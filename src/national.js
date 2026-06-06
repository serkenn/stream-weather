// 全国の「警報・注意報」と「台風情報」を気象庁の無料JSONから集約するモジュール。
//   警報・注意報: https://www.jma.go.jp/bosai/warning/data/warning/{office}.json
//   台風一覧:     https://www.jma.go.jp/bosai/information/data/typhoon.json
//   台風詳細:     https://www.jma.go.jp/bosai/typhoon/data/{eventId}/specifications.json

const UA = "stream-weather/1.0 (+JMA public data)";

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// 全58府県予報区オフィス（北海道7・沖縄4・鹿児島2分割を含む）
const OFFICES = [
  { code: "011000", name: "宗谷" }, { code: "012000", name: "上川・留萌" },
  { code: "013000", name: "網走・北見・紋別" }, { code: "014030", name: "十勝" },
  { code: "014100", name: "釧路・根室" }, { code: "015000", name: "胆振・日高" },
  { code: "016000", name: "石狩・空知・後志" }, { code: "017000", name: "渡島・檜山" },
  { code: "020000", name: "青森県" }, { code: "030000", name: "岩手県" },
  { code: "040000", name: "宮城県" }, { code: "050000", name: "秋田県" },
  { code: "060000", name: "山形県" }, { code: "070000", name: "福島県" },
  { code: "080000", name: "茨城県" }, { code: "090000", name: "栃木県" },
  { code: "100000", name: "群馬県" }, { code: "110000", name: "埼玉県" },
  { code: "120000", name: "千葉県" }, { code: "130000", name: "東京都" },
  { code: "140000", name: "神奈川県" }, { code: "150000", name: "新潟県" },
  { code: "160000", name: "富山県" }, { code: "170000", name: "石川県" },
  { code: "180000", name: "福井県" }, { code: "190000", name: "山梨県" },
  { code: "200000", name: "長野県" }, { code: "210000", name: "岐阜県" },
  { code: "220000", name: "静岡県" }, { code: "230000", name: "愛知県" },
  { code: "240000", name: "三重県" }, { code: "250000", name: "滋賀県" },
  { code: "260000", name: "京都府" }, { code: "270000", name: "大阪府" },
  { code: "280000", name: "兵庫県" }, { code: "290000", name: "奈良県" },
  { code: "300000", name: "和歌山県" }, { code: "310000", name: "鳥取県" },
  { code: "320000", name: "島根県" }, { code: "330000", name: "岡山県" },
  { code: "340000", name: "広島県" }, { code: "350000", name: "山口県" },
  { code: "360000", name: "徳島県" }, { code: "370000", name: "香川県" },
  { code: "380000", name: "愛媛県" }, { code: "390000", name: "高知県" },
  { code: "400000", name: "福岡県" }, { code: "410000", name: "佐賀県" },
  { code: "420000", name: "長崎県" }, { code: "430000", name: "熊本県" },
  { code: "440000", name: "大分県" }, { code: "450000", name: "宮崎県" },
  { code: "460100", name: "鹿児島県" }, { code: "460040", name: "奄美" },
  { code: "471000", name: "沖縄本島" }, { code: "472000", name: "大東島" },
  { code: "473000", name: "宮古島" }, { code: "474000", name: "八重山" },
];

// 気象警報・注意報コード → 名称・レベル
const WCODE = {
  "32": ["暴風雪特別警報", "特別警報"], "33": ["大雨特別警報", "特別警報"],
  "35": ["暴風特別警報", "特別警報"], "36": ["大雪特別警報", "特別警報"],
  "37": ["波浪特別警報", "特別警報"], "38": ["高潮特別警報", "特別警報"],
  "02": ["暴風雪警報", "警報"], "03": ["大雨警報", "警報"], "04": ["洪水警報", "警報"],
  "05": ["暴風警報", "警報"], "06": ["大雪警報", "警報"], "07": ["波浪警報", "警報"],
  "08": ["高潮警報", "警報"],
  "10": ["大雨注意報", "注意報"], "12": ["大雪注意報", "注意報"], "13": ["風雪注意報", "注意報"],
  "14": ["雷注意報", "注意報"], "15": ["強風注意報", "注意報"], "16": ["波浪注意報", "注意報"],
  "17": ["融雪注意報", "注意報"], "18": ["洪水注意報", "注意報"], "19": ["高潮注意報", "注意報"],
  "20": ["濃霧注意報", "注意報"], "21": ["乾燥注意報", "注意報"], "22": ["なだれ注意報", "注意報"],
  "23": ["低温注意報", "注意報"], "24": ["霜注意報", "注意報"], "25": ["着氷注意報", "注意報"],
  "26": ["着雪注意報", "注意報"],
};
const LEVEL_ORDER = { 特別警報: 0, 警報: 1, 注意報: 2 };

// 1オフィス分の有効な警報・注意報コードを集める
function collectCodes(data) {
  const set = new Set();
  for (const at of data.areaTypes || []) {
    for (const area of at.areas || []) {
      for (const w of area.warnings || []) {
        if (!w.code) continue;
        if (w.status === "解除" || w.status === "解除警報・注意報はなし") continue;
        if (WCODE[w.code]) set.add(w.code);
      }
    }
  }
  return set;
}

async function fetchWarnings() {
  const byLevel = { 特別警報: [], 警報: [], 注意報: [] };
  for (const office of OFFICES) {
    try {
      const data = await getJson(`https://www.jma.go.jp/bosai/warning/data/warning/${office.code}.json`);
      const codes = collectCodes(data);
      if (!codes.size) continue;
      // レベルごとに名称をまとめる
      const perLevel = { 特別警報: [], 警報: [], 注意報: [] };
      for (const c of codes) {
        const [name, level] = WCODE[c];
        if (!perLevel[level].includes(name)) perLevel[level].push(name);
      }
      for (const level of Object.keys(perLevel)) {
        if (perLevel[level].length) byLevel[level].push({ pref: office.name, names: perLevel[level] });
      }
    } catch (e) {
      // 単一オフィスの失敗は全体に影響させない
    }
  }
  const count = {
    特別警報: byLevel.特別警報.length,
    警報: byLevel.警報.length,
    注意報: byLevel.注意報.length,
  };
  return {
    byLevel,
    count,
    none: count.特別警報 === 0 && count.警報 === 0 && count.注意報 === 0,
  };
}

async function fetchTyphoons() {
  let list;
  try {
    list = await getJson("https://www.jma.go.jp/bosai/information/data/typhoon.json");
  } catch {
    return { active: false, typhoons: [] };
  }
  if (!Array.isArray(list) || list.length === 0) return { active: false, typhoons: [] };

  // eventIdで重複排除
  const ids = [...new Set(list.map((x) => x.eventId).filter(Boolean))].slice(0, 3);
  const typhoons = [];
  for (const id of ids) {
    try {
      const spec = await getJson(`https://www.jma.go.jp/bosai/typhoon/data/${id}/specifications.json`);
      const title = (spec || []).find((p) => p.part === "title") || {};
      const ana = (spec || []).find((p) => p.part && p.part.jp === "実況") ||
                  (spec || []).find((p) => p.part && p.part.en === "Analysis") || {};
      typhoons.push({
        number: title.typhoonNumber || null,
        name: (title.name && title.name.jp) || null,
        category: (ana.category && ana.category.jp) || (title.category && title.category.jp) || null,
        location: ana.location || null,
        pressure: ana.pressure || null,
        course: ana.course || null,
        speed: (ana.speed && ana.speed["km/h"]) || null,
        intensity: ana.intensity && ana.intensity !== "-" ? ana.intensity.jp || ana.intensity : null,
        validtime: (ana.validtime && ana.validtime.JST) || null,
      });
    } catch {
      /* skip */
    }
  }
  return { active: typhoons.length > 0, typhoons };
}

async function fetchNational() {
  const [warnings, typhoon] = await Promise.all([fetchWarnings(), fetchTyphoons()]);
  return { warnings, typhoon, updatedAt: new Date().toISOString() };
}

module.exports = { fetchNational, OFFICES, WCODE, LEVEL_ORDER };
