#!/usr/bin/env python3
# Copyright (c) 2026 Red Hat, Inc.
# This program and the accompanying materials are made
# available under the terms of the Eclipse Public License 2.0
# which is available at https://www.eclipse.org/legal/epl-2.0/
#
# SPDX-License-Identifier: EPL-2.0
#
# Contributors:
#   Red Hat, Inc. - initial API and implementation

"""
Patch packages/opencode/script/build-node.ts to produce a Node.js-compatible
ESM bundle instead of an embedded Bun binary.

Changes applied:
1. Entrypoint: src/node.ts → src/index.ts (the real CLI runner with yargs)
   bun-shim.ts is loaded via inject (runs before the entry, no tree-shaking risk)
2. Externals: keep only native addons that are rebuilt per-arch
3. Insert bunCompatPlugin using onResolve+onLoad for bun/bun:sqlite/bun:ffi/
   @lydell/node-pty stubs
4. Register bunCompatPlugin + inject: [bun-shim] in Bun.build()
"""

import os
import pathlib
import sys

os.chdir("/build")
TARGET = pathlib.Path("packages/opencode/script/build-node.ts")
if not TARGET.exists():
    print(f"ERROR: {TARGET} not found — is the working directory the repo root?", file=sys.stderr)
    sys.exit(1)

src = TARGET.read_text()

# 1. Switch entrypoint from the SDK library (node.ts) to the real CLI runner
#    (index.ts has top-level `await cli.parse()` which starts yargs + TUI).
#    Also add the TUI worker as a second entrypoint — opencode's TUI spawns a
#    Worker at cli/tui/worker.js relative to the bundle; without it, the TUI
#    falls back to the TypeScript source path which doesn't exist at runtime.
BEFORE = '"./src/node.ts"'
AFTER = '"./src/index.ts", "./src/cli/tui/worker.ts"'
if BEFORE not in src:
    print(f"ERROR: entrypoint pattern not found in {TARGET}", file=sys.stderr)
    sys.exit(1)
src = src.replace(BEFORE, AFTER)

# 2. Shrink external list:
#   - jsonc-parser: pure JS, bundle it
#   - @parcel/watcher: bundled (CJS→ESM by bun avoids Node.js 22 extensionless import error)
#   - @lydell/node-pty: stubbed via bunCompatPlugin (no s390x prebuilt binary)
EXTERNAL_PAT = 'external: ["jsonc-parser", "@lydell/node-pty"],'
# jsonc-parser uses UMD format; its ./impl/* sub-modules are not bundleable by bun.
# Keep it external and copy the pure-JS package to the runtime image.
# @opentui/core: exports 20+ named symbols (Renderables, Yoga, MemoryEvents, etc.)
# Stubbing all of them in bunCompatPlugin is error-prone. Keep it external instead;
# it is installed in native-builder and the s390x-throwing file is patched there.
EXTERNAL_REP = 'external: ["jsonc-parser", "@opentui/core", "tree-sitter-bash", "tree-sitter-powershell"],'
if EXTERNAL_PAT not in src:
    print(f"ERROR: external list pattern not found in {TARGET}", file=sys.stderr)
    sys.exit(1)
src = src.replace(EXTERNAL_PAT, EXTERNAL_REP)

# 3. Insert the Bun→Node compat plugin before Bun.build(
PLUGIN = r"""
// Redirect Bun-specific module specifiers to Node.js-compatible shims.
// Uses onResolve+onLoad (Bun.build()-compatible) instead of build.module()
// which is only available at runtime via Bun.plugin().
const bunCompatPlugin: import("bun").BunPlugin = {
  name: "bun-node-compat",
  setup(build) {
    // "bun" → re-export url helpers from node:url
    build.onResolve({ filter: /^bun$/ }, () => ({ path: "bun-compat", namespace: "bun-compat-url" }))
    build.onLoad({ filter: /.*/, namespace: "bun-compat-url" }, () => ({
      contents: `export { pathToFileURL, fileURLToPath } from "node:url"`,
      loader: "ts",
    }))

    // "bun:sqlite" → thin wrapper around node:sqlite DatabaseSync
    build.onResolve({ filter: /^bun:sqlite$/ }, () => ({ path: "bun-sqlite", namespace: "bun-compat-sqlite" }))
    build.onLoad({ filter: /.*/, namespace: "bun-compat-sqlite" }, () => ({
      contents: `import { DatabaseSync } from "node:sqlite"
class Database {
  #db
  constructor(filename, opts = {}) {
    this.#db = new DatabaseSync(filename, { readOnly: opts.readonly ?? false, open: !(opts.create === false) })
  }
  query(sql) {
    const stmt = this.#db.prepare(sql)
    return { all: (...p) => stmt.all(...p), get: (...p) => stmt.get(...p), run: (...p) => { const r = stmt.run(...p); return { changes: r.changes ?? 0, lastInsertRowid: r.lastInsertRowid ?? 0 } } }
  }
  run(sql, ...p) { this.#db.prepare(sql).run(...p) }
  serialize(cb) { if (cb) cb() }
  close() { this.#db.close() }
  loadExtension() {}
}
export { Database }`,
      loader: "js",
    }))

    // "bun:ffi" → stubs (Windows-only code path, never reached on Linux)
    build.onResolve({ filter: /^bun:ffi$/ }, () => ({ path: "bun-ffi", namespace: "bun-compat-ffi" }))
    build.onLoad({ filter: /.*/, namespace: "bun-compat-ffi" }, () => ({
      contents: `const n = (name) => () => { throw new Error("bun:ffi." + name + " unavailable on Node.js") }
export const dlopen = n("dlopen"); export const ptr = n("ptr")
export const toBuffer = n("toBuffer"); export const CString = class {}; export const FFIType = {}`,
      loader: "js",
    }))

    // "@lydell/node-pty" → stub: no prebuilt binary exists for s390x/ppc64le.
    // opencode uses PTY for subprocess execution; the stub lets the server start
    // and throws a clear error only if a PTY is actually spawned at runtime.
    build.onResolve({ filter: /^@lydell\/node-pty$/ }, () => ({ path: "node-pty-stub", namespace: "bun-compat-pty" }))
    build.onLoad({ filter: /.*/, namespace: "bun-compat-pty" }, () => ({
      contents: `export const spawn = () => { throw new Error("@lydell/node-pty is not available on this platform — no prebuilt binary for s390x/ppc64le") }
export default { spawn }`,
      loader: "js",
    }))

    // "@ff-labs/fff-bun" → stub: native file-finder with no s390x/ppc64le binary.
    // Bun's target:"node" build still resolves #fff → fff.bun.ts (bun condition
    // takes precedence), which imports FileFinder from this package. The stub
    // returns isAvailable()=false so opencode falls back to ripgrep automatically.
    build.onResolve({ filter: /^@ff-labs\/fff-bun$/ }, () => ({ path: "fff-bun-stub", namespace: "bun-compat-fff" }))
    build.onLoad({ filter: /.*/, namespace: "bun-compat-fff" }, () => ({
      contents: `class FileFinder {
  static isAvailable() { return false }
  static create() { return { ok: false, error: "@ff-labs/fff-bun has no native binary for s390x/ppc64le" } }
}
export { FileFinder }`,
      loader: "js",
    }))

    // tree-sitter WASM grammar imports: replace 'import ... with { type:"wasm" }'
    // with fs.readFile + WebAssembly.compile. The import-attribute form is valid
    // syntax in Node.js 24 but the 'type:"wasm"' attribute is NOT supported — Node
    // can parse it but then throws "Import attribute type wasm is not supported".
    // The shim reads the .wasm file at runtime using Node's fs module and compiles
    // it directly, which works in all Node.js versions that have WebAssembly.
    // Paths are relative to the bundle file (bundle/index.js → ../node_modules/…).
    // resolveWasm() in the bundle expects a file:// URL string or absolute path,
    // NOT a WebAssembly.Module. Return the file URL so resolveWasm can convert
    // it to a path via fileURLToPath for Language.load().
    build.onResolve({ filter: /tree-sitter-bash.*\.wasm$/ }, () => ({ path: "ts-bash-wasm", namespace: "bun-compat-wasm" }))
    build.onLoad({ filter: /.*/, namespace: "bun-compat-wasm" }, () => ({
      contents: `export default new URL("../node_modules/tree-sitter-bash/tree-sitter-bash.wasm", import.meta.url).href;`,
      loader: "js",
    }))
    build.onResolve({ filter: /tree-sitter-powershell.*\.wasm$/ }, () => ({ path: "ts-ps-wasm", namespace: "bun-compat-wasm-ps" }))
    build.onLoad({ filter: /.*/, namespace: "bun-compat-wasm-ps" }, () => ({
      contents: `export default new URL("../node_modules/tree-sitter-powershell/tree-sitter-powershell.wasm", import.meta.url).href;`,
      loader: "js",
    }))

    // "@opentui/solid/runtime-plugin-support/*" → no-op stubs.
    // @opentui/solid ships Bun-specific runtime plugin APIs that explicitly
    // throw when imported in Node.js ("is Bun-only and is not available in
    // Node.js"). Intercept ALL subpaths under runtime-plugin-support and
    // replace with harmless no-ops so the TUI module loads without crashing.
    build.onResolve({ filter: /^@opentui\/solid\/runtime-plugin-support\// }, () => ({ path: "opentui-solid-runtime-stub", namespace: "bun-compat-opentui-solid" }))
    build.onLoad({ filter: /.*/, namespace: "bun-compat-opentui-solid" }, () => ({
      contents: `export function configure() {}
export function ensureRuntimePluginSupport() {}
export default { configure: () => {}, ensureRuntimePluginSupport: () => {} }`,
      loader: "js",
    }))

  },
}

"""

if "bunCompatPlugin" not in src:
    BUILD_ANCHOR = "await Bun.build({"
    if BUILD_ANCHOR not in src:
        print(f"ERROR: '{BUILD_ANCHOR}' not found in {TARGET} — cannot insert bunCompatPlugin", file=sys.stderr)
        sys.exit(1)
    src = src.replace(BUILD_ANCHOR, PLUGIN + BUILD_ANCHOR)

# 4. Register plugin
OLD_CLOSE = '  files: {\n    "opencode-web-ui.gen.ts": "",\n  },\n})'
# Note: bun-shim.ts is no longer injected via Bun.build({ inject }) because
# inject in the build API is webpack-ProvidePlugin-style (global variable
# substitution), not "run before entry". globalThis.Worker and globalThis.Bun
# are instead set by the Worker polyfill prepended to the output JS file (see
# the Dockerfile RUN step after bun run).
NEW_CLOSE = '  files: {\n    "opencode-web-ui.gen.ts": "",\n  },\n  plugins: [bunCompatPlugin],\n})'
if OLD_CLOSE not in src:
    print(f"ERROR: files{{}} close pattern not found — plugin not injected in {TARGET}", file=sys.stderr)
    sys.exit(1)
src = src.replace(OLD_CLOSE, NEW_CLOSE)

TARGET.write_text(src)
print(f"Patched {TARGET}")
