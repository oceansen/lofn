import { redirect } from "next/navigation";
import { getParticipant } from "@/lib/session";
import { ParticipantWorkspace } from "@/components/participant/Workspace";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const p = await getParticipant().catch(() => null);
  return { title: p ? `${p.group.name} — ${p.project.name}` : "Your group" };
}

export default async function GroupPage() {
  const p = await getParticipant();
  if (!p) redirect("/");
  return <ParticipantWorkspace />;
}
