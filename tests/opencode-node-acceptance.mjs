// Copyright (c) 2026 Red Hat, Inc.
// SPDX-License-Identifier: EPL-2.0
// Offline acceptance: exercise the relocated CLI, native bindings and provider path.
import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const original = process.env.TOOL_ROOT || "/opt/opencode";
const temp = await mkdtemp(path.join(tmpdir(), "opencode-acceptance-"));
const root = path.join(temp, "injected-tools/opencode");
await cp(original, root, { recursive: true });
await mkdir(path.join(temp, "bin"));
const cli = path.join(temp, "bin/opencode");
await symlink(path.join(root, "bin/opencode"), cli);
const home = path.join(temp, "home");
await mkdir(home);
const env = {
  ...process.env,
  HOME: home,
  OPENCODE_PURE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  XDG_DATA_HOME: path.join(home, ".local/share"),
  XDG_STATE_HOME: path.join(home, ".local/state"),
};
const children = new Set();
function start(args, extra = {}, timeoutMs = 90000) {
  const proc = spawn(cli, args, {
    cwd: temp,
    env: { ...env, ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(proc);
  let output = "";
  proc.stdout.on("data", (data) => {
    output += data;
  });
  proc.stderr.on("data", (data) => {
    output += data;
  });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`Timed out: ${args.join(" ")}\n${output}`));
    }, timeoutMs);
    proc.on("error", reject);
    proc.on("close", (code) => {
      clearTimeout(timer);
      children.delete(proc);
      resolve({ code, output });
    });
  });
  return { proc, done, output: () => output };
}
async function succeeds(args, expected, extra) {
  const result = await start(args, extra).done;
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, expected);
  return result;
}
let mock;
try {
  const version = JSON.parse(
    await (
      await import("node:fs/promises")
    ).readFile(path.join(root, "bundle/package.json"), "utf8"),
  ).version;
  await succeeds(
    ["--version"],
    new RegExp(`^${version.replaceAll(".", "\\.")}\\s*$`),
  );
  await succeeds(["--help"], /opencode run/);
  assert.notEqual(
    (await start(["--port-acceptance-invalid-flag"]).done).code,
    0,
  );
  assert.notEqual(
    (await start(["run", "--interactive", "hello"]).done).code,
    0,
  );
  await succeeds(["--version"], new RegExp(version), { HOME: "/proc/1" });
  console.log(
    "PASS relocated CLI, symlink, version, help, invalid flags, read-only HOME",
  );

  const require = createRequire(path.join(root, "package.json"));
  const pty = require("@lydell/node-pty");
  await new Promise((resolve, reject) => {
    const child = pty.spawn("/bin/sh", ["-c", "printf PTY_PORT_OK"], {
      cols: 80,
      rows: 24,
      env: { ...env },
      cwd: temp,
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PTY timed out"));
    }, 10000);
    child.onData((data) => {
      out += data;
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timer);
      try {
        assert.equal(exitCode, 0);
        assert.match(out, /PTY_PORT_OK/);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
  const watcher = require("@parcel/watcher");
  const directory = path.join(temp, "watch");
  await mkdir(directory);
  let subscription;
  await new Promise(async (resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Native watcher delivered no event")),
      10000,
    );
    try {
      subscription = await watcher.subscribe(
        directory,
        (error, events) => {
          if (error) {
            clearTimeout(timer);
            reject(error);
          } else if (
            events.some(
              (event) => event.path === path.join(directory, "changed.txt"),
            )
          ) {
            clearTimeout(timer);
            resolve();
          }
        },
        { backend: "inotify" },
      );
      await writeFile(
        path.join(directory, "changed.txt"),
        "native watcher acceptance",
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
  await subscription.unsubscribe();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(temp, "test.sqlite"));
  db.exec("create table port (value text);");
  db.prepare("insert into port values (?)").run("SQLITE_PORT_OK");
  assert.equal(
    db.prepare("select value from port").get().value,
    "SQLITE_PORT_OK",
  );
  db.close();
  const photon = require("@silvia-odwyer/photon-node");
  const image = new photon.PhotonImage(new Uint8Array([255, 0, 0, 255]), 1, 1);
  assert.equal(image.get_width(), 1);
  image.free();
  console.log("PASS native PTY, inotify watcher, SQLite, image WASM");

  let requests = 0;
  mock = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, "smoke");
    assert.equal(req.headers.authorization, "Bearer acceptance-only");
    requests++;
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const base = {
        id: "port-test",
        object: "chat.completion.chunk",
        created: 1,
        model: "smoke",
      };
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "S390X_PORT_OK" }, finish_reason: null }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "port-test",
          object: "chat.completion",
          created: 1,
          model: "smoke",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "S390X_PORT_OK" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    }
  });
  await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const config = {
    provider: {
      "port-test": {
        npm: "@ai-sdk/openai-compatible",
        name: "Acceptance",
        options: {
          baseURL: `http://127.0.0.1:${mock.address().port}/v1`,
          apiKey: "acceptance-only",
        },
        models: {
          smoke: { name: "Smoke", limit: { context: 4096, output: 1024 } },
        },
      },
    },
    model: "port-test/smoke",
    small_model: "port-test/smoke",
  };
  await writeFile(path.join(temp, "opencode.json"), JSON.stringify(config));
  await succeeds(["models", "port-test"], /port-test\/smoke/);
  // Reserve a free local server port, then release it for the real OpenCode server.
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  // The server stays up through the health check and the provider request, so
  // give it more headroom than one-shot commands (emulated builders are slow).
  const server = start(
    ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {},
    300000,
  );
  let healthy = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/global/health`);
      const health = await response.json();
      if (response.ok && health.healthy && health.version === version) {
        healthy = true;
        break;
      }
    } catch {}
    if (server.proc.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert(healthy, `OpenCode server failed health check: ${server.output()}`);
  await succeeds(
    [
      "run",
      "--model",
      "port-test/smoke",
      "--format",
      "json",
      "Return the acceptance marker",
    ],
    /S390X_PORT_OK/,
  );
  assert(requests > 0, "CLI never contacted the provider");
  server.proc.kill("SIGTERM");
  await server.done;
  console.log(
    `PASS models, server health, real headless provider request (${requests} requests)`,
  );
  console.log(
    `OpenCode ${version}: all acceptance checks passed on ${process.platform}/${process.arch}`,
  );
} finally {
  for (const child of children) child.kill("SIGKILL");
  if (mock) await new Promise((resolve) => mock.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
