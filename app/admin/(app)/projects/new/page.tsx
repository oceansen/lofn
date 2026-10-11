"use client";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { ProjectForm } from "@/components/admin/ProjectForm";

export default function NewProject() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-[34px] font-bold">New project</h1>
      <p className="mb-6 text-muted">Next you’ll add questions, create groups and set up a timed cycle.</p>
      <ProjectForm
        submitLabel="Create project"
        onSubmit={async (v) => {
          const r = await api("/api/admin/projects", { body: v });
          router.push(`/admin/projects/${r.project.id}/questions`);
        }}
      />
    </main>
  );
}
