# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

# Stage 1: install gemini on a multi-arch Node image for consistent npm paths.
# ubi8/nodejs-22-minimal is used instead of node:22-slim because it supports
# s390x (and ppc64le) in addition to amd64/arm64.
FROM registry.access.redhat.com/ubi8/nodejs-22-minimal:1-11 AS npm-installer

ARG GEMINI_CLI_VERSION=0.44.0

RUN npm install -g @google/gemini-cli@${GEMINI_CLI_VERSION} && \
    npm cache clean --force

# Verify binary and capture the package's entry-point script.
# npm global prefix on ubi8/nodejs-22-minimal is /opt/app-root/src/.npm-global
RUN which gemini && \
    node -e " \
      const p = require('/opt/app-root/src/.npm-global/lib/node_modules/@google/gemini-cli/package.json'); \
      const b = p.bin; \
      const entry = typeof b === 'string' ? b : b[Object.keys(b)[0]]; \
      process.stdout.write(entry.replace(/^\.\//, '')); \
    " > /tmp/gemini-entry.txt && \
    echo "Gemini entry point: $(cat /tmp/gemini-entry.txt)"

# Stage 2: obtain the official Node.js binary from nodejs.org.
# ubi9/nodejs-22 ships node as a dynamically linked binary that requires
# libnode.so.127 — a RHEL-package-specific shared library not present in
# workspace containers. The official upstream tarball is a self-contained
# binary compiled against glibc 2.17, which works on ubi9 (2.34), ubi10
# (2.38+), and any other modern Linux without extra shared libraries.
FROM alpine:3.21 AS node-provider

ARG TARGETARCH
ARG NODE_VERSION=22.16.0

RUN apk add --no-cache curl xz && \
    case "${TARGETARCH}" in \
      amd64) NODE_ARCH="x64" ;; \
      arm64) NODE_ARCH="arm64" ;; \
      s390x) NODE_ARCH="s390x" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
      -o /tmp/node.tar.xz && \
    tar -xJf /tmp/node.tar.xz -C /tmp && \
    cp /tmp/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node /usr/local/bin/node && \
    ls -lh /usr/local/bin/node

# Stage 3: assemble the final bundle.
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

RUN microdnf install -y libstdc++ && microdnf clean all

COPY --from=npm-installer /opt/app-root/src/.npm-global/lib/node_modules /opt/gemini-cli/lib/node_modules
COPY --from=node-provider /usr/local/bin/node /opt/gemini-cli/bin/node
COPY --from=npm-installer /tmp/gemini-entry.txt /opt/gemini-cli/gemini-entry.txt

# Wrapper script:
#   - Uses the bundled official Node.js binary (self-contained, glibc 2.17+, no libnode.so).
#   - Resolves the gemini entry point within the bundled node_modules so
#     Node's module resolution finds all dependencies correctly.
#   - Redirects HOME for OpenShift arbitrary UIDs where $HOME is not writable.
RUN GEMINI_ENTRY="$(cat /opt/gemini-cli/gemini-entry.txt)" && \
    printf '#!/bin/sh\n\
REAL_PATH="$(readlink -f "$0" 2>/dev/null || echo "$0")"\n\
SCRIPT_DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"\n\
GEMINI_SCRIPT="$SCRIPT_DIR/../lib/node_modules/@google/gemini-cli/%s"\n\
GEMINI_TMP_HOME="/tmp/gemini-home"\n\
if [ ! -w "$HOME" ]; then\n\
  export HOME="$GEMINI_TMP_HOME"\n\
fi\n\
mkdir -p "$HOME/.gemini"\n\
test -f "$HOME/.gemini/projects.json" || echo '"'"'{"projects":{}}'"'"' > "$HOME/.gemini/projects.json"\n\
exec "$SCRIPT_DIR/node" "$GEMINI_SCRIPT" "$@"\n' "$GEMINI_ENTRY" > /opt/gemini-cli/bin/gemini && \
    chmod +x /opt/gemini-cli/bin/gemini && \
    rm /opt/gemini-cli/gemini-entry.txt

LABEL org.opencontainers.image.description="Gemini CLI init container for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"
