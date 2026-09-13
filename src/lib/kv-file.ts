import fs from "node:fs";
import path from "node:path";
import type { KV } from "./kv";

/**
 * Local-development backend: the whole key space in one JSON file.
 *
 * Every operation is a read-modify-write of that file. That is wasteful, but at
 * the scale this runs at locally (a handful of sessions, one user) it is
 * irrelevant, and it keeps state correct across Next.js's separate dev workers —
 * which an in-memory Map would not.
 */

interface Snapshot {
  /** Plain values, JSON-encoded. */
  kv: Record<string, string>;
  /** Sorted sets, as member -> score. */
  z: Record<string, Record<string, number>>;
  /** Absolute expiry timestamps in ms, for keys that have a TTL. */
  exp: Record<string, number>;
}

const DATA_DIR = process.env.CLAUDE_CONTROL_DATA_DIR
  ? path.resolve(process.env.CLAUDE_CONTROL_DATA_DIR)
  : path.join(process.cwd(), ".claude-control-data");
const FILE = path.join(DATA_DIR, "store.json");

const EMPTY: Snapshot = { kv: {}, z: {}, exp: {} };

function read(): Snapshot {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as Snapshot;
    return { kv: parsed.kv ?? {}, z: parsed.z ?? {}, exp: parsed.exp ?? {} };
  } catch {
    return structuredClone(EMPTY);
  }
}

function write(snap: Snapshot): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Write-then-rename so a crash mid-write cannot leave a truncated file behind.
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snap), "utf8");
  fs.renameSync(tmp, FILE);
}

/** Drops every key whose TTL has passed. Called on each read-modify-write. */
function sweep(snap: Snapshot): void {
  const now = Date.now();
  for (const [key, expiresAt] of Object.entries(snap.exp)) {
    if (expiresAt > now) continue;
    delete snap.kv[key];
    delete snap.z[key];
    delete snap.exp[key];
  }
}

/** Runs `fn` against a freshly-swept snapshot and persists the result. */
function mutate<T>(fn: (snap: Snapshot) => T): T {
  const snap = read();
  sweep(snap);
  const result = fn(snap);
  write(snap);
  return result;
}

function query<T>(fn: (snap: Snapshot) => T): T {
  const snap = read();
  sweep(snap);
  return fn(snap);
}

export function createFileKV(): KV {
  return {
    async get<T>(key: string) {
      return query((s) => {
        const raw = s.kv[key];
        if (raw === undefined) return null;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return null;
        }
      });
    },

    async set<T>(key: string, value: T, ttlSeconds?: number) {
      mutate((s) => {
        s.kv[key] = JSON.stringify(value);
        if (ttlSeconds) s.exp[key] = Date.now() + ttlSeconds * 1000;
        else delete s.exp[key];
      });
    },

    async del(key: string) {
      mutate((s) => {
        delete s.kv[key];
        delete s.exp[key];
      });
    },

    async mget<T>(keys: string[]) {
      if (keys.length === 0) return [];
      return query((s) =>
        keys.map((key) => {
          const raw = s.kv[key];
          if (raw === undefined) return null;
          try {
            return JSON.parse(raw) as T;
          } catch {
            return null;
          }
        }),
      );
    },

    async zadd(key: string, score: number, member: string) {
      mutate((s) => {
        (s.z[key] ??= {})[member] = score;
      });
    },

    async zrem(key: string, member: string) {
      mutate((s) => {
        if (s.z[key]) delete s.z[key][member];
      });
    },

    async zrange(key: string) {
      return query((s) =>
        Object.entries(s.z[key] ?? {})
          .sort((a, b) => a[1] - b[1])
          .map(([member]) => member),
      );
    },

    async incrWithTtl(key: string, ttlSeconds: number) {
      return mutate((s) => {
        const next = Number(s.kv[key] ?? "0") + 1;
        s.kv[key] = String(next);
        if (next === 1) s.exp[key] = Date.now() + ttlSeconds * 1000;
        return next;
      });
    },
  };
}
