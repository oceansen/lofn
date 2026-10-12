import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdmin } from "@/lib/session";
import { Wordmark } from "@/components/ui";
import { SignOut } from "@/components/admin/SignOut";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-5 px-4 sm:px-6">
          <Link href="/admin" aria-label="Lofn projects">
            <Wordmark className="text-xl" />
          </Link>
          <nav className="flex gap-1 text-[15px]">
            <Link href="/admin" className="rounded-md px-2.5 py-1.5 font-semibold hover:bg-ink/5">
              Projects
            </Link>
            <Link href="/admin/ai" className="rounded-md px-2.5 py-1.5 font-semibold hover:bg-ink/5">
              AI settings
            </Link>
            {admin.role === "admin" && (
              <>
                <Link href="/admin/users" className="rounded-md px-2.5 py-1.5 font-semibold hover:bg-ink/5">
                  Users
                </Link>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted">
            <span className="hidden sm:inline">{admin.name || admin.email}</span>
            <SignOut />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
