# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/gemini-cli:next
FROM ${SOURCE_IMAGE} AS source

# Stage 2: Minimal runtime image
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

RUN microdnf install -y libstdc++ && microdnf clean all

COPY --from=source /opt/gemini-cli /opt/gemini-cli

# Wrapper script:
#   - Uses the bundled Node.js binary from the tools-injector image.
#   - Resolves the gemini entry point within the bundled node_modules so
#     Node's module resolution finds all dependencies correctly.
#   - Redirects HOME for OpenShift arbitrary UIDs where $HOME is not writable.
RUN GEMINI_ENTRY="$(cd /opt/gemini-cli/lib/node_modules/@google/gemini-cli && \
    /opt/gemini-cli/bin/node -e " \
      const p = require('./package.json'); \
      const b = p.bin; \
      const entry = typeof b === 'string' ? b : b[Object.keys(b)[0]]; \
      process.stdout.write(entry.replace(/^\.\//, '')); \
    ")" && \
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
    chmod +x /opt/gemini-cli/bin/gemini

LABEL org.opencontainers.image.description="Gemini CLI init container for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"
