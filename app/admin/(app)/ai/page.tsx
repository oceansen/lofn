import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/session";
import { AiSettingsForm } from "@/components/admin/AiSettings";

export const metadata = { title: "AI models" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await getAdmin();
  if (me?.role !== "admin") redirect("/admin");
  return <AiSettingsForm />;
}
