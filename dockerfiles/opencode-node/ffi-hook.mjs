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
 * ESM loader hook that intercepts `import("node:ffi")` and redirects it to
 * bun-ffi-shim.cjs (our ffi-napi based implementation).
 *
 * Node.js does not ship a `node:ffi` built-in module. @opentui/core may
 * attempt to import it as a fallback. This hook ensures the import resolves
 * to our shim instead of throwing ERR_UNKNOWN_BUILTIN_MODULE.
 *
 * Registered via Module.register() in bun-shim.ts before the main bundle runs.
 */

const FFI_SHIM_URL = new URL('./bun-ffi-shim.cjs', import.meta.url).href;

/**
 * @param {string} specifier
 * @param {object} context
 * @param {Function} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'bun:ffi' || specifier === 'node:ffi') {
    return { url: FFI_SHIM_URL, format: 'commonjs', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

/**
 * @param {string} url
 * @param {object} context
 * @param {Function} nextLoad
 */
export async function load(url, context, nextLoad) {
  if (url === FFI_SHIM_URL) {
    return nextLoad(url, { ...context, format: 'commonjs' });
  }
  return nextLoad(url, context);
}
