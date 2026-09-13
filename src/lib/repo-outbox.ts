import { kv } from "./kv";
import { CLAIM_TIMEOUT_MS, k, OUTBOX_TTL_SECONDS } from "./keys";
import { newId } from "./tokens";
import type { OutboxItem, SessionState } from "./types";
import { getSession, patchSession } from "./repo-sessions";

/**
 * The outbox is the write path's queue: the browser puts a prompt in, the
 * machine's relay agent takes it out.
 *
 * Two constraints shape it. First, `claude --resume` attaches to a session that
 * has *finished* its turn, not one mid-run — so an item is only handed out once
 * its session is idle. Second, an agent can die holding a claim, so claims
 * expire and the item becomes deliverable again rather than being lost.
 */

/** Statuses that still need an agent to do something. */
const ACTIVE: OutboxItem["status"][] = ["queued", "claimed"];

/** A session in one of these states can accept a resumed prompt right now. */
function sessionIsReady(session: SessionState | null): boolean {
  // A session whose state blob expired is still resumable by id — Claude Code
  // keeps the transcript on disk long after we stop hearing about it.
  if (!session) return true;
  return session.status === "done" || session.status === "idle";
}

export async function enqueuePrompt(params: {
  userId: string;
  sessionId: string;
  deviceId: string;
  cwd: string;
  text: string;
  fork: boolean;
}): Promise<OutboxItem> {
  const store = await kv();
  const item: OutboxItem = {
    id: newId(),
    userId: params.userId,
    sessionId: params.sessionId,
    deviceId: params.deviceId,
    cwd: params.cwd,
    text: params.text,
    createdAt: Date.now(),
    status: "queued",
    fork: params.fork,
  };

  await store.set(k.outboxItem(params.userId, item.id), item, OUTBOX_TTL_SECONDS);
  await store.zadd(k.outboxIndex(params.userId), item.createdAt, item.id);
  await refreshQueuedCount(params.userId, params.sessionId);
  return item;
}

/** Every item still in the user's active index, oldest first. */
export async function listActive(userId: string): Promise<OutboxItem[]> {
  const store = await kv();
  const ids = await store.zrange(k.outboxIndex(userId));
  if (ids.length === 0) return [];

  const blobs = await store.mget<OutboxItem>(
    ids.map((id) => k.outboxItem(userId, id)),
  );

  const alive: OutboxItem[] = [];
  const dead: string[] = [];
  ids.forEach((id, i) => {
    const blob = blobs[i];
    if (blob && ACTIVE.includes(blob.status)) alive.push(blob);
    else dead.push(id);
  });

  await Promise.all(dead.map((id) => store.zrem(k.outboxIndex(userId), id)));
  return alive.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getItem(
  userId: string,
  itemId: string,
): Promise<OutboxItem | null> {
  const store = await kv();
  return store.get<OutboxItem>(k.outboxItem(userId, itemId));
}

/**
 * Hands an agent the work it may do right now: its own device's items, whose
 * sessions are idle, that nobody else holds a live claim on.
 */
export async function claimForDevice(
  userId: string,
  deviceId: string,
  max = 5,
): Promise<OutboxItem[]> {
  const store = await kv();
  const now = Date.now();
  const active = await listActive(userId);

  const claimed: OutboxItem[] = [];
  // Cache session lookups — several queued prompts often target one session.
  const sessions = new Map<string, SessionState | null>();

  for (const item of active) {
    if (claimed.length >= max) break;
    if (item.deviceId !== deviceId) continue;
    // Someone else is already working on it and has not timed out yet.
    if (item.status === "claimed" && now - (item.claimedAt ?? 0) < CLAIM_TIMEOUT_MS) {
      continue;
    }

    if (!sessions.has(item.sessionId)) {
      sessions.set(item.sessionId, await getSession(userId, item.sessionId));
    }
    if (!sessionIsReady(sessions.get(item.sessionId) ?? null)) continue;

    const next: OutboxItem = { ...item, status: "claimed", claimedAt: now };
    await store.set(k.outboxItem(userId, item.id), next, OUTBOX_TTL_SECONDS);
    claimed.push(next);
  }

  return claimed;
}

/** Records the agent's delivery result and drops the item from the active index. */
export async function ackItem(
  userId: string,
  itemId: string,
  status: "delivered" | "failed",
  error?: string,
): Promise<OutboxItem | null> {
  const store = await kv();
  const item = await getItem(userId, itemId);
  if (!item) return null;

  const next: OutboxItem = { ...item, status, error };
  await store.set(k.outboxItem(userId, itemId), next, OUTBOX_TTL_SECONDS);
  await store.zrem(k.outboxIndex(userId), itemId);
  await refreshQueuedCount(userId, item.sessionId);
  return next;
}

export async function cancelItem(userId: string, itemId: string): Promise<boolean> {
  const store = await kv();
  const item = await getItem(userId, itemId);
  if (!item || !ACTIVE.includes(item.status)) return false;
  await store.del(k.outboxItem(userId, itemId));
  await store.zrem(k.outboxIndex(userId), itemId);
  await refreshQueuedCount(userId, item.sessionId);
  return true;
}

/**
 * Recomputes a session's queued badge from the active index.
 *
 * The count is denormalized onto the session so the dashboard's polling route
 * stays a single read of the session list rather than a second pass over the
 * outbox on every tick.
 */
export async function refreshQueuedCount(
  userId: string,
  sessionId: string,
): Promise<void> {
  const active = await listActive(userId);
  const queuedCount = active.filter((i) => i.sessionId === sessionId).length;
  await patchSession(userId, sessionId, { queuedCount });
}
