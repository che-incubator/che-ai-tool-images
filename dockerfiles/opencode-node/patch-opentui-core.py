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
Replace @opentui/core *.node.js files with ESM no-op stubs.

The package has "type":"module" — all .js files are loaded as ESM.
Static imports like `import { FrameBufferRenderable } from "@opentui/core"`
require the module to export every named symbol. There are 400+ such symbols.

This script dynamically extracts ALL value-export names from the package's
.d.ts declaration files and generates a single ESM stub that exports each one
as an appropriate no-op. Running at image build time ensures the stub stays
in sync with whatever version of @opentui/core is installed.

When libopentui.so is present for the current architecture, index.node.js is
NOT stubbed — the real @opentui code loads the native library via the FFI shim.
Only runtime-plugin-support files (Bun-only) are still stubbed in that case.
"""

import os
import pathlib
import platform
import re
import sys

os.chdir("/native")
TARGET_DIR = pathlib.Path("node_modules/@opentui/core")
if not TARGET_DIR.exists():
    print(f"WARNING: {TARGET_DIR} not found — skipping", file=sys.stderr)
    sys.exit(0)

# Extract all value-export names from .d.ts files.
# Types/interfaces are erased at runtime and don't need stubs.
# "export * from ..." re-exports are followed by reading the child files,
# but we just grep everything for simplicity.
VALUE_EXPORT_PAT = re.compile(
    # Group 1: export kind (class/function/const/enum/var)
    # Group 2: exported name
    r"^export\s+(?:(?:declare|abstract|override)\s+)*"
    r"(class|function|const|enum|var)\s+"
    r"([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)
# Handles: export * as Yoga from "./yoga.js"  (namespace re-export)
NAMESPACE_PAT = re.compile(
    r"^export\s+\*\s+as\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.MULTILINE,
)

# Track whether each name was ever seen as a class (to choose the right stub).
# A name seen as 'class' always gets a class stub; any other kind gets a
# callable stub so that plain calls (fn()) don't throw TypeError.
all_names: set[str] = set()
class_names: set[str] = set()
for f in sorted(TARGET_DIR.rglob("*.d.ts")):
    try:
        text = f.read_text()
        for m in VALUE_EXPORT_PAT.finditer(text):
            kind, name = m.group(1), m.group(2)
            all_names.add(name)
            if kind == "class":
                class_names.add(name)
        for m in NAMESPACE_PAT.finditer(text):
            all_names.add(m.group(1))
    except OSError:
        pass

print(f"Found {len(all_names)} exported value names from @opentui/core *.d.ts files")

if not all_names:
    # .d.ts files may be absent on s390x (cpu restriction → npm skips them).
    # Fall back to the known exports extracted by grepping the installed
    # runtime from the cluster. This list covers all imports used by both
    # opencode bundle and @opentui/solid (kilocode's TUI adapter).
    all_names = {
        "ASCIIFontRenderable",
        "ArrowRenderable",
        "Audio",
        "BaseRenderable",
        "BloomEffect",
        "BoxRenderable",
        "CRTRollingBarEffect",
        "Capture",
        "CapturedFrame",
        "CliRenderer",
        "CloudsEffect",
        "CodeRenderable",
        "DiffRenderable",
        "DistortionEffect",
        "EditBuffer",
        "EditorView",
        "FlamesEffect",
        "FrameBufferRenderable",
        "InputRenderable",
        "JSAnimation",
        "KeyEvent",
        "LineNumberRenderable",
        "MacOSScrollAccel",
        "MarkdownRenderable",
        "MockInput",
        "MockMouse",
        "MouseButton",
        "NativeSpanFeed",
        "OptimizedBuffer",
        "RGBA",
        "RainbowTextEffect",
        "Renderable",
        "RootRenderable",
        "RootTextNodeRenderable",
        "ScrollBarRenderable",
        "ScrollBoxRenderable",
        "SelectRenderable",
        "SliderRenderable",
        "SlotRenderable",
        "StyledText",
        "SyntaxStyle",
        "TabSelectRenderable",
        "TestRecorder",
        "TestRenderer",
        "TextBuffer",
        "TextBufferView",
        "TextNodeRenderable",
        "TextRenderable",
        "TextTableRenderable",
        "TextareaRenderable",
        "Timeline",
        "TimeToFirstDrawRenderable",
        "VignetteEffect",
        # Namespace re-exports (export * as NAME from ...)
        "Yoga",
        "core",
        "opentui",
        # Events and option objects
        "CliRenderEvents",
        "InputRenderableEvents",
        "RenderableEvents",
        "SelectRenderableEvents",
        "TabSelectRenderableEvents",
        "TextAttributes",
        # Functions
        "addDefaultParsers",
        "createCliRenderer",
        "createSlotRegistry",
        "createTextAttributes",
        "fg",
        "init",
        "isTextNodeRenderable",
        "parseColor",
        "render",
        "cleanup",
        "createRenderer",
        "resolveRenderLib",
    }
    print(f"  Using hardcoded fallback with {len(all_names)} names")

# Some names need specific stub shapes (not just 'class {}').
# Everything else is stubbed as an empty class (works for classes AND
# can be called as a constructor-like no-op for functions/consts too).
SPECIAL_STUBS: dict[str, str] = {
    "MemoryEvents": "{ setSink: _noop, getSink: () => null, subscribe: () => _noop }",
    # RGBA: native class with static factory methods.
    # embind-exported native methods not declared in .d.ts files.
    "RGBA": """((() => {
  class _RGBA {
    constructor(r=0,g=0,b=0,a=255){this.r=r;this.g=g;this.b=b;this.a=a;}
    static fromInts(r=0,g=0,b=0,a=255){return new _RGBA(r,g,b,a);}
    static fromValues(r=0,g=0,b=0,a=255){return new _RGBA(r,g,b,a);}
    static fromIndex(idx=0){return new _RGBA(0,0,0,255);}
    static fromFloat(r=0,g=0,b=0,a=1){return new _RGBA(Math.round(r*255),Math.round(g*255),Math.round(b*255),Math.round(a*255));}
    static fromHex(h=''){return new _RGBA(0,0,0,255);}
    static fromCSS(s=''){return new _RGBA(0,0,0,255);}
    static lerp(a,b,t){return new _RGBA(a.r+(b.r-a.r)*t,a.g+(b.g-a.g)*t,a.b+(b.b-a.b)*t,a.a+(b.a-a.a)*t);}
    static defaultForeground(){return new _RGBA(255,255,255,255);}
    static defaultBackground(){return new _RGBA(0,0,0,255);}
    static transparent(){return new _RGBA(0,0,0,0);}
    static black(){return new _RGBA(0,0,0,255);}
    static white(){return new _RGBA(255,255,255,255);}
    clone(){return new _RGBA(this.r,this.g,this.b,this.a);}
    static clone(o){return o instanceof _RGBA ? new _RGBA(o.r,o.g,o.b,o.a) : new _RGBA(0,0,0,255);}
    equals(o){return o&&this.r===o.r&&this.g===o.g&&this.b===o.b&&this.a===o.a;}
    toString(){return `rgba(${this.r},${this.g},${this.b},${this.a})`;}
  }
  return _RGBA;
})())""",
    "Yoga": "_proxy",
    "core": "_proxy",
    "engine": "_proxy",
    "opentui": "_proxy",
    "addDefaultParsers": "_noop",
    "createCliRenderer": "() => _proxy",
    "createSlotRegistry": "() => ({})",
    "createTextAttributes": "() => ({})",
    "fg": "_noop",
    "isTextNodeRenderable": "() => false",
    "init": "_noop",
    "render": "_noop",
    "cleanup": "_noop",
    "createRenderer": "() => ({ render: _noop, cleanup: _noop })",
    "parseColor": "() => null",
    "resolveRenderLib": "_noop",
    "TextAttributes": "{}",
}

# Build the ESM stub
lines = [
    "/* @opentui/core stub — no native binary for s390x/ppc64le. Type: module (ESM). */",
    "/* Auto-generated by patch-opentui-core.py from installed *.d.ts files.      */",
    "const _noop = () => undefined;",
    "const _proxy = new Proxy({}, { get: () => _noop, apply: () => undefined, construct: () => ({}) });",
    "",
]

# Generate stubs for all discovered names that aren't in SPECIAL_STUBS.
# - Names seen with 'class' keyword → empty class (safe for both `new X()` and
#   static-member access; breaks on plain calls, but classes are not called that way).
# - Names seen only with 'function'/'const'/'var'/'enum' → callable stub,
#   because `export class X {}` throws TypeError on a plain `X()` call.
for name in sorted(all_names - set(SPECIAL_STUBS.keys())):
    if name in class_names:
        lines.append(f"export class {name} {{}}")
    else:
        lines.append(f"export const {name} = _noop;")

lines.append("")

# Always include special stubs — these may be interfaces/namespaces in .d.ts
# (not matched by VALUE_EXPORT_PAT) but are still required at runtime.
for name, stub_val in sorted(SPECIAL_STUBS.items()):
    lines.append(f"export const {name} = {stub_val};")

lines += [
    "",
    "export default {};",
]

MAIN_STUB = "\n".join(lines) + "\n"

# Minimal ESM stub for non-main *.node.js files (runtime-plugin etc.)
SUPPORT_STUB = """\
/* @opentui/core stub — no native binary for s390x/ppc64le. Type: module (ESM). */
export const configure = () => undefined;
export const ensureRuntimePluginSupport = () => undefined;
export const install = () => undefined;
export const uninstall = () => undefined;
export default {};
"""

# Determine current architecture (matches node-assets.js naming: x64, arm64, s390x, ppc64le).
_MACHINE_MAP = {"x86_64": "x64", "aarch64": "arm64", "s390x": "s390x", "ppc64le": "ppc64le"}
_CURRENT_ARCH = _MACHINE_MAP.get(platform.machine(), platform.machine())

# Check whether a pre-built libopentui.so exists for this architecture.
# If it does, we can use the real native TUI — only stub runtime-plugin files,
# not index.node.js (which would kill the TUI entry point).
_NATIVE_LIB = pathlib.Path(f"node_modules/@opentui/core-linux-{_CURRENT_ARCH}/libopentui.so")
_HAVE_NATIVE_LIB = _NATIVE_LIB.exists() and _NATIVE_LIB.stat().st_size > 1000

if _HAVE_NATIVE_LIB:
    print(f"Native library found: {_NATIVE_LIB} ({_NATIVE_LIB.stat().st_size} bytes) — skipping stub of index.node.js")
else:
    print(f"No native library for arch={_CURRENT_ARCH} — stubbing all *.node.js files")

# Patch the arch allow-list in ALL files that contain the check.
# @opentui/core has the same guard in three places:
#   node-assets.js        (the canonical source)
#   chunk-node-*.js       (bundled copy used by the Node.js entry point)
#   chunk-bun-*.js        (bundled copy used by the Bun entry point)
# We must patch every occurrence — only patching node-assets.js is insufficient
# because the chunk files have their own inlined copies of the same function.
_OLD_ARCH_CHECK = 'target.arch !== "arm64" && target.arch !== "x64"'
_NEW_ARCH_CHECK = (
    'target.arch !== "arm64" && target.arch !== "x64" '
    '&& target.arch !== "s390x" && target.arch !== "ppc64le"'
)
for _js_file in sorted(TARGET_DIR.glob("*.js")):
    try:
        _txt = _js_file.read_text()
    except Exception:
        continue
    if _OLD_ARCH_CHECK in _txt:
        _js_file.write_text(_txt.replace(_OLD_ARCH_CHECK, _NEW_ARCH_CHECK))
        print(f"  Patched arch check in {_js_file.name}")

patched = 0
for f in sorted(TARGET_DIR.glob("*.node.js")):
    if _HAVE_NATIVE_LIB and f.name == "index.node.js":
        # Skip — native library handles this file's role; stubbing would break the TUI.
        print(f"  Skipped (native lib present): {f.name}")
        continue
    stub = MAIN_STUB if f.name == "index.node.js" else SUPPORT_STUB
    f.write_text(stub)
    print(f"  Stubbed: {f.name}")
    patched += 1

print(f"Patched {patched} @opentui/core *.node.js file(s)")
