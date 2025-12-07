const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const crypto = require("crypto");
const { broadcastSOSMessage } = require("./smsService");

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from /public
app.use(express.static("public"));

// In-memory session store
// (resets on deployment — fine for MVP)
const sessions = new Map();       // sosId -> session
const tokenToSosId = new Map();   // shareToken -> sosId

// Live link expiry (e.g. 6 hours)
const LIVE_LINK_TTL_MS = 1000 * 60 * 60 * 6;

// Public base URL for live links
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://guardian-sos-api.onrender.com";

// Generate a random share token (shorter than UUID)
function generateShareToken() {
  return crypto.randomBytes(16).toString("hex"); // 32-char hex
}

// ===========================
//        SOS ROUTES
// ===========================

// Start SOS session
// Expects body:
// {
//   displayName: string,
//   latitude?: number,
//   longitude?: number,
//   startedAt: string (ISO),
//   contacts?: [{ name?: string, phone: string }]
// }
app.post("/api/sos/start", async (req, res) => {
  const { displayName, latitude, longitude, startedAt, contacts } = req.body || {};

  if (!displayName || !startedAt) {
    return res
      .status(400)
      .json({ error: "displayName and startedAt required" });
  }

  const sosId = uuidv4();
  const shareToken = generateShareToken();
  const timestamp = new Date(startedAt).toISOString();
  const expiresAt = new Date(Date.now() + LIVE_LINK_TTL_MS).toISOString();

  const location =
    latitude != null && longitude != null
      ? { latitude, longitude, timestamp }
      : null;

  // Normalize contacts into { name?, phone }
  const normalizedContacts = Array.isArray(contacts)
    ? contacts
        .map((c) => {
          if (!c) return null;
          const phone = typeof c.phone === "string" ? c.phone.trim() : "";
          if (!phone) return null;
          return {
            name: typeof c.name === "string" ? c.name.trim() : null,
            phone
          };
        })
        .filter(Boolean)
    : [];

  const session = {
    sosId,
    displayName,
    status: "active",
    startedAt: timestamp,
    lastLocation: location,
    locationHistory: location ? [location] : [],
    endedAt: null,
    endReason: null,
    shareToken,
    expiresAt,
    contacts: normalizedContacts
  };

  sessions.set(sosId, session);
  tokenToSosId.set(shareToken, sosId);

  console.log(
    `🆕 SOS started: ${sosId} (${displayName}) token=${shareToken} contacts=${normalizedContacts.length}`
  );

  // Build live link
  const liveURL = `${PUBLIC_BASE_URL}/live/${shareToken}`;

  // Build initial SOS SMS body
  let coordinateText = "Location: Unknown (location permission not granted).";
  if (location) {
    coordinateText = `Location: https://maps.apple.com/?ll=${location.latitude},${location.longitude}`;
  }

  let smsBody = `🚨 SOS from ${displayName}.\nI need help immediately.\n\n${coordinateText}\n\n`;
  smsBody += `Live tracking link (updates in real time):\n${liveURL}`;

  // Extract phone numbers for broadcast
  const recipientPhones = normalizedContacts.map((c) => c.phone);

  // Fire-and-forget Twilio send (don't block response if it fails)
  if (recipientPhones.length > 0) {
    broadcastSOSMessage(recipientPhones, smsBody)
      .then(() => {
        console.log(`✅ Initial SOS SMS sent to ${recipientPhones.length} contacts.`);
      })
      .catch((err) => {
        console.error("❌ Failed broadcasting initial SOS SMS:", err?.message || err);
      });
  } else {
    console.warn("⚠️ No contacts provided for SOS – no SMS sent.");
  }

  // Important: we now return BOTH sosId and shareToken (for the app)
  return res.json({ sosId, shareToken });
});

// Update location
app.post("/api/sos/update", (req, res) => {
  const { sosId, latitude, longitude, updatedAt } = req.body || {};

  if (!sosId) return res.status(400).json({ error: "sosId required" });

  const session = sessions.get(sosId);
  if (!session) return res.status(404).json({ error: "SOS not found" });

  const timestamp = updatedAt
    ? new Date(updatedAt).toISOString()
    : new Date().toISOString();

  const location = { latitude, longitude, timestamp };

  session.lastLocation = location;
  session.locationHistory.push(location);

  console.log(`📍 Update: ${sosId} -> ${latitude}, ${longitude}`);

  return res.json({ success: true });
});

// End SOS session
app.post("/api/sos/end", (req, res) => {
  const { sosId, endedAt, reason } = req.body || {};

  if (!sosId) return res.status(400).json({ error: "sosId required" });

  const session = sessions.get(sosId);
  if (!session) return res.status(404).json({ error: "SOS not found" });

  session.status = "ended";
  session.endReason = reason || "unknown";
  session.endedAt = endedAt
    ? new Date(endedAt).toISOString()
    : new Date().toISOString();

  console.log(`✅ SOS ended: ${sosId} (reason: ${session.endReason})`);

  return res.json({ success: true });
});

// ===========================
//      LIVE JSON API (TOKEN)
// ===========================

app.get("/api/live/token/:token", (req, res) => {
  const token = req.params.token;
  const sosId = tokenToSosId.get(token);

  if (!sosId) {
    return res.status(404).json({ error: "Live link not found" });
  }

  const session = sessions.get(sosId);
  if (!session) {
    return res.status(404).json({ error: "SOS not found" });
  }

  const now = Date.now();
  const expiry = session.expiresAt ? Date.parse(session.expiresAt) : null;

  if (expiry && now > expiry) {
    return res.status(410).json({ error: "Live link expired" });
  }

  // Don't leak the shareToken itself back out
  const { shareToken, contacts, ...publicSession } = session;
  res.json(publicSession);
});

// ===========================
//      LIVE DASHBOARD PAGE
// ===========================

app.get("/live/:token", (req, res) => {
  // We don't validate here; the JS inside will hit /api/live/token/:token
  res.sendFile(path.join(__dirname, "public", "live.html"));
});

// ===========================
//         ROOT
// ===========================

app.get("/", (req, res) => {
  res.send("GuardianSOS API running (secure links + Twilio SMS)");
});

// ===========================
//     START SERVER
// ===========================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 GuardianSOS API running on port ${PORT}`);
});
