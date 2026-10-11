import Link from "next/link";
import { Wordmark } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
      <Wordmark className="text-xl" />
      <h1 className="mt-6 font-display text-3xl font-bold">This page doesn’t exist</h1>
      <p className="mt-2 text-muted">The link may be out of date, or you may not have access to it.</p>
      <Link href="/" className="mt-6 font-semibold text-spruce hover:underline">
        Go to Lofn
      </Link>
    </main>
  );
}
