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

const NAV: { href: string; label: string; wide?: boolean }[] = [
  { href: "/break-it", label: "Break it" },
  { href: "/obligations", label: "Bills" },
  { href: "/refusals", label: "Refusals" },
  { href: "/contracts", label: "How it's wired", wide: true },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between gap-x-4 px-4 py-2 sm:px-6">
            <Link href="/" className="flex min-h-11 items-center gap-2 no-underline" aria-label="Symbolon home">
              <Mark />
              <span className="hidden font-serif text-xl tracking-tight min-[480px]:inline">Symbolon</span>
            </Link>
            <div className="flex min-w-0 items-center gap-x-1 text-sm">
              <ul className="-mx-1 flex min-w-0 items-center gap-x-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none]">
                {NAV.map((n) => (
                  <li key={n.href} className={n.wide ? "hidden sm:block" : undefined}>
                    <Link href={n.href} className="inline-flex min-h-11 items-center rounded-full px-2.5 text-ink-2 no-underline transition hover:bg-paper-2 hover:text-ink sm:px-3">
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/try" className="ml-1 inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full bg-ink px-4 font-semibold text-paper no-underline transition hover:bg-ink/85 active:scale-[0.97]">
                Try it
              </Link>
            </div>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-6xl overflow-x-clip px-4 py-10 sm:px-6 sm:py-14">
          {children}
        </main>
        <footer className="mt-10 border-t border-rule">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 text-xs text-ink-2 sm:grid-cols-[1fr_auto] sm:px-6">
            <p className="max-w-xl">
              Runs on Arc Testnet (chain 5042002) with test USDC. Every number on this site is read from the chain or the block
              explorer when you load the page. Nothing here is hard-coded.
            </p>
            <p className="flex flex-wrap gap-x-4 gap-y-1">
              <a href={GITHUB_URL} className="hover:text-ink">Source on GitHub</a>
              <a href={CONTRACT_URL} className="hover:text-ink">Contract on Arcscan</a>
              <Link href="/contracts" className="hover:text-ink">How it&apos;s wired</Link>
              <Link href="/api/stats" prefetch={false} className="hover:text-ink">Raw data (JSON)</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

/** Two halves of a broken token that fit: the brand mark. */
function Mark() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 22 22" className="text-ink">
      <path d="M11 2a9 9 0 0 0 0 18l-2-3 2-3-2-3 2-3-2-3z" fill="currentColor" />
      <path d="M11 2a9 9 0 0 1 0 18l-2-3 2-3-2-3 2-3-2-3z" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
