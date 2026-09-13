import { fail, isResponse, json, requireViewer } from "@/lib/api";
import { createDevice, listDevices } from "@/lib/repo-devices";

/** Device tokens: one per machine, minted here and shown exactly once. */

export const dynamic = "force-dynamic";

const MAX_DEVICES = 25;

export async function GET() {
  const viewer = await requireViewer();
  if (isResponse(viewer)) return viewer;

  const devices = await listDevices(viewer.userId);
  // The hash is the credential's shadow; it never needs to leave the server.
  return json({
    devices: devices.map(({ tokenHash: _tokenHash, ...rest }) => rest),
  });
}

export async function POST(request: Request) {
  const viewer = await requireViewer();
  if (isResponse(viewer)) return viewer;

  const existing = await listDevices(viewer.userId);
  if (existing.length >= MAX_DEVICES) {
    return fail(`You already have ${MAX_DEVICES} devices. Revoke one first.`, 409);
  }

  const body = (await request.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label.slice(0, 60) : "";

  const { device, rawToken } = await createDevice(viewer.userId, label);
  const { tokenHash: _tokenHash, ...safe } = device;

  // This is the only response that will ever carry the raw token.
  return json({ device: safe, token: rawToken }, 201);
}
