"use client";

/* eslint-disable @next/next/no-img-element -- reference thumbs are /api/files URLs, same as garments */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AdTemplate } from "@/lib/ad-templates";
import type { ReferenceJob, ReferenceStage } from "@/lib/reference/types";
import { getPosePreset } from "@/lib/pose-presets";
import { useLocale, useT } from "@/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const EDITOR_INPUT_CLS =
  "w-full px-2 py-1.5 rounded-md text-xs border border-border/50 bg-background/60 outline-none focus:border-primary/60 placeholder:text-muted-foreground/60";

const MAX_BYTES = 200 * 1024 * 1024;
const ACCEPT = "video/mp4,video/webm,video/quicktime";

const STEPS: Exclude<ReferenceStage, "queued" | "failed">[] = [
  "probe",
  "scenes",
  "asr",
  "frames",
  "read",
  "derive",
  "done",
];

const STAGE_KEYS: Record<(typeof STEPS)[number], string> = {
  probe: "stageProbe",
  scenes: "stageScenes",
  asr: "stageAsr",
  frames: "stageFrames",
  read: "stageRead",
  derive: "stageDerive",
  done: "stageDone",
};

export type ReferenceLlmConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  visionModel?: string;
};

export function ReferenceImportDialog({
  open,
  onOpenChange,
  llmConfig,
  onDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  llmConfig: ReferenceLlmConfig | null | undefined;
  onDraft: (tpl: AdTemplate, meta: { referenceId: string; needsConfirmation: string[] }) => void;
}) {
  const t = useT("fashionEditor");
  const locale = useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState("upload");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [referenceId, setReferenceId] = useState("");
  const [job, setJob] = useState<ReferenceJob | null>(null);

  const llmOk = !!(llmConfig?.baseUrl && llmConfig?.model);
  const stage = job?.stage;

  const reset = useCallback(() => {
    setError("");
    setBusy(false);
    setReferenceId("");
    setJob(null);
    setFile(null);
    setUrl("");
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open || !referenceId) return;
    if (stage === "done" || stage === "failed") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/reference/${encodeURIComponent(referenceId)}`);
        const data = (await res.json()) as ReferenceJob & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || t("refFailed"));
          setJob((prev) => (prev ? { ...prev, stage: "failed", error: data.error } : prev));
          return;
        }
        setJob(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("refFailed"));
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, referenceId, stage, t]);

  const submit = async () => {
    if (busy || !llmOk) return;
    setError("");
    if (tab === "upload") {
      if (!file) {
        setError(t("refNoFile"));
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(t("refFileTooLarge"));
        return;
      }
    } else if (!url.trim()) {
      setError(t("refNoUrl"));
      return;
    }
    setBusy(true);
    setJob(null);
    setReferenceId("");
    try {
      const bodyCfg = {
        baseUrl: llmConfig!.baseUrl,
        apiKey: llmConfig?.apiKey ?? "",
        model: llmConfig!.model,
        ...(llmConfig?.visionModel ? { visionModel: llmConfig.visionModel } : {}),
      };
      let res: Response;
      if (tab === "upload") {
        const fd = new FormData();
        fd.append("video", file!);
        fd.append("llmConfig", JSON.stringify(bodyCfg));
        fd.append("locale", locale);
        res = await fetch("/api/reference/ingest", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/reference/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), llmConfig: bodyCfg, locale }),
        });
      }
      const data = (await res.json()) as { referenceId?: string; stage?: string; error?: string };
      if (!res.ok || !data.referenceId) {
        throw new Error(data.error || t("refFailed"));
      }
      setReferenceId(data.referenceId);
      setJob({
        id: data.referenceId,
        stage: (data.stage as ReferenceStage) || "queued",
        createdAt: "",
        updatedAt: "",
        source: { kind: tab === "upload" ? "upload" : "url", fileName: file?.name || url.trim() },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("refFailed"));
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = stage && STEPS.includes(stage as (typeof STEPS)[number])
    ? STEPS.indexOf(stage as (typeof STEPS)[number])
    : stage === "queued"
      ? -1
      : -1;
  const draft = job?.draft;
  const poseNames = (draft?.fashion?.poseSequence ?? [])
    .map((id) => {
      const p = getPosePreset(id);
      return p ? (locale === "zh" ? p.name.zh : p.name.en) : id;
    })
    .join(" → ");
  const patternLabel =
    draft?.fashion?.scriptPattern === "on-camera"
      ? t("scriptOnCamera")
      : draft?.fashion?.scriptPattern === "voiceover"
        ? t("scriptVoiceover")
        : t("scriptNone");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("refTitle")}</DialogTitle>
          <DialogDescription>{t("refStructureNote")}</DialogDescription>
        </DialogHeader>

        {!llmOk && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">{t("refNeedLlm")}</p>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(typeof v === "string" ? v : "upload")}>
          <TabsList>
            <TabsTrigger value="upload">{t("refTabUpload")}</TabsTrigger>
            <TabsTrigger value="url">{t("refTabUrl")}</TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="mt-2 space-y-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              disabled={!llmOk || busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > MAX_BYTES) {
                  setError(t("refFileTooLarge"));
                  setFile(null);
                  e.target.value = "";
                  return;
                }
                setError("");
                setFile(f);
              }}
              className="block w-full text-xs text-muted-foreground file:mr-2 file:px-2 file:py-1 file:rounded-md file:border file:border-border/50 file:bg-muted/20 file:text-xs"
            />
          </TabsContent>
          <TabsContent value="url" className="mt-2 space-y-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("refUrlPlaceholder")}
              disabled={!llmOk || busy}
              className={EDITOR_INPUT_CLS}
            />
          </TabsContent>
        </Tabs>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!llmOk || busy}
            onClick={() => void submit()}
            className="px-3 py-1 rounded-full text-xs border border-primary/40 bg-primary/5 text-primary hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {busy ? t("refIngesting") : t("refSubmit")}
          </button>
        </div>

        {(referenceId || job) && (
          <div className="flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => {
              const done = stepIndex > i || stage === "done";
              const active = stepIndex === i && stage !== "done";
              return (
                <span
                  key={s}
                  className={`px-2 py-0.5 rounded-full text-[10px] border ${
                    done
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : active
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "border-border/50 text-muted-foreground"
                  }`}
                >
                  {t(STAGE_KEYS[s])}
                </span>
              );
            })}
          </div>
        )}

        {referenceId && stage !== "done" && stage !== "failed" && (
          <p className="text-[11px] text-muted-foreground">{t("refPolling")}</p>
        )}

        {stage === "failed" && (
          <div className="space-y-2">
            <p className="text-xs text-destructive">{job?.error || error || t("refFailed")}</p>
            <button
              type="button"
              onClick={() => {
                setJob(null);
                setReferenceId("");
                setError("");
                void submit();
              }}
              className="px-3 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
            >
              {t("refRetry")}
            </button>
          </div>
        )}

        {error && stage !== "failed" && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        {stage === "done" && draft && (
          <div className="space-y-3">
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <p>{t("refSummaryShots", { n: draft.fashion?.poseSequence.length ?? job?.shots?.length ?? 0 })}</p>
              <p>{t("refSummaryPattern", { pattern: patternLabel })}</p>
              {poseNames && <p>{t("refSummaryPoses", { poses: poseNames })}</p>}
            </div>
            {job?.shots && job.shots.length > 0 && (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {job.shots.map((shot) => (
                  <div key={shot.index} className="rounded-md border border-border/40 p-2 space-y-1">
                    <div className="flex gap-1">
                      {(shot.frames ?? []).slice(0, 3).map((src) => (
                        <img
                          key={src}
                          src={src}
                          alt=""
                          className="h-14 w-10 object-cover rounded bg-muted/40"
                        />
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {shot.role}
                      {shot.poseText ? ` · ${shot.poseText}` : ""}
                      {shot.cameraText ? ` · ${shot.cameraText}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {(job?.needsConfirmation?.length ?? 0) > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1">
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{t("refNeedsConfirm")}</p>
                <ul className="list-disc pl-4 text-[11px] text-amber-800/90 dark:text-amber-300/90">
                  {job!.needsConfirmation!.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={() =>
                onDraft(draft, {
                  referenceId: job?.id ?? referenceId,
                  needsConfirmation: job?.needsConfirmation ?? [],
                })
              }
              className="px-3 py-1 rounded-full text-xs border border-primary/40 bg-primary/5 text-primary hover:border-primary"
            >
              {t("refOpenEditor")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
