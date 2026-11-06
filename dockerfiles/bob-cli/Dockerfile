# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0

FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6 AS builder

ARG TARGETARCH
ARG NODE_VERSION=24.22.2
ARG BOB_CLI_VERSION=2.0.9

RUN microdnf install -y tar xz gzip libstdc++ && microdnf clean all

# Use upstream Node, rather than the RHEL binary that requires libnode.so
# in the destination workspace. Verify the downloaded archive before use.
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      s390x) NODE_ARCH=s390x ;; \
      ppc64le) NODE_ARCH=ppc64le ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; \
    esac; \
    ARCHIVE="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/${ARCHIVE}" -o "/tmp/${ARCHIVE}"; \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o /tmp/SHASUMS256.txt; \
    cd /tmp; grep "  ${ARCHIVE}$" SHASUMS256.txt | sha256sum -c -; \
    mkdir -p /opt/node; \
    tar -xJf "${ARCHIVE}" --strip-components=1 -C /opt/node; \
    rm -f "${ARCHIVE}" SHASUMS256.txt

ENV PATH="/opt/node/bin:${PATH}"
RUN npm install --registry=https://registry.npmjs.org/ --prefix /opt/bob-cli -g "@ibm/bob@${BOB_CLI_VERSION}" && \
    npm cache clean --force && \
    rm /opt/bob-cli/bin/bob && \
    cp /opt/node/bin/node /opt/bob-cli/bin/node

# Resolve the injected symlink and use the bundled Node, including in child processes.
# Fall back to a writable home for OpenShift arbitrary UIDs.
RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'REAL_PATH="$(readlink -f "$0")"' \
    'SCRIPT_DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"' \
    'if [ -z "${HOME:-}" ] || [ ! -w "$HOME" ]; then' \
    '    export HOME="/tmp/bob-home-$(id -u)"' \
    'fi' \
    'mkdir -p "$HOME/.bob"' \
    'export PATH="$SCRIPT_DIR:$PATH"' \
    'exec "$SCRIPT_DIR/node" "$SCRIPT_DIR/../lib/node_modules/@ibm/bob/dist/bob.js" "$@"' \
    > /opt/bob-cli/bin/bob && \
    chmod -R a+rX /opt/bob-cli && chmod 755 /opt/bob-cli/bin/bob && \
    /opt/bob-cli/bin/bob --version

FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

RUN microdnf install -y libstdc++ && microdnf clean all
COPY --from=builder /opt/bob-cli /opt/bob-cli

USER 1001
LABEL org.opencontainers.image.description="IBM Bob CLI bundle for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"
