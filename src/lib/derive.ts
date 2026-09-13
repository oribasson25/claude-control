import type { HookEvent, SessionState, SessionStatus } from "./types";

/**
 * Turns a raw Claude Code hook event into the session state a card renders.
 *
 * This is the whole read path's interpretation layer: hooks are a stream of
 * low-level lifecycle events, and a dashboard needs three things out of them —
 * is this session working, does it need me, is it done — plus one short line
 * saying what it is doing right now.
 */

/** We store status and a short activity string, never transcripts. */
const MAX_TEXT = 240;

export function truncate(value: unknown, max = MAX_TEXT): string {
  const text = typeof value === "string" ? value : "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The last meaningful path segment — the name a human calls the project. */
export function projectNameFrom(cwd: string | undefined): string {
  if (!cwd) return "unknown";
  const parts = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "unknown";
}

function basename(value: unknown): string {
  if (typeof value !== "string" || !value) return "";
  return value.split("/").filter(Boolean).pop() ?? "";
}

/** A one-line description of the tool a session is about to run. */
export function describeTool(
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
): string {
  const name = toolName ?? "a tool";
  const args = input ?? {};

  switch (name) {
    case "Read":
      return `Reading ${basename(args.file_path) || "a file"}`;
    case "Edit":
    case "MultiEdit":
      return `Editing ${basename(args.file_path) || "a file"}`;
    case "Write":
      return `Writing ${basename(args.file_path) || "a file"}`;
    case "NotebookEdit":
      return `Editing ${basename(args.notebook_path) || "a notebook"}`;
    case "Bash":
      // The hook gives us Claude's own description when it wrote one.
      return truncate(args.description || `Running: ${args.command ?? ""}`, 80);
    case "Grep":
      return truncate(`Searching for ${args.pattern ?? "a pattern"}`, 80);
    case "Glob":
      return truncate(`Finding files: ${args.pattern ?? ""}`, 80);
    case "Task":
      return truncate(`Delegating: ${args.description ?? "a subagent"}`, 80);
    case "WebFetch":
    case "WebSearch":
      return "Searching the web";
    case "TodoWrite":
      return "Updating its task list";
    default:
      return `Running ${name}`;
  }
}

/** A session we have never seen before, with everything at its zero value. */
export function blankSession(params: {
  sessionId: string;
  userId: string;
  deviceId: string;
  deviceLabel: string;
  cwd: string;
}): SessionState {
  const now = Date.now();
  return {
    sessionId: params.sessionId,
    userId: params.userId,
    deviceId: params.deviceId,
    deviceLabel: params.deviceLabel,
    project: projectNameFrom(params.cwd),
    cwd: params.cwd,
    status: "idle",
    activity: "Starting up",
    lastPrompt: "",
    lastMessage: "",
    startedAt: now,
    updatedAt: now,
    toolCount: 0,
    needsAttention: false,
    // Off by default: the write path runs code on someone's machine, so the
    // owner has to turn it on per session rather than inherit it.
    promptsAllowed: false,
    queuedCount: 0,
  };
}

/**
 * Folds one hook event into the previous state.
 *
 * Pure, so the same derivation can be unit-tested and reused by the agent.
 */
export function applyEvent(previous: SessionState, event: HookEvent): SessionState {
  const now = Date.now();
  const next: SessionState = { ...previous, updatedAt: now };

  if (event.cwd && event.cwd !== previous.cwd) {
    next.cwd = event.cwd;
    next.project = projectNameFrom(event.cwd);
  }

  const setStatus = (status: SessionStatus, activity: string) => {
    next.status = status;
    next.activity = activity;
    next.needsAttention = status === "needs_you";
  };

  switch (event.hook_event_name) {
    case "SessionStart":
      setStatus("idle", "Session started");
      next.startedAt = now;
      break;

    case "UserPromptSubmit":
      next.lastPrompt = truncate(event.prompt);
      setStatus("working", "Thinking");
      break;

    case "PreToolUse":
      next.toolCount = previous.toolCount + 1;
      setStatus("working", describeTool(event.tool_name, event.tool_input));
      break;

    case "PostToolUse":
      // Between tools Claude is composing its next step; still busy.
      if (previous.status === "working") next.activity = "Thinking";
      break;

    case "Notification":
      // Claude Code fires this when it wants permission or has gone quiet
      // waiting on the user — the one case that should pull someone's eye.
      next.lastMessage = truncate(event.message);
      setStatus("needs_you", truncate(event.message, 120) || "Waiting for you");
      break;

    case "Stop":
    case "SubagentStop":
      setStatus("done", "Finished — waiting for your next prompt");
      break;

    case "SessionEnd":
      setStatus("idle", "Session ended");
      break;

    case "PreCompact":
      setStatus("working", "Compacting its context");
      break;

    default:
      // Unknown event: keep the status, just refresh the heartbeat.
      break;
  }

  return next;
}
