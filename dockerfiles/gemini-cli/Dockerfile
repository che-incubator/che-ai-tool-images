# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

FROM node:22-slim AS builder

ARG GEMINI_CLI_VERSION=0.44.0

RUN npm install -g @google/gemini-cli@${GEMINI_CLI_VERSION} && \
    npm cache clean --force

# Verify binary exists
RUN which gemini

# Bundle node + gemini into /bundle for copying
RUN mkdir -p /bundle/bin /bundle/lib && \
    cp /usr/local/bin/node /bundle/bin/ && \
    cp -a /usr/local/lib/node_modules /bundle/lib/ && \
    cp -a /usr/local/bin/gemini /bundle/bin/gemini

# Stage 2: Minimal image containing the bundle
# Used as init container — copies bundle to shared volume, then exits.
FROM registry.access.redhat.com/ubi10/ubi-minimal:10.0

COPY --from=builder /bundle /opt/gemini-cli

# Rename the original gemini symlink and add a wrapper that sets HOME to a
# writable location for OpenShift arbitrary UIDs, and ensures the bundled
# node binary is on PATH (required by gemini's shebang).
RUN mv /opt/gemini-cli/bin/gemini /opt/gemini-cli/bin/gemini-bin && \
    printf '#!/bin/sh\n\
REAL_PATH="$(readlink -f "$0" 2>/dev/null || echo "$0")"\n\
SCRIPT_DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"\n\
export PATH="$SCRIPT_DIR:$PATH"\n\
GEMINI_TMP_HOME="/tmp/gemini-home"\n\
if [ ! -w "$HOME" ]; then\n\
  export HOME="$GEMINI_TMP_HOME"\n\
fi\n\
mkdir -p "$HOME/.gemini"\n\
test -f "$HOME/.gemini/projects.json" || echo '\''{"projects":{}}'\'' > "$HOME/.gemini/projects.json"\n\
exec "$SCRIPT_DIR/gemini-bin" "$@"\n' > /opt/gemini-cli/bin/gemini && \
    chmod +x /opt/gemini-cli/bin/gemini

LABEL org.opencontainers.image.description="Gemini CLI init container for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"