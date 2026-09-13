import Link from "next/link";
import { currentViewer } from "@/lib/auth";
import { localModeIsUnsafe } from "@/lib/api";
import { MisconfiguredNotice, SignInPrompt } from "@/components/Gates";
import { Devices } from "@/components/Devices";

/** Device tokens: link a machine, see what is connected, revoke access. */

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (localModeIsUnsafe()) return <MisconfiguredNotice />;

  const viewer = await currentViewer();
  if (!viewer) return <SignInPrompt />;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Devices</h1>
          <span className="tag">one token per machine</span>
        </div>
        <Link className="btn" href="/">
          Back to board
        </Link>
      </header>

      <Devices />
    </main>
  );
}
