#!/bin/sh
# Copyright (c) 2026 Red Hat, Inc.
# SPDX-License-Identifier: EPL-2.0
set -eu
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/injected-tools/bin"
if [ -d /opt/opencode ]; then
    pattern=bundle
    cp -a /opt/opencode/. "$scratch/injected-tools/opencode/"
    ln -s "$scratch/injected-tools/opencode/bin/opencode" "$scratch/injected-tools/bin/opencode"
    # Bundled Node must not shadow the editor's or another AI tool's Node runtime.
    test ! -e "$scratch/injected-tools/opencode/bin/node"
    test -x "$scratch/injected-tools/opencode/runtime/node"
else
    pattern=init
    # Match the existing dashboard init command, including its companion binary.
    cp /usr/local/bin/opencode "$scratch/injected-tools/bin/opencode"
    cp /usr/local/bin/opencode-bin "$scratch/injected-tools/bin/opencode-bin"
fi
cli="$scratch/injected-tools/bin/opencode"
export HOME=/proc/1
unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME
actual=$("$cli" --version)
test "$actual" = "${OPENCODE_EXPECTED_VERSION#v}"
"$cli" --help > "$scratch/help" 2>&1
grep -q 'opencode run' "$scratch/help"
if "$cli" --port-acceptance-invalid-flag > "$scratch/invalid" 2>&1; then
    echo 'Unknown CLI flag was incorrectly accepted' >&2
    exit 1
fi
echo "PASS OpenCode $actual $pattern injection on $(uname -m), UID $(id -u)"
if [ "$pattern" = bundle ]; then
    /opt/opencode/runtime/node /validation/opencode-node-acceptance.mjs
fi
