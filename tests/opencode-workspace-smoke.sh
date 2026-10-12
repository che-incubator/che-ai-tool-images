#!/bin/sh
# Copyright (c) 2026 Red Hat, Inc.
# SPDX-License-Identifier: EPL-2.0
set -eu
injector=${1:?injector image is required}
workspace=${2:?workspace image is required}
platform=${3:-linux/s390x}
scratch=$(mktemp -d)
container=
cleanup() {
    if [ -n "$container" ]; then docker rm -fv "$container" >/dev/null; fi
    rm -rf "$scratch"
}
trap cleanup EXIT
container=$(docker create --platform "$platform" -v /injected-tools -v /validation "$injector")
docker cp "$container:/opt/opencode" "$scratch/opencode"
docker cp "$scratch/opencode" "$container:/injected-tools/opencode"
docker cp tests/. "$container:/validation"
# Only the portable payload crosses into the workspace; no injector system libraries.
docker run --rm --platform "$platform" --user 10001 \
    --network none --read-only --tmpfs /tmp:rw,exec,mode=1777 \
    --volumes-from "$container:ro" \
    -e TOOL_ROOT=/injected-tools/opencode \
    --entrypoint /injected-tools/opencode/runtime/node "$workspace" \
    /validation/opencode-node-acceptance.mjs
