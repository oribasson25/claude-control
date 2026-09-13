import { fail, isResponse, json, requireViewer } from "@/lib/api";
import { revokeDevice } from "@/lib/repo-devices";

/** Revoking a device kills both its hooks and its relay agent immediately. */

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const viewer = await requireViewer();
  if (isResponse(viewer)) return viewer;

  const { id } = await params;
  const revoked = await revokeDevice(viewer.userId, id);
  if (!revoked) return fail("No such device.", 404);

  return json({ ok: true });
}
