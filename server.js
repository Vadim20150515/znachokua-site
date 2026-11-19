// Сервер каси ЗначокUA: роздає сторінку каси та API (/api/pos/)
const http = require("http"), fs = require("fs"), path = require("path");
try { // читаємо settings.env, якщо є (на хостингу використовуйте змінні Environment)
  for (const l of fs.readFileSync(path.join(__dirname, "settings.env"), "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !l.trim().startsWith("#") && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
const pos = require("./pos");
const PUB = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
if (!process.env.POS_OWNER_EMAIL || !process.env.POS_OWNER_PASSWORD) console.warn("УВАГА: не задано POS_OWNER_EMAIL / POS_OWNER_PASSWORD — увійти не вдасться.");
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/pos/")) return await pos(req, res, url);
    const f = path.join(PUB, url.pathname === "/" ? "index.html" : path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/, ""));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  } catch (e) { if (!res.headersSent) { res.writeHead(500); res.end("Помилка сервера"); } }
}).listen(process.env.PORT || 3000, () => console.log("Каса запущена: http://localhost:" + (process.env.PORT || 3000)));
