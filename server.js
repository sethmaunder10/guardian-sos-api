const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from /public
app.use(express.static("public"));

// In-memory store for SOS sessions
// NOTE: This resets when the server restarts (fine for MVP).
const sessions = new Map();

// ===========================
//   SOS API ROUTES
// ===========================

/**
 * POST /api/sos/start
 * Body: { displayName, latitude?, longitude?, startedAt }
 * Returns: { sosId }
 */
app.post("/api/sos/start", (req, res) => {
  const { displayName, latitude, longitude, startedAt } = req.body || {};

  if (!displayName || !startedAt) {
    return res
      .status(400)
      .json({ error: "displayName and startedAt are required" });
  }

  const sosId = uuidv4();
  const now = startedAt ? new Date(startedAt) : new Date();

  const location =
    latitude != null && longitude != null
      ? {
          latitude,
          longitude,
          timestamp: now.toISOString()
        }
      : null;

  sessions.set(sosId, {
    sosId,
    displayName,
    startedAt: now.toISOString(),
    status: "active",
    lastLocation: location,
    locationHistory: location ? [location] : [],
    endReason: null,
    endedAt: null
  });

  console.log(`🆕 SOS started: ${sosId} (${displayName})`);

  return res.json({ sosId });
});

/**
 * POST /api/sos/update
 * Body: { sosId, latitude, longitude, updatedAt }
 */
app.post("/api/sos/update", (req, res) => {
  const { sosId, latitude, longitude, updatedAt } = req.body || {};

  if (!sosId) {
    return res.status(400).json({ error: "sosId is required" });
  }

  const session = sessions.get(sosId);
  if (!session) {
    return res.status(404).json({ error: "SOS session not found" });
  }

  const timestamp = updatedAt
    ? new Date(updatedAt).toISOString()
    : new Date().toISOString();

  const location = {
    latitude,
    longitude,
    timestamp
  };

  session.lastLocation = location;
  session.locationHistory.push(location);

  console.log(`📍 SOS update: ${sosId} -> ${latitude}, ${longitude}`);

  return res.json({ success: true });
});

/**
 * POST /api/sos/end
 * Body: { sosId, endedAt, reason }
 */
app.post("/api/sos/end", (req, res) => {
  const { sosId, endedAt, reason } = req.body || {};

  if (!sosId) {
    return res.status(400).json({ error: "sosId is required" });
  }

  const session = sessions.get(sosId);
  if (!session) {
    return res.status(404).json({ error: "SOS session not found" });
  }

  session.status = "ended";
  session.endedAt = (endedAt ? new Date(endedAt) : new Date()).toISOString();
  session.endReason = reason || "unknown";

  console.log(
    `✅ SOS ended: ${sosId} (reason: ${session.endReason})`
  );

  return res.json({ success: true });
});

// ===========================
//   LIVE JSON ENDPOINT
// ===========================

/**
 * GET /api/live/:sosId
 * Returns current snapshot of an SOS session
 */
app.get("/api/live/:sosId", (req, res) => {
  const sosId = req.params.sosId;
  const session = sessions.get(sosId);

  if (!session) {
    return res.status(404).json({ error: "SOS session not found" });
  }

  return res.json(session);
});

// ===========================
//   LIVE DASHBOARD PAGE
// ===========================

/**
 * GET /live/:sosId
 * Serves the dashboard HTML (which then calls /api/live/:sosId)
 */
app.get("/live/:sosId", (req, res) => {
  const filePath = path.join(__dirname, "public", "live.html");
  res.sendFile(filePath);
});

// Root route
app.get("/", (req, res) => {
  res.send("GuardianSOS API running");
});

// ===========================
//   START SERVER
// ===========================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 GuardianSOS API running on port ${PORT}`);
});
