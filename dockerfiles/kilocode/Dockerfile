# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/kilocode:next
FROM ${SOURCE_IMAGE} AS source

# Stage 2: Minimal runtime image
FROM registry.access.redhat.com/ubi10/ubi-minimal:10.0

RUN microdnf install -y libstdc++ && microdnf clean all

COPY --from=source /opt/kilocode /opt/kilocode

# Wrapper script:
#   - Uses the bundled Node.js binary from the tools-injector image.
#   - Resolves the kilo entry point within the bundled node_modules so
#     Node's module resolution finds all dependencies correctly.
#   - Redirects HOME for OpenShift arbitrary UIDs where $HOME is not writable.
RUN KILO_ENTRY="$(cd /opt/kilocode/lib/node_modules/@kilocode/cli && \
    /opt/kilocode/bin/node -e " \
      const p = require('./package.json'); \
      const b = p.bin; \
      const entry = typeof b === 'string' ? b : b[Object.keys(b)[0]]; \
      process.stdout.write(entry.replace(/^\.\//, '')); \
    ")" && \
    printf '#!/bin/sh\n\
REAL_PATH="$(readlink -f "$0" 2>/dev/null || echo "$0")"\n\
SCRIPT_DIR="$(cd "$(dirname "$REAL_PATH")" && pwd)"\n\
KILO_SCRIPT="$SCRIPT_DIR/../lib/node_modules/@kilocode/cli/%s"\n\
KILO_TMP_HOME="/tmp/kilocode-home"\n\
if [ ! -w "$HOME" ]; then\n\
  export HOME="$KILO_TMP_HOME"\n\
fi\n\
mkdir -p "$HOME"\n\
exec "$SCRIPT_DIR/node" "$KILO_SCRIPT" "$@"\n' "$KILO_ENTRY" > /opt/kilocode/bin/kilo && \
    chmod +x /opt/kilocode/bin/kilo

LABEL org.opencontainers.image.description="Kilo Code CLI tool for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"
