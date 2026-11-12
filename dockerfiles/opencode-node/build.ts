// Copyright (c) 2026 Red Hat, Inc.
// SPDX-License-Identifier: EPL-2.0
import { readFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageRoot = path.join(root, "packages/opencode");
const version = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
).version;
const requested = process.env.OPENCODE_VERSION?.replace(/^v/, "");
if (!requested || requested !== version)
  throw new Error(
    `Source version ${version} does not match requested ${requested}`,
  );
await mkdir(path.join(packageRoot, "src/node"), { recursive: true });
await copyFile("/port/node-cli.ts", path.join(packageRoot, "src/node/cli.ts"));
process.chdir(packageRoot);
const { modelsData } = await import(
  path.join(packageRoot, "script/generate.ts")
);

const result = await Bun.build({
  target: "node",
  conditions: ["node"],
  entrypoints: ["./src/node/cli.ts"],
  outdir: "./dist/node",
  format: "esm",
  minify: false,
  external: [
    "jsonc-parser",
    "@lydell/node-pty",
    "@parcel/watcher",
    "@parcel/watcher/wrapper",
  ],
  define: {
    OPENCODE_VERSION: JSON.stringify(version),
    OPENCODE_CHANNEL: JSON.stringify("stable"),
    OPENCODE_LIBC: JSON.stringify("glibc"),
    OPENCODE_MODELS_DEV: modelsData,
  },
  files: { "opencode-web-ui.gen.ts": "" },
  plugins: [
    {
      name: "headless-node-cli",
      setup(build) {
        // Keep the JS runtime external, but let Bun copy its WASM asset.
        build.onResolve(
          { filter: /^@silvia-odwyer\/photon-node$/ },
          ({ path }) => ({ path, external: true }),
        );
        // Parcel's package loader supports a locally compiled binding on s390x/ppc64le.
        // Upstream's prebuild-only selector would silently disable the watcher.
        build.onLoad(
          { filter: /\/core\/src\/filesystem\/watcher\.ts$/ },
          async ({ path }) => {
            const source = await readFile(path, "utf8");
            const start = source.indexOf(
              "    const libc = typeof OPENCODE_LIBC",
            );
            const end = source.indexOf("  } catch {", start);
            if (start < 0 || end < 0)
              throw new Error(
                "Upstream watcher selector changed; review the Node adapter",
              );
            return {
              loader: "ts",
              contents:
                source.slice(0, start) +
                '    return require("@parcel/watcher") as typeof import("@parcel/watcher")\n' +
                source.slice(end),
            };
          },
        );
        // This module implements the Bun/OpenTUI renderer, not headless run.
        build.onLoad({ filter: /\/cli\/cmd\/run\/runtime\.ts$/ }, () => ({
          loader: "js",
          contents: `const unsupported = () => { throw new Error("Interactive OpenTUI is unavailable in the Node.js build") }; export const runInteractiveMode = unsupported; export const runInteractiveLocalMode = unsupported;`,
        }));
      },
    },
  ],
});
if (!result.success)
  throw new AggregateError(result.logs, "OpenCode Node CLI build failed");
await Bun.write(
  "./dist/node/package.json",
  JSON.stringify({ type: "module", version }),
);
await copyFile(path.join(root, "LICENSE"), "./dist/node/LICENSE.opencode");
// Retain license/notice text for the dependencies incorporated into the bundle.
const notices = [];
for await (const file of new Bun.Glob(
  "**/{LICENSE*,LICENCE*,NOTICE*,COPYING*}",
).scan({
  cwd: path.join(root, "node_modules"),
  dot: true,
  onlyFiles: true,
})) {
  notices.push(
    `\n--- ${file} ---\n` +
      (await readFile(path.join(root, "node_modules", file), "utf8")),
  );
}
await Bun.write("./dist/node/THIRD_PARTY_NOTICES", notices.join("\n"));
console.log(`Built OpenCode ${version} Node CLI`);
