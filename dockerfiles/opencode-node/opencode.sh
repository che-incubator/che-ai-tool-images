#!/bin/sh
# Copyright (c) 2026 Red Hat, Inc.
# SPDX-License-Identifier: EPL-2.0
set -eu

# Resolve the dashboard-created symlink before locating the portable bundle.
launcher=$(readlink -f "$0")
tool_root=$(dirname "$(dirname "$launcher")")
user_home=${TMPDIR:-/tmp}/opencode-$(id -u)
if [ ! -w "${HOME:-/}" ]; then
    export HOME="$user_home"
fi
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$user_home/.config}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$user_home/.local/share}"
export XDG_STATE_HOME="${XDG_STATE_HOME:-$user_home/.local/state}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$user_home/.cache}"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"
# Keep Node private: the dashboard symlinks bundle bin/node into the workspace PATH.
exec "$tool_root/runtime/node" "$tool_root/bundle/cli.js" "$@"
