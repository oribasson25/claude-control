import { fail, isResponse, json, markDeviceSeen, requireDevice } from "@/lib/api";
import { ackItem, getItem } from "@/lib/repo-outbox";
import { truncate } from "@/lib/derive";

/** The relay agent reporting what happened to a prompt it claimed. */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireDevice(request);
  if (isResponse(auth)) return auth;
  markDeviceSeen(auth);

  const body = (await request.json().catch(() => ({}))) as {
    id?: unknown;
    status?: unknown;
    error?: unknown;
  };

  if (typeof body.id !== "string" || !body.id) return fail("Expected an item id.", 400);
  if (body.status !== "delivered" && body.status !== "failed") {
    return fail("Status must be 'delivered' or 'failed'.", 400);
  }

  const item = await getItem(auth.userId, body.id);
  if (!item) return fail("No such outbox item.", 404);
  // A device may only close out work it was actually handed.
  if (item.deviceId !== auth.deviceId) return fail("That item is not yours.", 403);

  const updated = await ackItem(
    auth.userId,
    body.id,
    body.status,
    body.status === "failed" ? truncate(body.error, 400) : undefined,
  );

  return json({ item: updated });
}
