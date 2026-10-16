// POST /api/log — receives console events, stores each as a JSON blob.
// Event types: prompt_click | message | sql | fallback
// Body: { "type": "...", "data": "..." } (any content-type; sendBeacon-safe)
// Degrades gracefully when BLOB_READ_WRITE_TOKEN is not configured.

var put = require("@vercel/blob").put;

var ALLOWED = { prompt_click: 1, message: 1, sql: 1, fallback: 1 };
var MAX_DATA = 2000;
var RATE_LIMIT = 40; // posts per IP per minute
var hits = new Map();

function rateLimited(ip) {
  var now = Date.now();
  var h = hits.get(ip);
  if (!h || now > h.reset) {
    hits.set(ip, { n: 1, reset: now + 60000 });
    return false;
  }
  h.n += 1;
  return h.n > RATE_LIMIT;
}

function rand(n) {
  var c = "abcdefghijklmnopqrstuvwxyz0123456789";
  var s = "";
  for (var i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

module.exports = async function (req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }
  // Auth: explicit BLOB_READ_WRITE_TOKEN if present, otherwise the SDK uses
  // ambient Vercel OIDC credentials (VERCEL_OIDC_TOKEN + BLOB_STORE_ID).
  var rwToken = process.env.BLOB_READ_WRITE_TOKEN || undefined;
  var ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    res.status(429).json({ ok: false });
    return;
  }
  var body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = null;
    }
  }
  if (!body || !ALLOWED[body.type] || typeof body.data !== "string") {
    res.status(400).json({ ok: false });
    return;
  }
  var now = new Date();
  var day = now.toISOString().slice(0, 10);
  var ts = now.toISOString().slice(11, 19).replace(/:/g, "-");
  var pathname = "logs/" + day + "/" + ts + "-" + rand(24) + ".json";
  var event = { type: body.type, data: body.data.slice(0, MAX_DATA), ts: now.toISOString() };
  try {
    await put(pathname, JSON.stringify(event), {
      access: "public",
      contentType: "application/json",
      token: rwToken,
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
};
