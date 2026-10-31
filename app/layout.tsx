import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { siteBaseUrl } from "@/lib/site";

// Fonts are files in app/fonts (latin subset, woff2): the build never downloads anything from Google.
// Get the files once with: bash scripts/download-fonts.sh  (then commit app/fonts).
const display = localFont({
  src: [{ path: "./fonts/space-grotesk-latin-600-normal.woff2", weight: "600", style: "normal" }],
  variable: "--font-display",
  display: "swap",
});
const sans = localFont({
  src: [
    { path: "./fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

const TITLE = "Blisscco Online Ad Network";
const DESCRIPTION = "Contextual ads for AI chatbot platforms. Relevant to the conversation, clearly labelled, built for trust.";

export const metadata: Metadata = {
  metadataBase: new URL(siteBaseUrl()),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Blisscco" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};
export const viewport: Viewport = { themeColor: "#0B1020", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-aqua focus:px-4 focus:py-2 focus:font-medium focus:text-ink"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
