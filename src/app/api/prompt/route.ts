import { fail, isResponse, json, rateLimit, requireViewer } from "@/lib/api";
import { getSession } from "@/lib/repo-sessions";
import { cancelItem, enqueuePrompt } from "@/lib/repo-outbox";

/**
 * The write path's front door: queue a prompt for one of the user's sessions.
 *
 * Nothing is executed here. This only puts an item in the user's outbox; the
 * relay agent on that machine is what eventually runs it, and only for sessions
 * whose owner has explicitly turned prompting on.
 */

export const dynamic = "force-dynamic";

const MAX_PROMPT_CHARS = 8000;
const PROMPTS_PER_MINUTE = 30;

export async function POST(request: Request) {
  const viewer = await requireViewer();
  if (isResponse(viewer)) return viewer;

  const withinLimit = await rateLimit("prompt", viewer.userId, PROMPTS_PER_MINUTE, 60);
  if (!withinLimit) return fail("Too many prompts, slow down.", 429);

  const body = (await request.json().catch(() => ({}))) as {
    sessionId?: unknown;
    text?: unknown;
    fork?: unknown;
  };

  if (typeof body.sessionId !== "string" || !body.sessionId) {
    return fail("Expected a sessionId.", 400);
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return fail("Prompt was empty.", 400);
  if (text.length > MAX_PROMPT_CHARS) {
    return fail(`Prompt is longer than ${MAX_PROMPT_CHARS} characters.`, 413);
  }

  const session = await getSession(viewer.userId, body.sessionId);
  if (!session) return fail("No such session.", 404);

  // The per-session switch is the last gate before something runs on a machine.
  if (!session.promptsAllowed) {
    return fail(
      "Prompting is off for this session. Turn it on from the session card first.",
      403,
    );
  }

  const item = await enqueuePrompt({
    userId: viewer.userId,
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    cwd: session.cwd,
    text,
    fork: body.fork === true,
  });

  return json({ item });
}

/** Drops a prompt that has not been delivered yet. */
export async function DELETE(request: Request) {
  const viewer = await requireViewer();
  if (isResponse(viewer)) return viewer;

  const itemId = new URL(request.url).searchParams.get("id");
  if (!itemId) return fail("Expected an item id.", 400);

  const cancelled = await cancelItem(viewer.userId, itemId);
  if (!cancelled) return fail("That prompt is no longer cancellable.", 409);

  return json({ ok: true });
}
