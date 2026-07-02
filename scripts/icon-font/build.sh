#!/usr/bin/env bash
# Costra 图标字体一键构建
#   第 1 步（node）    ：fit 归一 → dist/glyph-svg/*.svg + glyphs.json + iconMap.ts + glyph-map.json
#   第 2 步（fontforge）：描边扩展 + 去重叠 → dist/iconfont.ttf + styles/iconfont.wxss + dist/preview.html
#
# 依赖：node（scripts/icon-font 内已 npm install）+ fontforge（brew install fontforge）
set -euo pipefail
cd "$(dirname "$0")"

echo "==> [1/2] node build-svg.mjs"
node build-svg.mjs

echo "==> [2/2] fontforge build-font.py"
fontforge -script build-font.py

echo "==> done. 预览: scripts/icon-font/dist/preview.html"
