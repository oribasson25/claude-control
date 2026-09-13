import { Dashboard } from "@/components/Dashboard";
import { authEnabled, currentViewer } from "@/lib/auth";
import { localModeIsUnsafe } from "@/lib/api";
import { MisconfiguredNotice, SignInPrompt } from "@/components/Gates";

/**
 * The board. Auth is resolved on the server so an unauthenticated visitor never
 * receives the dashboard bundle, let alone any session data.
 */

export const dynamic = "force-dynamic";

export default async function Page() {
  if (localModeIsUnsafe()) return <MisconfiguredNotice />;

  const viewer = await currentViewer();
  if (!viewer) return <SignInPrompt />;

  return <Dashboard signOutHref={authEnabled ? "/api/auth/signout" : null} />;
}
