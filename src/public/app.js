// ダッシュボード描画ロジック（NCM風 3ゾーン構成）。
//  - 左端: 今日の24時間天気（都市ローテ）
//  - 中央: 全国の警報・注意報 / 台風 / PM2.5 をローテ（切替時に mei_sad で読み上げ）
//  - 最下部: 週間天気予報（都市ローテ）
//  - 音声: BGM(<audio>)＋TTS(Web Audio)。ffmpegがPulseAudioで取り込む。
"use strict";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const HOURLY_MS = 12000;   // 左端の都市切替
const WEEKLY_MS = 12000;   // 週間の都市切替
const CENTER_MS = 15000;   // 中央パネル切替

// 時刻は常に日本時間(JST/GMT+9)。コンテナTZに依存しないようIntlで明示。
const TZ = "Asia/Tokyo";
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const JST_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23",
});
function jst(date) {
  const o = {};
  for (const p of JST_FMT.formatToParts(date)) if (p.type !== "literal") o[p.type] = p.value;
  o.dow = WD[o.weekday];
  return o;
}

let wx = null;          // 天気データ /api/weather
let national = null;    // 全国情報 /api/national
let hourlyIndex = 0;
let weeklyIndex = 0;
let panelIndex = 0;

// ===== 天気コード → 絵文字 =====
function icon(code) {
  const c = String(code || "");
  const n = parseInt(c, 10);
  if (!n) return "❓";
  if (n >= 400) return /0[34]|6|7/.test(c) ? "🌨️" : "❄️";
  if (n >= 300) return /0[34]|13|14|15|16/.test(c) ? "⛈️" : "🌧️";
  if (n >= 200) { if (/0[1]/.test(c)) return "⛅"; if (/1[0-9]|2[0-9]/.test(c)) return "🌥️"; return "☁️"; }
  if (n >= 100) { if (c === "100") return "☀️"; if (/0[12]|10|11/.test(c)) return "🌤️"; if (/0[3-9]|2[0-9]|3[0-9]/.test(c)) return "🌦️"; return "🌤️"; }
  return "🌡️";
}
function num(v, suffix = "") {
  return v == null || v === "" || Number.isNaN(Number(v)) ? "--" : `${v}${suffix}`;
}

// ===== 時計 =====
function renderClock() {
  const p = jst(new Date());
  document.getElementById("date").textContent = `${+p.year}年${+p.month}月${+p.day}日（${DOW[p.dow]}）`;
  document.getElementById("time").textContent = `${p.hour}:${p.minute}:${p.second}`;
}

// ===== 左端: 今日の24時間天気 =====
function renderHourly() {
  if (!wx) return;
  const valid = wx.cities.filter((c) => !c.error);
  if (!valid.length) return;
  hourlyIndex %= valid.length;
  const c = valid[hourlyIndex];
  document.getElementById("hourly-city").textContent = `［${c.name}］`;
  const t = c.today || {};
  document.getElementById("hourly-head").innerHTML = `
    <div class="icon">${icon(t.code)}</div>
    <div class="temps"><span class="tmax">${num(t.tempMax)}℃</span><span class="tmin">${num(t.tempMin)}℃</span></div>
    <div class="wtext">${(t.text || "").replace(/\s+/g, "")}</div>`;
  const list = document.getElementById("hourly-list");
  list.className = "hourly-list fade";
  list.innerHTML = "";
  for (const s of c.series || []) {
    const p = jst(new Date(s.time));
    const row = document.createElement("div");
    row.className = "hrow";
    row.innerHTML = `
      <span class="htime">${p.hour}時</span>
      <span class="hicon">${icon(s.code)}</span>
      <span class="hpop">${num(s.pop, "%")}</span>
      <span class="htemp">${s.temp != null ? s.temp + "℃" : "―"}</span>`;
    list.appendChild(row);
  }
}

// ===== 最下部: 週間予報 =====
function renderWeekly() {
  if (!wx) return;
  const valid = wx.cities.filter((c) => !c.error && Array.isArray(c.week) && c.week.length);
  if (!valid.length) return;
  weeklyIndex %= valid.length;
  const c = valid[weeklyIndex];
  document.getElementById("weekly-city").textContent = `［${c.name}］`;
  const root = document.getElementById("week");
  root.className = "week fade";
  root.innerHTML = "";
  for (const day of c.week.slice(0, 7)) {
    const p = day.date ? jst(new Date(day.date)) : null;
    const dowIdx = p ? p.dow : -1;
    const dowCls = dowIdx === 0 ? "sun" : dowIdx === 6 ? "sat" : "";
    const md = p ? `${+p.month}/${+p.day}` : "--";
    const dow = dowIdx >= 0 ? DOW[dowIdx] : "-";
    const el = document.createElement("div");
    el.className = "day";
    el.innerHTML = `
      <div class="dow ${dowCls}">${dow}</div>
      <div class="md">${md}</div>
      <div class="icon">${icon(day.code)}</div>
      <div class="temps"><span class="tmax">${num(day.tempMax)}</span><span class="tmin">${num(day.tempMin)}</span></div>
      <div class="pop">${num(day.pop, "%")}</div>`;
    root.appendChild(el);
  }
}

// ===== 中央: 全国情報パネル =====
function renderWarnPanel() {
  const w = national && national.warnings;
  if (!w || w.none) return `<div class="panel-none">現在、特別警報・警報・注意報はありません</div>`;
  const groups = [["特別警報", "special"], ["警報", "alert"], ["注意報", "advis"]];
  let html = "";
  for (const [level, cls] of groups) {
    const arr = (w.byLevel && w.byLevel[level]) || [];
    if (!arr.length) continue;
    html += `<div class="warn-group"><span class="warn-label ${cls}">${level}　${arr.length}地域</span><div class="warn-items">`;
    for (const it of arr) html += `<span class="warn-pref"><b>${it.pref}</b>${it.names.join("・")}</span>`;
    html += `</div></div>`;
  }
  return html || `<div class="panel-none">現在、特別警報・警報・注意報はありません</div>`;
}
function renderTyphoonPanel() {
  const t = national && national.typhoon;
  if (!t || !t.active || !t.typhoons.length) return `<div class="panel-none">現在、台風の発生はありません</div>`;
  let html = "";
  for (const ty of t.typhoons) {
    const numStr = ty.number ? `台風第${Number(String(ty.number).slice(2))}号` : "台風";
    html += `<div class="ty"><div><span class="ty-name">${numStr}　${ty.name || ""}</span><span class="ty-cat">${ty.category || ""}</span></div>`;
    if (ty.location) html += `<div class="ty-row">中心位置：<b>${ty.location}</b></div>`;
    if (ty.pressure) html += `<div class="ty-row">中心気圧：<b>${ty.pressure}hPa</b></div>`;
    if (ty.course || ty.speed) html += `<div class="ty-row">進行：<b>${ty.course || ""} ${ty.speed ? ty.speed + "km/h" : ""}</b></div>`;
    html += `</div>`;
  }
  return html;
}
function renderPm25Panel() {
  return `<div class="pm25-wrap"><img src="/api/pm25.png?t=${Date.now()}" onerror="pm25Failed(this)"></div>`;
}
window.pm25Failed = function (img) {
  const wrap = img.parentNode;
  if (wrap) wrap.innerHTML = `<div class="panel-none">PM2.5予測画像は準備中です<br>（取得元URL未設定: 環境変数 PM25_IMAGE_URL）</div>`;
};

const PANELS = [
  { key: "warn", title: "全国の 警報・注意報", phrase: "全国の警報・注意報です。", render: renderWarnPanel },
  { key: "typhoon", title: "全国の 台風情報", phrase: "全国の台風情報です。", render: renderTyphoonPanel },
  { key: "pm25", title: "全国の PM2.5分布予測", phrase: "全国のPM2.5分布予測です。", render: renderPm25Panel },
];
function showPanel(i) {
  const p = PANELS[i];
  speak(p.phrase);
  const el = document.getElementById("panel");
  el.classList.remove("fade"); void el.offsetWidth; el.classList.add("fade");
  el.innerHTML = `<div class="panel-title">${p.title}</div><div class="panel-body">${p.render()}</div>`;
}

// ===== 音声: BGM(<audio>) ＋ TTS(Web Audio) =====
let actx = null, bgmGain = null, ttsGain = null;
let bgmTracks = [], bgmIndex = 0;
const ttsBufCache = {};
const bgmEl = document.getElementById("bgm");

function initAudio() {
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    bgmGain = actx.createGain(); bgmGain.gain.value = 1.0; bgmGain.connect(actx.destination);
    ttsGain = actx.createGain(); ttsGain.gain.value = 1.0; ttsGain.connect(actx.destination);
    const src = actx.createMediaElementSource(bgmEl);
    src.connect(bgmGain);
  } catch (e) { console.error("audio init", e); }
}
function setNowPlaying(t) {
  const el = document.getElementById("nowplaying");
  if (!el) return;
  el.textContent = t ? "♪ " + (t.artist ? `${t.title} ／ ${t.artist}` : t.title) : "♪ BGM：なし（無音）";
}
function playBgm() {
  if (!bgmTracks.length) { setNowPlaying(null); return; }
  bgmIndex %= bgmTracks.length;
  const t = bgmTracks[bgmIndex];
  bgmEl.src = t.url;
  bgmEl.play().catch(() => {});
  setNowPlaying(t);
}
bgmEl.addEventListener("ended", () => { bgmIndex = (bgmIndex + 1) % Math.max(bgmTracks.length, 1); playBgm(); });
async function loadBgm() {
  try {
    const r = await fetch("/api/bgm", { cache: "no-store" });
    const j = await r.json();
    bgmTracks = (j && j.tracks) || [];
  } catch { bgmTracks = []; }
  playBgm();
}
function duck(on) {
  if (!actx || !bgmGain) return;
  const now = actx.currentTime;
  bgmGain.gain.cancelScheduledValues(now);
  bgmGain.gain.linearRampToValueAtTime(on ? 0.22 : 1.0, now + 0.25);
}
async function ttsBuffer(text, speaker) {
  const key = speaker + "|" + text;
  if (ttsBufCache[key]) return ttsBufCache[key];
  const r = await fetch(`/api/tts?text=${encodeURIComponent(text)}&speaker=${speaker}`);
  if (!r.ok) throw new Error("tts " + r.status);
  const ab = await r.arrayBuffer();
  const buf = await actx.decodeAudioData(ab);
  ttsBufCache[key] = buf;
  return buf;
}
async function speak(text, speaker = "mei_sad") {
  if (!actx) return;
  try {
    if (actx.state === "suspended") await actx.resume();
    const buf = await ttsBuffer(text, speaker);
    duck(true);
    const node = actx.createBufferSource();
    node.buffer = buf;
    node.connect(ttsGain);
    node.onended = () => duck(false);
    node.start();
  } catch (e) { duck(false); /* 失敗時は無音スキップ */ }
}

// ===== データ取得 =====
async function fetchWeather() {
  try {
    const r = await fetch("/api/weather", { cache: "no-store" });
    const j = await r.json();
    if (j && Array.isArray(j.cities) && j.cities.length) {
      wx = j;
      renderHourly();
      renderWeekly();
      const u = document.getElementById("updated");
      if (j.updatedAt) { const p = jst(new Date(j.updatedAt)); u.textContent = `最終更新：${p.hour}:${p.minute}`; }
    }
  } catch (e) { console.error("weather", e); }
}
async function fetchNational() {
  try {
    const r = await fetch("/api/national", { cache: "no-store" });
    national = await r.json();
  } catch (e) { console.error("national", e); }
}

// ===== 起動 =====
renderClock();
setInterval(renderClock, 1000);

initAudio();
(async () => {
  await fetchWeather();
  await fetchNational();
  await loadBgm();
  showPanel(0);
})();

setInterval(fetchWeather, 5 * 60 * 1000);
setInterval(fetchNational, 5 * 60 * 1000);

setInterval(() => { hourlyIndex += 1; renderHourly(); }, HOURLY_MS);
setInterval(() => { weeklyIndex += 1; renderWeekly(); }, WEEKLY_MS);
setInterval(() => { panelIndex = (panelIndex + 1) % PANELS.length; showPanel(panelIndex); }, CENTER_MS);
