# Specification: Add s390x Support to tools-injector gemini-cli

## Problem

The tools-injector gemini-cli image only supports amd64 and arm64. It uses `node:22-slim` as its npm install base, which lacks s390x support. This prevents che-ai-tool-images from consuming the tools-injector gemini-cli image for s390x builds — forcing either a parallel build path or dropping s390x entirely.

## Goal

Enable s390x builds for gemini-cli in tools-injector so that che-ai-tool-images can restore s390x support by simply consuming the tools-injector image for all three architectures.

## Design

### Dockerfile: 3-stage build

Replace the current 2-stage build (`node:22-slim` → `ubi10/ubi-minimal`) with a 3-stage build:

**Stage 1 — npm install** on `ubi10/nodejs-22-minimal:10.0` (supports amd64, arm64, ppc64le, s390x):
```dockerfile
FROM registry.access.redhat.com/ubi10/nodejs-22-minimal:10.0 AS npm-installer
ARG GEMINI_CLI_VERSION=0.49.0
RUN npm install -g @google/gemini-cli@${GEMINI_CLI_VERSION} && npm cache clean --force
RUN which gemini
```

npm global prefix on ubi10/nodejs-22-minimal is `/opt/app-root/src/.npm-global`.

**Stage 2 — Node.js binary** from nodejs.org (self-contained, no libnode.so dependency):
```dockerfile
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
    cp /tmp/node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node /usr/local/bin/node
```

Why not copy node from ubi10/nodejs-22-minimal: the ubi10 node binary is dynamically linked against `libnode.so.127`, which is not present in the runtime `ubi10/ubi-minimal` image. The nodejs.org binary is self-contained.

**Stage 3 — runtime bundle** on `ubi10/ubi-minimal:10.0`:
```dockerfile
FROM registry.access.redhat.com/ubi10/ubi-minimal:10.0
COPY --from=node-provider /usr/local/bin/node /opt/gemini-cli/bin/node
COPY --from=npm-installer /opt/app-root/src/.npm-global/lib/node_modules /opt/gemini-cli/lib/node_modules
COPY --from=npm-installer /opt/app-root/src/.npm-global/bin/gemini /opt/gemini-cli/bin/gemini
```

The bundle layout stays identical: `/opt/gemini-cli/bin/node`, `/opt/gemini-cli/bin/gemini`, `/opt/gemini-cli/lib/node_modules/`. Consumers using `COPY --from` see no change.

### CI: per-tool platform lists

**release.yml** — Add a `platforms` field to the gemini-cli matrix entry:

```yaml
matrix:
  tool:
    - name: gemini-cli
      dockerfile: dockerfiles/gemini-cli
      platforms: linux/amd64,linux/arm64,linux/s390x
    - name: opencode
      dockerfile: dockerfiles/opencode
    # ... other tools unchanged (no platforms field)
```

Reference with fallback:
```yaml
platforms: ${{ matrix.tool.platforms || 'linux/amd64,linux/arm64' }}
```

**pr.yml** — The matrix is dynamically generated in a shell script. Add a platform lookup for gemini-cli:

```bash
# In the matrix generation loop
if [ "$TOOL" = "gemini-cli" ]; then
  PLATFORMS="linux/amd64,linux/arm64,linux/s390x"
else
  PLATFORMS="linux/amd64,linux/arm64"
fi
MATRIX="${MATRIX}{\"name\":\"${TOOL}\",\"dockerfile\":\"dockerfiles/${TOOL}\",\"platforms\":\"${PLATFORMS}\"}"
```

And reference in the build step:
```yaml
platforms: ${{ matrix.tool.platforms || 'linux/amd64,linux/arm64' }}
```

## Verified External Resources

- `ubi10/nodejs-22-minimal:10.0` — exists, supports amd64, arm64, ppc64le, s390x (verified via skopeo)
- `nodejs.org/dist/v22.16.0/` — has s390x tarball (`node-v22.16.0-linux-s390x.tar.xz`) (verified via curl)
- `ubi10/ubi-minimal:10.0` — already the runtime base in tools-injector (unchanged)

## Files to Modify

| File | Change |
|------|--------|
| `dockerfiles/gemini-cli/Dockerfile` | Rewrite to 3-stage build with ubi10/nodejs-22-minimal + nodejs.org binary |
| `.github/workflows/release.yml` | Add `platforms` to gemini-cli matrix entry, use fallback in build step |
| `.github/workflows/pr.yml` | Add platform lookup in matrix generation, use fallback in build step |

## What Does NOT Change

- All other tool Dockerfiles (unchanged)
- Makefile (local dev tool, amd64+arm64 is fine)
- Bundle layout (`/opt/gemini-cli/bin/node`, `bin/gemini`, `lib/node_modules/`)
- che-ai-tool-images (will consume the s390x image once published — separate follow-up PR)

## Validation Plan

1. **Local build**: `docker buildx build --platform linux/amd64,linux/arm64,linux/s390x dockerfiles/gemini-cli/`
2. **Binary execution per arch**: `docker run --rm --platform linux/s390x <image> /opt/gemini-cli/bin/gemini --version`
3. **Bundle layout check**: `docker run --rm --entrypoint=find <image> /opt/gemini-cli -type f` — same structure as before
4. **Node binary is self-contained**: `docker run --rm --entrypoint=ldd <image> /opt/gemini-cli/bin/node` — should show no `libnode.so` dependency
5. **CI dry-run**: PR build triggers for gemini-cli with all three platforms

## Follow-up (che-ai-tool-images)

After this lands in tools-injector and the `:next` image includes s390x:
1. Restore `linux/s390x` to gemini-cli platform lists in both workflow files
2. Update README to list s390x for gemini-cli
