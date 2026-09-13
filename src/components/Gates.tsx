/**
 * The two states that stand in front of the dashboard: not signed in, and
 * deployed without the auth configuration that multi-user isolation depends on.
 */

export function SignInPrompt() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Claude Control</h1>
          <span className="tag">sign in</span>
        </div>
      </header>

      <div className="panel">
        <h2>One screen for every Claude session</h2>
        <p className="sub">
          See what each of your parallel Claude Code sessions is doing, and send a
          prompt to any of them from here.
        </p>
        <a className="btn primary" href="/api/auth/signin">
          Sign in to continue
        </a>
      </div>
    </main>
  );
}

export function MisconfiguredNotice() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Claude Control</h1>
          <span className="tag">not configured</span>
        </div>
      </header>

      <div className="banner warn">
        This deployment has no OAuth provider configured. Without one, every
        visitor would share a single namespace and see each other&rsquo;s sessions,
        so the app refuses to serve.
      </div>

      <div className="panel">
        <h2>To fix it</h2>
        <p className="sub">Set these environment variables and redeploy:</p>
        <pre className="snippet">{`AUTH_SECRET=<openssl rand -base64 32>
AUTH_GITHUB_ID=<your GitHub OAuth app id>
AUTH_GITHUB_SECRET=<your GitHub OAuth app secret>`}</pre>
        <p className="sub" style={{ marginTop: 14 }}>
          If this URL is genuinely private and you want the single-user mode
          anyway, set <code>ALLOW_LOCAL_MODE=1</code>.
        </p>
      </div>
    </main>
  );
}
