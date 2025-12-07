// smsService.js
const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

let client = null;

if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
} else {
  console.warn("⚠️ Twilio credentials missing – SMS sending disabled.");
}

/**
 * Send a single SOS-related SMS.
 * @param {string} to - Recipient phone number in E.164 format (+44...)
 * @param {string} body - Message body
 */
async function sendSOSMessage(to, body) {
  if (!client || !fromNumber) {
    console.error("❌ Twilio not configured. Skipping SMS send.");
    return;
  }

  try {
    const res = await client.messages.create({
      body,
      from: fromNumber,
      to
    });
    console.log(`📨 SMS sent to ${to}: ${res.sid}`);
  } catch (err) {
    console.error("❌ Failed to send SMS:", err?.message || err);
  }
}

/**
 * Send the same SOS message to many contacts.
 * @param {string[]} recipients - Array of phone numbers
 * @param {string} body - Message body
 */
async function broadcastSOSMessage(recipients, body) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    console.warn("⚠️ broadcastSOSMessage called with no recipients.");
    return;
  }

  await Promise.all(
    recipients.map((to) => sendSOSMessage(to, body))
  );
}

module.exports = {
  sendSOSMessage,
  broadcastSOSMessage
};
