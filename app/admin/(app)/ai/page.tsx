import { AiSettingsForm } from "@/components/admin/AiSettings";

export const metadata = { title: "AI settings" };
export const dynamic = "force-dynamic";

// Every account sets up its own AI keys and models; the (app) layout already requires sign-in.
export default function Page() {
  return <AiSettingsForm />;
}
