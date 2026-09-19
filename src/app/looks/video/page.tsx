"use client";

import { useT } from "@/lib/i18n";
import { LooksVideoWorkbench } from "./looks-video-workbench";

export default function LooksVideoPage() {
  const t = useT("looksVideo");

  return (
    <div className="min-h-screen grid-bg">
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("pageSubtitle")}</p>
        </div>
        <LooksVideoWorkbench />
      </main>
    </div>
  );
}
