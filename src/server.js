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
const nat = require("./national");

const PORT = Number(process.env.PORT || 8080);
// 取得間隔（分）。気象庁の更新は5/11/17時前後なので10分間隔で十分。
const UPDATE_MIN = Number(process.env.UPDATE_INTERVAL_MIN || 10);
const PUBLIC_DIR = path.join(__dirname, "public");

// BGMはブラウザ再生（ffmpegがPulseAudioで取り込む）。サーバは一覧と音源配信のみ担当。
const BGM_DIR = process.env.BGM_DIR || "/app/bgm";
const AUDIO_EXT = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg"]);
// OpenJTalk TTS（swiftlybot）中継先
const TTS_URL = process.env.TTS_URL || "https://openjtalk-api.swiftlybot.com/synthesis";
// 全国PM2.5分布予測の画像URL（SPRINTARS等）。未設定ならPM2.5パネルは取得不可表示。
const PM25_IMAGE_URL = process.env.PM25_IMAGE_URL || "";

let cache = { updatedAt: null, cities: [] };
let national = {
  warnings: { byLevel: { 特別警報: [], 警報: [], 注意報: [] }, count: { 特別警報: 0, 警報: 0, 注意報: 0 }, none: true },
  typhoon: { active: false, typhoons: [] },
  updatedAt: null,
};

// ===== BGM 一覧（ffprobeでタグ・長さを取得） =====
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

let bgmList = [];
let bgmMtime = -1;
async function refreshBgm() {
  let mtime;
  try { mtime = fs.statSync(BGM_DIR).mtimeMs; } catch { return; }
  if (mtime === bgmMtime && bgmList.length) return;
  let files = [];
  try {
    files = fs.readdirSync(BGM_DIR).filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase())).sort();
  } catch { files = []; }
  const out = [];
  for (const f of files) {
    const meta = await ffprobe(path.join(BGM_DIR, f));
    const base = f.replace(/\.[^.]+$/, "");
    out.push({
      file: f,
      url: "/bgm/" + encodeURIComponent(f),
      title: meta.title || base,
      artist: meta.artist || null,
      duration: meta.duration || 0,
    });
  }
  bgmList = out;
  bgmMtime = mtime;
  console.log(`[server] BGM ${out.length}曲を認識`);
}

// ===== 全国情報（警報・注意報＋台風） =====
async function refreshNational() {
  try {
    national = await nat.fetchNational();
    console.log(`[server] 全国情報更新: 警報注意報 ${JSON.stringify(national.warnings.count)} / 台風 ${national.typhoon.active ? "あり" : "なし"}`);
  } catch (e) {
    console.error("[server] 全国情報更新失敗:", e.message);
  }
}

// ===== TTS 中継（text+speaker+speedでキャッシュ） =====
const ttsCache = new Map();
async function synthTTS(text, speaker, speed) {
  const key = `${speaker}|${speed}|${text}`;
  if (ttsCache.has(key)) return ttsCache.get(key);
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, speaker, speed }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (ttsCache.size > 50) ttsCache.clear();
  ttsCache.set(key, buf);
  return buf;
}

// ===== PM2.5 画像プロキシ（取得をキャッシュ） =====
let pm25Cache = { buf: null, at: 0, type: "image/png" };
const PM25_TTL = 30 * 60 * 1000;
async function getPm25() {
  if (!PM25_IMAGE_URL) return null;
  if (pm25Cache.buf && Date.now() - pm25Cache.at < PM25_TTL) return pm25Cache;
  const res = await fetch(PM25_IMAGE_URL, { headers: { "User-Agent": "stream-weather/1.0" } });
  if (!res.ok) throw new Error(`PM2.5 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  pm25Cache = { buf, at: Date.now(), type: res.headers.get("content-type") || "image/png" };
  return pm25Cache;
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
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
};

// BGM音源をブラウザへ配信（BGM_DIRからのみ・トラバーサル防止）
function serveBgm(req, res) {
  const name = decodeURIComponent(req.url.split("?")[0].replace(/^\/bgm\//, ""));
  const filePath = path.normalize(path.join(BGM_DIR, name));
  if (!filePath.startsWith(path.normalize(BGM_DIR))) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404).end("Not Found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  });
}

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
  if (req.url.startsWith("/api/national")) {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify(national));
    return;
  }
  if (req.url.startsWith("/api/bgm")) {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify({ tracks: bgmList }));
    return;
  }
  if (req.url.startsWith("/bgm/")) {
    serveBgm(req, res);
    return;
  }
  if (req.url.startsWith("/api/tts")) {
    const q = new URL(req.url, "http://localhost").searchParams;
    const text = (q.get("text") || "").slice(0, 500);
    const speaker = q.get("speaker") || "mei_sad";
    const speed = Number(q.get("speed") || 1.0);
    if (!text) { res.writeHead(400).end("text required"); return; }
    synthTTS(text, speaker, speed)
      .then((buf) => {
        res.writeHead(200, { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=3600" });
        res.end(buf);
      })
      .catch((e) => { res.writeHead(502).end("TTS error: " + e.message); });
    return;
  }
  if (req.url.startsWith("/api/pm25.png")) {
    getPm25()
      .then((c) => {
        if (!c) { res.writeHead(404).end("PM25 not configured"); return; }
        res.writeHead(200, { "Content-Type": c.type, "Cache-Control": "public, max-age=600" });
        res.end(c.buf);
      })
      .catch((e) => { res.writeHead(502).end("PM25 error: " + e.message); });
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`[server] dashboard listening on http://localhost:${PORT}`);
  refresh();
  setInterval(refresh, UPDATE_MIN * 60 * 1000);
  refreshNational();
  setInterval(refreshNational, 5 * 60 * 1000);
  refreshBgm();
  setInterval(refreshBgm, 30 * 1000);
});
