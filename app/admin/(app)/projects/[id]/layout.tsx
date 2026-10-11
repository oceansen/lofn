import { notFound, redirect } from "next/navigation";
import { getAdmin, isUuid } from "@/lib/session";
import { one } from "@/lib/db";
import { ProjectNav } from "@/components/admin/ProjectNav";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await getAdmin();
  if (!admin || !isUuid(id)) return {};
  const p = await one(`SELECT name FROM projects WHERE id=$1 AND owner_id=$2`, [id, admin.id]);
  return { title: p?.name ?? "Project" };
}

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await getAdmin();
  if (!admin) redirect("/admin/login");
  if (!isUuid(id)) notFound();
  const p = await one(`SELECT id, name, status FROM projects WHERE id=$1 AND owner_id=$2`, [id, admin.id]);
  if (!p) notFound();
  return (
    <>
      <ProjectNav id={p.id} name={p.name} archived={p.status === "archived"} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </>
  );
}
