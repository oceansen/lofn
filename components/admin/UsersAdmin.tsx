"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { api, fetcher, timeAgo, useNow } from "@/lib/client/api";
import { Button, Input, Modal, Notice, Pill, Spinner, cx } from "@/components/ui";

type U = {
  id: string; email: string; name: string; role: "admin" | "member"; status: "active" | "pending" | "disabled";
  createdAt: string; lastLoginAt: string | null; hasPassword: boolean; providers: string[]; projects: number;
};
type Data = {
  me: string;
  users: U[];
  policy: { mode: "open" | "approval" | "domains" | "closed"; domains: string[] };
  providers: { google: boolean; github: boolean };
  callbackUrls: { google: string; github: string };
};

const MODES: { mode: Data["policy"]["mode"]; label: string; help: string }[] = [
  { mode: "open", label: "Anyone can sign up", help: "New accounts work straight away." },
  { mode: "approval", label: "Sign-ups need approval", help: "New accounts wait until an administrator approves them." },
  { mode: "domains", label: "Only my organisation", help: "Google/GitHub sign-ups with a verified address on these domains work straight away; email sign-ups wait for approval." },
  { mode: "closed", label: "No new accounts", help: "Only existing accounts can sign in." },
];

export function UsersAdmin() {
  const { data, mutate } = useSWR<Data>("/api/admin/users", fetcher);
  const now = useNow(30_000);
  const [mode, setMode] = useState<Data["policy"]["mode"]>("open");
  const [domains, setDomains] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<U | null>(null);
  useEffect(() => {
    if (data) {
      setMode(data.policy.mode);
      setDomains(data.policy.domains.join(", "));
    }
  }, [data?.policy.mode, data?.policy.domains.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><Spinner className="size-6 text-spruce" /></main>;

  async function savePolicy() {
    setBusy("policy");
    setMsg(null);
    try {
      await api("/api/admin/signup-policy", { method: "PUT", body: { mode, domains: domains.split(/[,\s]+/).filter(Boolean) } });
      setMsg({ ok: true, text: "Saved." });
      mutate();
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }
  async function patch(u: U, body: Partial<Pick<U, "role" | "status">>) {
    setBusy(u.id);
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(null);
      mutate();
    }
  }
  const pending = data.users.filter((u) => u.status === "pending").length;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-[34px] leading-tight font-bold">Users</h1>
      <p className="mt-1 max-w-[65ch] text-muted">
        Everyone with an account can create their own projects; each person sees only their own. Administrators also manage users and the AI models, which run on this server’s API keys.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-semibold">
            Accounts <span className="text-sm font-medium text-muted">{data.users.length}</span>
            {pending > 0 && <Pill tone="tide">{pending} waiting for approval</Pill>}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface">
            {data.users.map((u) => (
              <li key={u.id} className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", u.status === "pending" && "bg-tide-wash/50")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-spruce-wash font-display font-bold text-spruce-deep" aria-hidden="true">
                  {(u.name || u.email)[0]?.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate font-semibold">
                    {u.name || u.email.split("@")[0]}
                    {u.id === data.me && <span className="ml-1.5 text-sm font-normal text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-[13.5px] text-muted">
                    {u.email}, {[u.hasPassword && "password", ...u.providers.map((p) => (p === "google" ? "Google" : "GitHub"))].filter(Boolean).join(" + ")}
                  </p>
                  <p className="text-[12.5px] text-faint">
                    {u.projects} project{u.projects === 1 ? "" : "s"}, last sign-in {u.lastLoginAt ? timeAgo(u.lastLoginAt, now) : "never"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {u.role === "admin" && <Pill tone="weave">Administrator</Pill>}
                  {u.status === "pending" && <Pill tone="tide">Waiting</Pill>}
                  {u.status === "disabled" && <Pill tone="alarm">Disabled</Pill>}
                  {u.id !== data.me && (
                    <>
                      {u.status === "pending" && (
                        <Button size="sm" variant="primary" busy={busy === u.id} onClick={() => patch(u, { status: "active" })}>
                          Approve
                        </Button>
                      )}
                      {u.status === "disabled" && (
                        <Button size="sm" busy={busy === u.id} onClick={() => patch(u, { status: "active" })}>
                          Enable
                        </Button>
                      )}
                      {u.status === "active" && (
                        <Button size="sm" variant="ghost" busy={busy === u.id} onClick={() => patch(u, { status: "disabled" })}>
                          Disable
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => patch(u, { role: u.role === "admin" ? "member" : "admin" })}>
                        {u.role === "admin" ? "Remove admin" : "Make admin"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-alarm" onClick={() => setDel(u)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {msg && !msg.ok && <p className="mt-2 text-sm text-alarm">{msg.text}</p>}
        </section>

        <div className="space-y-6 lg:self-start">
          <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
            <h2 className="font-display text-lg font-semibold">Who can create an account</h2>
            <fieldset className="mt-3 space-y-2">
              <legend className="sr-only">Sign-up policy</legend>
              {MODES.map((m) => (
                <label key={m.mode} className={cx("flex cursor-pointer gap-3 rounded-[var(--radius-md)] border px-3 py-2.5", mode === m.mode ? "border-spruce bg-spruce-wash" : "border-line")}>
                  <input type="radio" name="mode" checked={mode === m.mode} onChange={() => setMode(m.mode)} className="mt-1 accent-[var(--color-spruce)]" />
                  <span>
                    <span className="block font-semibold">{m.label}</span>
                    <span className="block text-[13.5px] text-muted">{m.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {mode === "domains" && (
              <label className="mt-3 block text-[15px] font-semibold">
                Email domains
                <Input className="mt-1.5 font-normal" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="sintef.no, ntnu.no" />
              </label>
            )}
            <div className="mt-4 flex items-center gap-3">
              <Button variant="primary" onClick={savePolicy} busy={busy === "policy"}>
                Save
              </Button>
              {msg?.ok && <span className="text-sm font-semibold text-spruce">{msg.text}</span>}
            </div>
            {mode === "open" && (
              <p className="mt-3 text-[13px] text-muted">Anyone who finds this site can create projects that use your AI keys. Consider “Only my organisation” for a public server.</p>
            )}
          </section>

          <section className="rounded-[var(--radius-lg)] border border-line bg-surface p-5">
            <h2 className="font-display text-lg font-semibold">Google and GitHub sign-in</h2>
            <ul className="mt-2 space-y-3 text-[14.5px]">
              {(["google", "github"] as const).map((p) => (
                <li key={p}>
                  <p className="flex items-center gap-2 font-semibold">
                    {p === "google" ? "Google" : "GitHub"} {data.providers[p] ? <Pill tone="spruce">On</Pill> : <Pill>Not set up</Pill>}
                  </p>
                  {!data.providers[p] && (
                    <p className="text-[13.5px] text-muted">
                      Set <code>{p.toUpperCase()}_CLIENT_ID</code> and <code>{p.toUpperCase()}_CLIENT_SECRET</code> on the server, with this callback URL:
                    </p>
                  )}
                  <code className="mt-1 block rounded bg-ink/5 px-2 py-1 text-[12.5px] break-all">{data.callbackUrls[p]}</code>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <Modal open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.name || del?.email}?`}>
        <p>Their account and all {del?.projects ?? 0} of their projects, including contributions and media, are deleted permanently.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setDel(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={async () => {
              await api(`/api/admin/users/${del!.id}`, { method: "DELETE" }).catch((e) => setMsg({ ok: false, text: e.message }));
              setDel(null);
              mutate();
            }}
          >
            Delete account
          </Button>
        </div>
      </Modal>
    </main>
  );
}
