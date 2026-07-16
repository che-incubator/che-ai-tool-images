# Specification: Consume tools-injector Images in che-ai-tool-images

## Problem

Both repositories independently download identical upstream AI tool binaries. This causes version drift (claude-code 2.1.207 in tools-injector vs 2.1.81 in che-ai-tool-images) and doubles maintenance burden. The only value-add in che-ai-tool-images is the OpenShift arbitrary-UID wrapper layer and the `dashboard-ai` publish namespace.

## Design

### Dockerfile Pattern

Use a **named source stage** with a build-arg for the tools-injector image. Default to `:next` for local development; CI overrides with a resolved digest.

```dockerfile
ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/<tool>:next
FROM ${SOURCE_IMAGE} AS source
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6  # or ubi10 as appropriate
COPY --from=source /path /path
# ... wrapper script ...
```

### Verified Binary Paths (from tools-injector Dockerfiles)

| Tool | Path in tools-injector image | Copy destination in che-ai-tool-images |
|------|------------------------------|----------------------------------------|
| claude-code | `/usr/local/bin/claude` | `/usr/local/bin/claude-bin` |
| opencode | `/usr/local/bin/opencode` | `/usr/local/bin/opencode-bin` |
| gemini-cli | `/opt/gemini-cli/` (full tree: `bin/node`, `bin/gemini`, `lib/node_modules/`) | `/opt/gemini-cli/` (wrapper overwrites `bin/gemini`) |

### claude-code

```dockerfile
ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/claude-code:next
FROM ${SOURCE_IMAGE} AS source
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

COPY --from=source /usr/local/bin/claude /usr/local/bin/claude-bin

# Wrapper script — preserved from current repo
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

Removes: alpine download stage, `ARG CLAUDE_CODE_VERSION`.

### opencode

```dockerfile
ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/opencode:next
FROM ${SOURCE_IMAGE} AS source
FROM registry.access.redhat.com/ubi10/ubi-minimal:10.0

COPY --from=source /usr/local/bin/opencode /usr/local/bin/opencode-bin

# Wrapper script — preserved from current repo
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

Removes: alpine download stage, `ARG OPENCODE_VERSION`.

### gemini-cli

```dockerfile
ARG SOURCE_IMAGE=quay.io/che-incubator/tools-injector/gemini-cli:next
FROM ${SOURCE_IMAGE} AS source
FROM registry.access.redhat.com/ubi9/ubi-minimal:9.6

RUN microdnf install -y libstdc++ && microdnf clean all

COPY --from=source /opt/gemini-cli /opt/gemini-cli

# Discover gemini entry point and write wrapper script.
# tools-injector bundles node + npm global install; the bin/gemini is an npm script.
# The wrapper overwrites it with HOME redirect logic.
RUN GEMINI_ENTRY="$(cd /opt/gemini-cli/lib/node_modules/@google/gemini-cli && \
    node -e "const p=require('./package.json'); const b=p.bin; const e=typeof b==='string'?b:b[Object.keys(b)[0]]; process.stdout.write(e.replace(/^\\.\\//,''))")" && \
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

Removes: ubi8/nodejs-22-minimal npm stage, alpine Node.js download stage, all version ARGs.

Keeps: `libstdc++` install (needed for dynamically-linked Node.js from tools-injector bundle).

**Drop s390x support.** Build `linux/amd64` and `linux/arm64` only. Revisit when tools-injector publishes s390x for gemini-cli.

## CI Changes

### resolve-versions action rewrite

Replace Dockerfile ARG grepping with tools-injector image inspection.

The action must:

1. **Resolve `:next` to digest** for each tool using `skopeo inspect --raw` on the manifest list.
2. **Extract version** by running the binary in an ephemeral container (`docker run --rm <image> <tool> --version`). No `org.opencontainers.image.version` label exists on tools-injector images (verified 2026-07-16).
3. **Emit build-args**: pass `SOURCE_IMAGE=quay.io/che-incubator/tools-injector/<tool>@sha256:<resolved-digest>` to `docker buildx build`.
4. **Compute immutable tags**: `{version}-{YYYYMMDD}-{sha7}` — same format as today.
5. **Fail the job** if the resolved manifest list does not contain all required platforms (amd64, arm64).

```bash
# Example for claude-code
DIGEST=$(skopeo inspect --override-os linux --override-arch amd64 \
  --raw docker://quay.io/che-incubator/tools-injector/claude-code:next | \
  jq -r '.digest // empty')
if [ -z "$DIGEST" ]; then
  DIGEST=$(skopeo inspect --override-os linux --override-arch amd64 \
    docker://quay.io/che-incubator/tools-injector/claude-code:next | \
    jq -r '.Digest')
fi

VERSION=$(docker run --rm quay.io/che-incubator/tools-injector/claude-code:next \
  claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

SOURCE_IMAGE="quay.io/che-incubator/tools-injector/claude-code@${DIGEST}"
TAG="${VERSION:-unknown}-$(date +%Y%m%d)-$(git rev-parse --short=7 HEAD)"
```

### No lock file

Do not introduce a committed version-tracking file. The tools-injector image IS the source of truth.

## Architecture Support

| Tool | Platforms | Source |
|------|-----------|--------|
| claude-code | linux/amd64, linux/arm64 | tools-injector |
| opencode | linux/amd64, linux/arm64 | tools-injector |
| gemini-cli | linux/amd64, linux/arm64 | tools-injector |

s390x is dropped for gemini-cli. CI must validate that the source manifest contains all required platforms before proceeding with the build.

## Files to Modify

| File | Change |
|------|--------|
| `dockerfiles/claude-code/Dockerfile` | Replace with COPY --from tools-injector pattern |
| `dockerfiles/gemini-cli/Dockerfile` | Replace with COPY --from tools-injector pattern, drop s390x |
| `dockerfiles/opencode/Dockerfile` | Replace with COPY --from tools-injector pattern |
| `.github/actions/resolve-versions/action.yml` | Rewrite to inspect tools-injector images instead of grepping ARGs |
| `.github/workflows/next-build-multiarch.yml` | Update to pass SOURCE_IMAGE build-arg, remove s390x from gemini-cli platforms |
| `.github/workflows/release-build-multiarch.yml` | Same updates as next-build workflow |
| `registry.json` | **No change** |

## Validation Plan

1. **Path verification**: Done — verified via tools-injector Dockerfiles on GitHub.
2. **Local build**: `docker buildx build --platform linux/amd64,linux/arm64` for each tool.
3. **Binary execution**: `docker run --rm <image> <tool> --version` succeeds and reports expected version.
4. **Wrapper test**: `docker run --rm -u 1000170000:0 <image> <tool> --help` succeeds (confirms HOME redirect under OpenShift arbitrary UID).
5. **File tree diff**: Compare `find` output between old and new images to confirm identical binary+wrapper layout.
6. **CI dry-run**: Run the rewritten resolve-versions action and confirm correct `{version}-{YYYYMMDD}-{sha7}` tags.
7. **registry.json unchanged**: `git diff` confirms no modification.
8. **Multi-arch manifest**: `skopeo inspect --raw` on published manifest list shows exactly amd64 and arm64.

## What This Does NOT Change

- tools-injector repository (no modifications)
- che-dashboard (no modifications)
- registry.json (no modifications)
- Wrapper script logic (preserved from current repo)
- Published image paths (`quay.io/che-incubator/dashboard-ai/<tool>:next`)
- Immutable tag format (`{version}-{YYYYMMDD}-{sha7}`)

## Risks

- **Version coupling**: che-ai-tool-images inherits versions from tools-injector `:next`. Desired behavior — eliminates drift. Tools-injector must be built first when versions bump.
- **Single failure domain**: Quay.io outage blocks all builds. Current approach has three independent failure domains. Acceptable tradeoff for eliminated drift.
- **Node.js binary compatibility**: tools-injector bundles Node.js from `node:22-slim` (Debian-based, dynamically linked). The `libstdc++` install in gemini-cli Dockerfile addresses this.

---

*Designed by 5-model LLM Council (Claude Opus 4.6, Fable/Sonnet 5, Gemini 3.1 Pro, GPT-5.4, Grok 4.5) — 2026-07-16*
