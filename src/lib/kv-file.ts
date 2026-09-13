import fs from "node:fs";
import path from "node:path";
import type { KV } from "./kv";

/**
 * Local-development backend: the whole key space in one JSON file.
 *
 * Every mutation is a read-modify-write of that file, which is wasteful but
 * irrelevant at the scale this runs at locally. It is also, without care, wrong:
 * the dashboard polls every 1.5s and those polls write too (pruning dead index
 * entries), so a poll that read the file before a device was minted would write
 * its stale snapshot back over it and silently erase the new token.
 *
 * So every mutation holds an exclusive lock for its whole read-modify-write
 * cycle — a lock file, because Next.js serves requests from more than one
 * process and an in-process mutex alone would not see the others. Reads need no
 * lock: writes land via rename, so a reader always sees a complete file.
 *
 * Upstash needs none of this. Its operations are atomic server-side, with no
 * global blob to lose a write into.
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

const LOCK = `${FILE}.lock`;

/** How long to wait for another holder before giving up. */
const LOCK_TIMEOUT_MS = 5000;
/** A lock older than this belonged to a process that died; take it. */
const LOCK_STALE_MS = 10_000;

const EMPTY: Snapshot = { kv: {}, z: {}, exp: {} };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquireLock(): Promise<number> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      // "wx" fails if the file exists, which is what makes this a lock.
      return fs.openSync(LOCK, "wx");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;

      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(LOCK, { force: true });
          continue;
        }
      } catch {
        // The holder released it between our open and our stat; just retry.
      }

      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for the store lock at ${LOCK}.`);
      }
      await sleep(5 + Math.random() * 20);
    }
  }
}

function releaseLock(handle: number): void {
  try {
    fs.closeSync(handle);
  } catch {
    // Already closed.
  }
  fs.rmSync(LOCK, { force: true });
}

/**
 * In-process serialization, so concurrent requests in one worker queue up
 * instead of spinning against each other on the file lock.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  // Keep the chain alive regardless of how this link settles.
  chain = run.catch(() => undefined);
  return run;
}

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

/**
 * Runs `fn` against a freshly-swept snapshot and persists the result, holding
 * the lock across the whole cycle so no concurrent writer can clobber it.
 */
function mutate<T>(fn: (snap: Snapshot) => T): Promise<T> {
  return serialize(async () => {
    const handle = await acquireLock();
    try {
      const snap = read();
      sweep(snap);
      const result = fn(snap);
      write(snap);
      return result;
    } finally {
      releaseLock(handle);
    }
  });
}

/** Reads need no lock: `write` renames into place, so the file is never torn. */
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
      await mutate((s) => {
        s.kv[key] = JSON.stringify(value);
        if (ttlSeconds) s.exp[key] = Date.now() + ttlSeconds * 1000;
        else delete s.exp[key];
      });
    },

    async del(key: string) {
      await mutate((s) => {
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
      await mutate((s) => {
        (s.z[key] ??= {})[member] = score;
      });
    },

    async zrem(key: string, member: string) {
      await mutate((s) => {
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
