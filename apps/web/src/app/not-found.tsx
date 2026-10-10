import { ButtonLink, Empty } from "@/components/ui";

export default function NotFound() {
  return (
    <Empty
      title="We couldn't find that page or bill"
      action={
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/obligations">See every bill</ButtonLink>
          <ButtonLink href="/" variant="ghost">
            Home
          </ButtonLink>
        </div>
      }
    >
      Bill links look like <span className="font-mono">/obligations/0x…</span> followed by 64 characters. Check the link, or pick a bill from the list.
    </Empty>
  );
}
