/**
 * Every key is prefixed with its owner. `u:{userId}` is the tenant boundary —
 * no route may build a key from a userId that did not come from the auth context.
 */

export const SESSION_TTL_SECONDS = 2 * 60 * 60; // dead sessions fall off the board after 2h
export const OUTBOX_TTL_SECONDS = 24 * 60 * 60;
export const CLAIM_TIMEOUT_MS = 2 * 60 * 1000; // a claim an agent never acked is retryable

export const k = {
  session: (userId: string, sessionId: string) => `u:${userId}:session:${sessionId}`,
  sessionIndex: (userId: string) => `u:${userId}:sessions`,

  outboxItem: (userId: string, itemId: string) => `u:${userId}:outbox:${itemId}`,
  outboxIndex: (userId: string) => `u:${userId}:outbox`,

  device: (userId: string, deviceId: string) => `u:${userId}:device:${deviceId}`,
  deviceIndex: (userId: string) => `u:${userId}:devices`,

  /** Reverse lookup so /api/hook can resolve a bearer token to its owner. */
  tokenHash: (hash: string) => `tokenhash:${hash}`,

  user: (userId: string) => `user:${userId}`,
  /** Maps an OAuth identity to our internal userId. */
  identity: (provider: string, providerId: string) => `identity:${provider}:${providerId}`,

  rateLimit: (scope: string, id: string, window: number) => `rl:${scope}:${id}:${window}`,
};
