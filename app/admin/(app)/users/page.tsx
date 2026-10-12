import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/session";
import { UsersAdmin } from "@/components/admin/UsersAdmin";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await getAdmin();
  if (me?.role !== "admin") redirect("/admin");
  return <UsersAdmin />;
}
