import { kv } from "./kv";
import { k, SESSION_TTL_SECONDS } from "./keys";
import type { SessionState } from "./types";

/**
 * Session state lives in two keys: the state blob (which carries a TTL, so a
 * machine that goes away stops cluttering the board) and a sorted-set index
 * scored by `updatedAt`, which gives us a cheap ordered listing without a scan.
 */

export async function saveSession(state: SessionState): Promise<void> {
  const store = await kv();
  await store.set(k.session(state.userId, state.sessionId), state, SESSION_TTL_SECONDS);
  await store.zadd(k.sessionIndex(state.userId), state.updatedAt, state.sessionId);
}

export async function getSession(
  userId: string,
  sessionId: string,
): Promise<SessionState | null> {
  const store = await kv();
  return store.get<SessionState>(k.session(userId, sessionId));
}

/**
 * Returns the user's sessions, newest activity first.
 *
 * The index outlives the state keys it points at, so any id whose blob has
 * expired is dropped from the index here rather than in a separate sweep.
 */
export async function listSessions(userId: string): Promise<SessionState[]> {
  const store = await kv();
  const ids = await store.zrange(k.sessionIndex(userId));
  if (ids.length === 0) return [];

  const blobs = await store.mget<SessionState>(
    ids.map((id) => k.session(userId, id)),
  );

  const alive: SessionState[] = [];
  const dead: string[] = [];
  ids.forEach((id, i) => {
    const blob = blobs[i];
    if (blob) alive.push(blob);
    else dead.push(id);
  });

  await Promise.all(dead.map((id) => store.zrem(k.sessionIndex(userId), id)));

  return alive.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  const store = await kv();
  await store.del(k.session(userId, sessionId));
  await store.zrem(k.sessionIndex(userId), sessionId);
}

/** Applies a partial change to a session, preserving the rest. No-op if gone. */
export async function patchSession(
  userId: string,
  sessionId: string,
  patch: Partial<SessionState>,
): Promise<SessionState | null> {
  const current = await getSession(userId, sessionId);
  if (!current) return null;
  const next = { ...current, ...patch };
  await saveSession(next);
  return next;
}
