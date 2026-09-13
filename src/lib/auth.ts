import crypto from "node:crypto";
import NextAuth, { type NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

/**
 * Browser auth.
 *
 * Providers are wired up only when their credentials are present, which gives
 * the app two modes. With OAuth configured it is a real multi-user service. With
 * nothing configured it runs in single-user local mode, so you can clone the
 * repo and see your own sessions without registering an OAuth app first.
 *
 * Local mode is a development convenience and refuses to engage once the app is
 * reachable from anywhere but this machine — see `assertLocalModeIsSafe`.
 */

export const LOCAL_USER_ID = "local";

const providers: NextAuthConfig["providers"] = [];
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(GitHub);
}
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

/** True when at least one OAuth provider is configured. */
export const authEnabled = providers.length > 0;

/**
 * Derives a stable internal userId from an OAuth identity.
 *
 * Hashing rather than storing a mapping keeps the auth path stateless: the same
 * GitHub account always resolves to the same namespace, with no lookup and no
 * chance of a race minting two ids for one person.
 */
function stableUserId(provider: string, providerAccountId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${provider}:${providerAccountId}`)
    .digest("hex")
    .slice(0, 24);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  secret: process.env.AUTH_SECRET ?? "claude-control-local-development-secret",
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    jwt({ token, account }) {
      if (account) {
        token.uid = stableUserId(account.provider, account.providerAccountId);
      }
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
});

export interface Viewer {
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * The signed-in user, or null. In local mode this always returns the single
 * local user, because there is nobody else it could be.
 */
export async function currentViewer(): Promise<Viewer | null> {
  if (!authEnabled) {
    return { userId: LOCAL_USER_ID, name: "Local user", email: null, image: null };
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  return {
    userId,
    name: session.user?.name ?? null,
    email: session.user?.email ?? null,
    image: session.user?.image ?? null,
  };
}
