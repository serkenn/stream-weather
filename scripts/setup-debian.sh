#!/usr/bin/env bash
#
# Debian サーバーに Docker Engine + Compose プラグインを公式手順でインストールする。
# 対応: Debian 11(bullseye) / 12(bookworm) / 13(trixie)
# 使い方:  sudo bash scripts/setup-debian.sh
#
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "root で実行してください:  sudo bash scripts/setup-debian.sh" >&2
  exit 1
fi

echo "== 既存の競合パッケージを削除 =="
for p in docker.io docker-doc docker-compose podman-docker containerd runc; do
  apt-get remove -y "$p" 2>/dev/null || true
done

echo "== 前提パッケージ =="
apt-get update
apt-get install -y ca-certificates curl gnupg

echo "== Docker 公式 GPG 鍵 =="
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo "== Docker リポジトリ追加 =="
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME}")"
ARCH="$(dpkg --print-architecture)"
echo \
  "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

echo "== Docker Engine + Compose インストール =="
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "== 起動 & 自動起動有効化 =="
systemctl enable --now docker

# sudo なしで docker を使えるよう、呼び出したユーザーを docker グループへ
TARGET_USER="${SUDO_USER:-}"
if [ -n "${TARGET_USER}" ] && [ "${TARGET_USER}" != "root" ]; then
  usermod -aG docker "${TARGET_USER}"
  echo "== ${TARGET_USER} を docker グループに追加（再ログインで反映）=="
fi

echo
docker --version
docker compose version
echo "== 完了。再ログイン後に 'docker compose up --build -d' を実行してください =="
