# che-ai-tool-images

UBI-based injector images that install AI CLI tools into Eclipse Che DevWorkspaces.
The OpenCode amd64/arm64 image uses UBI10; its s390x headless variant uses UBI9.

## Background

The original idea of injecting CLI tools into DevWorkspaces via init containers comes from [akurinnoy/tools-injector](https://github.com/akurinnoy/tools-injector.git). The Dockerfiles in this repository are simplified and modified versions of that approach, adapted to work with the [che-dashboard](https://github.com/eclipse-che/che-dashboard) and support all DevWorkspace samples out of the box.

## Images

| Tool | Pattern | Image | Architectures |
|------|---------|-------|---------------|
| [Claude Code](https://claude.ai/code) | init | `quay.io/che-incubator/dashboard-ai/claude-code:next` | amd64, arm64 |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | bundle | `quay.io/che-incubator/dashboard-ai/gemini-cli:next` | amd64, arm64, s390x, ppc64le |
| [OpenCode](https://opencode.ai) | init | `quay.io/che-incubator/dashboard-ai/opencode:next` | amd64, arm64 |
| [OpenCode (headless)](https://opencode.ai) | bundle | `quay.io/che-incubator/dashboard-ai/opencode:next` | s390x |

### OpenCode s390x release notes and requirements

- s390x supports `run`, `serve`, `models`, `providers`, version and help. Interactive
  OpenTUI and the other upstream top-level commands, including `mcp`, `session`,
  `export`, `import`, `stats` and `db`, are outside this port's scope.
- amd64/arm64 retain the upstream CLI and the `init` injection pattern. s390x uses
  Node.js with a complete `bundle`; the architectures share the same image tags.
- The supplied registry requires Eclipse Che Dashboard **7.122.0 or newer**, with
  architecture filtering from [che-dashboard #1643](https://github.com/eclipse-che/che-dashboard/pull/1643).
  OpenShift Dev Spaces **3.31.0** was used for native s390x validation. Architecture
  detection must succeed; its fallback returns all entries and cannot select the
  correct injection pattern. Older dashboards require an architecture-specific
  registry containing only the applicable OpenCode entry.
- The s390x workspace must provide a UBI9-compatible userspace: glibc **2.34+**,
  compatible `libstdc++.so.6` and `libgcc_s.so.1`, a POSIX shell, and Git for project
  operations. Installing libraries in the injector does not install them in the
  workspace. CI tests a minimal UBI9 workspace with these packages and the public
  Dev Spaces UDI (`quay.io/devspaces/udi-rhel9`). Alpine/musl workspaces are not supported.
- This PR covers IBM Z only. Power/ppc64le is tracked in [PR #9](https://github.com/che-incubator/che-ai-tool-images/pull/9);
  [CRW-11779](https://redhat.atlassian.net/browse/CRW-11779) also covers Power and is
  not closed by the s390x image change.

---

## Usage in a DevWorkspace

### Claude Code

```yaml
components:
  - name: injected-tools
    volume:
      size: 512Mi
  - name: claude-code-injector
    container:
      image: quay.io/che-incubator/dashboard-ai/claude-code:next
      command: ["/bin/cp"]
      args: ["/usr/local/bin/claude", "/injected-tools/claude"]
      memoryLimit: 1024Mi
      mountSources: false
      volumeMounts:
        - name: injected-tools
          path: /injected-tools

commands:
  - id: install-claude-code
    apply:
      component: claude-code-injector

events:
  preStart:
    - install-claude-code
```

The editor container must mount the `injected-tools` volume to access the binary.

### Gemini CLI

```yaml
components:
  - name: injected-tools
    volume:
      size: 512Mi
  - name: gemini-cli-injector
    container:
      image: quay.io/che-incubator/dashboard-ai/gemini-cli:next
      command: ["/bin/sh"]
      args: ["-c", "cp -a /opt/gemini-cli/. /injected-tools/gemini-cli/"]
      memoryLimit: 1024Mi
      mountSources: false
      volumeMounts:
        - name: injected-tools
          path: /injected-tools

commands:
  - id: install-gemini-cli
    apply:
      component: gemini-cli-injector

events:
  preStart:
    - install-gemini-cli
```

The editor container must mount the `injected-tools` volume to access the tool at `/injected-tools/gemini-cli/bin/gemini`.

### OpenCode on amd64/arm64 (`init`)

```yaml
components:
  - name: injected-tools
    volume:
      size: 512Mi
  - name: opencode-injector
    container:
      image: quay.io/che-incubator/dashboard-ai/opencode:next
      command: ["/bin/sh"]
      args: ["-c", "cp /usr/local/bin/opencode /usr/local/bin/opencode-bin /injected-tools/"]
      memoryLimit: 1024Mi
      mountSources: false
      volumeMounts:
        - name: injected-tools
          path: /injected-tools

commands:
  - id: install-opencode
    apply:
      component: opencode-injector

events:
  preStart:
    - install-opencode
```

The editor container must mount `injected-tools` at `/injected-tools`. Run
`/injected-tools/opencode`; keep `opencode-bin` beside the launcher.

### OpenCode on s390x (`bundle`)

Copy the complete directory, including the private runtime and native dependencies:

```yaml
components:
  - name: injected-tools
    volume:
      size: 512Mi
  - name: opencode-injector
    container:
      image: quay.io/che-incubator/dashboard-ai/opencode:next
      command: ["/bin/sh"]
      args: ["-c", "cp -a /opt/opencode/. /injected-tools/opencode/"]
      memoryLimit: 1024Mi
      mountSources: false
      volumeMounts:
        - name: injected-tools
          path: /injected-tools

commands:
  - id: install-opencode
    apply:
      component: opencode-injector

events:
  preStart:
    - install-opencode
```

Mount the same volume in the editor and run `/injected-tools/opencode/bin/opencode`.
For PATH-based access, add `/injected-tools/opencode/bin`. Keep Node in
`/injected-tools/opencode/runtime/node` so injection does not shadow the editor's Node.
Copying only `/usr/local/bin/opencode` leaves the required runtime behind.

---

## Structure

```
dockerfiles/
├── claude-code/Dockerfile
├── gemini-cli/Dockerfile
├── opencode/Dockerfile
├── opencode/Dockerfile.s390x
└── opencode-node/                 # headless adapter, dependency lock and model snapshot
```

---

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `next-build-multiarch.yml` | Push to `main` | Single Quay.io login; builds and pushes all 3 images (gemini-cli also for s390x and ppc64le) |
| `opencode-compatibility.yml` | PR, push, manual | Builds all three OpenCode architectures; tests s390x injection in separate workspace images with networking disabled |

The OpenCode publishing workflows validate all architectures before promoting the
shared tags. The acceptance suite runs in CI, not during `docker build`.

### Updating the s390x build inputs

`Dockerfile.s390x` pins the base image indexes, the OpenCode source commit and the
expected Node archive SHA256. Update the source commit alongside `OPENCODE_VERSION`;
the build checks that the source package version matches the requested release.
The package lock records the Node adapter's dependencies. OS package repositories
remain external build inputs; these pins do not guarantee bit-for-bit identical images.

The models.dev catalog is a compressed snapshot in `dockerfiles/opencode-node/`,
verified in a separate build layer and passed through `MODELS_DEV_API_JSON`. Builds
do not contact the live catalog endpoint. This snapshot was captured on 2026-11-11;
upstream amd64/arm64 release archives may embed a different catalog revision.
Its MIT license is retained in the image as `LICENSE.models.dev`.
To refresh it deliberately, fetch `https://models.dev/api.json`, validate the JSON,
compress it with `gzip -n`, and update `models.dev.sha256` with `sha256sum`.

### Required Secrets

| Secret | Description |
|--------|-------------|
| `QUAY_USERNAME` | Quay.io username |
| `QUAY_PASSWORD` | Quay.io password or robot token |

---

## Patching Eclipse Che with AI Tools

The dashboard reads AI tool definitions from a Kubernetes ConfigMap at runtime. You can add, update, or remove tools by managing this ConfigMap.

### Prerequisites

- `oc` CLI authenticated to your cluster
- Eclipse Che installed (namespace defaults to `eclipse-che`)

### Image tags

| Tag | Built by | Use for |
|---|---|---|
| `next` | Every push to `main` (automatic) | Development clusters |
| `latest` | **Release Build** workflow (manual) | Production clusters |
| `{version}-{YYYYMMDD}-{sha7}` | Both workflows | Pinned, immutable reference |

`registry.json` ships with `:next` tags so it works immediately after any push to `main`.
To point production clusters at `:latest`, run the **Release Build - Multiarch** workflow once,
then update `injectorImage` entries in your ConfigMap to use `:latest`.

### Adding tools from registry.json

Create a ConfigMap from the `registry.json` file in this repository:

```bash
# Set your Che namespace
NS="${CHE_NAMESPACE:-eclipse-che}"

# Create (or replace) the AI tool registry ConfigMap
oc create configmap ai-tool-registry \
  --from-file=registry.json=registry.json \
  -n "$NS" \
  --dry-run=client -o yaml | \
  oc label --local -f - \
    app.kubernetes.io/component=ai-tool-registry \
    app.kubernetes.io/part-of=che.eclipse.org \
    -o yaml | \
  oc apply -f -
```

The dashboard backend picks up the ConfigMap automatically — no restart needed; the registry is read on each request.

### Customizing the registry

Edit `registry.json` before applying. For example, to offer only Claude Code:

```json
{
  "providers": [
    {
      "id": "anthropic/claude",
      "name": "Claude",
      "publisher": "Anthropic"
    }
  ],
  "tools": [
    {
      "providerId": "anthropic/claude",
      "tag": "next",
      "name": "Claude Code",
      "url": "https://claude.ai/code",
      "binary": "claude",
      "pattern": "init",
      "injectorImage": "quay.io/che-incubator/dashboard-ai/claude-code:next",
      "envVarName": "ANTHROPIC_API_KEY"
    }
  ],
  "defaultAiProviders": ["anthropic/claude"]
}
```

### Removing all tools

Delete the ConfigMap to hide all AI widgets from the dashboard:

```bash
oc delete configmap ai-tool-registry -n "${CHE_NAMESPACE:-eclipse-che}"
```

When no ConfigMap is found, the dashboard returns an empty registry and all AI-related UI elements (AI Provider Selector on Create Workspace page, AI Provider(s) column in the Workspaces list, and AI Providers Keys tab in User Preferences) are hidden automatically.

### Verifying

Check the current registry served by the dashboard by querying the pod directly (bypasses OAuth):

```bash
NS="${CHE_NAMESPACE:-eclipse-che}"
POD=$(oc get pods -n "$NS" -l app.kubernetes.io/component=che-dashboard -o jsonpath='{.items[0].metadata.name}')
oc exec -n "$NS" "$POD" -- wget -qO- http://localhost:8080/dashboard/api/ai-registry | jq .
```

---

## License

EPL-2.0 — see [LICENSE](LICENSE).
