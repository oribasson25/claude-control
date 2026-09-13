"use client";

import { useState } from "react";
import type { OutboxItem, SessionState } from "@/lib/types";
import { humanAgo, humanDuration, STATUS_LABEL, tildePath } from "@/lib/format";
import { Spinner } from "./Spinner";

interface Props {
  session: SessionState;
  /** Undelivered prompts aimed at this session, oldest first. */
  queued: OutboxItem[];
  now: number;
  onTogglePrompts: (sessionId: string, allowed: boolean) => Promise<void>;
  onSendPrompt: (sessionId: string, text: string) => Promise<void>;
  onCancelPrompt: (itemId: string) => Promise<void>;
  onDismiss: (sessionId: string) => Promise<void>;
}

export function SessionCard({
  session,
  queued,
  now,
  onTogglePrompts,
  onSendPrompt,
  onCancelPrompt,
  onDismiss,
}: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSendPrompt(session.sessionId, text);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not queue that prompt.");
    } finally {
      setSending(false);
    }
  }

  // A session mid-turn can't be resumed, so say plainly that the prompt will wait.
  const willQueue = session.status === "working" || session.status === "needs_you";

  return (
    <article className="card" data-status={session.status}>
      <header className="card-head">
        <span className="dot" data-status={session.status} />
        <h2 title={session.cwd}>{session.project}</h2>
        <span className="state-label" data-status={session.status}>
          {STATUS_LABEL[session.status] ?? session.status}
        </span>
      </header>

      <div className="activity">
        {session.status === "working" && <Spinner />}
        <span>{session.activity}</span>
      </div>

      <div className="meta-line" title={session.cwd}>
        {session.deviceLabel} ·{" "}
        {session.cwd ? (
          // Jumps back to the window this card is about. Only resolves on the
          // machine the session is actually running on, which is the common case
          // for a dashboard open on a second monitor.
          <a href={`vscode://file/${session.cwd}`} title="Open this project in VS Code">
            {tildePath(session.cwd)}
          </a>
        ) : (
          "unknown path"
        )}
      </div>

      {session.lastPrompt && <div className="quote">{session.lastPrompt}</div>}

      {queued.length > 0 && (
        <div className="queued-list">
          {queued.map((item) => (
            <div className="queued-item" key={item.id}>
              <span title={item.text}>
                {item.status === "claimed" ? "delivering" : "queued"}: {item.text}
              </span>
              <button
                className="btn ghost"
                onClick={() => void onCancelPrompt(item.id)}
                title="Cancel this prompt"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {session.promptsAllowed && (
        <div className="promptbox">
          <textarea
            rows={2}
            value={draft}
            placeholder={
              willQueue ? "Queue a prompt for when it finishes…" : "Send a prompt…"
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline, as in the editor itself.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="row">
            <span className="hint">
              {willQueue ? "delivers when idle" : "⏎ to send"}
            </span>
            <span className="spacer" style={{ marginLeft: "auto" }} />
            <button
              className="btn primary"
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
            >
              {sending ? "Queueing…" : "Send"}
            </button>
          </div>
          {error && <span className="hint" style={{ color: "var(--danger)" }}>{error}</span>}
        </div>
      )}

      <footer className="card-foot">
        <span>{session.toolCount} tools</span>
        <span>·</span>
        <span>{humanDuration(session.updatedAt - session.startedAt)}</span>
        <span>·</span>
        <span>{humanAgo(session.updatedAt, now)}</span>

        <span className="spacer" />

        <label className="switch" title="Allow prompts to be sent to this session">
          <input
            type="checkbox"
            checked={session.promptsAllowed}
            onChange={(event) =>
              void onTogglePrompts(session.sessionId, event.target.checked)
            }
          />
          prompt
        </label>

        <button
          className="btn ghost"
          onClick={() => void onDismiss(session.sessionId)}
          title="Remove this card from the board"
        >
          ✕
        </button>
      </footer>
    </article>
  );
}
