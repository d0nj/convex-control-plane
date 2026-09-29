import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "./components/SiteHeader";
import "./globals.css";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Convex Control Plane",
  description: "Self-hosted Convex project provisioning for the homelab.",
};

/**
 * Root layout. Renders the persistent header (which shows the signed-in user
 * and team links) around every route. Always dark: this is an ops console, so
 * `dark` is pinned on <html> and :root/.dark carry the same tokens.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable)}>
      <body>
        <SiteHeader />
        <main>{children}</main>
      </body>
    </html>
  );
}
