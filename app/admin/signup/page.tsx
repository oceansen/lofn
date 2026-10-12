import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdmin } from "@/lib/session";
import { authInfo } from "@/lib/auth-info";
import { SignUpPanel } from "@/components/admin/AuthPanel";
import { Wordmark } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create an account" };

export default async function SignupPage() {
  if (await getAdmin()) redirect("/admin");
  const info = await authInfo();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
      <Link href="/" className="self-start">
        <Wordmark className="text-xl" />
      </Link>
      <div className="flex flex-1 flex-col justify-center pb-16">
        <h1 className="font-display text-[34px] leading-tight font-bold">{info.firstRun ? "Set up Lofn" : "Create an account"}</h1>
        <p className="mt-2 mb-7 text-muted">
          {info.firstRun
            ? "The first account administers this Lofn: it manages users and the AI models."
            : "Your account lets you create projects, run timed sessions and collect your groups’ answers. Your projects are private to you."}
        </p>
        <SignUpPanel info={info} />
      </div>
    </main>
  );
}
