import fs from "node:fs";
import { spawn } from "node:child_process";
import { ackItem, fetchOutbox, HttpError } from "./api.js";
import { CONFIG_DIR, LOG_PATH } from "./config.js";

/**
 * The write path's business end.
 *
 * Claude Code has no inbound API, so nothing in the cloud can talk to a session.
 * This loop is the bridge: it pulls prompts the user queued from the web and
 * replays them into the right session with `claude -p --resume`, which continues
 * that exact conversation. Everything this process does runs as the logged-in
 * user, so it is deliberately narrow — it only ever asks its own server for its
 * own device's work, and it runs prompts under the permission policy in the
 * local config file, which the dashboard cannot change.
 */

export function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    // Logging must never take the relay down.
  }
}

/** Builds the argv for one delivery. No shell is involved, so nothing is quoted. */
function buildArgs(config, item) {
  const args = ["-p", item.text];

  // `--fork-session` branches a new session off this one, leaving the original
  // transcript untouched — "try a follow-up" without disturbing the thread.
  if (item.fork) args.push("--fork-session");
  args.push("--resume", item.sessionId);
  args.push("--permission-mode", config.permissionMode);

  if (Array.isArray(config.allowedTools) && config.allowedTools.length > 0) {
    args.push("--allowedTools", config.allowedTools.join(","));
  }

  return args;
}

/** Runs one queued prompt to completion. Resolves with the outcome, never throws. */
export function deliver(config, item) {
  return new Promise((resolve) => {
    const args = buildArgs(config, item);
    const child = spawn("claude", args, {
      cwd: item.cwd || process.cwd(),
      // The hook that reports this session's progress needs the token, and a
      // detached background agent does not inherit an interactive shell's env.
      env: { ...process.env, CLAUDE_CONTROL_TOKEN: config.token },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let settled = false;
    const capture = (chunk) => {
      // Only the tail matters: it is all that gets reported back on failure.
      output = (output + chunk).slice(-4000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ ok: false, error: `Timed out after ${config.timeoutMs}ms.` });
    }, config.timeoutMs);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on("error", (cause) => {
      const missing = cause.code === "ENOENT";
      finish({
        ok: false,
        error: missing
          ? "The `claude` binary is not on this machine's PATH."
          : String(cause.message ?? cause),
      });
    });

    child.on("close", (code) => {
      if (code === 0) finish({ ok: true, output });
      else finish({ ok: false, error: `claude exited ${code}. ${output}`.trim() });
    });
  });
}

/**
 * Polls for work forever.
 *
 * The server withholds prompts whose session is mid-turn, so this loop does not
 * need to know anything about session state — an item it receives is an item it
 * may run right now.
 */
export async function runRelay(config, { once = false } = {}) {
  log(`relay started · server ${config.server} · permission-mode ${config.permissionMode}`);

  let backoffMs = config.pollIntervalMs;

  for (;;) {
    let waitMs = config.pollIntervalMs;

    try {
      const { items = [], pollAfterMs } = await fetchOutbox(config);
      backoffMs = config.pollIntervalMs;
      waitMs = pollAfterMs ?? config.pollIntervalMs;

      for (const item of items) {
        log(`delivering ${item.id} → session ${item.sessionId} (${item.cwd})`);
        const result = await deliver(config, item);

        if (result.ok) log(`delivered ${item.id}`);
        else log(`failed ${item.id}: ${result.error}`);

        try {
          await ackItem(config, item.id, result.ok ? "delivered" : "failed", result.error);
        } catch (cause) {
          // An ack we could not send will be retried by the server's claim
          // timeout; losing it is recoverable, crashing the relay is not.
          log(`could not ack ${item.id}: ${cause.message}`);
        }
      }
    } catch (cause) {
      if (cause instanceof HttpError && cause.status === 401) {
        log("device token was rejected — it has been revoked. Stopping.");
        return;
      }
      // Back off on transient trouble so a server outage is not a request storm.
      backoffMs = Math.min(backoffMs * 2, 60_000);
      waitMs = backoffMs;
      log(`poll failed (${cause.message}); retrying in ${Math.round(waitMs / 1000)}s`);
    }

    if (once) return;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
