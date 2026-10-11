"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { Button, Input, Modal } from "@/components/ui";

export type CycleV = {
  id: string;
  name: string;
  note: string;
  status: "draft" | "running" | "paused" | "ended";
  durationMs: number;
  carryForward: boolean;
  startedAt: string | null;
  endsAt: string | null;
  remainingMs: number;
  endedAt: string | null;
  nextSynthesisAt: string | null;
  finalStatus: string;
};

export function CycleControls({ cycle, onChange, size = "md" }: { cycle: CycleV; onChange?: () => void; size?: "sm" | "md" }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState<null | "extend" | "reopen">(null);
  const [mins, setMins] = useState(5);
  const [confirmEnd, setConfirmEnd] = useState(false);

  async function act(action: string, minutes?: number) {
    setBusy(action);
    setError(null);
    try {
      await api(`/api/admin/cycles/${cycle.id}/control`, { body: { action, minutes } });
      onChange?.();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const s = size;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {cycle.status === "draft" && (
          <Button size={s} variant="primary" busy={busy === "start"} onClick={() => act("start")}>
            Start cycle
          </Button>
        )}
        {cycle.status === "running" && (
          <Button size={s} busy={busy === "pause"} onClick={() => act("pause")}>
            Pause
          </Button>
        )}
        {cycle.status === "paused" && (
          <Button size={s} variant="primary" busy={busy === "resume"} onClick={() => act("resume")}>
            Resume
          </Button>
        )}
        {(cycle.status === "running" || cycle.status === "paused") && (
          <>
            <Button size={s} variant="ghost" busy={busy === "extend"} onClick={() => act("extend", 5)}>
              +5 min
            </Button>
            <Button size={s} variant="ghost" onClick={() => act("extend", 10)}>
              +10 min
            </Button>
            <Button size={s} variant="ghost" onClick={() => setCustom("extend")}>
              Extend…
            </Button>
            <Button size={s} variant="danger" busy={busy === "end"} onClick={() => setConfirmEnd(true)}>
              End now
            </Button>
          </>
        )}
        {cycle.status === "ended" && (
          <Button size={s} variant="ghost" onClick={() => setCustom("reopen")}>
            Reopen…
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-alarm">
          {error}
        </p>
      )}
      <Modal open={!!custom} onClose={() => setCustom(null)} title={custom === "reopen" ? "Reopen this cycle" : "Add time"}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await act(custom!, mins);
            setCustom(null);
          }}
          className="space-y-4"
        >
          <p className="text-[15px] text-muted">
            {custom === "reopen" ? "Participants can contribute again, and answers will be refined and finalised again when it ends." : "Every participant’s countdown updates immediately."}
          </p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 5, 10, 15, 30].map((m) => (
              <Button key={m} type="button" size="sm" variant={mins === m ? "primary" : "secondary"} onClick={() => setMins(m)}>
                {m} min
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[15px]">
            Custom
            <Input type="number" min={1} max={1440} value={mins} onChange={(e) => setMins(Math.max(1, Number(e.target.value) || 1))} className="w-24" />
            minutes
          </label>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" busy={!!busy}>
              {custom === "reopen" ? `Reopen for ${mins} min` : `Add ${mins} min`}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End the cycle now?">
        <p>Contributions close for everyone immediately and Lofn writes the final answers.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setConfirmEnd(false)}>Keep going</Button>
          <Button
            variant="danger"
            onClick={async () => {
              setConfirmEnd(false);
              await act("end");
            }}
          >
            End cycle
          </Button>
        </div>
      </Modal>
    </div>
  );
}
