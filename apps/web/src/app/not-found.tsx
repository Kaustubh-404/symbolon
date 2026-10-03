import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16">
      <p className="font-serif text-2xl">No such page or obligation.</p>
      <p className="mt-2 text-sm text-ink-2">
        Obligation ids are 32-byte hashes, e.g. <span className="font-mono">keccak256(&quot;Purchase Invoice:ACC-PINV-…&quot;)</span>.{" "}
        <Link href="/obligations">See every registered obligation</Link>.
      </p>
    </div>
  );
}
