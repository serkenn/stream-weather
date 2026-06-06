// ダッシュボード描画ロジック。
//  - /api/weather を定期取得してカードを更新
//  - 週間予報は地点を一定間隔でローテーション表示
//  - 時計は毎秒更新
"use strict";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const ROTATE_MS = 12000; // 週間予報の地点切替間隔

// 表示は常に日本時間(JST/GMT+9)。コンテナのTZに依存しないようIntlで明示する。
const TZ = "Asia/Tokyo";
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const JST_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  weekday: "short", hourCycle: "h23",
});
// Date → JSTの各フィールド {year,month,day,hour,minute,second,weekday,dow}
function jst(date) {
  const o = {};
  for (const p of JST_FMT.formatToParts(date)) if (p.type !== "literal") o[p.type] = p.value;
  o.dow = WD[o.weekday];
  return o;
}

let data = null;
let rotateIndex = 0;

// 気象庁の天気コード → 絵文字アイコン
function icon(code) {
  const c = String(code || "");
  const n = parseInt(c, 10);
  if (!n) return "❓";
  // 雪系 4xx
  if (n >= 400) {
    if (/0[34]|6|7/.test(c)) return "🌨️"; // 雪/みぞれ寄り
    return "❄️";
  }
  // 雨系 3xx
  if (n >= 300) {
    if (/0[34]|13|14|15|16/.test(c)) return "⛈️"; // 雷雨寄り
    return "🌧️";
  }
  // くもり系 2xx
  if (n >= 200) {
    if (/0[1]/.test(c)) return "⛅"; // くもり時々晴れ
    if (/1[0-9]|2[0-9]/.test(c)) return "🌥️";
    return "☁️";
  }
  // 晴れ系 1xx
  if (n >= 100) {
    if (c === "100") return "☀️";
    if (/0[12]|10|11/.test(c)) return "🌤️"; // 晴れ時々/のち くもり
    if (/0[3-9]|2[0-9]|3[0-9]/.test(c)) return "🌦️"; // 晴れ一時雨など
    return "🌤️";
  }
  return "🌡️";
}

function num(v, suffix = "") {
  return v == null || v === "" || Number.isNaN(Number(v)) ? "--" : `${v}${suffix}`;
}

function renderClock() {
  const p = jst(new Date());
  document.getElementById("date").textContent =
    `${+p.year}年${+p.month}月${+p.day}日（${DOW[p.dow]}）`;
  document.getElementById("time").textContent = `${p.hour}:${p.minute}:${p.second}`;
}

function renderCards() {
  if (!data) return;
  const root = document.getElementById("cards");
  root.innerHTML = "";
  for (const c of data.cities) {
    const el = document.createElement("div");
    el.className = "card" + (c.error ? " err" : "");
    if (c.error) {
      el.innerHTML = `<div class="city">${c.name}</div><div class="icon">⚠️</div><div class="wtext">取得失敗</div>`;
    } else {
      const t = c.today || {};
      el.innerHTML = `
        <div class="city">${c.name}</div>
        <div class="icon">${icon(t.code)}</div>
        <div class="wtext">${(t.text || "").replace(/\s+/g, "")}</div>
        <div class="temps">
          <span class="tmax">${num(t.tempMax)}<span class="unit">℃</span></span>
          <span class="tmin">${num(t.tempMin)}<span class="unit">℃</span></span>
        </div>
        <div class="pop">降水 ${num(t.pop, "%")}</div>`;
    }
    root.appendChild(el);
  }
}

function renderWeekly() {
  if (!data) return;
  const valid = data.cities.filter((c) => !c.error && Array.isArray(c.week) && c.week.length);
  if (!valid.length) return;
  rotateIndex = rotateIndex % valid.length;
  const c = valid[rotateIndex];

  document.getElementById("weekly-city").textContent = `［${c.name}］`;
  const root = document.getElementById("week");
  root.className = "week fade";
  root.innerHTML = "";
  // void→reflowでアニメ再生
  void root.offsetWidth;
  root.classList.add("fade");

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
      <div class="temps">
        <span class="tmax">${num(day.tempMax)}</span>
        <span class="tmin">${num(day.tempMin)}</span>
      </div>
      <div class="pop">${num(day.pop, "%")}</div>`;
    root.appendChild(el);
  }
}

function renderUpdated() {
  const u = document.getElementById("updated");
  if (data && data.updatedAt) {
    const p = jst(new Date(data.updatedAt));
    u.textContent = `最終更新：${p.hour}:${p.minute}`;
  }
}

async function fetchData() {
  try {
    const res = await fetch("/api/weather", { cache: "no-store" });
    const json = await res.json();
    if (json && Array.isArray(json.cities) && json.cities.length) {
      data = json;
      renderCards();
      renderWeekly();
      renderUpdated();
    }
  } catch (e) {
    console.error("fetch error", e);
  }
}

// 起動
renderClock();
setInterval(renderClock, 1000);

fetchData();
setInterval(fetchData, 5 * 60 * 1000); // 5分ごとに再取得

setInterval(() => {
  rotateIndex += 1;
  renderWeekly();
}, ROTATE_MS);
