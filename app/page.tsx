import { getParticipant } from "@/lib/session";
import { JoinForm } from "@/components/participant/JoinForm";
import { Wordmark } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ code?: string; withdrawn?: string }> }) {
  const sp = await searchParams;
  const current = await getParticipant().catch(() => null);
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-4 sm:px-8">
      <header className="flex items-center justify-between py-5">
        <Wordmark className="text-2xl" />
        <Link href="/admin" className="text-[15px] font-semibold text-muted hover:text-ink">
          Facilitator sign in
        </Link>
      </header>

      <div className="grid flex-1 items-center gap-10 pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-16">
        <section className="max-w-xl">
          <h1 className="font-display text-[44px] leading-[1.02] font-bold tracking-[-0.025em] sm:text-[64px]" style={{ fontVariationSettings: '"wdth" 88' }}>
            Many voices,
            <br />
            one answer.
          </h1>
          <p className="mt-5 max-w-[34ch] text-[19px] leading-relaxed text-muted">
            Type, talk, snap a photo or record a video. Lofn weaves everyone’s input into a shared answer you can watch take shape.
          </p>
          {sp.withdrawn && (
            <p role="status" className="mt-6 max-w-md rounded-[var(--radius-md)] border border-line bg-surface px-4 py-3 text-[15px]">
              Your consent is withdrawn and your contributions have been deleted.
            </p>
          )}
          <div className="mt-8">
            <JoinForm initialCode={sp.code ?? ""} current={current ? { group: current.group.name, project: current.project.name } : null} />
          </div>
        </section>
        <Threads />
      </div>
    </main>
  );
}

/** Contributions (spruce, varied) converging into one synthesis line (weave). */
function Threads() {
  const starts = [40, 95, 150, 205, 260, 315, 370];
  return (
    <figure className="hidden lg:block" aria-hidden="true">
      <svg viewBox="0 0 520 420" className="w-full">
        {starts.map((y, i) => (
          <g key={i}>
            <path d={`M20 ${y} C 200 ${y}, 250 210, 360 210`} fill="none" stroke="var(--color-spruce)" strokeOpacity={0.25 + (i % 3) * 0.2} strokeWidth={2 + (i % 2)} strokeLinecap="round" />
            <circle cx="20" cy={y} r={i % 3 === 0 ? 7 : 5} fill="var(--color-surface)" stroke="var(--color-spruce)" strokeWidth="2" />
          </g>
        ))}
        <path d="M360 210 H 500" stroke="var(--color-weave)" strokeWidth="9" strokeLinecap="round" />
        <path d="M360 210 H 500" stroke="white" strokeWidth="2" strokeDasharray="6 8" strokeLinecap="round" opacity="0.7" />
        <circle cx="360" cy="210" r="11" fill="var(--color-ink)" />
      </svg>
    </figure>
  );
}
