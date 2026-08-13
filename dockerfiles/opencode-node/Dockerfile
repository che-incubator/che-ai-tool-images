# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

# OpenCode — Node.js build for s390x and ppc64le
#
# Upstream OpenCode distributes pre-built Bun-compiled binaries only for
# x64 and arm64. This Dockerfile rebuilds OpenCode from source using Node.js
# instead of the embedded Bun runtime, enabling deployment on IBM Z (s390x)
# and Power (ppc64le).
#
# Build strategy — five stages:
#
#   js-bundler  (forced linux/amd64)
#     Clones the OpenCode source at the pinned tag, injects minimal Node.js
#     compatibility shims for Bun-specific APIs, and produces a platform-
#     neutral ESM bundle via Bun.build({ target: "node" }).
#
#   zig-builder  (forced BUILD platform)
#     Cross-compiles libopentui.so for s390x and ppc64le using the Zig
#     compiler's built-in cross-compilation support. Zig targets
#     s390x-linux-gnu.2.17 / powerpc64le-linux-gnu.2.17 for glibc compat
#     with UBI9/RHEL9 runtime images.
#
#   native-builder  (TARGET architecture)
#     Rebuilds the C++/N-API and Rust native addons from source for the
#     actual deployment architecture using node-gyp and Cargo.
#     Uses ubuntu:22.04 (GCC 12) — required for ref-napi which uses
#     TypedThreadSafeFunction templates that GCC 11 (Ubuntu 22.04) cannot parse.
#
#   node-provider  (TARGET architecture)
#     Downloads the official Node.js binary from nodejs.org for the target
#     architecture. This is a portable, self-contained binary that does not
#     depend on any system-installed Node.js runtime.
#
#   Runtime (UBI9 minimal, TARGET architecture)
#     Assembles the bundle, rebuilt native addons, and Node.js binary into
#     /opt/opencode, then creates a thin wrapper script that handles
#     OpenShift arbitrary UIDs.

# v1.18.9 is the first series that includes packages/opencode/script/build-node.ts
# (the Node.js build script needed for this Dockerfile). v1.2.27 predates that file.
ARG OPENCODE_VERSION=v1.18.9
ARG NODE_VERSION=24.18.1
# Zig version used in the opentui repo (.zig-version file as of the pinned build).
ARG ZIG_VERSION=0.15.2

# ── Stage 1: JS bundler ────────────────────────────────────────────────────
# Always runs on linux/amd64 because Bun has no s390x/ppc64le release.
# Output: packages/opencode/dist/node/ — a platform-neutral ESM bundle.
# $BUILDPLATFORM: stage always runs on the BUILD machine's native architecture.
# Bun supports amd64 and arm64, so this works natively on both CI (amd64)
# and Apple Silicon (arm64) without cross-exec failures when targeting s390x.
FROM --platform=$BUILDPLATFORM oven/bun:1.3.14 AS js-bundler

ARG OPENCODE_VERSION=v1.18.9

RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN git clone --depth=1 --branch "${OPENCODE_VERSION}" \
      https://github.com/anomalyco/opencode.git . || \
    (git clone --depth=1 https://github.com/anomalyco/opencode.git . && \
     git checkout "${OPENCODE_VERSION}")

# ── Inject Node.js compatibility shims ────────────────────────────────────
# Files are COPYed from the Docker context (dockerfiles/opencode-node/) to
# avoid heredoc/escaping issues with inline << EOF blocks.

RUN mkdir -p packages/opencode/src/node

# bun-shim.ts: sets globalThis.Bun before any module runs.
COPY dockerfiles/opencode-node/bun-shim.ts packages/opencode/src/node/bun-shim.ts

# node-entry.ts: imports shim first, then re-exports node.ts surface.
COPY dockerfiles/opencode-node/node-entry.ts packages/opencode/src/node/node-entry.ts

# patch-build-node.py: modifies build-node.ts to use node-entry.ts, add
# native externals, and inject the bunCompatPlugin.
COPY dockerfiles/opencode-node/patch-build-node.py /tmp/patch-build-node.py
RUN python3 /tmp/patch-build-node.py && rm /tmp/patch-build-node.py

# Add string-width (needed by bun-shim.ts), then install all deps
# --ignore-scripts: skip postinstall compilation (tree-sitter-bash, node-pty, etc.)
# All native addons are marked external in build-node.ts and are rebuilt in the
# native-builder stage for the target architecture.
# || true: bun exits 1 when optional arch-specific packages fail to download
# (e.g. wrangler, lightningcss for non-hosted platforms); string-width itself
# installs successfully so this is safe to ignore.
RUN bun add string-width --ignore-scripts || true
RUN bun install --ignore-scripts

# Build the Node.js ESM bundle.
# Bun.build({ target: "node" }) automatically selects the #sqlite, #pty, #fff
# "node" conditional import paths, so sqlite.node.ts, pty.node.ts, etc. are used.
RUN bun run packages/opencode/script/build-node.ts

# Compile bun-shim.ts as a standalone ESM module loaded via node --import.
# Prepending the preamble to the main bundle causes "already declared" errors
# because both files emit static imports for the same node:* identifiers
# (e.g. createRequire from node:module). node --import loads the shim in its
# OWN module scope before the entry point — zero binding conflicts.
RUN bun build packages/opencode/src/node/bun-shim.ts \
    --target node --format esm --no-splitting \
    --outfile packages/opencode/dist/node/bun-shim.mjs

# ── Stage 2: Zig cross-compiler for libopentui.so ─────────────────────────
# Must run on the BUILD host (not QEMU) so Zig's cross-compilation is fast.
# $BUILDPLATFORM ensures this stage is native even when targeting s390x.
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS zig-builder

ARG ZIG_VERSION=0.15.2

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates xz-utils git \
    && rm -rf /var/lib/apt/lists/*

# Install Zig. Map Docker arch names to Zig's naming convention.
# amd64→x86_64, arm64→aarch64 (the two arches Zig ships for Linux).
RUN set -e && \
    case "$(uname -m)" in \
      x86_64)  ZIG_ARCH="x86_64" ;; \
      aarch64) ZIG_ARCH="aarch64" ;; \
      *) echo "Unsupported build arch: $(uname -m)" && exit 1 ;; \
    esac && \
    curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-${ZIG_ARCH}-linux-${ZIG_VERSION}.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1 && \
    ln -sf /usr/local/zig /usr/local/bin/zig && \
    zig version

# Clone the opentui repo (anomalyco fork used by opencode)
# Pin to the SAME tag as the @opentui/core npm package installed in native-builder.
# The Zig ABI must match the JavaScript chunk files in the npm package.
# Cloning main would give a different API version → createEventSink fails with 0.
ARG OPENTUI_VERSION=v0.5.1
RUN git clone --depth=1 --branch "${OPENTUI_VERSION}" \
      https://github.com/anomalyco/opentui.git /opentui

WORKDIR /opentui/packages/core/src/zig

# Patch lib.zig: replace Zig's GeneralPurposeAllocator with std.heap.c_allocator
# for big-endian targets (s390x, ppc64le). The Zig GPA fails silently on s390x
# — ALL allocations return 0 (INVALID_HANDLE), making every createEventSink,
# createRenderer etc. call fail. Root cause: likely a Zig 0.15.2 GPA bug on
# big-endian targets. std.heap.c_allocator uses libc malloc which works correctly.
RUN sed -i \
    's/const globalAllocator = gpa\.allocator();/const globalAllocator = std.heap.c_allocator;/' \
    /opentui/packages/core/src/zig/lib.zig && \
    grep -n "globalAllocator" /opentui/packages/core/src/zig/lib.zig | head -5 && \
    echo "lib.zig patched to use c_allocator"

# Build for s390x (glibc 2.17 for RHEL/UBI9 compat)
RUN zig build -Dtarget="s390x-linux-gnu.2.17" -Doptimize=ReleaseSafe && \
    find /opentui -name "libopentui.so" -exec echo "Built: {}" \;

# Build for ppc64le — Zig uses "powerpc64le", not "ppc64le"
RUN zig build -Dtarget="powerpc64le-linux-gnu.2.17" -Doptimize=ReleaseSafe && \
    find /opentui -name "libopentui.so" -exec echo "Built: {}" \; || \
    echo "ppc64le build failed (non-fatal)"

# Collect both libraries into a known location for COPY --from
RUN mkdir -p /libopentui/s390x /libopentui/ppc64le && \
    find /opentui -path "*/s390x-linux-gnu.2.17*/libopentui.so" -exec cp {} /libopentui/s390x/ \; || true && \
    find /opentui -path "*/powerpc64le-linux-gnu.2.17*/libopentui.so" -exec cp {} /libopentui/ppc64le/ \; || true && \
    # Create placeholders so Docker COPY (which uses glob) always finds ≥1 file.
    # native-builder checks file size before using the library.
    [ -f /libopentui/s390x/libopentui.so ]   || touch /libopentui/s390x/libopentui.so.placeholder; \
    [ -f /libopentui/ppc64le/libopentui.so ] || touch /libopentui/ppc64le/libopentui.so.placeholder; \
    ls -lh /libopentui/s390x/ /libopentui/ppc64le/ || true

# ── Stage 3: Native module builder ────────────────────────────────────────
# Runs on the TARGET architecture (via QEMU for cross-builds).
# Rebuilds C++ and Rust native addons for the actual deployment platform.
#
# Uses ubuntu:22.04 + GCC 12 instead of ubuntu:22.04 default (GCC 11) because:
#   ref-napi:  TypedThreadSafeFunction templates fail on GCC 11 (napi.h:2477 parse error)
#   GCC 12 fixes this. Ubuntu 22.04 ships gcc-12 in the main archive.
# Uses ubuntu:22.04 instead of ubuntu:24.04 because:
#   Ubuntu 24.04 links against GLIBC_2.38; UBI9 runtime only has GLIBC_2.34.
#   Ubuntu 22.04 links against GLIBC_2.35. The rebuilt addons only reference
#   symbols present long before GLIBC_2.34, so 2.35 > 2.34 is not a problem —
#   the higher build-time version does not pull in newer symbols.
FROM ubuntu:22.04 AS native-builder

ARG TARGETARCH
ARG NODE_VERSION=24.18.1

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential python3 python3-pip git libssl-dev pkg-config curl ca-certificates \
      libffi-dev gcc-12 g++-12 \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/gcc gcc /usr/bin/gcc-12 100 \
    && update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-12 100 \
    && gcc --version | head -1

# Install Node.js from nodejs.org (supports amd64, arm64, s390x, ppc64le)
RUN set -e && \
    case "${TARGETARCH}" in \
      amd64)   NODE_ARCH="x64" ;; \
      arm64)   NODE_ARCH="arm64" ;; \
      s390x)   NODE_ARCH="s390x" ;; \
      ppc64le) NODE_ARCH="ppc64le" ;; \
    esac && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" \
      | tar -xz -C /usr/local --strip-components=1

# @parcel/watcher: now bundled by bun (CJS→ESM), not needed here.
# @lydell/node-pty: stubbed via bunCompatPlugin (no s390x prebuilt binary exists).
# Rust: was only used for @parcel/watcher — no longer needed.
# Only tree-sitter-bash and tree-sitter-powershell require source compilation.
# ffi-napi + ref-napi: used by bun-ffi-shim.cjs to call libopentui.so on s390x/ppc64le.

WORKDIR /native

RUN npm install --ignore-scripts \
      jsonc-parser \
      @opentui/core@0.5.1 \
      tree-sitter-bash \
      tree-sitter-powershell

# Install ffi-napi and ref-napi (built from source via node-gyp since they include
# native addons). These link against libffi and enable calling libopentui.so on s390x/ppc64le.
#
# ffi-napi fix: use the system libffi (from libffi-dev) instead of the bundled copy.
# ffi-napi 4.0.3 bundles libffi 3.4.2 whose K&R-style declarations in prep_cif.c
# are rejected by GCC 13 (-std=gnu17). GYP_DEFINES="use_system_libffi=1" tells
# node-gyp to link against /usr/lib and /usr/include instead of deps/libffi/.
# Ubuntu 24.04 ships libffi-dev 3.4.6 which is already in the apt install list above.
#
# ref-napi fix: ref-napi@3.0.3 bundles an old node-addon-api whose napi-inl.h
# has TypedThreadSafeFunction constructor template issues with GCC 13.
# Installing node-addon-api@latest into ref-napi's local node_modules replaces the
# bundled copy before node-gyp runs, picking up the fixed napi-inl.h.
COPY dockerfiles/opencode-node/patch-ffi-napi.py /tmp/patch-ffi-napi.py
COPY dockerfiles/opencode-node/fficonfig-s390x.h /tmp/fficonfig-s390x.h
RUN npm install ffi-napi ref-napi --ignore-scripts && \
    # Patch and build ffi-napi (uses system libffi, not bundled K&R sources)
    cp /tmp/patch-ffi-napi.py /tmp/fficonfig-s390x.h node_modules/ffi-napi/ && \
    cd node_modules/ffi-napi && \
    npm install node-addon-api@latest --prefix . --ignore-scripts && \
    python3 patch-ffi-napi.py && \
    npx node-gyp rebuild 2>&1 | tee /tmp/ffi-napi-build.log | tail -20 || \
      { cat /tmp/ffi-napi-build.log; exit 1; } && \
    echo "ffi-napi built successfully" && \
    # ffi-napi bundles its own ref-napi — rebuild it too (same TypedThreadSafeFunction fix)
    if [ -d /native/node_modules/ffi-napi/node_modules/ref-napi ]; then \
      cd /native/node_modules/ffi-napi/node_modules/ref-napi && \
      npm install node-addon-api@latest --prefix . --ignore-scripts && \
      npx node-gyp rebuild 2>&1 | tee /tmp/ffi-ref-napi-build.log | tail -10 || \
        { cat /tmp/ffi-ref-napi-build.log; exit 1; } && \
      echo "ffi-napi nested ref-napi built"; \
    fi && \
    # Build the top-level ref-napi
    cd /native/node_modules/ref-napi && \
    npm install node-addon-api@latest --prefix . --ignore-scripts && \
    npx node-gyp rebuild 2>&1 | tee /tmp/ref-napi-build.log | tail -20 || \
      { cat /tmp/ref-napi-build.log; exit 1; } && \
    echo "ref-napi built successfully"

# Copy the cross-compiled libopentui.so for this architecture into the expected
# @opentui/core-linux-{arch} package directory. The patch-opentui-core.py script
# checks for this file and skips stubbing index.node.js when it exists.
# Always create both arch directories so the runtime COPY steps don't fail.
# The one matching TARGETARCH will get libopentui.so populated below;
# the other stays as an empty placeholder (and index.node.js stays stubbed).
RUN for ARCH in s390x ppc64le; do \
      mkdir -p "node_modules/@opentui/core-linux-${ARCH}" ; \
      printf '{"name":"@opentui/core-linux-%s","version":"1.0.0","main":"./index.js"}\n' "${ARCH}" \
        > "node_modules/@opentui/core-linux-${ARCH}/package.json" ; \
      printf 'module.exports = require("path").join(__dirname, "libopentui.so");\n' \
        > "node_modules/@opentui/core-linux-${ARCH}/index.js" ; \
    done

COPY --from=zig-builder /libopentui/s390x/libopentui.so* /tmp/libopentui-s390x/
COPY --from=zig-builder /libopentui/ppc64le/libopentui.so* /tmp/libopentui-ppc64le/

RUN set -e && \
    case "${TARGETARCH}" in \
      s390x) \
        LIB=/tmp/libopentui-s390x/libopentui.so && \
        if [ -f "$LIB" ] && [ "$(wc -c < "$LIB")" -gt 1000 ]; then \
          cp "$LIB" node_modules/@opentui/core-linux-s390x/ && \
          echo "Installed libopentui.so for s390x ($(wc -c < "$LIB") bytes)"; \
        else echo "No real libopentui.so for s390x — native TUI unavailable"; fi ;; \
      ppc64le) \
        LIB=/tmp/libopentui-ppc64le/libopentui.so && \
        if [ -f "$LIB" ] && [ "$(wc -c < "$LIB")" -gt 1000 ]; then \
          cp "$LIB" node_modules/@opentui/core-linux-ppc64le/ && \
          echo "Installed libopentui.so for ppc64le ($(wc -c < "$LIB") bytes)"; \
        else echo "No real libopentui.so for ppc64le — native TUI unavailable"; fi ;; \
      *) echo "No libopentui.so needed for ${TARGETARCH}" ;; \
    esac

COPY dockerfiles/opencode-node/patch-opentui-core.py /tmp/patch-opentui-core.py
RUN python3 /tmp/patch-opentui-core.py && rm /tmp/patch-opentui-core.py

RUN cd node_modules/tree-sitter-bash && \
    npx node-gyp rebuild 2>&1 && echo "tree-sitter-bash rebuilt" || \
    { echo "ERROR: tree-sitter-bash rebuild failed"; exit 1; }

RUN cd node_modules/tree-sitter-powershell && \
    npx node-gyp rebuild 2>&1 && echo "tree-sitter-powershell rebuilt" || \
    { echo "ERROR: tree-sitter-powershell rebuild failed"; exit 1; }

# ── Stage 4: Node.js binary provider ──────────────────────────────────────
# Downloads the official portable Node.js binary for the target architecture.
# Using the official nodejs.org tarball (not the distro package) ensures
# the binary is self-contained and does not depend on system libraries.
FROM alpine:3.21 AS node-provider

ARG TARGETARCH
ARG NODE_VERSION

RUN apk add --no-cache curl tar gzip

RUN set -e && \
    case "${TARGETARCH}" in \
      amd64)   NODE_ARCH="x64" ;; \
      arm64)   NODE_ARCH="arm64" ;; \
      s390x)   NODE_ARCH="s390x" ;; \
      ppc64le) NODE_ARCH="ppc64le" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL \
      "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" \
      | tar -xz -C /tmp && \
    cp "/tmp/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node" /tmp/node && \
    chmod +x /tmp/node

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

ARG OPENCODE_VERSION

# Node.js bundle (platform-neutral ESM)
COPY --from=js-bundler /build/packages/opencode/dist/node/ /opt/opencode/bundle/

# bun-ffi-shim.cjs: implements bun:ffi API using ffi-napi so @opentui/core can
# call libopentui.so on s390x/ppc64le using Node.js 24 (no bun:ffi built-in).
# Placed alongside bun-shim.mjs so the path computed in bun-shim.ts resolves correctly.
COPY dockerfiles/opencode-node/bun-ffi-shim.cjs /opt/opencode/bundle/bun-ffi-shim.cjs

# ffi-hook.mjs: ESM loader hook that intercepts import("node:ffi") and redirects
# to bun-ffi-shim.cjs. Registered via Module.register() in bun-shim.ts.
COPY dockerfiles/opencode-node/ffi-hook.mjs /opt/opencode/bundle/ffi-hook.mjs

# Only native addons are needed at runtime — the ESM bundle is self-contained.
# Do NOT copy the full bun workspace node_modules (2.4 GB) — it is not needed
# and would make the init container hang for minutes on every workspace start.
# Rebuilt native addons for this architecture
COPY --from=native-builder /native/node_modules/jsonc-parser \
                           /opt/opencode/node_modules/jsonc-parser/
COPY --from=native-builder /native/node_modules/@opentui \
                           /opt/opencode/node_modules/@opentui/
COPY --from=native-builder /native/node_modules/tree-sitter-bash \
                           /opt/opencode/node_modules/tree-sitter-bash/
COPY --from=native-builder /native/node_modules/tree-sitter-powershell \
                           /opt/opencode/node_modules/tree-sitter-powershell/
# node-gyp-build is required by tree-sitter-bash/bindings/node/index.js.
# Without it, the native .node addon can't be loaded and tree-sitter falls
# back to a WASM path that uses 'import ... with { type: "wasm" }' — an
# import attribute not supported in Node.js 22, causing shell commands to fail.
COPY --from=native-builder /native/node_modules/node-gyp-build \
                           /opt/opencode/node_modules/node-gyp-build/

# ffi-napi and ref-napi: native addons used by bun-ffi-shim.cjs on s390x/ppc64le.
# ffi-napi links against libffi and provides the foreign function interface.
# ref-napi provides pointer/struct type handling used internally by ffi-napi.
COPY --from=native-builder /native/node_modules/ffi-napi \
                           /opt/opencode/node_modules/ffi-napi/
COPY --from=native-builder /native/node_modules/ref-napi \
                           /opt/opencode/node_modules/ref-napi/
# ffi-napi bundles its own nested ref-napi (no compiled .node file) that shadows
# the top-level compiled ref-napi. Remove it so Node.js resolves to the top-level
# ref-napi which has the correct s390x build/Release/binding.node.
RUN rm -rf /opt/opencode/node_modules/ffi-napi/node_modules/ref-napi

# libopentui.so for s390x and ppc64le — pre-built by zig-builder via cross-compilation.
# The @opentui/core-linux-{arch} directory structure mirrors the convention used by
# opentui's node-assets.js (similar to how @swc/core-linux-x64-gnu works).
COPY --from=native-builder /native/node_modules/@opentui/core-linux-s390x \
                           /opt/opencode/node_modules/@opentui/core-linux-s390x/
# ppc64le: only present when the Zig cross-build succeeded; ignore if absent
COPY --from=native-builder /native/node_modules/@opentui/core-linux-ppc64le/. \
                           /opt/opencode/node_modules/@opentui/core-linux-ppc64le/

# Portable Node.js runtime
COPY --from=node-provider /tmp/node /opt/opencode/bin/node

# Wrapper script: sets NODE_PATH and redirects writable dirs for OpenShift
# arbitrary UIDs where $HOME may not be writable.
COPY dockerfiles/opencode-node/wrapper.sh /opt/opencode/bin/opencode
RUN chmod +x /opt/opencode/bin/opencode

LABEL org.opencontainers.image.description="OpenCode CLI — Node.js build for s390x/ppc64le DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"
