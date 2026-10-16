// GET /api/logs?token=... — token-protected viewer for console events.
// Renders a simple HTML page with the most recent events (Eastern time).

var list = require("@vercel/blob").list;

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

var LABELS = {
  prompt_click: "suggestion tapped",
  message: "message sent",
  sql: "SQL run",
  fallback: "fallback shown",
};

module.exports = async function (req, res) {
  var rwToken = process.env.BLOB_READ_WRITE_TOKEN;
  var viewToken = process.env.LOG_VIEW_TOKEN;
  if (!rwToken || !viewToken || req.query.token !== viewToken) {
    res.status(403).send("forbidden");
    return;
  }
  try {
    var blobs = [];
    var cursor = undefined;
    do {
      var page = await list({ prefix: "logs/", limit: 100, cursor: cursor, token: rwToken });
      blobs = blobs.concat(page.blobs);
      cursor = page.cursor;
    } while (cursor && blobs.length < 500);
    // Pathnames sort chronologically; newest first.
    blobs.sort(function (a, b) {
      return a.pathname < b.pathname ? 1 : -1;
    });
    var recent = blobs.slice(0, 100);
    var events = await Promise.all(
      recent.map(async function (b) {
        try {
          var r = await fetch(b.url, {
            headers: { authorization: "Bearer " + rwToken },
          });
          if (!r.ok) return null;
          return await r.json();
        } catch (e) {
          return null;
        }
      })
    );
    var rows = events
      .filter(Boolean)
      .map(function (e) {
        var when = "";
        try {
          when = new Date(e.ts).toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
          });
        } catch (err) {
          when = e.ts || "";
        }
        return (
          "<tr><td>" + esc(when) + "</td><td>" + esc(LABELS[e.type] || e.type || "") +
          "</td><td>" + esc(e.data || "") + "</td></tr>"
        );
      })
      .join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(
      "<!doctype html><html><head><meta charset='utf-8'>" +
        "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
        "<title>Console log</title>" +
        "<style>body{font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#f7f7f4;color:#26251e;padding:24px;max-width:960px;margin:0 auto}" +
        "h1{font-size:16px;font-weight:600}a{color:#f54e00}" +
        "table{border-collapse:collapse;width:100%;margin-top:16px}" +
        "td,th{border:1px solid rgba(38,37,30,.12);padding:8px 10px;text-align:left;vertical-align:top}" +
        "th{background:rgba(38,37,30,.05);font-weight:600;white-space:nowrap}" +
        "td:first-child{white-space:nowrap}</style></head><body>" +
        "<h1>SQL console — recent events</h1>" +
        "<p>" + events.filter(Boolean).length + " events shown (newest first), Eastern time.</p>" +
        "<table><tr><th>Time</th><th>Event</th><th>Text</th></tr>" + rows + "</table>" +
        "</body></html>"
    );
  } catch (e) {
    res.status(500).send("error reading logs");
  }
};
