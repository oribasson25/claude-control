#!/usr/bin/env node

import { readConfig, requireConfig, writeConfig, CONFIG_PATH, LOG_PATH } from "../src/config.js";
import { hooksInstalled, installHooks, removeHooks, SETTINGS_PATH } from "../src/hooks.js";
import { installService, removeService } from "../src/service.js";
import { runRelay, log } from "../src/relay.js";
import { fetchOutbox, HttpError } from "../src/api.js";

/**
 * The one command a user runs on a machine they want on the board.
 *
 * `init` does the whole setup — save the token, write the reporting hooks, and
 * register the relay to run in the background — because the alternative is
 * asking people to hand-edit a JSON file full of curl commands.
 */

const USAGE = `claude-control-agent — link this machine to a Claude Control dashboard

  init      --server <url> --token <token> [--no-service] [--no-hooks]
            Link this machine: save credentials, install the reporting hooks,
            and start the relay in the background.

  start     Run the relay in the foreground (this is what the service runs).
  status    Show what is configured and whether the server accepts this token.
  hooks     Re-write the reporting hooks in ~/.claude/settings.json.
  unlink    Remove the hooks, the background service, and the saved token.

Options for init:
  --permission-mode <mode>   How delivered prompts may act. Default: "default",
                             which refuses anything that would need approval.
  --allowed-tools <a,b,c>    Restrict delivered prompts to these tools.
`;

function parseArgs(argv) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[name] = true;
    } else {
      flags[name] = next;
      i += 1;
    }
  }

  return { flags, positional };
}

async function cmdInit(flags) {
  const server = typeof flags.server === "string" ? flags.server.replace(/\/+$/, "") : "";
  const token = typeof flags.token === "string" ? flags.token : "";

  if (!server || !token) {
    console.error("Both --server and --token are required.\n\n" + USAGE);
    process.exit(1);
  }

  const config = {
    ...readConfig(),
    server,
    token,
    permissionMode:
      typeof flags["permission-mode"] === "string" ? flags["permission-mode"] : "default",
    allowedTools:
      typeof flags["allowed-tools"] === "string"
        ? flags["allowed-tools"].split(",").map((t) => t.trim()).filter(Boolean)
        : [],
  };

  // Verify before writing anything else — a bad token should fail here, not
  // silently in a background service nobody is watching.
  try {
    await fetchOutbox(config);
  } catch (cause) {
    const hint =
      cause instanceof HttpError && cause.status === 401
        ? "The server rejected that token. Mint a fresh one on the Devices page."
        : `Could not reach ${server}: ${cause.message}`;
    console.error(hint);
    process.exit(1);
  }

  console.log(`✓ token accepted by ${server}`);
  console.log(`✓ credentials saved to ${writeConfig(config)}`);

  if (flags["no-hooks"] !== true) {
    const { path, backup } = installHooks(server, token);
    console.log(`✓ reporting hooks written to ${path}`);
    if (backup) console.log(`  (previous settings backed up to ${backup})`);
  }

  if (flags["no-service"] !== true) {
    const target = installService();
    if (target) console.log(`✓ relay registered to run in the background (${target})`);
    else console.log("· no service manager for this OS — run `claude-control-agent start`");
  }

  console.log(
    `\nRestart your Claude Code sessions and they will appear on the board.\n` +
      `Delivered prompts run with --permission-mode ${config.permissionMode}` +
      (config.allowedTools.length
        ? `, limited to: ${config.allowedTools.join(", ")}`
        : "") +
      `.\nChange that in ${CONFIG_PATH}.`,
  );
}

async function cmdStatus() {
  const config = readConfig();

  console.log(`server          ${config.server || "(not set)"}`);
  console.log(`token           ${config.token ? `…${config.token.slice(-6)}` : "(not set)"}`);
  console.log(`permission mode ${config.permissionMode}`);
  console.log(
    `allowed tools   ${config.allowedTools.length ? config.allowedTools.join(", ") : "(whatever the mode allows)"}`,
  );
  console.log(`hooks           ${hooksInstalled() ? `installed in ${SETTINGS_PATH}` : "not installed"}`);
  console.log(`log             ${LOG_PATH}`);

  if (!config.server || !config.token) return;

  try {
    const { items = [] } = await fetchOutbox(config);
    console.log(`connection      ok · ${items.length} prompt(s) waiting`);
  } catch (cause) {
    console.log(`connection      failed · ${cause.message}`);
    process.exitCode = 1;
  }
}

function cmdUnlink() {
  const { path, backup } = removeHooks();
  console.log(`✓ reporting hooks removed from ${path}`);
  if (backup) console.log(`  (previous settings backed up to ${backup})`);

  const service = removeService();
  if (service) console.log(`✓ background service removed (${service})`);

  writeConfig({ ...readConfig(), server: "", token: "" });
  console.log(`✓ credentials cleared from ${CONFIG_PATH}`);
  console.log("\nRevoke the device on the dashboard too, so the token stops working.");
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? "help";

  switch (command) {
    case "init":
      return cmdInit(flags);

    case "start": {
      const config = requireConfig();
      // A relay that dies silently is a write path that stops working with no
      // sign, so surface the reason and let the service manager restart us.
      process.on("unhandledRejection", (cause) => {
        log(`unhandled rejection: ${cause}`);
        process.exit(1);
      });
      return runRelay(config);
    }

    case "status":
      return cmdStatus();

    case "hooks": {
      const config = requireConfig();
      const { path, backup } = installHooks(config.server, config.token);
      console.log(`✓ reporting hooks written to ${path}`);
      if (backup) console.log(`  (previous settings backed up to ${backup})`);
      return undefined;
    }

    case "unlink":
      return cmdUnlink();

    default:
      console.log(USAGE);
      return undefined;
  }
}

main().catch((cause) => {
  console.error(cause.message ?? cause);
  process.exit(1);
});
