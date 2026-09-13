"use client";

import { useCallback, useEffect, useState } from "react";
import { humanAgo } from "@/lib/format";

interface Device {
  deviceId: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  tokenHint: string;
}

/** A token exists in the browser only between minting it and dismissing it. */
interface FreshToken {
  label: string;
  token: string;
}

async function callApi(input: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error((body.error as string) ?? `Request failed (${response.status})`);
  }
  return body;
}

export function Devices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<FreshToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  // The setup snippets have to name this deployment's own URL.
  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    try {
      const body = await callApi("/api/devices");
      setDevices((body.devices as Device[]) ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load devices.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = await callApi("/api/devices", {
        method: "POST",
        body: JSON.stringify({ label }),
      });
      setFresh({ label: label.trim() || "unnamed machine", token: body.token as string });
      setLabel("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a device.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: Device) {
    const confirmed = window.confirm(
      `Revoke "${device.label}"? Its hooks stop reporting and its agent stops ` +
        `delivering prompts immediately.`,
    );
    if (!confirmed) return;
    try {
      await callApi(`/api/devices/${device.deviceId}`, { method: "DELETE" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke that device.");
    }
  }

  const now = Date.now();

  return (
    <>
      {error && <div className="banner error">{error}</div>}

      {fresh && (
        <div className="panel">
          <h2>Token for &ldquo;{fresh.label}&rdquo;</h2>
          <p className="sub">
            This is the only time it will be shown &mdash; the server keeps just a
            hash. Copy it now.
          </p>
          <pre className="snippet">{fresh.token}</pre>

          <p className="sub" style={{ marginTop: 16 }}>
            On that machine, run:
          </p>
          <pre className="snippet">{`npx claude-control-agent init \\
  --server ${origin} \\
  --token ${fresh.token}`}</pre>
          <p className="sub" style={{ marginTop: 10 }}>
            That writes the reporting hooks into <code>~/.claude/settings.json</code>{" "}
            and starts the relay agent, which is what lets you send prompts back.
            Run <code>npx claude-control-agent start</code> to keep it running.
          </p>

          <button
            className="btn"
            style={{ marginTop: 14 }}
            onClick={() => setFresh(null)}
          >
            I&rsquo;ve copied it
          </button>
        </div>
      )}

      <div className="panel">
        <h2>Link a machine</h2>
        <p className="sub">
          Each machine gets its own token, used by both its hooks and its relay
          agent. Revoking one does not touch the others.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="work laptop"
            value={label}
            style={{ flex: 1, minWidth: 200 }}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
            }}
          />
          <button className="btn primary" onClick={() => void create()} disabled={busy}>
            {busy ? "Creating…" : "New device"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Linked machines</h2>
        <p className="sub">
          {devices.length === 0
            ? "Nothing linked yet."
            : `${devices.length} machine${devices.length === 1 ? "" : "s"}.`}
        </p>

        {devices.map((device) => (
          <div className="device-row" key={device.deviceId}>
            <span className="dot" data-status={device.lastSeenAt ? "done" : "idle"} />
            <span className="name">{device.label}</span>
            <span className="meta-line">
              …{device.tokenHint} ·{" "}
              {device.lastSeenAt
                ? `last seen ${humanAgo(device.lastSeenAt, now)}`
                : "never connected"}
            </span>
            <span style={{ marginLeft: "auto" }} />
            <button className="btn danger" onClick={() => void revoke(device)}>
              Revoke
            </button>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Manual setup</h2>
        <p className="sub">
          If you would rather not run the agent, these hooks alone give you the
          read-only board. Add them to <code>~/.claude/settings.json</code>, with{" "}
          <code>$CLAUDE_CONTROL_TOKEN</code> exported in your shell.
        </p>
        <pre className="snippet">{hookSnippet(origin)}</pre>
        <p className="sub" style={{ marginTop: 12 }}>
          Every hook ends in <code>|| true</code> on a short timeout, so a network
          problem here can never block or slow a Claude session.
        </p>
      </div>
    </>
  );
}

/** The `~/.claude/settings.json` fragment that drives the read path. */
function hookSnippet(origin: string): string {
  const url = `${origin || "https://your-deployment.vercel.app"}/api/hook`;
  const command =
    `curl -sS -m 3 -X POST ${url} ` +
    `-H "Authorization: Bearer $CLAUDE_CONTROL_TOKEN" ` +
    `-H "Content-Type: application/json" --data-binary @- >/dev/null 2>&1 || true`;

  const events = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "Notification",
    "Stop",
    "SessionEnd",
  ];

  const hooks = Object.fromEntries(
    events.map((event) => [
      event,
      [{ hooks: [{ type: "command", command, timeout: 5 }] }],
    ]),
  );

  return JSON.stringify({ hooks }, null, 2);
}
