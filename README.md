# Claude Control

One screen for every Claude Code session you have running — and a prompt box for
each of them.

You keep several editor windows open, each with Claude working on a different
project, and you tab between them to find out what happened. This replaces that
with a board: a card per session showing whether it is **working**, **needs you**,
or is **done**, what it is doing right now, and a box to send it its next prompt
from wherever you are.

---

## How it works

There are two paths through the system, and they are not symmetric.

**Reading** is ordinary. Hooks in `~/.claude/settings.json` fire on every session
lifecycle event and POST them to the app, which folds them into a small state
blob per session. The browser polls for the current board.

```
VS Code hooks ──POST /api/hook──► app ──► store ──poll /api/sessions──► browser
```

**Writing** cannot be done from the cloud at all. Claude Code has no inbound API —
hooks are outbound only — so nothing running on a server can talk to a session on
your laptop. The only thing that can is a process on that same machine. So
prompts go into a queue, and a small **relay agent** you run locally pulls them
and replays them with `claude -p --resume <session_id>`, which continues that
exact conversation.

```
browser ──POST /api/prompt──► outbox ──poll /api/outbox──► relay agent
                                                                │
                                          claude -p --resume <id>┘
                                                                │
                              new hook events flow back out the read path
```

That asymmetry is the whole shape of the system. Everything else follows from it.

---

## Running it locally

```bash
npm install
npm run dev
```

That is all. With no `KV_REST_API_URL` set the app keeps state in a JSON file
under `.claude-control-data/`, and with no OAuth credentials set it runs in
single-user mode — so there is nothing to sign up for before you can see it work.

Then open <http://localhost:3000>, go to **Devices**, mint a token, and on the
same machine run what the page shows you:

```bash
npx claude-control-agent init --server http://localhost:3000 --token ccd_…
```

Restart your Claude sessions and they appear on the board.

---

## Deploying to Vercel

Three things change when it goes online, and all three are load-bearing.

**1. State moves to Upstash.** Serverless functions are separate processes with
no shared memory, so an in-process cache would lose a session between the hook
that created it and the poll that reads it. Install the Upstash Redis integration
from the Vercel Marketplace; it injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`
and the app switches backends on its own. Upstash speaks HTTP rather than the
Redis wire protocol, which is what makes it usable from a function that cannot
hold a socket open.

**2. Auth becomes mandatory.** Configure at least one OAuth provider:

```
AUTH_SECRET=<openssl rand -base64 32>
AUTH_GITHUB_ID=…
AUTH_GITHUB_SECRET=…
```

Without one, the app refuses to serve from a deployed URL rather than quietly
putting every visitor in the same namespace. If the URL is genuinely private and
you want single-user mode anyway, set `ALLOW_LOCAL_MODE=1` — deliberately, not by
accident.

**3. Each machine gets its own token.** Mint one per machine on the Devices page.
A token is shown once and stored only as a SHA-256 hash; revoking it stops that
machine's hooks and its relay agent immediately, and touches no other machine.

```bash
vercel deploy
```

---

## What it does not do

Three limits worth knowing before you build on this, because they come from
Claude Code itself rather than from this app.

**You are not typing into the live chat panel.** `claude -p --resume <id>`
continues the same *conversation*, headlessly. Results come back through the
hooks, so the board updates — but the extension window in front of you is not
what ran it.

**Prompts to a busy session wait.** `--resume` attaches to a session that has
finished its turn, not one mid-run. A prompt sent to a working session is held
and delivered when it goes idle. The server enforces this, so the card's
*queued* badge is the truth rather than a guess.

**A session must report before you can prompt it.** The write path addresses
sessions by the `session_id` the read path captured. No hook event, no card, no
prompt box.

---

## Security

This system lets a web page cause an AI to run code on your machine. It is built
to be treated that way.

- **Prompting is off per session by default.** The switch on each card is the
  last gate, and only its owner can turn it on.
- **The relay's policy is local.** Delivered prompts run under the
  `permissionMode` and `allowedTools` in `~/.claude-control/config.json`, which
  the dashboard cannot read or change. The default is `default` — in a headless
  run, anything that would need approval is refused rather than allowed.
- **Tokens are stored hashed** and shown once. `/api/hook` and `/api/outbox`
  derive the user from the token; no route ever takes a user id from a request
  body.
- **Hooks cannot block a session.** Every hook is a 3-second `curl` with its
  output discarded and `|| true` on the end.
- **Optional HMAC.** Set `REQUIRE_HOOK_SIGNATURE=1` to reject events that are not
  signed with the device token.

---

## Layout

| Path | What lives there |
|---|---|
| `src/app/api/hook` | Ingest: one hook event → session state |
| `src/app/api/sessions` | The board's polling endpoint |
| `src/app/api/prompt` | Queue a prompt (permission gate lives here) |
| `src/app/api/outbox` | The relay's pull endpoint (deliver-on-idle lives here) |
| `src/lib/derive.ts` | Hook events → status and activity strings |
| `src/lib/kv.ts` | Backend selection: Upstash or local file |
| `src/lib/keys.ts` | The key namespace, and with it the tenant boundary |
| `agent/` | The relay agent, published as `claude-control-agent` |
