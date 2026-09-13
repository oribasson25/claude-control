import {
  fail,
  isResponse,
  json,
  markDeviceSeen,
  rateLimit,
  requireDevice,
  signatureIsValid,
} from "@/lib/api";
import { applyEvent, blankSession, projectNameFrom } from "@/lib/derive";
import { getSession, saveSession } from "@/lib/repo-sessions";
import type { HookEvent } from "@/lib/types";

/**
 * Ingest for the read path: one Claude Code hook event from one machine.
 *
 * This route is on the hot path of somebody's editor, so it does the minimum —
 * authenticate, fold the event into the session blob, write it — and it never
 * returns a status that would make the calling hook retry or stall a session.
 */

export const dynamic = "force-dynamic";

/** A hook loop gone wrong shouldn't be able to drain an Upstash quota. */
const EVENTS_PER_MINUTE = 600;

export async function POST(request: Request) {
  const auth = await requireDevice(request);
  if (isResponse(auth)) return auth;

  const withinLimit = await rateLimit("hook", auth.deviceId, EVENTS_PER_MINUTE, 60);
  if (!withinLimit) return fail("Too many events from this device.", 429);

  const rawBody = await request.text();
  if (!signatureIsValid(request, rawBody, auth.rawToken)) {
    return fail("Bad signature.", 401);
  }

  let event: HookEvent;
  try {
    event = JSON.parse(rawBody) as HookEvent;
  } catch {
    return fail("Body was not valid JSON.", 400);
  }

  const sessionId = event.session_id;
  if (!sessionId || typeof sessionId !== "string") {
    return fail("Event had no session_id.", 400);
  }

  const existing = await getSession(auth.userId, sessionId);
  const base =
    existing ??
    blankSession({
      sessionId,
      userId: auth.userId,
      deviceId: auth.deviceId,
      deviceLabel: auth.device.label,
      cwd: event.cwd ?? "",
    });

  // A session can only ever be re-homed onto the device that is reporting it now;
  // the label may also have been renamed since the session first appeared.
  const next = applyEvent(
    {
      ...base,
      deviceId: auth.deviceId,
      deviceLabel: auth.device.label,
      project: base.project || projectNameFrom(event.cwd),
    },
    event,
  );

  await saveSession(next);
  markDeviceSeen(auth);

  return json({ ok: true, status: next.status });
}
