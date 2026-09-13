import crypto from "node:crypto";

/**
 * Device tokens authenticate a machine — both its hooks and its relay agent.
 * They are shown to the user exactly once and stored only as a SHA-256 hash, so
 * a dump of the store does not hand anyone the ability to drive someone's
 * machine. Revocation is deleting the hash.
 */

const PREFIX = "ccd_";

export interface MintedToken {
  raw: string;
  hash: string;
  /** Last 6 characters, so the UI can tell two tokens apart after the fact. */
  hint: string;
}

export function mintDeviceToken(): MintedToken {
  const raw = PREFIX + crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw), hint: raw.slice(-6) };
}

export function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Pulls the token out of an `Authorization: Bearer …` header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Verifies an HMAC signature over the raw request body.
 *
 * Hooks may sign their payload with the device token as the key, so a leaked
 * endpoint URL alone cannot be used to forge events. Compared in constant time.
 */
export function verifySignature(
  rawBody: string,
  signature: string,
  token: string,
): boolean {
  const expected = crypto.createHmac("sha256", token).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function newId(): string {
  return crypto.randomUUID();
}
