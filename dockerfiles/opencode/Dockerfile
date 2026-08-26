# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

FROM alpine:3.21 AS builder

ARG OPENCODE_VERSION=v1.18.14
ARG TARGETARCH

RUN apk add --no-cache curl tar gzip

RUN set -e && \
    case "${TARGETARCH}" in \
      amd64) ARCH="x64" ;; \
      arm64) ARCH="arm64" ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL -o /tmp/opencode.tar.gz \
      "https://github.com/anomalyco/opencode/releases/download/${OPENCODE_VERSION}/opencode-linux-${ARCH}.tar.gz" && \
    tar -xzf /tmp/opencode.tar.gz -C /tmp && \
    mv /tmp/opencode /usr/local/bin/opencode && \
    chmod +x /usr/local/bin/opencode

# Stage 2: Minimal runtime image
FROM registry.access.redhat.com/ubi10/ubi-minimal:10.0

COPY --from=builder /usr/local/bin/opencode /usr/local/bin/opencode-bin

# Wrapper script: redirect XDG dirs to writable locations for OpenShift arbitrary UIDs.
# Uses SCRIPT_DIR so the wrapper works both at /usr/local/bin/ and /injected-tools/bin/.
RUN printf '#!/bin/sh\n\
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n\
OC_HOME="/tmp/opencode-home"\n\
mkdir -p "$OC_HOME/.config" "$OC_HOME/.local/share" "$OC_HOME/.local/state" "$OC_HOME/.cache"\n\
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$OC_HOME/.config}"\n\
export XDG_DATA_HOME="${XDG_DATA_HOME:-$OC_HOME/.local/share}"\n\
export XDG_STATE_HOME="${XDG_STATE_HOME:-$OC_HOME/.local/state}"\n\
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$OC_HOME/.cache}"\n\
exec "$SCRIPT_DIR/opencode-bin" "$@"\n' > /usr/local/bin/opencode && \
    chmod +x /usr/local/bin/opencode

LABEL org.opencontainers.image.description="Opencode CLI tool for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"