"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button, Field, Input, Notice } from "@/components/ui";

type Info = { providers: { google: boolean; github: boolean }; firstRun: boolean; needsCode: boolean; signup: string; domains: string[] };

function ProviderButtons({ info, verb }: { info: Info; verb: string }) {
  if (!info.providers.google && !info.providers.github) return null;
  return (
    <div className="space-y-2.5">
      {info.providers.google && (
        <a href="/api/auth/google/start" className="flex h-12 w-full items-center justify-center rounded-[var(--radius-md)] border border-line-strong bg-surface text-[16px] font-semibold hover:border-ink">
          {verb} with Google
        </a>
      )}
      {info.providers.github && (
        <a href="/api/auth/github/start" className="flex h-12 w-full items-center justify-center rounded-[var(--radius-md)] border border-line-strong bg-surface text-[16px] font-semibold hover:border-ink">
          {verb} with GitHub
        </a>
      )}
      <div className="flex items-center gap-3 py-2 text-sm text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or with email
        <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}

export function SignInPanel({ info, error, notice }: { info: Info; error?: string; notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(error ?? null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-5">
      {notice && <Notice tone="tide">{notice}</Notice>}
      <ProviderButtons info={info} verb="Continue" />
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await api("/api/admin/login", { body: { email, password } });
            router.replace("/admin");
            router.refresh();
          } catch (e: any) {
            setErr(e.message);
            setBusy(false);
          }
        }}
      >
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {err && (
          <p role="alert" className="text-[15px] font-medium text-alarm">
            {err}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" busy={busy} className="w-full">
          Sign in
        </Button>
      </form>
      {info.signup !== "closed" && (
        <p className="text-[15px] text-muted">
          New to Lofn?{" "}
          <Link href="/admin/signup" className="font-semibold text-spruce hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </div>
  );
}

export function SignUpPanel({ info }: { info: Info }) {
  const router = useRouter();
  const [v, setV] = useState({ name: "", email: "", password: "", setupCode: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  if (!info.firstRun && info.signup === "closed")
    return <Notice>New accounts are closed on this Lofn. Ask its administrator for access.</Notice>;
  if (pending)
    return (
      <Notice tone="weave">
        <strong>Account created.</strong> An administrator of this Lofn needs to approve it before you can sign in. You’ll be able to sign in with the same email and password once that’s done.
      </Notice>
    );
  return (
    <div className="space-y-5">
      {!info.firstRun && info.signup === "approval" && <Notice className="text-[14.5px]">New accounts are approved by this Lofn’s administrator before they can be used.</Notice>}
      {!info.firstRun && info.signup === "domains" && (
        <Notice className="text-[14.5px]">
          Accounts are limited to {info.domains.map((d) => "@" + d).join(", ")} addresses. Signing up with Google or GitHub is instant; email sign-ups wait for approval.
        </Notice>
      )}
      <ProviderButtons info={info} verb="Sign up" />
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const r = await api("/api/admin/signup", { body: v });
            if (r.status === "pending") {
              setPending(true);
              return;
            }
            router.replace("/admin");
            router.refresh();
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {info.needsCode && (
          <Field label="Setup code" htmlFor="setupCode" hint="Set as SETUP_CODE on the server, so nobody else can claim this installation first.">
            <Input id="setupCode" value={v.setupCode} onChange={(e) => setV({ ...v, setupCode: e.target.value })} autoComplete="off" required />
          </Field>
        )}
        <Field label="Your name" htmlFor="name">
          <Input id="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input id="password" type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" required minLength={10} />
        </Field>
        {err && (
          <p role="alert" className="text-[15px] font-medium text-alarm">
            {err}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" busy={busy} className="w-full">
          Create account
        </Button>
      </form>
      <p className="text-[15px] text-muted">
        Already have an account?{" "}
        <Link href="/admin/login" className="font-semibold text-spruce hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
