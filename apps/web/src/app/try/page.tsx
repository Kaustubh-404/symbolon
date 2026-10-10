import type { Metadata } from "next";
import Link from "next/link";
import { PageHead } from "@/components/Page";
import { TryForm } from "./TryForm";

export const metadata: Metadata = { title: "Try it yourself" };

export default function TryPage() {
  return (
    <>
      <PageHead kicker="Try it yourself" title="Send a bill and watch it get paid, or refused">
        <p>
          Your bill goes into our company&apos;s real accounting software, exactly as an accountant would enter it. Then the AI decides, Circle sends
          the money, an independent witness confirms it, and the contract pays or refuses. Every step is a real transaction you can open.
        </p>
        <p>
          Prefer to see it refuse? Try to trick it in the supplier&apos;s note, or <Link href="/break-it">try to break it</Link>.
        </p>
      </PageHead>
      <TryForm />
    </>
  );
}
