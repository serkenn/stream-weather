# 全国お天気 YouTube Live 配信システム

気象庁(JMA)の無料JSONから全国主要都市の天気・気温・降水確率・週間予報を取得し、
HTMLダッシュボードを生成 → ヘッドレスChromiumで描画 → ffmpegで画面キャプチャ＋BGM合成 →
**YouTube Liveへ24時間配信**します。**既定1080p**（CPUエンコード向き）で、設定だけで**4K/8Kへ拡張可能**。Docker1コンテナで動作。

```
気象庁JSON ──> Node(取得/整形/HTML配信) ──> Chromium(描画) ──> ffmpeg(画面+BGM) ──RTMP──> YouTube Live
```

> レイアウトはビューポート単位なので、1080p / 4K / 8K のいずれでも同じ見た目で等倍スケールします。

## 構成

| パス | 役割 |
|------|------|
| `src/server.js` | 依存ゼロのHTTPサーバ。気象庁データを定期取得しダッシュボード配信 |
| `src/jma.js` | 気象庁JSONの取得・整形（欠損に強い防御的パース） |
| `src/cities.js` | 表示地点リスト（**ここを編集すれば長崎県内版などに差替可**） |
| `src/public/` | ダッシュボードのHTML/CSS/JS（vw/vhベースで4K/8K等倍スケール） |
| `scripts/start-stream.sh` | Xvfb + Chromium + ffmpeg のオーケストレータ |
| `bgm/` | フリーBGMを置く場所（ループ再生） |
| `Dockerfile` / `docker-compose.yml` | 1コンテナ構成 |

> **Debianサーバーで運用する場合は [DEPLOY-debian.md](./DEPLOY-debian.md) を参照**（Docker導入スクリプト・自動起動・GPU/8K手順つき）。

## 使い方

### 1. ストリームキーを設定
```bash
cp .env.example .env
# .env を開き YOUTUBE_STREAM_KEY を YouTube Studio のストリームキーに変更
```

### 2. BGMを置く
`bgm/` にフリーBGM（mp3等）を入れる。詳細は `bgm/README.md`。

### 3. 起動
```bash
docker compose up --build -d
docker compose logs -f        # 配信ログ確認
```
YouTube Studio のライブ配信ダッシュボードに映像が届けば成功です（受信開始後に「配信開始」を押す）。

### 4. 見た目の確認だけしたい場合
配信せずブラウザで確認: `docker compose up` 後に `http://localhost:8080` を開く。

## 解像度の切替（1080p / 4K / 8K）

`.env` を編集するだけ。**GPU非搭載＝CPUエンコードの環境では 1080p が現実的な上限**です。

```bash
# 1080p（既定・CPUエンコード推奨）
OUTPUT_W=1920
OUTPUT_H=1080
VIDEO_BITRATE=6000k
X264_PRESET=veryfast   # 重ければ faster / fast / ultrafast

# 4K（高性能CPU、できればGPU）
OUTPUT_W=3840
OUTPUT_H=2160
VIDEO_BITRATE=16000k

# 8K（GPUエンコード前提）
OUTPUT_W=7680
OUTPUT_H=4320
VIDEO_ENCODER=hevc_nvenc
VIDEO_BITRATE=45000k
```

> **CPUエンコードの目安**: libx264 で 1080p30 はおおむね物理4コア程度から安定。
> 4Kのリアルタイムはかなり重く、8K(7680×4320)は NVIDIA GPU(NVENC)＋大帯域がほぼ必須です。
> CPUが厳しい場合は `X264_PRESET=ultrafast` / `FPS=24` / 解像度を下げて調整してください。

## 表示地点を変える（例: 長崎県内版）

`src/cities.js` を編集します。`office` は気象庁の府県予報区コード、
`areaIndex`/`tempIndex` で同一JSON内の地点を選べます（既定0）。

```js
module.exports = [
  { name: "長崎",   office: "420000", areaIndex: 0, tempIndex: 0 },
  { name: "佐世保", office: "420000", areaIndex: 1, tempIndex: 1 },
  { name: "対馬",   office: "420000", areaIndex: 2 },
  // ...
];
```
コード一覧は <https://www.jma.go.jp/bosai/common/const/area.json> を参照。
編集後は `docker compose restart`。

## カスタマイズ早見表

| やりたいこと | 触る場所 |
|--------------|----------|
| 表示都市の追加・変更 | `src/cities.js` |
| 配色・フォント・レイアウト | `src/public/style.css` |
| カード内容・週間ローテ間隔 | `src/public/app.js`（`ROTATE_MS`） |
| データ更新間隔 | `.env` の `UPDATE_INTERVAL_MIN` |
| 解像度/ビットレート/エンコーダ | `.env` |

## データ出典・ライセンス
- 天気データ: **気象庁（Japan Meteorological Agency）** の公開JSON。出典明記のうえ利用可。
- BGM: 各音源の利用規約に従ってください（`bgm/README.md`）。
