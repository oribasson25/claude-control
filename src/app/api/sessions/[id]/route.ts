import { fail, isResponse, json, requireViewer } from "@/lib/api";
import { deleteSession, getSession, patchSession } from "@/lib/repo-sessions";

/** Per-session controls: the prompt permission toggle, and dismissing a card. */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const viewer = await requireViewer();
  if (isResponse(viewer)) return viewer;

  const { id } = await params;
  // Reading through the user's own namespace is what proves ownership — there
  // is no way to address another tenant's session from here.
  const session = await getSession(viewer.userId, id);
  if (!session) return fail("No such session.", 404);

  const body = (await request.json().catch(() => ({}))) as {
    promptsAllowed?: unknown;
  };

  if (typeof body.promptsAllowed !== "boolean") {
    return fail("Expected { promptsAllowed: boolean }.", 400);
  }

  const updated = await patchSession(viewer.userId, id, {
    promptsAllowed: body.promptsAllowed,
  });

  return json({ session: updated });
}

export async function DELETE(_request: Request, { params }: Context) {
  const viewer = await requireViewer();
  if (isResponse(viewer)) return viewer;

  const { id } = await params;
  await deleteSession(viewer.userId, id);
  return json({ ok: true });
}
