// 依存ゼロのHTTPサーバ。
//  - 静的ファイル(public/)を配信
//  - /api/weather で整形済み天気データを返す
//  - バックグラウンドで気象庁データを定期取得しキャッシュ
const http = require("http");
const fs = require("fs");
const path = require("path");

const cities = require("./cities");
const jma = require("./jma");

const PORT = Number(process.env.PORT || 8080);
// 取得間隔（分）。気象庁の更新は5/11/17時前後なので10分間隔で十分。
const UPDATE_MIN = Number(process.env.UPDATE_INTERVAL_MIN || 10);
const PUBLIC_DIR = path.join(__dirname, "public");

let cache = { updatedAt: null, cities: [] };

async function refresh() {
  try {
    const data = await jma.fetchAll(cities);
    cache = { updatedAt: new Date().toISOString(), cities: data };
    console.log(`[server] 天気データ更新: ${data.length}地点 @ ${cache.updatedAt}`);
  } catch (e) {
    console.error("[server] 更新失敗:", e.message);
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  // ディレクトリトラバーサル防止
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404).end("Not Found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (req.url.startsWith("/api/weather")) {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify(cache));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[server] dashboard listening on http://localhost:${PORT}`);
  refresh();
  setInterval(refresh, UPDATE_MIN * 60 * 1000);
});
