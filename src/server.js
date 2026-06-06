// 依存ゼロのHTTPサーバ。
//  - 静的ファイル(public/)を配信
//  - /api/weather で整形済み天気データを返す
//  - バックグラウンドで気象庁データを定期取得しキャッシュ
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const cities = require("./cities");
const jma = require("./jma");

const PORT = Number(process.env.PORT || 8080);
// 取得間隔（分）。気象庁の更新は5/11/17時前後なので10分間隔で十分。
const UPDATE_MIN = Number(process.env.UPDATE_INTERVAL_MIN || 10);
const PUBLIC_DIR = path.join(__dirname, "public");

// BGMの「再生中」表示用。ffmpegと同一コンテナ内の /tmp を共有して連携する。
const BGM_PLAYLIST = process.env.BGM_PLAYLIST || "/tmp/bgm.txt";
const BGM_START_FILE = process.env.BGM_START_FILE || "/tmp/bgm-start";

let cache = { updatedAt: null, cities: [] };

// ===== BGM 現在再生中の算出 =====
let bgmTracks = [];      // [{title, artist, duration}]（プレイリスト順）
let bgmTotal = 0;        // 全曲合計秒
let bgmListMtime = -1;

function ffprobe(file) {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", file],
      (err, stdout) => {
        if (err) return resolve({ duration: 0, title: null, artist: null });
        try {
          const f = (JSON.parse(stdout).format) || {};
          const t = f.tags || {};
          resolve({
            duration: parseFloat(f.duration) || 0,
            title: t.title || t.TITLE || null,
            artist: t.artist || t.ARTIST || t.album_artist || null,
          });
        } catch {
          resolve({ duration: 0, title: null, artist: null });
        }
      }
    );
  });
}

function parsePlaylist() {
  try {
    return fs.readFileSync(BGM_PLAYLIST, "utf8")
      .split("\n")
      .map((l) => l.match(/^file\s+'(.*)'\s*$/))
      .filter(Boolean)
      .map((m) => m[1].replace(/'\\''/g, "'"));
  } catch {
    return [];
  }
}

async function refreshBgm() {
  let mtime;
  try { mtime = fs.statSync(BGM_PLAYLIST).mtimeMs; } catch { return; }
  if (mtime === bgmListMtime && bgmTracks.length) return;
  const files = parsePlaylist();
  const tracks = [];
  for (const f of files) {
    const meta = await ffprobe(f);
    const base = f.split("/").pop().replace(/\.[^.]+$/, "");
    tracks.push({ title: meta.title || base, artist: meta.artist || null, duration: meta.duration || 0 });
  }
  bgmTracks = tracks;
  bgmTotal = tracks.reduce((s, t) => s + t.duration, 0);
  bgmListMtime = mtime;
  console.log(`[server] BGM ${tracks.length}曲を認識（計${Math.round(bgmTotal)}秒）`);
}

function nowPlaying() {
  if (!bgmTracks.length || bgmTotal <= 0) return { playing: false };
  let start = 0;
  try { start = parseInt(String(fs.readFileSync(BGM_START_FILE, "utf8")).trim(), 10); } catch {}
  if (!start) return { playing: false };
  let elapsed = (Date.now() - start) / 1000;
  if (!(elapsed >= 0)) elapsed = 0;
  elapsed %= bgmTotal;
  let acc = 0;
  for (let i = 0; i < bgmTracks.length; i++) {
    acc += bgmTracks[i].duration;
    if (elapsed < acc) {
      const t = bgmTracks[i];
      return { playing: true, title: t.title, artist: t.artist, index: i, count: bgmTracks.length };
    }
  }
  const t = bgmTracks[bgmTracks.length - 1];
  return { playing: true, title: t.title, artist: t.artist, index: bgmTracks.length - 1, count: bgmTracks.length };
}

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
  if (req.url.startsWith("/api/nowplaying")) {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify(nowPlaying()));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[server] dashboard listening on http://localhost:${PORT}`);
  refresh();
  setInterval(refresh, UPDATE_MIN * 60 * 1000);
  // BGMプレイリストはffmpeg起動後に生成されるため、定期的に取り込む
  refreshBgm();
  setInterval(refreshBgm, 30 * 1000);
});
