#!/usr/bin/env bash
set -euo pipefail

REPO="codeine-dev/pgapi"
VERSION=""
BIN_DIR="/usr/local/bin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --dir)
      BIN_DIR="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- [--version vX.Y.Z] [--dir /path]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- [--version vX.Y.Z] [--dir /path]"
      exit 1
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required but not installed." >&2
  exit 1
fi

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux) ;;
  darwin) ;;
  *)
    echo "Error: unsupported OS: $OS" >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Error: unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

if [ -z "$VERSION" ]; then
  echo "Fetching latest version..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
  if [ -z "$VERSION" ]; then
    echo "Error: failed to fetch latest version" >&2
    exit 1
  fi
fi

BINARY="pgapi-${OS}-${ARCH}"
URL="https://github.com/$REPO/releases/download/$VERSION/$BINARY"

TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE"' EXIT

echo "Downloading pgapi $VERSION ($OS/$ARCH)..."
for i in $(seq 1 5); do
  if curl -fsSL "$URL" -o "$TMP_FILE"; then
    break
  fi
  if [ "$i" -lt 5 ]; then
    echo "Download failed (attempt $i/5), retrying in 3s..."
    sleep 3
  else
    echo "Error: download failed after 5 attempts" >&2
    exit 1
  fi
done

chmod +x "$TMP_FILE"

if [ ! -d "$BIN_DIR" ]; then
  mkdir -p "$BIN_DIR"
fi

if [ -w "$BIN_DIR" ]; then
  mv "$TMP_FILE" "$BIN_DIR/pgapi"
else
  if command -v sudo >/dev/null 2>&1; then
    sudo mv "$TMP_FILE" "$BIN_DIR/pgapi"
  else
    echo "Error: $BIN_DIR is not writable and sudo is not available" >&2
    exit 1
  fi
fi

echo "pgapi installed to $BIN_DIR/pgapi"
echo "Run 'pgapi --help' to get started."
