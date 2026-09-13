import { isResponse, json, requireViewer } from "@/lib/api";
import { listSessions } from "@/lib/repo-sessions";
import { listActive } from "@/lib/repo-outbox";
import { backendName } from "@/lib/kv";
import { authEnabled } from "@/lib/auth";

/**
 * The dashboard's polling endpoint: everything one screen needs, in one request.
 *
 * Returning the outbox alongside the sessions keeps the browser to a single
 * round trip per tick, which matters because this is the app's request driver.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await requireViewer();
  if (isResponse(viewer)) return viewer;

  const [sessions, outbox] = await Promise.all([
    listSessions(viewer.userId),
    listActive(viewer.userId),
  ]);

  return json({
    sessions,
    outbox,
    viewer: { name: viewer.name, email: viewer.email, image: viewer.image },
    meta: { backend: backendName(), authEnabled, now: Date.now() },
  });
}
