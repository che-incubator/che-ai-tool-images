# Reuse tools-injector Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework all three Dockerfiles in che-ai-tool-images to COPY binaries from tools-injector images instead of downloading upstream binaries, and update CI to resolve versions from those images.

**Architecture:** Each Dockerfile becomes a 2-stage build: a named `FROM ${SOURCE_IMAGE} AS source` stage pulls the tools-injector image, then the runtime stage copies the binary and adds the OpenShift arbitrary-UID wrapper script. CI resolves versions by running the binary inside the source image instead of grepping Dockerfile ARGs.

**Tech Stack:** Docker multi-stage builds, GitHub Actions, skopeo, shell scripts

## Global Constraints

- Do NOT modify tools-injector or che-dashboard repositories
- `registry.json` must not change
- Wrapper scripts must be functionally preserved (OpenShift arbitrary-UID handling)
- Multi-arch: all images build for linux/amd64 and linux/arm64
- s390x is dropped for gemini-cli
- Every `git commit` must include `-s` (DCO sign-off)
- Immutable build tag format preserved: `{version}-{YYYYMMDD}-{sha7}`

---

### Task 1: Rewrite claude-code Dockerfile

**Files:**
- Modify: `dockerfiles/claude-code/Dockerfile` (full rewrite)

**Interfaces:**
- Consumes: `quay.io/che-incubator/tools-injector/claude-code:next` — binary at `/usr/local/bin/claude`
- Produces: Image with binary at `/usr/local/bin/claude-bin`, wrapper at `/usr/local/bin/claude`, accepts `SOURCE_IMAGE` build-arg

- [ ] **Step 1: Replace the entire Dockerfile**

Replace `dockerfiles/claude-code/Dockerfile` with this content. The copyright header is preserved, the alpine download stage is removed, and a named source stage pulls from tools-injector:

```dockerfile
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/claude-code:next
FROM ${SOURCE_IMAGE} AS source

# Stage 2: Minimal runtime image
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

COPY --from=source /usr/local/bin/claude /usr/local/bin/claude-bin

# Wrapper script that redirects HOME and config dirs to a writable location
# for OpenShift arbitrary UIDs where $HOME is not writable.
RUN printf '#!/bin/sh\n\
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\n\
CLAUDE_TMP_HOME="/tmp/claude-home"\n\
if [ ! -w "$HOME" ]; then\n\
  export HOME="$CLAUDE_TMP_HOME"\n\
fi\n\
mkdir -p "$HOME/.claude"\n\
exec "$SCRIPT_DIR/claude-bin" "$@"\n' > /usr/local/bin/claude && \
    chmod +x /usr/local/bin/claude

LABEL org.opencontainers.image.description="Claude Code CLI tool for DevWorkspace injection" \
      org.opencontainers.image.source="https://github.com/che-incubator/che-ai-tool-images.git"
```

Key changes from current:
- Removed `FROM alpine:3.21 AS builder` stage and the `curl` download
- Removed `ARG CLAUDE_CODE_VERSION` and `ARG TARGETARCH`
- Added `ARG SOURCE_IMAGE` with `FROM ${SOURCE_IMAGE} AS source`
- `COPY --from=source` replaces `COPY --from=builder`
- Wrapper script is byte-for-byte identical to current

- [ ] **Step 2: Verify the Dockerfile is syntactically valid**

Run:
```bash
docker buildx build --check dockerfiles/claude-code/
```

If docker is unavailable, visually verify: the file has exactly two `FROM` lines (one for source stage, one for runtime), the `COPY --from=source` references the named stage, and the wrapper `printf` block matches the current wrapper exactly.

- [ ] **Step 3: Commit**

```bash
git add dockerfiles/claude-code/Dockerfile
git commit -s -m "feat(claude-code): use tools-injector image as binary source

Replace the alpine download stage with COPY --from tools-injector.
The wrapper script for OpenShift arbitrary UID handling is preserved."
```

---

### Task 2: Rewrite opencode Dockerfile

**Files:**
- Modify: `dockerfiles/opencode/Dockerfile` (full rewrite)

**Interfaces:**
- Consumes: `quay.io/che-incubator/tools-injector/opencode:next` — binary at `/usr/local/bin/opencode`
- Produces: Image with binary at `/usr/local/bin/opencode-bin`, wrapper at `/usr/local/bin/opencode`, accepts `SOURCE_IMAGE` build-arg

- [ ] **Step 1: Replace the entire Dockerfile**

Replace `dockerfiles/opencode/Dockerfile` with this content:

```dockerfile
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/opencode:next
FROM ${SOURCE_IMAGE} AS source

# Stage 2: Minimal runtime image
FROM registry.access.redhat.com/ubi10/ubi-minimal:10.0

COPY --from=source /usr/local/bin/opencode /usr/local/bin/opencode-bin

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
```

Key changes from current:
- Removed `FROM alpine:3.21 AS builder` stage and the `curl`/`tar` download
- Removed `ARG OPENCODE_VERSION` and `ARG TARGETARCH`
- Added `ARG SOURCE_IMAGE` with `FROM ${SOURCE_IMAGE} AS source`
- `COPY --from=source` replaces `COPY --from=builder`
- Wrapper script is byte-for-byte identical to current
- Runtime base image stays `ubi10/ubi-minimal:10.0` (unchanged)

- [ ] **Step 2: Verify the Dockerfile is syntactically valid**

Run:
```bash
docker buildx build --check dockerfiles/opencode/
```

Same visual verification as Task 1 if docker is unavailable.

- [ ] **Step 3: Commit**

```bash
git add dockerfiles/opencode/Dockerfile
git commit -s -m "feat(opencode): use tools-injector image as binary source

Replace the alpine download stage with COPY --from tools-injector.
The wrapper script for OpenShift arbitrary UID handling is preserved."
```

---

### Task 3: Rewrite gemini-cli Dockerfile

**Files:**
- Modify: `dockerfiles/gemini-cli/Dockerfile` (full rewrite)

**Interfaces:**
- Consumes: `quay.io/che-incubator/tools-injector/gemini-cli:next` — bundle at `/opt/gemini-cli/` with `bin/node`, `bin/gemini`, `lib/node_modules/`
- Produces: Image with bundle at `/opt/gemini-cli/`, wrapper overwrites `bin/gemini`, accepts `SOURCE_IMAGE` build-arg

- [ ] **Step 1: Replace the entire Dockerfile**

Replace `dockerfiles/gemini-cli/Dockerfile` with this content. This is the most complex change — three build stages collapse into one source stage + one runtime stage:

```dockerfile
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
```

Key changes from current:
- Removed `FROM registry.access.redhat.com/ubi8/nodejs-22-minimal:1-11 AS npm-installer` stage (npm install)
- Removed `FROM alpine:3.21 AS node-provider` stage (Node.js download from nodejs.org)
- Removed all version ARGs (`GEMINI_CLI_VERSION`, `NODE_VERSION`, `TARGETARCH`)
- Added `ARG SOURCE_IMAGE` with `FROM ${SOURCE_IMAGE} AS source`
- Single `COPY --from=source /opt/gemini-cli /opt/gemini-cli` replaces two separate COPY commands
- Entry point discovery uses `/opt/gemini-cli/bin/node` (the bundled node from tools-injector) instead of system `node`
- Wrapper script logic is functionally identical — same HOME redirect, same projects.json init
- Runtime base changed to `ubi9/ubi-minimal:9.6` (from `ubi9/ubi-minimal:9.6` in current — no change)
- `libstdc++` install preserved (tools-injector's node binary is dynamically linked)

- [ ] **Step 2: Verify the Dockerfile is syntactically valid**

Run:
```bash
docker buildx build --check dockerfiles/gemini-cli/
```

Pay special attention to: the `node -e` command uses `/opt/gemini-cli/bin/node` (not bare `node`), the `printf` format string has exactly one `%s` for the entry point, and single-quote escaping (`'"'"'`) is correct.

- [ ] **Step 3: Commit**

```bash
git add dockerfiles/gemini-cli/Dockerfile
git commit -s -m "feat(gemini-cli): use tools-injector image as binary source

Replace the npm-installer and node-provider stages with COPY --from
tools-injector. The wrapper script for OpenShift arbitrary UID handling
is preserved. s390x support is dropped (tools-injector does not publish
s390x for gemini-cli)."
```

---

### Task 4: Rewrite resolve-versions action

**Files:**
- Modify: `.github/actions/resolve-versions/action.yml` (full rewrite)

**Interfaces:**
- Consumes: tools-injector images at `quay.io/che-incubator/tools-injector/<tool>:next`
- Produces: outputs `claude`, `gemini`, `opencode` (version strings), `claude_tag`, `gemini_tag`, `opencode_tag` (immutable build tags), `claude_source`, `gemini_source`, `opencode_source` (digest-pinned image refs for build-args)

- [ ] **Step 1: Replace the action.yml**

Replace `.github/actions/resolve-versions/action.yml` with this content. The action now inspects tools-injector images instead of grepping Dockerfile ARGs:

```yaml
#
# Copyright (c) 2025 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
name: 'Resolve Tool Versions'
description: >
  Resolves tool versions by inspecting tools-injector container images.
  Extracts version strings by running the binary inside each image,
  resolves image digests for reproducible builds, and computes immutable
  dated build tags in the form {version}-{YYYYMMDD}-{sha7}.

inputs:
  sha:
    description: 'Full Git SHA — first 7 chars are appended to the build tag'
    required: true
  source_tag:
    description: 'Tag to pull from tools-injector images (default: next)'
    required: false
    default: 'next'

outputs:
  claude:
    description: 'Resolved Claude Code version'
    value: ${{ steps.resolve.outputs.claude }}
  gemini:
    description: 'Resolved Gemini CLI version'
    value: ${{ steps.resolve.outputs.gemini }}
  opencode:
    description: 'Resolved OpenCode version'
    value: ${{ steps.resolve.outputs.opencode }}
  claude_tag:
    description: 'Immutable build tag for claude-code'
    value: ${{ steps.resolve.outputs.claude_tag }}
  gemini_tag:
    description: 'Immutable build tag for gemini-cli'
    value: ${{ steps.resolve.outputs.gemini_tag }}
  opencode_tag:
    description: 'Immutable build tag for opencode'
    value: ${{ steps.resolve.outputs.opencode_tag }}
  claude_source:
    description: 'Digest-pinned source image for claude-code'
    value: ${{ steps.resolve.outputs.claude_source }}
  gemini_source:
    description: 'Digest-pinned source image for gemini-cli'
    value: ${{ steps.resolve.outputs.gemini_source }}
  opencode_source:
    description: 'Digest-pinned source image for opencode'
    value: ${{ steps.resolve.outputs.opencode_source }}

runs:
  using: composite
  steps:
    - id: resolve
      shell: bash
      env:
        INPUT_SHA: ${{ inputs.sha }}
        SOURCE_TAG: ${{ inputs.source_tag }}
        REGISTRY: quay.io/che-incubator/tools-injector
      run: |
        set -euo pipefail

        resolve_tool() {
          local TOOL="$1"
          local KEY="$2"
          local VERSION_CMD="$3"
          local IMAGE="${REGISTRY}/${TOOL}:${SOURCE_TAG}"

          # Resolve digest for reproducible builds
          local DIGEST
          DIGEST=$(skopeo inspect --override-os linux --override-arch amd64 \
            "docker://${IMAGE}" | jq -r '.Digest')
          if [ -z "$DIGEST" ] || [ "$DIGEST" = "null" ]; then
            echo "::error::Failed to resolve digest for ${IMAGE}"
            exit 1
          fi

          # Validate required platforms exist in the manifest
          local PLATFORMS
          PLATFORMS=$(skopeo inspect --override-os linux --override-arch amd64 \
            --raw "docker://${IMAGE}" | \
            jq -r '[.manifests[]?.platform | select(.architecture == "amd64" or .architecture == "arm64") | .architecture] | sort | join(",")' 2>/dev/null || echo "")
          if [[ "$PLATFORMS" != *"amd64"* ]] || [[ "$PLATFORMS" != *"arm64"* ]]; then
            echo "::warning::Platform check inconclusive for ${IMAGE} (got: ${PLATFORMS:-none}). Proceeding — buildx will fail if platforms are missing."
          fi

          # Extract version by running the binary
          local VERSION
          VERSION=$(docker run --rm "${IMAGE}" ${VERSION_CMD} 2>/dev/null \
            | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
          if [ -z "$VERSION" ]; then
            echo "::warning::Could not extract version from ${IMAGE} via '${VERSION_CMD}'. Using 'unknown'."
            VERSION="unknown"
          fi

          local DATE SHA7 TAG SOURCE
          DATE=$(date +%Y%m%d)
          SHA7="${INPUT_SHA:0:7}"
          TAG="${VERSION}-${DATE}-${SHA7}"
          SOURCE="${REGISTRY}/${TOOL}@${DIGEST}"

          echo "${TOOL} version: ${VERSION}, tag: ${TAG}, source: ${SOURCE}"

          echo "${KEY}=${VERSION}" >> "$GITHUB_OUTPUT"
          echo "${KEY}_tag=${TAG}" >> "$GITHUB_OUTPUT"
          echo "${KEY}_source=${SOURCE}" >> "$GITHUB_OUTPUT"
        }

        resolve_tool "claude-code" "claude" "claude --version"
        resolve_tool "gemini-cli" "gemini" "/opt/gemini-cli/bin/gemini --version"
        resolve_tool "opencode" "opencode" "opencode --version"
```

Key changes from current:
- Removed all `grep` commands that parsed Dockerfile ARGs
- Removed `claude_override`, `gemini_override`, `opencode_override` inputs (versions come from images)
- Added `source_tag` input (defaults to `next`, allows overriding)
- New outputs: `claude_source`, `gemini_source`, `opencode_source` (digest-pinned refs)
- Uses `skopeo inspect` to resolve digests and `docker run` to extract versions
- Includes platform validation (warns if amd64/arm64 missing)
- Output keys match current convention: `claude`, `gemini`, `opencode` (passed as second arg to resolve_tool)

- [ ] **Step 2: Verify YAML syntax**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/actions/resolve-versions/action.yml'))"
```

Expected: no output (clean parse).

- [ ] **Step 3: Commit**

```bash
git add .github/actions/resolve-versions/action.yml
git commit -s -m "feat(ci): rewrite resolve-versions to inspect tools-injector images

Replace Dockerfile ARG grepping with skopeo inspect + docker run.
Versions are now extracted from the tools-injector images themselves.
New outputs: digest-pinned source image refs for reproducible builds."
```

---

### Task 5: Update next-build workflow

**Files:**
- Modify: `.github/workflows/next-build-multiarch.yml`

**Interfaces:**
- Consumes: resolve-versions outputs from Task 4 (`claude_source`, `gemini_source`, `opencode_source`, `*_tag`)
- Produces: Published images at `quay.io/che-incubator/dashboard-ai/<tool>:next`

- [ ] **Step 1: Update the workflow**

In `.github/workflows/next-build-multiarch.yml`, make these changes:

1. In the "Build and push claude-code" step, add `build-args` to pass the source image:

```yaml
      -
        name: "Build and push claude-code"
        uses: docker/build-push-action@v5
        with:
          context: ./dockerfiles/claude-code
          file: ./dockerfiles/claude-code/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          provenance: false
          build-args: |
            SOURCE_IMAGE=${{ steps.versions.outputs.claude_source }}
          tags: |
            ${{ env.REGISTRY }}/claude-code:next
            ${{ env.REGISTRY }}/claude-code:${{ steps.versions.outputs.claude_tag }}
```

2. In the "Build and push gemini-cli" step, remove `linux/s390x` from platforms and add `build-args`:

```yaml
      -
        name: "Build and push gemini-cli"
        uses: docker/build-push-action@v5
        with:
          context: ./dockerfiles/gemini-cli
          file: ./dockerfiles/gemini-cli/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          provenance: false
          build-args: |
            SOURCE_IMAGE=${{ steps.versions.outputs.gemini_source }}
          tags: |
            ${{ env.REGISTRY }}/gemini-cli:next
            ${{ env.REGISTRY }}/gemini-cli:${{ steps.versions.outputs.gemini_tag }}
```

3. In the "Build and push opencode" step, add `build-args`:

```yaml
      -
        name: "Build and push opencode"
        uses: docker/build-push-action@v5
        with:
          context: ./dockerfiles/opencode
          file: ./dockerfiles/opencode/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          provenance: false
          build-args: |
            SOURCE_IMAGE=${{ steps.versions.outputs.opencode_source }}
          tags: |
            ${{ env.REGISTRY }}/opencode:next
            ${{ env.REGISTRY }}/opencode:${{ steps.versions.outputs.opencode_tag }}
```

- [ ] **Step 2: Verify YAML syntax**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/next-build-multiarch.yml'))"
```

Expected: no output (clean parse).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/next-build-multiarch.yml
git commit -s -m "feat(ci): pass tools-injector source images to next-build

Add SOURCE_IMAGE build-args using digest-pinned refs from resolve-versions.
Remove s390x from gemini-cli platforms (tools-injector does not publish it)."
```

---

### Task 6: Update release-build workflow

**Files:**
- Modify: `.github/workflows/release-build-multiarch.yml`

**Interfaces:**
- Consumes: resolve-versions outputs from Task 4
- Produces: Published images at `quay.io/che-incubator/dashboard-ai/<tool>:latest`

- [ ] **Step 1: Update the workflow**

In `.github/workflows/release-build-multiarch.yml`, make these changes:

1. Replace the `workflow_dispatch.inputs` section. The old version-override inputs no longer apply — replace with a source tag override:

```yaml
on:
  workflow_dispatch:
    inputs:
      source_tag:
        description: "Tag to pull from tools-injector images (default: next)"
        required: false
        default: 'next'
```

2. Update the "Resolve versions" step to pass the source tag:

```yaml
      -
        name: "Resolve versions"
        id: versions
        uses: ./.github/actions/resolve-versions
        with:
          sha: ${{ github.sha }}
          source_tag: ${{ github.event.inputs.source_tag || 'next' }}
```

3. Update the "Build and push claude-code" step — replace old `build-args` with `SOURCE_IMAGE`:

```yaml
      -
        name: "Build and push claude-code"
        uses: docker/build-push-action@v5
        with:
          context: ./dockerfiles/claude-code
          file: ./dockerfiles/claude-code/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          provenance: false
          build-args: |
            SOURCE_IMAGE=${{ steps.versions.outputs.claude_source }}
          tags: |
            ${{ env.REGISTRY }}/claude-code:latest
            ${{ env.REGISTRY }}/claude-code:${{ steps.versions.outputs.claude_tag }}
```

4. Update the "Build and push gemini-cli" step — replace old `build-args`, remove s390x:

```yaml
      -
        name: "Build and push gemini-cli"
        uses: docker/build-push-action@v5
        with:
          context: ./dockerfiles/gemini-cli
          file: ./dockerfiles/gemini-cli/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          provenance: false
          build-args: |
            SOURCE_IMAGE=${{ steps.versions.outputs.gemini_source }}
          tags: |
            ${{ env.REGISTRY }}/gemini-cli:latest
            ${{ env.REGISTRY }}/gemini-cli:${{ steps.versions.outputs.gemini_tag }}
```

5. Update the "Build and push opencode" step — replace old `build-args`:

```yaml
      -
        name: "Build and push opencode"
        uses: docker/build-push-action@v5
        with:
          context: ./dockerfiles/opencode
          file: ./dockerfiles/opencode/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          provenance: false
          build-args: |
            SOURCE_IMAGE=${{ steps.versions.outputs.opencode_source }}
          tags: |
            ${{ env.REGISTRY }}/opencode:latest
            ${{ env.REGISTRY }}/opencode:${{ steps.versions.outputs.opencode_tag }}
```

- [ ] **Step 2: Verify YAML syntax**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-build-multiarch.yml'))"
```

Expected: no output (clean parse).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-build-multiarch.yml
git commit -s -m "feat(ci): pass tools-injector source images to release-build

Replace per-tool version override inputs with a single source_tag input.
Add SOURCE_IMAGE build-args using digest-pinned refs from resolve-versions.
Remove s390x from gemini-cli platforms."
```
