FROM node:20-bookworm-slim

# Chromium / ffmpeg / Xvfb と日本語・絵文字フォント
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ffmpeg \
      xvfb \
      x11-utils \
      curl \
      ca-certificates \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_BIN=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# 依存ゼロ構成なので package.json のみ（将来 deps 追加時に効く）
COPY package.json ./
RUN npm install --omit=dev || true

COPY . .
RUN chmod +x scripts/start-stream.sh

EXPOSE 8080

CMD ["bash", "scripts/start-stream.sh"]
