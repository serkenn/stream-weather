# Debian サーバーでの稼働手順

ヘッドレス（GUIなし）Debianサーバーでそのまま動きます。Xvfb（仮想ディスプレイ）をコンテナ内に内包しているため、**サーバー側にデスクトップ環境は不要**です。

---

## 0. 必要スペックの目安

| 項目 | 4K配信 | 8K配信 |
|------|--------|--------|
| CPU | 物理6コア以上推奨（libx264 veryfastで4K30fpsはかなり重い） | GPU必須 |
| GPU | 任意 | **NVIDIA(NVENC)必須** |
| メモリ | 4GB以上 | 8GB以上 |
| 上り帯域 | 実測20Mbps以上 | 実測45Mbps以上 |

> CPUが厳しい場合は `.env` で `X264_PRESET=ultrafast`、`FPS=24`、`VIDEO_BITRATE` を下げて調整。
> 4Kでもコマ落ちするなら配信解像度を1440p/1080pに落とすのが現実的です。

---

## 1. Docker を入れる

リポジトリ一式をサーバーに置いてから（例 `/opt/stream-weather`）:

```bash
sudo bash scripts/setup-debian.sh   # Docker Engine + Compose を公式手順で導入
# 完了後、docker グループ反映のため一度ログアウト→ログイン
```

既に Docker がある場合はスキップ可。

---

## 2. 設定とBGM

```bash
cd /opt/stream-weather
cp .env.example .env
nano .env                    # YOUTUBE_STREAM_KEY を記入（解像度/エンコーダもここで）
# bgm/ にフリーBGM(mp3等)を転送（scp 等）
```

YouTube側: YouTube Studio →「ライブ配信」→「ストリーム」でストリームキーを取得して `.env` に貼る。
24時間配信なら、配信設定で「DVR」や「自動開始/終了」を運用に合わせて調整してください。

---

## 3. 起動

```bash
docker compose up --build -d   # 初回はビルドで数分
docker compose logs -f         # "配信開始 → rtmp://..." が出ればOK
```

YouTube Studio のライブ管理画面に映像プレビューが届けば成功です。

- 停止: `docker compose down`
- 再起動（BGM差替・設定変更の反映）: `docker compose restart`
- `restart: unless-stopped` 指定済みなので、**サーバー再起動後も自動で立ち上がります**
  （`systemctl enable docker` 済みであること。setup-debian.sh が実施済み）

---

## 4. 動作確認（任意）

ダッシュボードはローカル限定（127.0.0.1:8080）で公開しています。手元PCから見るにはSSHトンネル:

```bash
ssh -L 8080:127.0.0.1:8080 user@your-server
# → 手元ブラウザで http://localhost:8080
```

---

## 5. systemd で管理したい場合（任意）

`restart: unless-stopped` だけでも自動起動しますが、`systemctl` で明示管理したい場合:

```bash
sudo cp deploy/stream-weather.service /etc/systemd/system/
sudo sed -i 's#/opt/stream-weather#'"$(pwd)"'#' /etc/systemd/system/stream-weather.service
sudo systemctl daemon-reload
sudo systemctl enable --now stream-weather
```

---

## 6. 8K / GPU(NVENC) を使う場合

1. ホストに NVIDIA ドライバを導入
2. NVIDIA Container Toolkit を導入:
   ```bash
   curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
     | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
   curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
     | sed 's#deb https#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https#' \
     | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
   sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker
   ```
3. `.env` を 8K/NVENC に変更:
   ```
   OUTPUT_W=7680
   OUTPUT_H=4320
   VIDEO_ENCODER=hevc_nvenc
   VIDEO_BITRATE=45000k
   ```
4. `docker-compose.yml` の GPU構成例（`weather-live-gpu`）のコメントを外して使用。

---

## トラブルシュート

| 症状 | 対処 |
|------|------|
| `YOUTUBE_STREAM_KEY を設定してください` で停止 | `.env` の `YOUTUBE_STREAM_KEY` 未設定 |
| 映像が届かない | `docker compose logs -f` でffmpegエラー確認。帯域/キー間違いが多い |
| Chromiumが落ちる | `shm_size: 2gb`（設定済）を増やす。CPU/メモリ不足も疑う |
| カクつく・遅延 | `X264_PRESET=ultrafast`、`FPS=24`、ビットレート/解像度を下げる |
| 文字化け | フォントはイメージに同梱済み。再ビルド `docker compose up --build` |
| 天気が「取得失敗」 | サーバーから気象庁(`www.jma.go.jp`)へHTTPS到達できるか確認 |
