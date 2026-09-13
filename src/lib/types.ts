/**
 * Core domain types shared by the web app and the relay agent.
 * Keep this file dependency-free — the agent imports the same shapes.
 */

/** Lifecycle of a single Claude Code session, as derived from its hook events. */
export type SessionStatus =
  | "working" // Claude is mid-turn: thinking or running tools
  | "needs_you" // blocked on a permission prompt or a question
  | "done" // finished its turn, waiting for the next prompt
  | "idle"; // reported once but nothing has happened for a while

/** Live state of one session. This is what a dashboard card renders. */
export interface SessionState {
  sessionId: string;
  userId: string;
  /** Machine that reported this session, from the device token. */
  deviceId: string;
  deviceLabel: string;
  /** Last path segment of `cwd` — the human-readable project name. */
  project: string;
  cwd: string;
  status: SessionStatus;
  /** Short human string: "Editing src/lib/store.ts", "Waiting for permission". */
  activity: string;
  /** Truncated text of the most recent user prompt. */
  lastPrompt: string;
  /** Truncated text of the most recent notification/assistant message. */
  lastMessage: string;
  startedAt: number;
  updatedAt: number;
  /** How many tools this session has run since we started watching. */
  toolCount: number;
  needsAttention: boolean;
  /** Owner opt-in: may the web UI send prompts to this session? */
  promptsAllowed: boolean;
  /** Number of prompts queued for this session but not yet delivered. */
  queuedCount: number;
}

/** A prompt queued from the web UI, waiting for the relay agent to deliver it. */
export interface OutboxItem {
  id: string;
  userId: string;
  sessionId: string;
  /** Device the session lives on, so an agent only claims its own work. */
  deviceId: string;
  cwd: string;
  text: string;
  createdAt: number;
  /** Set when an agent claims the item; used to expire abandoned claims. */
  claimedAt?: number;
  status: "queued" | "claimed" | "delivered" | "failed";
  error?: string;
  /** Branch into a new session instead of continuing the original. */
  fork: boolean;
}

/** A machine the user has linked. The raw token is never stored. */
export interface DeviceRecord {
  deviceId: string;
  userId: string;
  label: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  /** Last few characters of the raw token, so the UI can identify it. */
  tokenHint: string;
}

/** A user account. In local mode there is exactly one, with id "local". */
export interface UserRecord {
  userId: string;
  email: string | null;
  name: string | null;
  image: string | null;
  createdAt: number;
}

/** The raw hook payload Claude Code posts to /api/hook. */
export interface HookEvent {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  transcript_path?: string;
  prompt?: string;
  message?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stop_hook_active?: boolean;
  [key: string]: unknown;
}
