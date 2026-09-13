import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Control",
  description: "Monitor and drive every parallel Claude Code session from one screen.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
