import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "./components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Convex Control Plane",
  description: "Self-hosted Convex project provisioning for the homelab.",
};

/**
 * Root layout. Renders the persistent header (which shows the signed-in user
 * and team links) around every route.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
