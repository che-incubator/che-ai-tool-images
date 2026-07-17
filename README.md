# che-ai-tool-images

UBI-based init container images that inject AI CLI tools into Eclipse Che DevWorkspaces.

## Background

The init-container approach for injecting CLI tools into DevWorkspaces originates from [tools-injector](https://github.com/che-incubator/tools-injector.git).
The Dockerfiles in this repository are derived from that work, with modifications to integrate with [che-dashboard](https://github.com/eclipse-che/che-dashboard.git) and support all DevWorkspace samples.

## Images

| Tool | Pattern | Image | Architectures |
|------|---------|-------|---------------|
| [Claude Code](https://claude.ai/code) | init | `quay.io/che-incubator/dashboard-ai/claude-code:next` | amd64, arm64 |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | bundle | `quay.io/che-incubator/dashboard-ai/gemini-cli:next` | amd64, arm64, s390x, ppc64le |
| [Goose](https://github.com/block/goose) | init | `quay.io/che-incubator/dashboard-ai/goose:next` | amd64, arm64 |
| [Kilo Code](https://github.com/AiCodeBot/kilocode) | bundle | `quay.io/che-incubator/dashboard-ai/kilocode:next` | amd64, arm64 |
| [OpenCode](https://opencode.ai) | init | `quay.io/che-incubator/dashboard-ai/opencode:next` | amd64, arm64 |

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

### Goose

```yaml
components:
  - name: injected-tools
    volume:
      size: 512Mi
  - name: goose-injector
    container:
      image: quay.io/che-incubator/dashboard-ai/goose:next
      command: ["/bin/cp"]
      args: ["/usr/local/bin/goose", "/injected-tools/goose"]
      memoryLimit: 128Mi
      mountSources: false
      volumeMounts:
        - name: injected-tools
          path: /injected-tools

commands:
  - id: install-goose
    apply:
      component: goose-injector

events:
  preStart:
    - install-goose
```

The editor container must mount the `injected-tools` volume to access the binary.

### Kilo Code

```yaml
components:
  - name: injected-tools
    volume:
      size: 512Mi
  - name: kilocode-injector
    container:
      image: quay.io/che-incubator/dashboard-ai/kilocode:next
      command: ["/bin/sh"]
      args: ["-c", "cp -a /opt/kilocode/. /injected-tools/kilocode/"]
      memoryLimit: 256Mi
      mountSources: false
      volumeMounts:
        - name: injected-tools
          path: /injected-tools

commands:
  - id: install-kilocode
    apply:
      component: kilocode-injector

events:
  preStart:
    - install-kilocode
```

The editor container must mount the `injected-tools` volume to access the tool at `/injected-tools/kilocode/bin/kilo`.

### OpenCode

```yaml
components:
  - name: injected-tools
    volume:
      size: 512Mi
  - name: opencode-injector
    container:
      image: quay.io/che-incubator/dashboard-ai/opencode:next
      command: ["/bin/cp"]
      args: ["/usr/local/bin/opencode", "/injected-tools/opencode"]
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

The editor container must mount the `injected-tools` volume to access the binary.

---

## Structure

```
dockerfiles/
├── claude-code/Dockerfile
├── gemini-cli/Dockerfile
├── goose/Dockerfile
├── kilocode/Dockerfile
└── opencode/Dockerfile
```

---

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| `next-build-multiarch.yml` | Push to `main` | Builds and pushes all 5 images with `:next` tag (gemini-cli also for s390x and ppc64le) |
| `release-build-multiarch.yml` | Manual dispatch | Builds and pushes all 5 images with `:latest` and immutable version tags |

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
