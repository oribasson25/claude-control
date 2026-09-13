import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Installing the read path: the hooks in `~/.claude/settings.json` that make
 * every Claude session on this machine report what it is doing.
 *
 * Two properties matter more than anything else here. The merge must not damage
 * hooks the user already has — this file is theirs, not ours. And the hook
 * command must never be able to block a session: short timeout, output
 * discarded, `|| true` so a failed curl is still a successful hook.
 */

export const SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

/**
 * Lets us find and remove our own hooks later without touching anyone else's.
 * It is a trailing shell comment, so it must stay at the *end* of the command —
 * at the front it would comment the whole hook out.
 */
const MARKER = "# claude-control";

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SessionEnd",
];

function hookCommand(server) {
  const url = new URL("/api/hook", server).toString();
  return (
    `curl -sS -m 3 -X POST ${url} ` +
    `-H "Authorization: Bearer $CLAUDE_CONTROL_TOKEN" ` +
    `-H "Content-Type: application/json" ` +
    `--data-binary @- >/dev/null 2>&1 || true ${MARKER}`
  );
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/** Keeps a timestamped copy before the first edit, so a bad merge is undoable. */
function backupSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) return null;
  const target = `${SETTINGS_PATH}.claude-control-backup-${Date.now()}`;
  fs.copyFileSync(SETTINGS_PATH, target);
  return target;
}

function isOurs(entry) {
  return (entry?.hooks ?? []).some((hook) => String(hook.command ?? "").includes(MARKER));
}

/**
 * Adds our reporting hook to each event, replacing an older copy of our own but
 * leaving every other hook exactly where it was.
 */
export function installHooks(server, token) {
  const backup = backupSettings();
  const settings = readSettings();
  settings.hooks ??= {};

  const entry = {
    hooks: [{ type: "command", command: hookCommand(server), timeout: 5 }],
  };

  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    settings.hooks[event] = [...existing.filter((e) => !isOurs(e)), entry];
  }

  // The hook command reads the token from the environment rather than baking it
  // into settings.json, which users commonly sync or commit.
  settings.env = { ...(settings.env ?? {}), CLAUDE_CONTROL_TOKEN: token };

  writeSettings(settings);
  return { path: SETTINGS_PATH, backup };
}

/** Removes only the hooks this tool installed. */
export function removeHooks() {
  if (!fs.existsSync(SETTINGS_PATH)) return { path: SETTINGS_PATH, backup: null };

  const backup = backupSettings();
  const settings = readSettings();

  for (const event of HOOK_EVENTS) {
    const existing = Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : [];
    const kept = existing.filter((e) => !isOurs(e));
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }

  if (settings.env) delete settings.env.CLAUDE_CONTROL_TOKEN;

  writeSettings(settings);
  return { path: SETTINGS_PATH, backup };
}

/** Whether our hooks are currently present, for `status`. */
export function hooksInstalled() {
  const settings = readSettings();
  return HOOK_EVENTS.every((event) =>
    (settings.hooks?.[event] ?? []).some(isOurs),
  );
}
