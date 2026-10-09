import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { CONTRACT_URL, GITHUB_URL } from "@/lib/config";
import "./globals.css";

const serif = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Symbolon — Nothing pays until the halves fit", template: "%s · Symbolon" },
  description:
    "A treasury agent for an ERPNext business pays bills in USDC on Arc. A contract releases money only when the approved document and an independent witness fit.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4efe4" },
    { media: "(prefers-color-scheme: dark)", color: "#15140f" },
  ],
};

const NAV = [
  { href: "/break-it", label: "Break it" },
  { href: "/obligations", label: "Obligations" },
  { href: "/refusals", label: "Refusals" },
  { href: "/contracts", label: "Contracts" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-paper focus:p-2">
          Skip to content
        </a>
        <header className="border-b border-ink/80 bg-paper/90">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-baseline gap-2 no-underline">
              <span aria-hidden className="font-mono text-sm text-ink-2">◐◑</span>
              <span className="font-serif text-xl tracking-tight">Symbolon</span>
            </Link>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="text-ink-2 no-underline hover:text-ink hover:underline">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-rule">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4 py-6 text-xs text-ink-2 sm:px-6">
            <p>Arc Testnet (chain 5042002). Every number on this site is read from the chain or the explorer at request time.</p>
            <p className="flex gap-4">
              <a href={GITHUB_URL} className="hover:text-ink">GitHub</a>
              <a href={CONTRACT_URL} className="hover:text-ink">Contract on Arcscan</a>
              <Link href="/api/stats" prefetch={false} className="hover:text-ink">/api/stats</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
