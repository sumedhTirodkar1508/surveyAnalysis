"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ExtractionPoller({ hasQuestions }: { hasQuestions: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (hasQuestions) return;

    const interval = setInterval(() => {
      router.refresh();
    }, 3000);

    return () => clearInterval(interval);
  }, [hasQuestions, router]);

  return null;
}
