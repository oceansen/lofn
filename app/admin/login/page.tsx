import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdmin } from "@/lib/session";
import { authInfo } from "@/lib/auth-info";
import { SignInPanel } from "@/components/admin/AuthPanel";
import { Notice, Wordmark } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  if (await getAdmin()) redirect("/admin");
  const info = await authInfo();
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-6">
      <Link href="/" className="self-start">
        <Wordmark className="text-xl" />
      </Link>
      <div className="flex flex-1 flex-col justify-center pb-16">
        <h1 className="font-display text-[34px] leading-tight font-bold">Sign in</h1>
        <p className="mt-2 mb-7 text-muted">Create and run feedback projects. Joining a group as a participant needs no account: use your group code on the front page.</p>
        {info.firstRun && (
          <Notice tone="tide" className="mb-6 text-[15px]">
            There are no facilitator accounts on this Lofn yet.{" "}
            <Link href="/admin/signup" className="font-semibold text-spruce underline-offset-2 hover:underline">
              Create the first one
            </Link>
            {info.providers.github || info.providers.google ? ", or continue with GitHub or Google below" : ""}. The first account becomes the administrator.
          </Notice>
        )}
        <SignInPanel info={info} error={sp.error?.slice(0, 300)} notice={sp.notice?.slice(0, 300)} />
      </div>
    </main>
  );
}
