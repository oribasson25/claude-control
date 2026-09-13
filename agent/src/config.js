import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Agent configuration, kept out of the repo and out of the environment so the
 * device token lives in exactly one place on disk, readable only by its owner.
 */

/**
 * `CLAUDE_CONTROL_HOME` relocates the config directory. Useful for testing and
 * for pointing one machine at two dashboards, and necessary because the agent
 * must otherwise share a home directory with the Claude sessions it resumes —
 * transcripts live under `~/.claude/projects`, so the relay cannot be sandboxed
 * into a different HOME.
 */
export const CONFIG_DIR =
  process.env.CLAUDE_CONTROL_HOME ||
  path.join(os.homedir(), ".claude-control");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
export const LOG_PATH = path.join(CONFIG_DIR, "agent.log");

/**
 * Defaults for how a delivered prompt is allowed to act.
 *
 * `default` is the conservative permission mode: in headless `-p` runs, anything
 * that would normally ask for approval is refused rather than silently allowed.
 * Widening this is a deliberate choice the user makes in this file, not
 * something the dashboard can do on their behalf.
 */
export const DEFAULTS = {
  server: "",
  token: "",
  permissionMode: "default",
  /** Empty means "whatever the permission mode allows". */
  allowedTools: [],
  /** A single delivered prompt is killed after this long. */
  timeoutMs: 10 * 60 * 1000,
  /** Idle poll interval; the server can ask us to come back sooner. */
  pollIntervalMs: 3000,
};

export function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  // Re-assert the mode: writeFileSync ignores `mode` for an existing file.
  fs.chmodSync(CONFIG_PATH, 0o600);
  return CONFIG_PATH;
}

/** Exits with a clear message rather than a stack trace when unconfigured. */
export function requireConfig() {
  const config = readConfig();
  if (!config.server || !config.token) {
    console.error(
      "This machine is not linked yet.\n\n" +
        "  claude-control-agent init --server <url> --token <device token>\n\n" +
        "Mint a token on the Devices page of your dashboard.",
    );
    process.exit(1);
  }
  return config;
}
