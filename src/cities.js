// 配信に表示する地点リスト。
// office: 気象庁 府県予報区コード（forecast/{office}.json で取得）
// name  : 画面表示名
// areaIndex / tempIndex: そのJSON内で使うエリア/気温地点のインデックス（既定0=県庁所在地圏）
//
// ▼ 長崎県内版にしたい場合はこの配列を県内地点に差し替えるだけでOK（README参照）。
//   気象庁の他コードは https://www.jma.go.jp/bosai/common/const/area.json 参照。

module.exports = [
  { name: "札幌",   office: "016000" },
  { name: "青森",   office: "020000" },
  { name: "仙台",   office: "040000" },
  { name: "秋田",   office: "050000" },
  { name: "新潟",   office: "150000" },
  { name: "東京",   office: "130000" },
  { name: "横浜",   office: "140000" },
  { name: "長野",   office: "200000" },
  { name: "金沢",   office: "170000" },
  { name: "名古屋", office: "230000" },
  { name: "大阪",   office: "270000" },
  { name: "広島",   office: "340000" },
  { name: "高松",   office: "370000" },
  { name: "高知",   office: "390000" },
  { name: "福岡",   office: "400000" },
  { name: "長崎",   office: "420000" },
  { name: "鹿児島", office: "460000" },
  { name: "那覇",   office: "471000" },
];
