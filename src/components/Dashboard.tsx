"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { OutboxItem, SessionState } from "@/lib/types";
import { SessionCard } from "./SessionCard";

interface Payload {
  sessions: SessionState[];
  outbox: OutboxItem[];
  viewer: { name: string | null; email: string | null; image: string | null };
  meta: { backend: string; authEnabled: boolean; now: number };
}

/** How often the board refreshes while the tab is in front. */
const POLL_MS = 1500;

async function callApi(input: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export function Dashboard({ signOutHref }: { signOutHref: string | null }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Held in a ref so the polling loop never restarts when a fetch resolves.
  const stopped = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const payload = (await callApi("/api/sessions")) as Payload;
      setData(payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach the server.");
    }
  }, []);

  // One self-rescheduling loop rather than an interval, so a slow response can
  // never stack requests on top of each other.
  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped.current) return;
      // Polling is this app's main cost driver; a hidden tab does not need it.
      if (document.visibilityState === "visible") await refresh();
      if (!stopped.current) timer = setTimeout(tick, POLL_MS);
    };

    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped.current = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // Drives the "12s ago" footers between polls.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);

  const counts = useMemo(() => {
    const tally = { working: 0, needs_you: 0, done: 0, idle: 0 };
    for (const session of sessions) tally[session.status] += 1;
    return tally;
  }, [sessions]);

  // The whole point of a second-monitor dashboard: the tab title carries the
  // one number you care about when you are not looking at it.
  useEffect(() => {
    document.title = counts.needs_you
      ? `(${counts.needs_you}) Claude Control`
      : "Claude Control";
  }, [counts.needs_you]);

  const queuedBySession = useMemo(() => {
    const map = new Map<string, OutboxItem[]>();
    for (const item of data?.outbox ?? []) {
      const list = map.get(item.sessionId) ?? [];
      list.push(item);
      map.set(item.sessionId, list);
    }
    return map;
  }, [data]);

  const togglePrompts = useCallback(
    async (sessionId: string, allowed: boolean) => {
      // Optimistic: the switch should not lag a poll behind the click.
      setData((current) =>
        current
          ? {
              ...current,
              sessions: current.sessions.map((s) =>
                s.sessionId === sessionId ? { ...s, promptsAllowed: allowed } : s,
              ),
            }
          : current,
      );
      await callApi(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ promptsAllowed: allowed }),
      });
      await refresh();
    },
    [refresh],
  );

  const sendPrompt = useCallback(
    async (sessionId: string, text: string) => {
      await callApi("/api/prompt", {
        method: "POST",
        body: JSON.stringify({ sessionId, text }),
      });
      await refresh();
    },
    [refresh],
  );

  const cancelPrompt = useCallback(
    async (itemId: string) => {
      await callApi(`/api/prompt?id=${encodeURIComponent(itemId)}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  const dismiss = useCallback(
    async (sessionId: string) => {
      await callApi(`/api/sessions/${sessionId}`, { method: "DELETE" });
      await refresh();
    },
    [refresh],
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Claude Control</h1>
          <span className="tag">{data?.meta.backend ?? "connecting…"}</span>
        </div>

        <div className="counters">
          <span className={`counter${counts.needs_you ? " is-hot" : ""}`}>
            <span className="dot" data-status="needs_you" />
            <b>{counts.needs_you}</b> need you
          </span>
          <span className="counter">
            <span className="dot" data-status="working" />
            <b>{counts.working}</b> working
          </span>
          <span className="counter">
            <span className="dot" data-status="done" />
            <b>{counts.done}</b> done
          </span>
        </div>

        <Link className="btn" href="/settings">
          Devices
        </Link>
        {signOutHref && (
          <a className="btn ghost" href={signOutHref}>
            Sign out
          </a>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}

      <div className="board">
        {sessions.length === 0 && !error && (
          <div className="empty">
            <h2>No sessions reporting yet</h2>
            <p>
              Link a machine on the <Link href="/settings">Devices</Link> page, then
              start or continue a Claude Code session. Cards appear as soon as the
              first hook fires.
            </p>
          </div>
        )}

        {sessions.map((session) => (
          <SessionCard
            key={session.sessionId}
            session={session}
            queued={queuedBySession.get(session.sessionId) ?? []}
            now={now}
            onTogglePrompts={togglePrompts}
            onSendPrompt={sendPrompt}
            onCancelPrompt={cancelPrompt}
            onDismiss={dismiss}
          />
        ))}
      </div>
    </main>
  );
}
