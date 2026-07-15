# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

# Stage 1: copy pre-built gemini-cli node_modules from tools-injector.
# --platform=linux/amd64 is MANDATORY: tools-injector/gemini-cli has no s390x
# manifest. BuildKit always pulls the amd64 manifest regardless of the target
# build platform, which is safe because the node_modules being copied are
# architecture-independent JavaScript files.
FROM --platform=linux/amd64 quay.io/che-incubator/tools-injector/gemini-cli:next AS source

# Stage 2: obtain the official Node.js binary from nodejs.org.
# The official upstream tarball is a self-contained binary compiled against
# glibc 2.17, which works on ubi9 (2.34), ubi10 (2.38+), and any other modern
# Linux without extra shared libraries. Supports amd64, arm64, and s390x.
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
    cp /tmp/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node /node && \
    ls -lh /node

# Stage 3: assemble the final bundle.
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

RUN microdnf install -y libstdc++ && microdnf clean all

COPY --from=source /opt/gemini-cli/lib/node_modules /opt/gemini-cli/lib/node_modules
COPY --from=node-provider /node /opt/gemini-cli/bin/node

# Wrapper script:
#   - Uses the bundled official Node.js binary (self-contained, glibc 2.17+, no libnode.so).
#   - Resolves the gemini entry point within the bundled node_modules.
#   - Redirects HOME for OpenShift arbitrary UIDs where $HOME is not writable.
#   - Uses SCRIPT_DIR so the wrapper works both at /opt/gemini-cli/bin/ and
#     at any injected-tools path.
RUN printf '#!/bin/sh\n\
REAL_PATH="$(readlink -f "$0" 2>/dev/null || echo "$0")"\n\
SCRIPT_DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"\n\
GEMINI_SCRIPT="$SCRIPT_DIR/../lib/node_modules/@google/gemini-cli/bundle/gemini.js"\n\
GEMINI_TMP_HOME="/tmp/gemini-home"\n\
if [ ! -w "$HOME" ]; then\n\
  export HOME="$GEMINI_TMP_HOME"\n\
fi\n\
mkdir -p "$HOME/.gemini"\n\
test -f "$HOME/.gemini/projects.json" || echo '"'"'{"projects":{}}'"'"' > "$HOME/.gemini/projects.json"\n\
exec "$SCRIPT_DIR/node" "$GEMINI_SCRIPT" "$@"\n' > /opt/gemini-cli/bin/gemini && \
    chmod +x /opt/gemini-cli/bin/gemini

LABEL org.opencontainers.image.description="Gemini CLI init container for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"
