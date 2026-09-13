import { kv } from "./kv";
import { k } from "./keys";
import { hashToken, mintDeviceToken, newId } from "./tokens";
import type { DeviceRecord } from "./types";

/**
 * A device is one linked machine. Its token is the credential used by both the
 * reporting hooks and the relay agent on that machine.
 */

export interface CreatedDevice {
  device: DeviceRecord;
  /** The only time the raw token exists anywhere. Show it once, never store it. */
  rawToken: string;
}

export async function createDevice(
  userId: string,
  label: string,
): Promise<CreatedDevice> {
  const store = await kv();
  const { raw, hash, hint } = mintDeviceToken();
  const now = Date.now();

  const device: DeviceRecord = {
    deviceId: newId(),
    userId,
    label: label.trim() || "unnamed machine",
    tokenHash: hash,
    createdAt: now,
    lastSeenAt: 0,
    tokenHint: hint,
  };

  await store.set(k.device(userId, device.deviceId), device);
  await store.zadd(k.deviceIndex(userId), now, device.deviceId);
  // Reverse lookup: /api/hook and /api/outbox see only a token, not a userId.
  await store.set(k.tokenHash(hash), { userId, deviceId: device.deviceId });

  return { device, rawToken: raw };
}

export interface TokenOwner {
  userId: string;
  deviceId: string;
}

/** Resolves a raw bearer token to its owner, or null if unknown/revoked. */
export async function resolveToken(raw: string): Promise<TokenOwner | null> {
  const store = await kv();
  return store.get<TokenOwner>(k.tokenHash(hashToken(raw)));
}

export async function getDevice(
  userId: string,
  deviceId: string,
): Promise<DeviceRecord | null> {
  const store = await kv();
  return store.get<DeviceRecord>(k.device(userId, deviceId));
}

export async function listDevices(userId: string): Promise<DeviceRecord[]> {
  const store = await kv();
  const ids = await store.zrange(k.deviceIndex(userId));
  if (ids.length === 0) return [];
  const blobs = await store.mget<DeviceRecord>(ids.map((id) => k.device(userId, id)));
  return blobs
    .filter((d): d is DeviceRecord => d !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Records that a device just called in. Best-effort; never blocks a request. */
export async function touchDevice(userId: string, deviceId: string): Promise<void> {
  const device = await getDevice(userId, deviceId);
  if (!device) return;
  const store = await kv();
  await store.set(k.device(userId, deviceId), { ...device, lastSeenAt: Date.now() });
}

/** Revokes a device: the token stops resolving, so hooks and agent both die. */
export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  const device = await getDevice(userId, deviceId);
  if (!device) return false;
  const store = await kv();
  await store.del(k.tokenHash(device.tokenHash));
  await store.del(k.device(userId, deviceId));
  await store.zrem(k.deviceIndex(userId), deviceId);
  return true;
}
