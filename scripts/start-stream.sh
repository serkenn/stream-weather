#!/usr/bin/env bash
#
# 1コンテナ内で配信パイプライン全体を起動するオーケストレータ。
#   1) Node ダッシュボードサーバ起動
#   2) Xvfb 仮想ディスプレイ起動
#   3) Chromium をキオスクモードで仮想画面に全画面表示
#   4) ffmpeg で仮想画面をキャプチャ + BGM を合成し YouTube へ RTMP 配信
#
set -euo pipefail

# ===== 設定（.env / 環境変数で上書き可）=====
: "${YOUTUBE_STREAM_KEY:?YOUTUBE_STREAM_KEY を設定してください（.env 参照）}"

OUTPUT_W="${OUTPUT_W:-1920}"
OUTPUT_H="${OUTPUT_H:-1080}"
FPS="${FPS:-30}"
VIDEO_ENCODER="${VIDEO_ENCODER:-libx264}"   # libx264(CPU) / h264_nvenc / hevc_nvenc など
X264_PRESET="${X264_PRESET:-veryfast}"
VIDEO_BITRATE="${VIDEO_BITRATE:-6000k}"     # 1080p目安6M / 4K=16M / 8K=45M(要GPU)
AUDIO_BITRATE="${AUDIO_BITRATE:-192k}"
PORT="${PORT:-8080}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
SCALE="${SCALE:-1}"
RTMP_URL="${RTMP_URL:-rtmp://a.rtmp.youtube.com/live2}"
CHROMIUM_BIN="${CHROMIUM_BIN:-chromium}"
BGM_DIR="${BGM_DIR:-/app/bgm}"

export DISPLAY=":${DISPLAY_NUM}"

echo "[stream] 解像度=${OUTPUT_W}x${OUTPUT_H} fps=${FPS} encoder=${VIDEO_ENCODER} bitrate=${VIDEO_BITRATE}"

# 子プロセスを終了時に掃除
cleanup() { echo "[stream] shutting down..."; kill $(jobs -p) 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# ===== 1) ダッシュボードサーバ =====
node /app/src/server.js &
echo "[stream] dashboard server 起動待ち..."
until curl -sf "http://localhost:${PORT}/healthz" >/dev/null 2>&1; do sleep 1; done
echo "[stream] dashboard server OK"

# ===== 2) Xvfb 仮想ディスプレイ =====
# restart で同一コンテナが再起動すると /tmp に古いXロックが残り、
# 「Server is already active for display」で起動不能になるため先に除去。
rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}" 2>/dev/null || true

Xvfb ":${DISPLAY_NUM}" -screen 0 "${OUTPUT_W}x${OUTPUT_H}x24" -nolisten tcp -ac &
XVFB_PID=$!

# 固定sleepでなくディスプレイが実際に使えるまで待つ（最大15秒）
echo "[stream] Xvfb 起動待ち..."
for _ in $(seq 1 30); do
  if xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1; then break; fi
  if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
    echo "[stream] ERROR: Xvfb が起動できませんでした" >&2
    exit 1
  fi
  sleep 0.5
done
if ! xdpyinfo -display ":${DISPLAY_NUM}" >/dev/null 2>&1; then
  echo "[stream] ERROR: Xvfb のディスプレイ :${DISPLAY_NUM} が使用可能になりませんでした" >&2
  exit 1
fi
echo "[stream] Xvfb ready on :${DISPLAY_NUM}"

# ===== 3) Chromium キオスク =====
"${CHROMIUM_BIN}" \
  --no-sandbox --disable-dev-shm-usage \
  --disable-gpu --use-gl=swiftshader --disable-software-rasterizer \
  --kiosk --start-fullscreen \
  --window-size="${OUTPUT_W},${OUTPUT_H}" --window-position=0,0 \
  --force-device-scale-factor="${SCALE}" \
  --no-first-run --noerrdialogs --disable-infobars --hide-scrollbars \
  --disable-translate --disable-features=Translate \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  "http://localhost:${PORT}/" >/tmp/chromium.log 2>&1 &
echo "[stream] Chromium 起動。描画安定まで待機..."
sleep 6

# ===== 4) BGM プレイリスト生成 =====
PLAYLIST="/tmp/bgm.txt"
: > "${PLAYLIST}"
shopt -s nullglob nocaseglob
mapfile -t BGM_FILES < <(ls -1 "${BGM_DIR}"/*.mp3 "${BGM_DIR}"/*.m4a "${BGM_DIR}"/*.aac \
  "${BGM_DIR}"/*.wav "${BGM_DIR}"/*.flac "${BGM_DIR}"/*.ogg 2>/dev/null | sort)

if [ "${#BGM_FILES[@]}" -eq 0 ]; then
  echo "[stream] WARN: ${BGM_DIR} にBGMが無いため無音で配信します"
  AUDIO_INPUT=(-f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100")
else
  echo "[stream] BGM ${#BGM_FILES[@]}曲をループ再生"
  for f in "${BGM_FILES[@]}"; do
    # concat デミューザ用にシングルクオートをエスケープ
    printf "file '%s'\n" "${f//\'/\'\\\'\'}" >> "${PLAYLIST}"
  done
  AUDIO_INPUT=(-stream_loop -1 -f concat -safe 0 -i "${PLAYLIST}")
fi

# ===== 5) エンコーダ別オプション =====
GOP=$((FPS * 2))
VENC_OPTS=(-c:v "${VIDEO_ENCODER}" -b:v "${VIDEO_BITRATE}" -maxrate "${VIDEO_BITRATE}" \
  -bufsize "${VIDEO_BITRATE}" -pix_fmt yuv420p -g "${GOP}" -keyint_min "${FPS}")
case "${VIDEO_ENCODER}" in
  libx264|libx265) VENC_OPTS+=(-preset "${X264_PRESET}" -tune zerolatency) ;;
  *nvenc*)         VENC_OPTS+=(-preset p4 -rc cbr) ;;
esac

# ===== 6) ffmpeg 配信 =====
echo "[stream] 配信開始 → ${RTMP_URL}/****"
exec ffmpeg -hide_banner -loglevel warning \
  -thread_queue_size 1024 \
  -f x11grab -framerate "${FPS}" -video_size "${OUTPUT_W}x${OUTPUT_H}" -i ":${DISPLAY_NUM}" \
  "${AUDIO_INPUT[@]}" \
  "${VENC_OPTS[@]}" \
  -c:a aac -b:a "${AUDIO_BITRATE}" -ar 44100 -ac 2 \
  -f flv "${RTMP_URL}/${YOUTUBE_STREAM_KEY}"
