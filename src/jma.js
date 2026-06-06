// 気象庁(JMA)の無料JSONから天気を取得・整形するモジュール。
// 公式エンドポイント（APIキー不要）:
//   https://www.jma.go.jp/bosai/forecast/data/forecast/{office}.json
//   https://www.jma.go.jp/bosai/forecast/data/overview_forecast/{office}.json
//
// JSONはバージョン保証のない「公開データ」なので、欠損に強い防御的パースにしている。

const FORECAST_URL = (office) =>
  `https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`;
const OVERVIEW_URL = (office) =>
  `https://www.jma.go.jp/bosai/forecast/data/overview_forecast/${office}.json`;

const UA = "stream-weather/1.0 (+JMA public data)";

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// 安全に配列要素を取る
const at = (arr, i) => (Array.isArray(arr) ? arr[i] : undefined);
// 空文字/未定義を null に
const clean = (v) => (v === "" || v == null ? null : v);

function parseForecast(data, city) {
  const ai = city.areaIndex ?? 0;
  const ti = city.tempIndex ?? 0;

  const short = at(data, 0) || {};
  const weekly = at(data, 1) || {};
  const sSeries = short.timeSeries || [];
  const wSeries = weekly.timeSeries || [];

  // --- 短期予報（今日・明日・明後日）---
  const wcTs = sSeries[0] || {};                 // 天気コード/天気文/風
  const popTs = sSeries[1] || {};                // 降水確率
  const wcArea = at(wcTs.areas, ai) || at(wcTs.areas, 0) || {};
  const popArea = at(popTs.areas, ai) || at(popTs.areas, 0) || {};
  const wcDefines = wcTs.timeDefines || [];

  const days = (wcArea.weatherCodes || []).map((code, i) => ({
    date: clean(at(wcDefines, i)),
    code: clean(code),
    text: clean(at(wcArea.weathers, i)),
    wind: clean(at(wcArea.winds, i)),
  }));

  // 降水確率は6時間刻み。今日ぶんの最大値を代表値にする。
  const todayDate = days[0]?.date ? days[0].date.slice(0, 10) : null;
  const todayPops = (popArea.pops || [])
    .map((p, i) => ({ p: clean(p), t: at(popTs.timeDefines, i) }))
    .filter((x) => x.p != null && (!todayDate || (x.t || "").startsWith(todayDate)))
    .map((x) => Number(x.p));
  const todayPop = todayPops.length ? Math.max(...todayPops) : null;

  // --- 週間予報 ---
  const wWeatherTs = wSeries[0] || {};           // 週間天気コード+降水確率
  const wTempTs = wSeries[1] || {};              // 週間最高/最低気温
  const wwArea = at(wWeatherTs.areas, ai) || at(wWeatherTs.areas, 0) || {};
  const wtArea = at(wTempTs.areas, ti) || at(wTempTs.areas, 0) || {};
  const weekDefines = wWeatherTs.timeDefines || [];

  const week = weekDefines.map((d, i) => ({
    date: clean(d),
    code: clean(at(wwArea.weatherCodes, i)),
    pop: clean(at(wwArea.pops, i)),
    tempMin: clean(at(wtArea.tempsMin, i)),
    tempMax: clean(at(wtArea.tempsMax, i)),
  }));

  // 今日の最高/最低は週間[0]を優先、無ければ短期気温から補完
  let todayMax = week[0]?.tempMax ?? null;
  let todayMin = week[0]?.tempMin ?? null;
  if (todayMax == null || todayMin == null) {
    const tempTs = sSeries[2] || {};
    const tArea = at(tempTs.areas, ti) || at(tempTs.areas, 0) || {};
    const temps = (tArea.temps || []).map(clean).filter((x) => x != null).map(Number);
    if (temps.length) {
      todayMin = todayMin ?? Math.min(...temps);
      todayMax = todayMax ?? Math.max(...temps);
    }
  }

  return {
    name: city.name,
    office: city.office,
    publishingOffice: short.publishingOffice || null,
    reportDatetime: short.reportDatetime || null,
    today: {
      date: days[0]?.date ?? null,
      code: days[0]?.code ?? null,
      text: days[0]?.text ?? null,
      pop: todayPop,
      tempMax: todayMax != null ? Number(todayMax) : null,
      tempMin: todayMin != null ? Number(todayMin) : null,
    },
    days,   // 今日/明日/明後日
    week,   // 週間
  };
}

async function fetchCity(city) {
  const data = await getJson(FORECAST_URL(city.office));
  const parsed = parseForecast(data, city);
  return parsed;
}

async function fetchOverview(office) {
  try {
    const o = await getJson(OVERVIEW_URL(office));
    return clean(o.text) ? o.text.replace(/\n+/g, " ").trim() : null;
  } catch {
    return null;
  }
}

async function fetchAll(cities) {
  const out = [];
  for (const city of cities) {
    try {
      out.push(await fetchCity(city));
    } catch (e) {
      console.error(`[jma] ${city.name}(${city.office}) 取得失敗: ${e.message}`);
      out.push({ name: city.name, office: city.office, error: e.message });
    }
  }
  return out;
}

module.exports = { fetchAll, fetchCity, fetchOverview };
