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
 * CJS shim for the `bun:ffi` module, implemented on top of ffi-napi.
 *
 * @opentui/core calls `require("bun:ffi")` (via createRequire) when it
 * detects `process.versions.bun`. Our bun-shim.ts sets that version flag and
 * monkey-patches Module._resolveFilename so `require("bun:ffi")` resolves to
 * this file instead of throwing MODULE_NOT_FOUND.
 *
 * API surface required by @opentui/core (chunk-node-*.js):
 *   dlopen(path, symbolSpec)  → { symbols: { [name]: Function } }
 *   FFIType                   → enum-like object of type name strings
 *   suffix                    → platform shared-library suffix ("so"/"dylib"/"dll")
 *   ptr(buffer)               → pointer value (Buffer itself for ffi-napi)
 *   toBuffer(ptr, byteLength) → Buffer
 *   CString                   → class with value property (reads null-terminated C string)
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');

// --- Type mapping: bun:ffi type names → ffi-napi ref-napi type strings -------

/**
 * Map from bun FFIType string (as used in dlopen symbol specs) to the
 * ref-napi / ffi-napi type string.
 *
 * @type {Record<string, string>}
 */
// s390x libffi big-endian return value bug: libffi reads the wrong bytes of the
// 64-bit return register r2 for types narrower than 64 bits. Only RETURN types
// need the uint64 workaround; ARGUMENT types work correctly with their native sizes.
// So we have two separate maps: one for return types, one for argument types.

// For RETURN types: all small integer/bool types → uint64 (reads full register)
const BUN_RETTYPE_TO_REF = {
  void: 'void',
  bool: 'uint64',   // bool = 1 byte, misread without uint64
  char: 'uint64',
  int8_t: 'uint64', int16_t: 'uint64', int32_t: 'uint64', int64_t: 'int64',
  uint8_t: 'uint64', uint16_t: 'uint64', uint32_t: 'uint64', uint64_t: 'uint64',
  float: 'float', double: 'double',
  u8: 'uint64', u16: 'uint64', u32: 'uint64', u64: 'uint64',
  i8: 'uint64', i16: 'uint64', i32: 'uint64', i64: 'int64',
  f32: 'float', f64: 'double',
  ptr: 'pointer', pointer: 'pointer', cstring: 'pointer', CString: 'pointer',
  function: 'pointer',
};

// For ARGUMENT types: use native sizes so JS values pass correctly to the callee.
// Do NOT widen u32 here — on s390x a 32-bit parameter is passed in the low half
// of the 64-bit slot, so widening to uint64 causes the callee to read the HIGH
// half and receive a wrong value. The uint64 widening applies only to return
// values (BUN_RETTYPE_TO_REF), where libffi reads the wrong bytes of r2.
const BUN_TYPE_TO_REF = {
  void: 'void',
  bool: 'bool',   // JS true/false must stay as 'bool' for argument passing
  char: 'char',
  int8_t: 'int8', int16_t: 'int16', int32_t: 'int32', int64_t: 'int64',
  uint8_t: 'uint8', uint16_t: 'uint16', uint32_t: 'uint32', uint64_t: 'uint64',
  float: 'float', double: 'double',
  u8: 'uint8', u16: 'uint16', u32: 'uint32', u64: 'uint64',
  i8: 'int8', i16: 'int16', i32: 'int32', i64: 'int64',
  f32: 'float', f64: 'double',
  ptr: 'pointer', pointer: 'pointer', cstring: 'pointer', CString: 'pointer',
  function: 'pointer',
};

/**
 * FFIType enum — mirrors the bun:ffi FFIType values that @opentui/core reads.
 * Values are the bun-style string names; we translate them in dlopen().
 */
const FFIType = {
  void: 'void',
  bool: 'bool',
  char: 'char',
  int8_t: 'int8_t',
  int16_t: 'int16_t',
  int32_t: 'int32_t',
  int64_t: 'int64_t',
  uint8_t: 'uint8_t',
  uint16_t: 'uint16_t',
  uint32_t: 'uint32_t',
  uint64_t: 'uint64_t',
  float: 'float',
  double: 'double',
  u8: 'u8',
  u16: 'u16',
  u32: 'u32',
  u64: 'u64',
  i8: 'i8',
  i16: 'i16',
  i32: 'i32',
  i64: 'i64',
  f32: 'f32',
  f64: 'f64',
  ptr: 'ptr',
  pointer: 'pointer',
  cstring: 'cstring',
  CString: 'CString',
  function: 'function',
};

/** Platform shared-library suffix (matches bun:ffi `suffix` export). */
const suffix = os.platform() === 'darwin' ? 'dylib' : os.platform() === 'win32' ? 'dll' : 'so';

// --- CString helper -----------------------------------------------------------

/**
 * Reads a null-terminated UTF-8 string from a raw Buffer/pointer value.
 * ffi-napi returns pointers as plain Buffers (ref-napi's concept of a pointer).
 *
 * @param {Buffer | null} ptrVal
 * @returns {string}
 */
function readCString(ptrVal) {
  if (!ptrVal || ptrVal.isNull()) return '';
  // ffi-napi returns pointer results as 0-length Buffers backed by native memory.
  // Index access on a 0-length Buffer does not reach the target memory.
  // Use ref-napi's readCString to traverse the pointer correctly.
  const ref = require('ref-napi');
  return ref.readCString(ptrVal, 0);
}

/**
 * CString class — wraps a raw pointer returned by ffi-napi and exposes a
 * `.value` property that reads the null-terminated C string.
 */
class CString {
  /**
   * @param {Buffer | null} ptr
   */
  constructor(ptr) {
    this._ptr = ptr;
    Object.defineProperty(this, 'value', {
      get: () => readCString(this._ptr),
      enumerable: true,
    });
  }

  toString() {
    return this.value;
  }
}

// --- ptr / toBuffer helpers --------------------------------------------------

/**
 * Convert a value to a Buffer for use as a 'pointer' argument in ffi-napi.
 * ffi-napi's writePointer requires a Buffer instance — TypedArrays, ArrayBuffers,
 * and other non-Buffer types must be converted first.
 *
 * @param {Buffer|ArrayBuffer|ArrayBufferView|null|undefined} value
 * @returns {Buffer|null|undefined}
 */
function ptr(value) {
  if (value == null) return value;  // null/undefined → null pointer (ffi-napi accepts)
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  // TypedArray (Float32Array, Uint8Array, etc.) — share the underlying ArrayBuffer
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  // bun-ffi-structs allocStruct() returns { buffer: ArrayBuffer, view: DataView, ... }
  // Use the .buffer property when it's an ArrayBuffer (plain POJO struct wrappers)
  if (value !== null && typeof value === 'object' && value.buffer instanceof ArrayBuffer) {
    return Buffer.from(value.buffer);
  }
  return value;  // fall-through: let ffi-napi reject unknown types with a clear error
}

/**
 * Wrap a raw pointer (returned by ffi-napi as a Buffer) into a Buffer of the
 * given byte length, so callers can read memory.
 *
 * @param {Buffer | null} ptrVal
 * @param {number} byteLength
 * @returns {Buffer}
 */
function toBuffer(ptrVal, byteLength) {
  if (!ptrVal || (Buffer.isBuffer(ptrVal) && ptrVal.length === 0)) return Buffer.alloc(0);
  // ffi-napi returns pointer results as 0-length Buffers — slice() does not
  // reach the target memory. Use ref-napi's reinterpret to create a view of
  // the correct size over the native memory region.
  const ref = require('ref-napi');
  return ref.reinterpret(ptrVal, byteLength, 0);
}

// --- dlopen ------------------------------------------------------------------

/**
 * Translate a single bun:ffi type string (or FFIType value) to a ref-napi type.
 *
 * @param {string} t
 * @returns {string}
 */
function translateType(t) {
  return BUN_TYPE_TO_REF[t] || 'pointer';
}

function translateRetType(t) {
  // Return types use uint64 for small types to work around s390x libffi bug.
  return BUN_RETTYPE_TO_REF[t] || 'pointer';
}

/**
 * bun:ffi dlopen — loads a shared library and binds its symbols.
 *
 * symbolSpec mirrors the bun:ffi API:
 *   { funcName: { args: string[], returns: string }, ... }
 *
 * Returns:
 *   { symbols: { funcName: Function, ... } }
 *
 * @param {string} libPath
 * @param {Record<string, { args: string[], returns: string }>} symbolSpec
 * @returns {{ symbols: Record<string, Function> }}
 */
function dlopen(libPath, symbolSpec) {
  // Only attempt FFI loading if the library actually exists
  if (!fs.existsSync(libPath)) {
    throw new Error(`bun-ffi-shim: library not found: ${libPath}`);
  }

  // Lazy-require ffi-napi so we don't hard-fail if it is missing on platforms
  // where we don't need it (amd64/arm64 use the real bun binary).
  /** @type {import('ffi-napi')} */
  const ffi = require('ffi-napi');

  // Build the ffi-napi function map: { funcName: [retType, [argTypes]] }
  /** @type {Record<string, [string, string[]]>} */
  const ffiMap = {};
  for (const [name, spec] of Object.entries(symbolSpec)) {
    const retType = translateRetType(spec.returns); // uint64 for small types (s390x bug)
    const argTypes = (spec.args || []).map(translateType); // native sizes for args
    ffiMap[name] = [retType, argTypes];
  }

  const lib = ffi.Library(libPath, ffiMap);

  // Wrap each symbol so callers get a plain JS function.
  // ffi-napi Library already returns callable functions, so just re-export.
  /** @type {Record<string, Function>} */
  const symbols = {};
  for (const name of Object.keys(ffiMap)) {
    symbols[name] = lib[name].bind(lib);
  }

  // On s390x/ppc64le (big-endian), the Zig render thread deadlocks due to
  // endianness-related synchronization bugs. Force setUseThread(false) so
  // the renderer runs synchronously in the main thread, avoiding the deadlock.
  // Node.js reports ppc64le as 'ppc64' (it does not distinguish endianness),
  // but guard against both forms for future-proofing.
  const isBeArch = process.arch === 's390x' || process.arch === 'ppc64' || process.arch === 'ppc64le';
  if (isBeArch && symbols.setUseThread) {
    const origSetUseThread = symbols.setUseThread;
    symbols.setUseThread = (renderer, _useThread) => origSetUseThread(renderer, false);
  }

  // bun:ffi's dlopen returns { symbols, close() }. @opentui calls library.close()
  // when shutting down. ffi-napi has no explicit close; unloading happens via GC.
  return {
    symbols,
    close() { /* ffi-napi libraries unload automatically via GC */ },
  };
}

// --- JSCallback --------------------------------------------------------------
// Bun's bun:ffi JSCallback creates a native-callable function pointer from a
// JavaScript function. @opentui uses it to pass JS event handlers to the Zig
// library. ffi-napi's ffi.Callback() provides the same functionality.
//
// Usage in @opentui: const cb = new JSCallback(fn, { args: ["u32"], returns: "void" });
//   native_fn(cb.ptr);  // pass the native function pointer
//   cb.close();         // release the callback
class JSCallback {
  constructor(fn, definition) {
    const ffi = require('ffi-napi');
    // JSCallback: JS→native direction — Zig reads the register directly at native
    // width. Use translateType (not translateRetType) so we don't widen narrow
    // types to uint64; widening here would put the value in the wrong register
    // half on big-endian (s390x) targets.
    const retType = translateType((definition && definition.returns) || 'void');
    const argTypes = ((definition && definition.args) || []).map(translateType);
    // ffi.Callback returns a Buffer containing the native function pointer
    this._cb = ffi.Callback(retType, argTypes, fn);
    // .ptr is the raw pointer — keep as Buffer; ffi-napi passes it correctly
    this.ptr = this._cb;
  }

  close() {
    // ffi-napi callbacks are released by GC; explicit close is a no-op
  }
}

// --- Exports -----------------------------------------------------------------

module.exports = {
  dlopen,
  FFIType,
  suffix,
  ptr,
  toBuffer,
  CString,
  JSCallback,
};
