#!/bin/sh
# Resolve the directory containing this script robustly: cd+pwd handles
# PATH-only invocations (where $0 has no slash) that break ${REAL_PATH%/*}.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OC_HOME="/tmp/opencode-home"
if [ ! -w "$HOME" ]; then
  # Only redirect to the tmp home when $HOME is not writable (e.g. OpenShift
  # pods with arbitrary UIDs). When $HOME is writable, preserve the real home
  # so that existing user configuration, credentials, and state are accessible.
  export HOME="$OC_HOME"
  mkdir -p "$OC_HOME/.config" "$OC_HOME/.local/share" "$OC_HOME/.local/state" "$OC_HOME/.cache"
fi
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export NODE_PATH="$SCRIPT_DIR/../node_modules"
# Suppress only the known noisy warnings (SQLite experimental, punycode deprecation).
# NODE_NO_WARNINGS=1 would silence everything including real errors.
export NODE_OPTIONS="--disable-warning=ExperimentalWarning --disable-warning=DEP0040"
# Prefer node-entry.mjs, then .js, then index.js. Explicit loop avoids
# LC_COLLATE-dependent ordering from ls output.
ENTRY=""
for f in "$SCRIPT_DIR/../bundle/node-entry.mjs" \
          "$SCRIPT_DIR/../bundle/node-entry.js" \
          "$SCRIPT_DIR/../bundle/index.js"; do
  [ -f "$f" ] && ENTRY="$f" && break
done
[ -n "$ENTRY" ] || { echo "ERROR: opencode bundle entry point not found in $SCRIPT_DIR/../bundle/"; exit 1; }
SHIM="$SCRIPT_DIR/../bundle/bun-shim.mjs"

# Default to interactive TUI mode (--mini) when run with no arguments in a real terminal.
if [ $# -eq 0 ] && [ -t 1 ]; then
  set -- --mini
fi
if [ -f "$SHIM" ]; then
  exec "$SCRIPT_DIR/node" --import "$SHIM" "$ENTRY" "$@"
else
  exec "$SCRIPT_DIR/node" "$ENTRY" "$@"
fi
