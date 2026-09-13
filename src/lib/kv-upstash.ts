import { Redis } from "@upstash/redis";
import type { KV } from "./kv";

/**
 * Upstash speaks HTTP rather than the Redis wire protocol, which is why it works
 * from a serverless function that cannot hold a socket open between invocations.
 *
 * We JSON-encode values ourselves rather than relying on the client's automatic
 * (de)serialization, so a value round-trips identically on both backends.
 */
export function createUpstashKV(): KV {
  const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
    automaticDeserialization: false,
  });

  const decode = <T>(raw: unknown): T | null => {
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(String(raw)) as T;
    } catch {
      return null;
    }
  };

  return {
    async get<T>(key: string) {
      return decode<T>(await redis.get(key));
    },

    async set<T>(key: string, value: T, ttlSeconds?: number) {
      const payload = JSON.stringify(value);
      if (ttlSeconds) await redis.set(key, payload, { ex: ttlSeconds });
      else await redis.set(key, payload);
    },

    async del(key: string) {
      await redis.del(key);
    },

    async mget<T>(keys: string[]) {
      if (keys.length === 0) return [];
      const raw = await redis.mget<unknown[]>(...keys);
      return raw.map((r) => decode<T>(r));
    },

    async zadd(key: string, score: number, member: string) {
      await redis.zadd(key, { score, member });
    },

    async zrem(key: string, member: string) {
      await redis.zrem(key, member);
    },

    async zrange(key: string) {
      const members = await redis.zrange<string[]>(key, 0, -1);
      return members ?? [];
    },

    async incrWithTtl(key: string, ttlSeconds: number) {
      const count = await redis.incr(key);
      // Only the first writer in the window needs to arm the expiry.
      if (count === 1) await redis.expire(key, ttlSeconds);
      return count;
    },
  };
}
