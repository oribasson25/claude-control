/** Formatting helpers shared by the dashboard's client components. */

/** "4s" / "3m" / "2h 10m" — compact enough for a card footer. */
export function humanDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** "just now" / "12s ago" / "5m ago" */
export function humanAgo(timestamp: number, now: number): string {
  const delta = now - timestamp;
  if (delta < 2000) return "just now";
  return `${humanDuration(delta)} ago`;
}

export const STATUS_LABEL: Record<string, string> = {
  working: "working",
  needs_you: "needs you",
  done: "done",
  idle: "idle",
};

/** Shortens a home-directory path the way a shell prompt would. */
export function tildePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}
