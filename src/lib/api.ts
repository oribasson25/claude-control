import { NextResponse } from "next/server";
import { authEnabled, currentViewer, type Viewer } from "./auth";
import { bearerFrom, verifySignature } from "./tokens";
import { getDevice, resolveToken, touchDevice } from "./repo-devices";
import { kv } from "./kv";
import { k } from "./keys";
import type { DeviceRecord } from "./types";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Local mode gives every browser the same namespace with no sign-in. That is
 * fine on a laptop and catastrophic on a public URL, so it is refused anywhere
 * that looks like a real deployment unless explicitly overridden.
 */
export function localModeIsUnsafe(): boolean {
  if (authEnabled) return false;
  if (process.env.ALLOW_LOCAL_MODE === "1") return false;
  return Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");
}

const LOCAL_MODE_MESSAGE =
  "This deployment has no OAuth provider configured, so it would serve every " +
  "visitor the same session data. Set AUTH_GITHUB_ID/AUTH_GITHUB_SECRET (or the " +
  "Google equivalents) and AUTH_SECRET, or set ALLOW_LOCAL_MODE=1 if this URL is " +
  "genuinely private.";

/** Guards a cookie-authenticated route. Returns the viewer or a Response. */
export async function requireViewer(): Promise<Viewer | NextResponse> {
  if (localModeIsUnsafe()) return fail(LOCAL_MODE_MESSAGE, 503);
  const viewer = await currentViewer();
  if (!viewer) return fail("Not signed in.", 401);
  return viewer;
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export interface DeviceAuth {
  userId: string;
  deviceId: string;
  device: DeviceRecord;
  /** The raw token, needed to verify an HMAC signature over the body. */
  rawToken: string;
}

/**
 * Guards a machine-authenticated route (hooks and the relay agent).
 *
 * `userId` is always derived from the token, never read from the request body —
 * that is the whole of the tenant isolation guarantee on the ingest path.
 */
export async function requireDevice(
  request: Request,
): Promise<DeviceAuth | NextResponse> {
  if (localModeIsUnsafe()) return fail(LOCAL_MODE_MESSAGE, 503);

  const raw = bearerFrom(request.headers.get("authorization"));
  if (!raw) return fail("Missing bearer token.", 401);

  const owner = await resolveToken(raw);
  if (!owner) return fail("Unknown or revoked device token.", 401);

  const device = await getDevice(owner.userId, owner.deviceId);
  if (!device) return fail("Unknown or revoked device token.", 401);

  return { userId: owner.userId, deviceId: owner.deviceId, device, rawToken: raw };
}

/** Optionally enforces an HMAC signature over the raw body, if one was sent. */
export function signatureIsValid(
  request: Request,
  rawBody: string,
  rawToken: string,
): boolean {
  const signature = request.headers.get("x-claude-control-signature");
  // Signing is opt-in: a plain curl hook has no way to compute an HMAC. When a
  // signature is present it must be correct; when absent, the token stands alone.
  if (!signature) return process.env.REQUIRE_HOOK_SIGNATURE !== "1";
  return verifySignature(rawBody, signature, rawToken);
}

/** Fire-and-forget "this machine is alive" marker for the devices page. */
export function markDeviceSeen(auth: DeviceAuth): void {
  void touchDevice(auth.userId, auth.deviceId).catch(() => {});
}

/**
 * Fixed-window rate limit. Coarse, but enough to stop a runaway hook loop from
 * burning through an Upstash quota — which is the failure it exists to prevent.
 */
export async function rateLimit(
  scope: string,
  id: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const store = await kv();
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const count = await store.incrWithTtl(
    k.rateLimit(scope, id, window),
    windowSeconds,
  );
  return count <= limit;
}
