"use client";

/* eslint-disable @next/next/no-img-element -- Look thumbs are local /api/files URLs */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  adTemplateStorageKey,
  isFashionTemplate,
  listAdTemplates,
  type AdTemplate,
} from "@/lib/ad-templates";
import { FashionApiError, listGarmentSets, listLooks, type GarmentSet, type Look } from "@/lib/fashion-api";
import { useLocale, useT } from "@/lib/i18n";
import { getPosePreset } from "@/lib/pose-presets";
import { useCharacterStore } from "@/lib/stores/project-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { LuCircleAlert, LuLoader } from "react-icons/lu";

interface MineTemplate extends AdTemplate {
  source?: string;
}

function acceptedLookForPose(looks: Look[], poseId: string): Look | undefined {
  return looks.find((l) => l.poseId === poseId && l.status === "accepted" && l.imageUrl);
}

async function fetchMineFashionTemplates(): Promise<AdTemplate[]> {
  const res = await fetch("/api/ad-template/mine");
  if (!res.ok) return [];
  const data = (await res.json()) as { templates?: MineTemplate[] };
  const rows = Array.isArray(data.templates) ? data.templates : [];
  return rows.filter((t) => isFashionTemplate(t) || t.kind === "fashion");
}

export function LooksVideoWorkbench() {
  const t = useT("looksVideo");
  const locale = useLocale();
  const router = useRouter();
  const { characters, getDefault } = useCharacterStore();
  const llm = useSettingsStore((s) => s.llm);

  const builtinTemplates = useMemo(() => listAdTemplates({ kind: "fashion" }), []);

  const [sets, setSets] = useState<GarmentSet[]>([]);
  const [setId, setSetId] = useState("");
  const [presenterId, setPresenterId] = useState("");
  const [mineTemplates, setMineTemplates] = useState<AdTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [looks, setLooks] = useState<Look[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [missingPoses, setMissingPoses] = useState<string[] | null>(null);

  const templates = useMemo(() => {
    const seen = new Set(builtinTemplates.map((tpl) => tpl.id));
    return [...builtinTemplates, ...mineTemplates.filter((tpl) => !seen.has(tpl.id))];
  }, [builtinTemplates, mineTemplates]);

  const selectedSet = sets.find((s) => s.id === setId);
  const selectedTemplate = templates.find((tpl) => tpl.id === templateId);
  const fashion = isFashionTemplate(selectedTemplate) ? selectedTemplate.fashion : selectedTemplate?.fashion;
  const fromGrid = fashion?.lookSource === "grid";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [{ sets: nextSets }, mine] = await Promise.all([listGarmentSets(), fetchMineFashionTemplates()]);
        if (cancelled) return;
        setSets(nextSets);
        setMineTemplates(mine);
        const preselect = new URLSearchParams(window.location.search).get("garmentSetId")?.trim() ?? "";
        const initial = nextSets.some((s) => s.id === preselect) ? preselect : nextSets[0]?.id ?? "";
        setSetId(initial);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof FashionApiError ? e.message : t("loadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!setId) {
      setLooks([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await listLooks(setId);
        if (!cancelled) setLooks(data.looks);
      } catch {
        if (!cancelled) setLooks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setId]);

  useEffect(() => {
    const fromSet = selectedSet?.characterId;
    const preferred =
      (fromSet && characters.some((c) => c.id === fromSet) ? fromSet : "") ||
      getDefault()?.id ||
      characters[0]?.id ||
      "";
    setPresenterId((current) => {
      if (fromSet && characters.some((c) => c.id === fromSet)) return fromSet;
      if (current && characters.some((c) => c.id === current)) return current;
      return preferred;
    });
    // Default presenter follows the garment set; the user can still change it afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-default only when the set or library hydrates
  }, [setId, characters, getDefault]);

  const onPickSet = (id: string) => {
    setSetId(id);
    setMissingPoses(null);
    setCreateError(null);
  };

  const missingInPreview = useMemo(() => {
    if (!fashion || fromGrid) return [];
    const accepted = new Set(looks.filter((l) => l.status === "accepted").map((l) => l.poseId));
    const seen = new Set<string>();
    const missing: string[] = [];
    for (const poseId of fashion.poseSequence) {
      if (!accepted.has(poseId) && !seen.has(poseId)) {
        seen.add(poseId);
        missing.push(poseId);
      }
    }
    return missing;
  }, [fashion, fromGrid, looks]);

  const presenter = characters.find((c) => c.id === presenterId);

  const createProject = useCallback(async () => {
    if (!setId) {
      setCreateError(t("needSet"));
      return;
    }
    if (!selectedTemplate) {
      setCreateError(t("needTemplate"));
      return;
    }
    if (!presenter) {
      setCreateError(t("needPresenter"));
      return;
    }
    setCreating(true);
    setCreateError(null);
    setMissingPoses(null);
    try {
      const llmConfig =
        llm.apiKey.trim() && llm.baseUrl.trim() && llm.model.trim()
          ? { baseUrl: llm.baseUrl, apiKey: llm.apiKey, model: llm.model, visionModel: llm.visionModel }
          : undefined;
      const res = await fetch("/api/project/from-look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          garmentSetId: setId,
          templateId: selectedTemplate.id,
          character: {
            id: presenter.id,
            name: presenter.name,
            appearance: presenter.appearance || "",
            referenceImages: presenter.referenceImages ?? [],
          },
          lang: locale,
          ...(llmConfig && { llmConfig }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        missingPoses?: string[];
        projectId?: string;
        storedTemplate?: string;
      };
      if (res.status === 409) {
        setMissingPoses(Array.isArray(data.missingPoses) ? data.missingPoses : missingInPreview);
        setCreateError(data.error || t("missingTitle"));
        return;
      }
      if (!res.ok || !data.projectId || typeof data.storedTemplate !== "string") {
        throw new Error(data.error || t("createFailed"));
      }
      try {
        localStorage.setItem(adTemplateStorageKey(data.projectId), data.storedTemplate);
      } catch {
        /* storage unavailable — assets page simply will not apply the fashion lock */
      }
      router.push(`/project/${data.projectId}/assets`);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setCreating(false);
    }
  }, [setId, selectedTemplate, presenter, llm, locale, missingInPreview, router, t]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LuLoader className="h-4 w-4 animate-spin" />
        {t("pageSubtitle")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <LuCircleAlert className="h-4 w-4 shrink-0" />
          {loadError}
        </p>
      )}

      <section className="space-y-2">
        <Label>{t("setLabel")}</Label>
        {sets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("noSets")}{" "}
            <Link href="/garments" className="text-primary underline underline-offset-2">
              {t("goGarments")}
            </Link>
          </p>
        ) : (
          <Select value={setId} onValueChange={(value) => { if (value) onPickSet(value); }}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder={t("setPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {sets.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {selectedSet && selectedSet.garments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">{t("garmentsInSet")}</span>
            {selectedSet.garments.map((g) => (
              <Badge key={g.id} variant="secondary" className="text-[10px]">
                {g.name}
              </Badge>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <Label>{t("presenterLabel")}</Label>
        {characters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("noPresenters")}{" "}
            <Link href="/presenters" className="text-primary underline underline-offset-2">
              {t("goPresenters")}
            </Link>
          </p>
        ) : (
          <Select value={presenterId} onValueChange={(value) => { if (value) setPresenterId(value); }}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder={t("presenterPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {characters.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </section>

      <section className="space-y-3">
        <Label>{t("templateLabel")}</Label>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((tpl) => {
              const mine = !builtinTemplates.some((b) => b.id === tpl.id);
              const on = tpl.id === templateId;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    setTemplateId(tpl.id);
                    setMissingPoses(null);
                    setCreateError(null);
                  }}
                  className={`text-left rounded-xl border p-4 transition-colors ${
                    on ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{tpl.name[locale]}</div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{tpl.tagline[locale]}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {mine ? t("templateMine") : t("templateBuiltin")}
                    </Badge>
                  </div>
                  {tpl.fashion && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {tpl.fashion.poseSequence.length} · {tpl.fashion.lookSource}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {fashion && (
        <section className="space-y-3">
          <Label>{t("posePreview")}</Label>
          {fromGrid && <p className="text-xs text-muted-foreground">{t("gridNote")}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {fashion.poseSequence.map((poseId, index) => {
              const pose = getPosePreset(poseId);
              const accepted = acceptedLookForPose(looks, poseId);
              const missing = !fromGrid && !accepted;
              return (
                <Card key={`${poseId}-${index}`} className={missing ? "border-destructive/60" : undefined}>
                  <CardContent className="p-2 space-y-1.5">
                    <div className="aspect-[3/4] rounded-md overflow-hidden bg-muted/40 flex items-center justify-center">
                      {accepted?.imageUrl ? (
                        <img src={accepted.imageUrl} alt={pose?.name[locale] ?? poseId} className="h-full w-full object-cover" />
                      ) : (
                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${missing ? "bg-destructive/15 text-destructive" : "text-muted-foreground"}`}>
                          {missing ? t("poseMissing") : poseId}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-medium truncate">{pose?.name[locale] ?? poseId}</div>
                    {accepted && <div className="text-[10px] text-muted-foreground">{t("poseAccepted")}</div>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {(createError || missingPoses) && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
          {createError && <p className="text-destructive">{createError}</p>}
          {missingPoses && missingPoses.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">{t("missingHint")}</p>
              <ul className="text-xs list-disc pl-4">
                {missingPoses.map((id) => (
                  <li key={id}>{getPosePreset(id)?.name[locale] ?? id}</li>
                ))}
              </ul>
              <Link
                href={`/looks?garmentSetId=${encodeURIComponent(setId)}`}
                className="inline-flex text-xs text-primary underline underline-offset-2"
              >
                {t("goLooks")}
              </Link>
            </>
          )}
        </div>
      )}

      <Button
        onClick={() => void createProject()}
        disabled={creating || !setId || !templateId || !presenterId}
      >
        {creating ? t("creating") : t("create")}
      </Button>
    </div>
  );
}
