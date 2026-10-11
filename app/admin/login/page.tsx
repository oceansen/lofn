import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/session";
import { one } from "@/lib/db";
import { LoginForm } from "@/components/admin/LoginForm";
import { Wordmark } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Facilitator sign in" };

export default async function LoginPage() {
  if (await getAdmin()) redirect("/admin");
  const n = await one(`SELECT count(*)::int AS n FROM admins`);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
      <Link href="/" className="self-start">
        <Wordmark className="text-xl" />
      </Link>
      <div className="flex flex-1 flex-col justify-center pb-20">
        <h1 className="font-display text-[34px] leading-tight font-bold">{n.n === 0 ? "Set up Lofn" : "Facilitator sign in"}</h1>
        <p className="mt-2 text-muted">
          {n.n === 0 ? "Create the first administrator account. You can add more later from the command line." : "Manage projects, groups and live sessions."}
        </p>
        <div className="mt-7">
          <LoginForm setup={n.n === 0} />
        </div>
      </div>
    </main>
  );
}
