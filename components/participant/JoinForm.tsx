"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button, Input } from "@/components/ui";

function format(v: string) {
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export function JoinForm({ initialCode, current }: { initialCode: string; current: { group: string; project: string } | null }) {
  const router = useRouter();
  const [code, setCode] = useState(format(initialCode));
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = code.replace("-", "").length === 8;

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!complete) {
      setError("Enter all 8 characters of your group code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/p/join", { body: { code, name } });
      router.push("/g");
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {current && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-spruce/30 bg-spruce-wash px-4 py-3">
          <p className="mr-auto text-[15px]">
            You’re in <strong>{current.group}</strong> for {current.project}.
          </p>
          <Button variant="primary" size="sm" onClick={() => router.push("/g")}>
            Continue
          </Button>
        </div>
      )}
      <form onSubmit={join} className="space-y-4" noValidate>
        <div>
          <label htmlFor="code" className="block text-[15px] font-semibold">
            Group code
          </label>
          <p id="code-hint" className="text-sm text-muted">
            From your facilitator. No account needed.
          </p>
          <input
            id="code"
            value={code}
            onChange={(e) => {
              setCode(format(e.target.value));
              setError(null);
            }}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            aria-describedby="code-hint code-error"
            aria-invalid={!!error}
            className="mt-2 h-16 w-full max-w-sm rounded-[var(--radius-md)] border-2 border-ink bg-surface px-4 text-center font-display text-[32px] font-bold tracking-[0.18em] tabular placeholder:text-line-strong focus:border-spruce focus:outline-none focus:ring-4 focus:ring-spruce/20"
          />
        </div>
        <div className="max-w-sm">
          <label htmlFor="name" className="block text-[15px] font-semibold">
            Your name <span className="font-normal text-muted">(optional)</span>
          </label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Shown to your group and facilitator" className="mt-1.5" />
        </div>
        {error && (
          <p id="code-error" role="alert" className="text-[15px] font-medium text-alarm">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" busy={busy} className="w-full max-w-sm">
          Join group
        </Button>
      </form>
    </div>
  );
}
