# claude-control-agent

Links one machine to a [Claude Control](../README.md) dashboard.

It does two jobs. It installs the hooks that make every Claude Code session on
this machine report its status, and it runs the relay loop that delivers prompts
you send from the web into those sessions — which nothing in the cloud can do,
since Claude Code has no inbound API.

## Use

This package is not published to npm. Run it from a checkout:

```bash
node agent/bin/claude-control-agent.js init \
  --server https://your-app.vercel.app --token ccd_…
```

Or install the command onto your PATH once, and use `claude-control-agent`
directly from then on:

```bash
cd agent && npm link
```

That verifies the token, saves it to `~/.claude-control/config.json` (mode 0600),
merges the reporting hooks into `~/.claude/settings.json`, and registers the relay
to run in the background — a LaunchAgent on macOS, a systemd user unit on Linux.

Commands (shown as the linked `claude-control-agent`; prefix with
`node agent/bin/claude-control-agent.js` if you did not link it):

| Command | |
|---|---|
| `init` | Link this machine. `--no-hooks` / `--no-service` to skip either half. |
| `start` | Run the relay in the foreground. This is what the service runs. |
| `status` | What is configured, and whether the server still accepts the token. |
| `hooks` | Re-write the reporting hooks. |
| `unlink` | Remove the hooks, the service, and the saved token. |

## What a delivered prompt is allowed to do

This is the part worth reading. The relay runs prompts as you, on your machine,
so its policy lives in the local config file and **the dashboard cannot change
it**:

```json
{
  "permissionMode": "default",
  "allowedTools": [],
  "timeoutMs": 600000
}
```

`default` is the conservative mode: in a headless `-p` run, anything that would
normally ask for approval is refused instead of being allowed. Widen it only
deliberately — `acceptEdits` lets delivered prompts change files without asking.
Setting `allowedTools` restricts them further, to exactly that list.

## Notes

- The hooks it writes are marked with a trailing `# claude-control` comment, so
  `unlink` removes its own and leaves yours untouched. Your `settings.json` is
  backed up before every edit.
- Every hook is a 3-second `curl` ending in `|| true`, so this can never block or
  slow a Claude session.
- `CLAUDE_CONTROL_HOME` relocates the config directory. The agent must otherwise
  share a home directory with the sessions it resumes, since transcripts live
  under `~/.claude/projects`.
- If the server ever rejects the token as revoked, the relay stops rather than
  retrying.
