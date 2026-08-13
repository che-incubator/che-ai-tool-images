/*
 * Copyright (c) 2026 Red Hat, Inc.
 * This program and the accompanying materials are made
 * available under the terms of the Eclipse Public License 2.0
 * which is available at https://www.eclipse.org/legal/epl-2.0/
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */

/**
 * Node.js runtime shim for Bun global APIs.
 * Compiled to a standalone ESM preamble and prepended to every output JS file
 * so globalThis.Bun and globalThis.Worker are set before any module code runs.
 *
 * IMPORTANT: ALL imports MUST use unique __bsh_-prefixed aliases.
 * When this preamble is prepended to the main bundle (both are ESM files),
 * Node.js sees a single merged file. Any import binding name that appears in
 * both the preamble AND the main bundle is a SyntaxError ("already declared").
 * The __bsh_ prefix guarantees no collision with the bundle's own imports.
 */
import { readFile as __bshReadFile, writeFile as __bshWriteFile } from 'node:fs/promises'
import { existsSync as __bshExistsSync } from 'node:fs'
import { createHash as __bshCreateHash } from 'node:crypto'
import { Worker as __bshWorker } from 'node:worker_threads'
import { createRequire as __bshCreateRequire } from 'node:module'
import { fileURLToPath as __bshFileURLToPath } from 'node:url'

// Intercept require("bun:ffi") / import("node:ffi") from @opentui/core and
// redirect to our ffi-napi based shim. Both bun-shim.mjs and bun-ffi-shim.cjs
// are copied into the same bundle directory (/opt/opencode/bundle/).
const __bshReq = __bshCreateRequire(import.meta.url)
const __bshShimDir = __bshFileURLToPath(new URL('.', import.meta.url))
const __bshFfiShimPath = __bshShimDir + 'bun-ffi-shim.cjs'
const __bshFfiHookPath = __bshShimDir + 'ffi-hook.mjs'

if (__bshExistsSync(__bshFfiShimPath)) {
  // Set process.versions.bun so @opentui uses the bun:ffi code path.
  // Critical: Node.js 24 throws ERR_UNKNOWN_BUILTIN_MODULE for require("node:ffi")
  // BEFORE Module._resolveFilename is called — our cache patch never runs.
  // With isBun=true, @opentui's loadBackend() calls require("bun:ffi") instead,
  // which goes through normal CJS module resolution (bun: is not a node: built-in)
  // and DOES hit our _resolveFilename patch and Module._cache entry.
  if (!(process.versions as Record<string, string>).bun) {
    ;(process.versions as Record<string, string>).bun = '1.2.0'
  }

  const __bshModule = __bshReq('node:module') as {
    register: (hookPath: string, baseUrl?: string | URL) => void
    _resolveFilename: (...args: unknown[]) => string
    _cache: Record<string, { id: string; filename: string; exports: unknown; loaded: boolean }>
  }
  // Register ESM loader hook so async import("bun:ffi") also resolves to the shim
  if (__bshExistsSync(__bshFfiHookPath) && typeof __bshModule.register === 'function') {
    __bshModule.register(__bshFfiHookPath, import.meta.url)
  }
  // Patch _resolveFilename for the synchronous require("bun:ffi") path.
  // bun:ffi is not a node: built-in so Node.js does call _resolveFilename for it.
  const __bshOrigResolve = __bshModule._resolveFilename.bind(__bshModule)
  __bshModule._resolveFilename = (req: string, ...rest: unknown[]): string => {
    if (req === 'bun:ffi') return 'bun:ffi'
    return __bshOrigResolve(req, ...rest)
  }
  const __bshFfiExports = __bshReq(__bshFfiShimPath)
  __bshModule._cache['bun:ffi'] = {
    id: 'bun:ffi',
    filename: __bshFfiShimPath,
    exports: __bshFfiExports,
    loaded: true,
  }
}

// Minimal Unicode-aware string width (no npm imports — avoids bundled functions
// that would conflict with the main bundle's top-level declarations).
const __bshStringWidth = (str: string): number =>
  [...str].reduce((w, ch) => {
    const cp = ch.codePointAt(0) ?? 0
    return (
      w +
      (cp >= 0x1100 &&
      (cp <= 0x115f ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe19) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1f64f) ||
        (cp >= 0x1f900 && cp <= 0x1f9ff) ||
        (cp >= 0x20000 && cp <= 0x2fffd) ||
        (cp >= 0x30000 && cp <= 0x3fffd))
        ? 2
        : 1)
    )
  }, 0)

declare global {
  // eslint-disable-next-line no-var
  var Bun:
    | {
        stringWidth(str: string): number
        file(path: string): { text(): Promise<string>; json<T = unknown>(): Promise<T> }
        write(path: string, data: string | Uint8Array): Promise<number>
        hash(input: string | Uint8Array): { toString(radix?: number): string; valueOf(): bigint }
        stdin: { text(): Promise<string> }
        env: NodeJS.ProcessEnv
        argv: string[]
        $: undefined
        version: string
      }
    | undefined
}

if (typeof globalThis.Bun === 'undefined') {
  globalThis.Bun = {
    stringWidth: __bshStringWidth,
    file: (p: string) => ({
      text: () => __bshReadFile(p, 'utf-8'),
      json: async <T = unknown>() => JSON.parse(await __bshReadFile(p, 'utf-8')) as T,
      delete: () => import('node:fs/promises').then(({ unlink }) => unlink(p)),
      exists: () =>
        import('node:fs/promises')
          .then(({ access }) => access(p))
          .then(() => true)
          .catch(() => false),
    }),
    write: async (p: string, data: string | Uint8Array) => {
      await __bshWriteFile(p, data as string)
      return typeof data === 'string' ? Buffer.byteLength(data, 'utf-8') : data.byteLength
    },
    hash: (input: string | Uint8Array) => {
      const hex = __bshCreateHash('sha256')
        .update(typeof input === 'string' ? input : Buffer.from(input))
        .digest('hex')
        .slice(0, 16)
      const value = BigInt('0x' + hex)
      return { toString: (radix = 16) => value.toString(radix), valueOf: () => value }
    },
    stdin: {
      text: () =>
        new Promise<string>((resolve, reject) => {
          const chunks: Buffer[] = []
          process.stdin.on('data', (d: Buffer) => chunks.push(d))
          process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
          process.stdin.on('error', reject)
        }),
    },
    env: process.env,
    argv: process.argv,
    $: undefined,
    version: 'node-compat',
  }
}

// Worker is a global in Bun/browsers but not Node.js.
// Wrap NodeWorker to inject --import bun-shim.mjs into every worker thread
// so onmessage/postMessage polyfills are available inside workers too.
if (typeof globalThis.Worker === 'undefined') {
  const __bshShimUrl = import.meta.url
  class __BshWorker extends __bshWorker {
    constructor(filename: string | URL, options?: ConstructorParameters<typeof __bshWorker>[1]) {
      const prev: string[] = (options as { execArgv?: string[] })?.execArgv ?? []
      super(filename, { ...(options ?? {}), execArgv: ['--import', __bshShimUrl, ...prev] })
    }
  }
  globalThis.Worker = __BshWorker as unknown as typeof globalThis.Worker
}

// onmessage / postMessage polyfill — only activates inside a worker thread
// (parentPort is non-null there). Bun workers expose these as globals but
// Node.js worker_threads do not.
const { parentPort: __bshParentPort } = await import('node:worker_threads')
if (__bshParentPort) {
  let __bshHandler: ((ev: { data: unknown }) => void) | null = null
  Object.defineProperty(globalThis, 'onmessage', {
    get: () => __bshHandler,
    set: (fn: ((ev: { data: unknown }) => void) | null) => {
      if (__bshHandler) __bshParentPort!.off('message', __bshHandler as never)
      __bshHandler = fn
      if (fn) __bshParentPort!.on('message', (data: unknown) => fn({ data }))
    },
    configurable: true,
  })
  ;(globalThis as Record<string, unknown>).postMessage = (data: unknown) =>
    __bshParentPort!.postMessage(data)
  ;(globalThis as Record<string, unknown>).self = globalThis
}
