# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/goose:next
FROM ${SOURCE_IMAGE} AS source

# Stage 2: Minimal runtime image
FROM registry.access.redhat.com/ubi10/ubi-minimal:10.0

COPY --from=source /usr/lib64/libgomp.so* /usr/lib64/
COPY --from=source /usr/local/bin/goose /usr/local/bin/goose-bin

# Wrapper script that redirects HOME to a writable location
# for OpenShift arbitrary UIDs where $HOME is not writable.
RUN printf '#!/bin/sh\n\
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n\
GOOSE_TMP_HOME="/tmp/goose-home"\n\
if [ ! -w "$HOME" ]; then\n\
  export HOME="$GOOSE_TMP_HOME"\n\
fi\n\
mkdir -p "$HOME"\n\
exec "$SCRIPT_DIR/goose-bin" "$@"\n' > /usr/local/bin/goose && \
    chmod +x /usr/local/bin/goose

LABEL org.opencontainers.image.description="Goose CLI tool for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"
