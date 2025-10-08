#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_NAME="${1:-relatorio-equivalencia-cispara-final.zip}"
OUTPUT_PATH="$ROOT_DIR/$OUTPUT_NAME"

cd "$ROOT_DIR"

if command -v zip >/dev/null 2>&1; then
  zip -r "$OUTPUT_PATH" . \
    -x "node_modules/*" \
    -x "*/node_modules/*" \
    -x "dist/*" \
    -x "*/dist/*" \
    -x ".git/*" \
    -x "*/.git/*" \
    -x "relatorios-ultra-vite/*" \
    -x "*.zip"
else
  echo "Erro: o utilitário 'zip' não está disponível neste ambiente." >&2
  exit 1
fi

echo "Arquivo gerado em: $OUTPUT_PATH"
