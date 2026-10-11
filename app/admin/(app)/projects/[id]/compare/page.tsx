"use client";
import { Suspense, use, useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetcher } from "@/lib/client/api";
import { AnswerPanel, type AnswerView } from "@/components/AnswerPanel";
import { Empty, Spinner, cx } from "@/components/ui";

type Data = {
  cycles: { id: string; name: string; status: string }[];
  questions: { id: string; title: string }[];
  groups: { id: string; name: string }[];
  cycleId: string | null;
  answers: AnswerView[];
};

export default function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Spinner className="size-6 text-spruce" />}>
      <Compare id={id} />
    </Suspense>
  );
}

function Compare({ id }: { id: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const [cycle, setCycle] = useState<string | null>(sp.get("cycle"));
  const [question, setQuestion] = useState<string | null>(sp.get("question"));
  const { data } = useSWR<Data>(`/api/admin/projects/${id}/compare${cycle ? `?cycle=${cycle}` : ""}`, fetcher, { keepPreviousData: true });
  const q = data?.questions.find((x) => x.id === question) ?? data?.questions[0];
  useEffect(() => {
    if (data && q) router.replace(`/admin/projects/${id}/compare?cycle=${data.cycleId ?? ""}&question=${q.id}`, { scroll: false });
  }, [data?.cycleId, q?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Spinner className="size-6 text-spruce" />;
  if (!data.cycleId || !q) return <Empty title="Nothing to compare yet">Start a cycle; once groups contribute, their answers appear here side by side.</Empty>;
  const answers = data.answers.filter((a) => a.questionId === q.id);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="font-display text-xl font-semibold">Compare groups</h2>
          <p className="text-[15px] text-muted">How each group answered the same question.</p>
        </div>
        <label className="text-sm">
          <span className="mr-2 text-muted">Cycle</span>
          <select value={data.cycleId} onChange={(e) => setCycle(e.target.value)} className="rounded-md border border-line-strong bg-surface px-2 py-1.5 font-semibold">
            {data.cycles.filter((c) => c.status !== "draft").map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <Link href={`/admin/projects/${id}/results?cycle=${data.cycleId}`} className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-weave px-4 text-[15px] font-semibold text-white hover:bg-weave-deep">
          Synthesise across groups
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {data.questions.map((qq, i) => (
          <button key={qq.id} onClick={() => setQuestion(qq.id)} aria-pressed={qq.id === q.id} className={cx("max-w-sm truncate rounded-full border px-3 py-1 text-[14px]", qq.id === q.id ? "border-ink bg-ink text-white" : "border-line-strong bg-surface")}>
            <span className="font-semibold">{i + 1}</span> {qq.title}
          </button>
        ))}
      </div>
      <h3 className="mt-5 max-w-[60ch] font-display text-[22px] leading-snug font-bold">{q.title}</h3>
      {answers.length === 0 ? (
        <p className="mt-4 text-muted">No group has this question in the selected cycle.</p>
      ) : (
        <div className="-mx-4 mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
          {answers.map((a) => {
            const g = data.groups.find((x) => x.id === a.groupId);
            return (
              <div key={a.id} className="w-[86vw] max-w-[440px] shrink-0 snap-start sm:w-[400px]">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-display text-[17px] font-semibold">{g?.name}</p>
                  <Link href={`/admin/projects/${id}/answers/${a.id}`} className="text-sm font-semibold text-spruce hover:underline">
                    Details
                  </Link>
                </div>
                <AnswerPanel answer={a} versionsUrl={`/api/admin/answers/${a.id}/versions`} onRef={() => router.push(`/admin/projects/${id}/answers/${a.id}`)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
