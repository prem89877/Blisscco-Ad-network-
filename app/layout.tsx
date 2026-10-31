import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { siteBaseUrl } from "@/lib/site";

// Fonts: next/font/google. Build ke waqt Next.js inhe download karke self-host karta hai (browser Google ko call nahi karta).
const display = Space_Grotesk({ subsets: ["latin"], weight: ["600"], variable: "--font-display", display: "swap" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

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
