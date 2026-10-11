"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button, Field, Input } from "@/components/ui";

export function LoginForm({ setup, needsCode }: { setup: boolean; needsCode?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(setup ? "/api/admin/setup" : "/api/admin/login", { body: setup ? { email, password, name, setupCode } : { email, password } });
      router.replace("/admin");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {needsCode && (
        <Field label="Setup code" htmlFor="setupCode" hint="Set as SETUP_CODE on the server, so nobody else can claim this installation.">
          <Input id="setupCode" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="off" required />
        </Field>
      )}
      {setup && (
        <Field label="Your name" htmlFor="name">
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
      )}
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" hint={setup ? "At least 10 characters." : undefined}>
        <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} required />
      </Field>
      {error && (
        <p role="alert" className="text-[15px] font-medium text-alarm">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" size="lg" busy={busy} className="w-full">
        {setup ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}
