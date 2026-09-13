import {
  fail,
  isResponse,
  json,
  markDeviceSeen,
  rateLimit,
  requireDevice,
} from "@/lib/api";
import { claimForDevice } from "@/lib/repo-outbox";
import { getSession } from "@/lib/repo-sessions";

/**
 * The relay agent's pull endpoint.
 *
 * An agent only ever sees its own user's outbox, filtered to its own device.
 * The server also withholds items whose session is mid-turn, because
 * `claude --resume` attaches to a finished session — so "deliver on idle" is
 * enforced here rather than trusted to the agent.
 */

export const dynamic = "force-dynamic";

const POLLS_PER_MINUTE = 240;
const MAX_BATCH = 5;

export async function GET(request: Request) {
  const auth = await requireDevice(request);
  if (isResponse(auth)) return auth;

  const withinLimit = await rateLimit("outbox", auth.deviceId, POLLS_PER_MINUTE, 60);
  if (!withinLimit) return fail("Polling too fast.", 429);

  markDeviceSeen(auth);

  const items = await claimForDevice(auth.userId, auth.deviceId, MAX_BATCH);

  // The agent needs each session's cwd to resume in the right project directory.
  const withContext = await Promise.all(
    items.map(async (item) => {
      const session = await getSession(auth.userId, item.sessionId);
      return { ...item, cwd: session?.cwd || item.cwd };
    }),
  );

  return json({ items: withContext, pollAfterMs: withContext.length ? 500 : 3000 });
}
