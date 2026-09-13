/**
 * The storage primitive layer.
 *
 * Serverless functions are stateless, so session state has to live outside the
 * process. In production that is Upstash Redis over HTTP (no persistent socket,
 * which is what makes it work on Vercel). With no Upstash credentials present we
 * fall back to a JSON file on disk, so the whole system runs locally with no
 * signup. Both backends implement this same interface and nothing above this
 * file knows which one is in play.
 */
export interface KV {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  /** Add or update a member's score in a sorted set. */
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  /** Members ordered by score ascending. */
  zrange(key: string): Promise<string[]>;
  /** Increment a counter, setting its TTL on first write. Used for rate limits. */
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
}

export const usingUpstash = Boolean(
  process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN,
);

let cached: KV | null = null;

/** Returns the process-wide KV instance, picking a backend on first use. */
export async function kv(): Promise<KV> {
  if (cached) return cached;
  cached = usingUpstash
    ? (await import("./kv-upstash")).createUpstashKV()
    : (await import("./kv-file")).createFileKV();
  return cached;
}

/** Describes the active backend, for the dashboard's status strip. */
export function backendName(): string {
  return usingUpstash ? "Upstash Redis" : "local file";
}
