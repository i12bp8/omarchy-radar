#!/usr/bin/env bash
# validate.sh - static checks for the Radar plugin.
#
# 1. omarchy plugin validate against a clean staged copy (skips local
#    dev junk like research/)
# 2. engine unit tests under node (tests/engine.test.mjs)
# 3. qmllint on every QML file, when qmllint is installed
#
# Run from anywhere:  tests/validate.sh

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

echo "== 1/3 manifest validation"
if command -v omarchy >/dev/null 2>&1; then
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  tar \
    --exclude ./.git \
    --exclude ./research \
    --exclude ./.validate-stage \
    -cf - . | tar -xf - -C "$stage"
  omarchy plugin validate "$stage"
  echo "   ok"
else
  echo "   omarchy not found; manifest validation skipped"
fi

echo "== 2/3 engine unit tests"
if command -v node >/dev/null 2>&1; then
  node tests/engine.test.mjs
else
  echo "   node not found; unit tests skipped"
fi

echo "== 3/3 QML syntax"
qml_files="BarWidget.qml Panel.qml RadarGroup.qml RadarRow.qml RadarEngine.qml RadarHistory.qml"
if command -v qmllint >/dev/null 2>&1 && [[ -n "${OMARCHY_PATH:-}" ]]; then
  qmllint -I "$OMARCHY_PATH/shell" $qml_files
  echo "   ok"
elif command -v qmlformat >/dev/null 2>&1 || [[ -x /usr/lib/qt6/bin/qmlformat ]]; then
  qmlformat="$(command -v qmlformat 2>/dev/null || echo /usr/lib/qt6/bin/qmlformat)"
  for file in $qml_files; do
    "$qmlformat" "$file" >/dev/null
  done
  echo "   ok (qmlformat parse; qmllint not available)"
else
  echo "   neither qmllint nor qmlformat found; QML syntax check skipped"
fi

echo "done."
