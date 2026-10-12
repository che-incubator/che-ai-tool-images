// Copyright (c) 2026 Red Hat, Inc.
// SPDX-License-Identifier: EPL-2.0
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

// Bun's bundler can emit CommonJS dependency calls inside ESM output.
globalThis.require = createRequire(import.meta.url);
globalThis.Bun = {
  stdin: {
    async text() {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks).toString("utf8");
    },
  },
  hash(value) {
    return BigInt(
      "0x" + createHash("sha256").update(value).digest("hex").slice(0, 16),
    );
  },
};

// Load upstream command handlers after initializing the Node compatibility layer.
const { default: yargs } = await import("yargs");
const { hideBin } = await import("yargs/helpers");
const { RunCommand } = await import("../cli/cmd/run");
const { ServeCommand } = await import("../cli/cmd/serve");
const { ModelsCommand } = await import("../cli/cmd/models");
const { ProvidersCommand } = await import("../cli/cmd/providers");
const { InstallationVersion } = await import(
  "@opencode-ai/core/installation/version"
);

const cli = yargs(hideBin(process.argv))
  .scriptName("opencode")
  .parserConfiguration({ "populate--": true })
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
  .alias("version", "v")
  .option("pure", { type: "boolean", describe: "run without external plugins" })
  .option("print-logs", { type: "boolean", describe: "print logs to stderr" })
  .option("log-level", {
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .middleware((args) => {
    if (args.pure) process.env.OPENCODE_PURE = "1";
    if (args.printLogs) process.env.OPENCODE_PRINT_LOGS = "1";
    if (args.logLevel) process.env.OPENCODE_LOG_LEVEL = args.logLevel;
    process.env.AGENT = "1";
    process.env.OPENCODE = "1";
    process.env.OPENCODE_PID = String(process.pid);
    if (args.mini || args.interactive)
      throw new Error(
        "The Node.js build supports headless commands; the Bun terminal UI is unavailable",
      );
  })
  .command(RunCommand)
  .command(ServeCommand)
  .command(ModelsCommand)
  .command(ProvidersCommand)
  .demandCommand(
    1,
    "Use opencode run or opencode serve; this build does not include the Bun terminal UI",
  )
  .strict();

try {
  await cli.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  // Match upstream CLI cleanup and preserve command failures as nonzero exits.
  process.exit(process.exitCode ?? 0);
}
