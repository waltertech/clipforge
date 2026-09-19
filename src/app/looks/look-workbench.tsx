"use client";

/* eslint-disable @next/next/no-img-element -- look images are local /api/files URLs, same as products */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  FashionApiError,
  generateLooks,
  groupLooksByPoseId,
  hasConfiguredImageProvider,
  isLookInFlight,
  LOOK_POLL_INTERVAL_MS,
  listGarmentSets,
  listLooks,
  lookScoreTone,
  matchesLookFilter,
  patchLook,
  type GarmentSet,
  type Look,
  type LookFilter,
  type TryOnRouteId,
} from "@/lib/fashion-api";
import { buildImageOptions, resolveDefaultModelTarget } from "@/lib/gen-params";
import { useLocale, useT } from "@/lib/i18n";
import { LOOK_NONE, LOOK_PRESETS } from "@/lib/look-presets";
import { getPosePreset, listPosesFor, type GarmentCategory } from "@/lib/pose-presets";
import { useCharacterStore } from "@/lib/stores/project-store";
import { DEFAULT_TRYON, useSettingsStore } from "@/lib/stores/settings-store";
import { LuCircleAlert, LuLoader, LuRefreshCw, LuSparkles } from "react-icons/lu";

const FILTERS: LookFilter[] = ["all", "accepted", "candidates", "failed"];

const STATUS_KEY: Record<Look["status"], string> = {
  pending: "statusPending",
  generating: "statusGenerating",
  candidate: "statusCandidate",
  accepted: "statusAccepted",
  rejected: "statusRejected",
  failed: "statusFailed",
};

const SCORE_CLASS: Record<NonNullable<ReturnType<typeof lookScoreTone>>, string> = {
  green: "bg-emerald-500/20 text-emerald-400",
  amber: "bg-amber-500/20 text-amber-400",
  red: "bg-red-500/20 text-red-400",
};

export function LookWorkbench() {
  const t = useT("looks");
  const locale = useLocale();
  const characters = useCharacterStore((s) => s.characters);
  const providers = useSettingsStore((s) => s.providers);
  const defaultImageModel = useSettingsStore((s) => s.defaultImageModel);
  const customModels = useSettingsStore((s) => s.customModels);
  const imageParams = useSettingsStore((s) => s.imageParams);
  const tryon = useSettingsStore((s) => s.tryon) ?? DEFAULT_TRYON;

  const providerReady = hasConfiguredImageProvider(providers, defaultImageModel);

  const [sets, setSets] = useState<GarmentSet[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [setsError, setSetsError] = useState<string | null>(null);
  const [setId, setSetId] = useState("");
  const [presenterId, setPresenterId] = useState("");
  const [route, setRoute] = useState<TryOnRouteId>(tryon.route === "vton" ? "vton" : "compose");
  const [lookPresetId, setLookPresetId] = useState(LOOK_NONE);
  const [lockFace, setLockFace] = useState(true);
  const [lockGarment, setLockGarment] = useState(true);
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [looks, setLooks] = useState<Look[]>([]);
  const [looksLoading, setLooksLoading] = useState(false);
  const [looksError, setLooksError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LookFilter>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pollNonce, setPollNonce] = useState(0);

  const selectedSet = sets.find((s) => s.id === setId) ?? null;
  const presenter = characters.find((c) => c.id === presenterId) ?? null;
  const hasSheet = (presenter?.referenceImages?.length ?? 0) > 0;

  const availablePoses = useMemo(() => {
    const categories = (selectedSet?.garments ?? [])
      .map((g) => g.category)
      .filter((c, i, arr): c is GarmentCategory => Boolean(c) && arr.indexOf(c) === i);
    return listPosesFor(categories);
  }, [selectedSet]);

  const selectedPoseIds = poseIds.filter((id) => availablePoses.some((p) => p.id === id));

  useEffect(() => {
    let cancelled = false;
    setSetsLoading(true);
    listGarmentSets()
      .then(({ sets: rows }) => {
        if (cancelled) return;
        setSets(rows);
        setSetsError(null);
        setSetId((current) => current || rows[0]?.id || "");
      })
      .catch((e) => {
        if (!cancelled) setSetsError(e instanceof Error ? e.message : t("loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setSetsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!setId) return;
    const set = sets.find((s) => s.id === setId);
    const fromSet = set?.characterId ? characters.find((c) => c.id === set.characterId) : undefined;
    const fallback = characters.find((c) => c.isDefault) ?? characters[0];
    setPresenterId(fromSet?.id ?? fallback?.id ?? "");
  }, [setId, sets, characters]);

  useEffect(() => {
    if (!setId) {
      setLooks([]);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLooksLoading(true);

    const tick = async (poll: boolean) => {
      try {
        const { looks: rows } = await listLooks(setId);
        if (cancelled) return;
        setLooks(rows);
        setLooksError(null);
        if (poll && rows.some((row) => isLookInFlight(row.status))) {
          timer = setTimeout(() => void tick(true), LOOK_POLL_INTERVAL_MS);
        }
      } catch (e) {
        if (!cancelled) setLooksError(e instanceof Error ? e.message : t("loadFailed"));
      } finally {
        if (!cancelled) setLooksLoading(false);
      }
    };

    void tick(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [setId, pollNonce, t]);

  const togglePose = (id: string) => {
    setPoseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const canGenerate = Boolean(setId && presenter && selectedPoseIds.length > 0 && providerReady && !generating);

  const onGenerate = async () => {
    if (!selectedSet || !presenter || selectedPoseIds.length === 0 || generating) return;
    setGenerating(true);
    setNotice(null);
    try {
      const target = await resolveDefaultModelTarget(providers, defaultImageModel, customModels, "image");
      if (!target) {
        setNotice(t("noImageModel"));
        return;
      }
      await generateLooks({
        garmentSetId: selectedSet.id,
        character: {
          id: presenter.id,
          name: presenter.name,
          appearance: presenter.appearance ?? "",
          referenceImages: presenter.referenceImages ?? [],
        },
        poseIds: selectedPoseIds,
        lookPresetId: lookPresetId === LOOK_NONE ? undefined : lookPresetId,
        route,
        lock: { face: lockFace, garmentPattern: lockGarment },
        lang: locale,
        provider: target.provider,
        model: target.model,
        apiKey: target.apiKey,
        baseUrl: target.baseUrl,
        options: buildImageOptions(imageParams ? { ...imageParams, count: 1 } : undefined),
      });
      setPollNonce((n) => n + 1);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setGenerating(false);
    }
  };

  const onPatch = useCallback(
    async (id: string, action: "accept" | "reject") => {
      try {
        const { look } = await patchLook(id, action);
        setLooks((prev) => {
          const next = prev.map((row) => (row.id === look.id ? look : row));
          if (action === "accept") {
            return next.map((row) =>
              row.id !== look.id && row.poseId === look.poseId && row.status === "accepted"
                ? { ...row, status: "candidate" as const }
                : row,
            );
          }
          return next;
        });
      } catch (e) {
        setNotice(e instanceof FashionApiError ? e.message : t("patchFailed"));
      }
    },
    [t],
  );

  const filtered = looks.filter((row) => matchesLookFilter(row, filter));
  const grouped = groupLooksByPoseId(filtered);
  const modelLabel = defaultImageModel || t("noModel");
  const fashnReady = Boolean(tryon.fashnApiKey);

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(240px,280px)_minmax(220px,300px)_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("setLabel")}</Label>
            {setsLoading ? (
              <div className="h-8 animate-pulse rounded-lg bg-muted/40" />
            ) : sets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
                <p>{t("noSets")}</p>
                <Link href="/garments" className="mt-2 inline-flex text-primary underline-offset-4 hover:underline">
                  {t("goGarments")}
                </Link>
              </div>
            ) : (
              <Select value={setId} onValueChange={(val) => setSetId(val ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string) => sets.find((s) => s.id === value)?.name ?? t("setPlaceholder")}
                  </SelectValue>
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
            {setsError && <p className="text-xs text-destructive">{setsError}</p>}
          </div>

          {selectedSet && selectedSet.garments.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">{t("garmentsInSet")}</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedSet.garmentIds.map((id) => {
                  const g = selectedSet.garments.find((item) => item.id === id);
                  if (!g) return null;
                  return (
                    <div key={id} className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 pr-2">
                      {g.frontUrl ? (
                        <img src={g.frontUrl} alt="" className="h-8 w-8 rounded-l-md object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded-l-md bg-muted" />
                      )}
                      <span className="max-w-[8rem] truncate text-[11px]">{g.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("presenterLabel")}</Label>
            {characters.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
                <p>{t("noPresenters")}</p>
                <Link href="/presenters" className="mt-2 inline-flex text-primary underline-offset-4 hover:underline">
                  {t("goPresenters")}
                </Link>
              </div>
            ) : (
              <Select value={presenterId} onValueChange={(val) => setPresenterId(val ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string) => characters.find((c) => c.id === value)?.name ?? t("presenterPlaceholder")}
                  </SelectValue>
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
            {presenter && (
              <p className={`text-[11px] ${hasSheet ? "text-emerald-500" : "text-amber-500"}`}>
                {hasSheet ? t("sheetReady") : t("sheetMissing")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("routeLabel")}</Label>
            <Select value={route} onValueChange={(val) => setRoute(val === "vton" ? "vton" : "compose")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) => (value === "vton" ? t("routeVton") : t("routeCompose"))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compose">{t("routeCompose")}</SelectItem>
                <SelectItem value="vton">{t("routeVton")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {route === "vton" ? t("routeVtonHint") : t("routeComposeHint")}
            </p>
            {route === "vton" && !fashnReady && (
              <p className="text-[11px] text-amber-500">{t("vtonNeedsFashn")}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("lookPresetLabel")}</Label>
            <Select value={lookPresetId} onValueChange={(val) => setLookPresetId(val ?? LOOK_NONE)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value === LOOK_NONE
                      ? t("lookPresetNone")
                      : LOOK_PRESETS.find((p) => p.id === value)?.name[locale] ?? t("lookPresetNone")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={LOOK_NONE}>{t("lookPresetNone")}</SelectItem>
                {LOOK_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={lockFace}
                onChange={(e) => setLockFace(e.target.checked)}
              />
              {t("lockFace")}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={lockGarment}
                onChange={(e) => setLockGarment(e.target.checked)}
              />
              {t("lockGarment")}
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">{t("poseTitle")}</h2>
              <p className="text-[11px] text-muted-foreground">{t("poseHint")}</p>
            </div>
            <span className="text-[11px] text-muted-foreground">{t("poseCount", { n: selectedPoseIds.length })}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPoseIds(availablePoses.map((p) => p.id))}>
              {t("poseSelectAll")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPoseIds([])}>
              {t("poseClear")}
            </Button>
          </div>
          <div className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
            {availablePoses.map((pose) => {
              const checked = selectedPoseIds.includes(pose.id);
              return (
                <label
                  key={pose.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                    checked ? "border-primary/40 bg-primary/8" : "border-border/50 hover:bg-muted/20"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-primary"
                    checked={checked}
                    onChange={() => togglePose(pose.id)}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{pose.name[locale]}</span>
                    <span className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{pose.prompt[locale]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">{t("costHint", { n: selectedPoseIds.length, model: modelLabel })}</p>
          <Button
            className="h-10 w-full brand-gradient text-white"
            disabled={!canGenerate}
            title={!canGenerate && !generating ? (providerReady ? t("generateNeedSet") : t("noImageModel")) : undefined}
            onClick={() => void onGenerate()}
          >
            {generating ? <LuLoader className="mr-2 h-4 w-4 animate-spin" /> : <LuSparkles className="mr-2 h-4 w-4" />}
            {generating ? t("generating") : t("generate")}
          </Button>
          {!providerReady && (
            <p className="flex items-start gap-1.5 text-[11px] text-amber-500">
              <LuCircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("noImageModel")}
            </p>
          )}
        </section>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    filter === f ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {t(f === "all" ? "filterAll" : f === "accepted" ? "filterAccepted" : f === "candidates" ? "filterCandidates" : "filterFailed")}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => setPollNonce((n) => n + 1)}>
              <LuRefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("refresh")}
            </Button>
          </div>

          {looksError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span>{looksError}</span>
              <Button size="sm" variant="outline" onClick={() => setPollNonce((n) => n + 1)}>
                {t("retry")}
              </Button>
            </div>
          )}

          {looksLoading && looks.length === 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="glass-card animate-pulse">
                  <CardContent className="p-0">
                    <div className="aspect-[3/4] bg-muted/40" />
                    <div className="space-y-2 p-3">
                      <div className="h-3 w-1/2 rounded bg-muted/50" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 px-6 text-center text-sm text-muted-foreground">
              <LuSparkles className="mb-3 h-7 w-7 opacity-40" />
              {looks.length === 0 ? t("emptyLooks") : t("emptyFiltered")}
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map((group) => {
                const pose = getPosePreset(group.poseId);
                return (
                  <div key={group.poseId}>
                    <h3 className="mb-2 text-sm font-semibold">{pose ? pose.name[locale] : t("unknownPose")}</h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {group.looks.map((row) => (
                        <LookCard key={row.id} look={row} t={t} onPatch={onPatch} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LookCard({
  look,
  t,
  onPatch,
}: {
  look: Look;
  t: (key: string, vars?: Record<string, string | number>) => string;
  onPatch: (id: string, action: "accept" | "reject") => void;
}) {
  const inFlight = isLookInFlight(look.status);
  const tone = lookScoreTone(look.score?.overall ?? null);
  const canJudge = look.status === "candidate" || look.status === "accepted" || look.status === "rejected";

  return (
    <Card className={`glass-card overflow-hidden ${look.status === "accepted" ? "ring-2 ring-emerald-500/60" : ""}`}>
      <CardContent className="p-0">
        <div className="relative aspect-[3/4] bg-muted/30">
          {look.imageUrl && !inFlight ? (
            <img src={look.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : inFlight ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <LuLoader className="h-5 w-5 animate-spin" />
              {t(STATUS_KEY[look.status])}
            </div>
          ) : look.status === "failed" ? (
            <div className="flex h-full items-center px-3 text-center text-xs text-destructive">
              {look.error || t("statusFailed")}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{t("statusCandidate")}</div>
          )}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            <Badge variant="outline" className="border-0 bg-black/50 text-[10px] text-white">
              {t(STATUS_KEY[look.status])}
            </Badge>
            {tone && look.score?.overall != null && (
              <Badge className={`${SCORE_CLASS[tone]} border-0 text-[10px]`}>
                {t("scoreLabel", { n: look.score.overall.toFixed(1) })}
              </Badge>
            )}
          </div>
        </div>
        <div className="space-y-2 p-3">
          {look.score?.reasons?.length ? (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer select-none">{t("scoreReasons")}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {look.score.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
          {canJudge && (
            <div className="flex gap-1.5">
              <Button
                size="sm"
                className="flex-1"
                variant={look.status === "accepted" ? "default" : "outline"}
                disabled={look.status === "accepted"}
                onClick={() => onPatch(look.id, "accept")}
              >
                {t("accept")}
              </Button>
              <Button
                size="sm"
                className="flex-1"
                variant={look.status === "rejected" ? "destructive" : "ghost"}
                disabled={look.status === "rejected"}
                onClick={() => onPatch(look.id, "reject")}
              >
                {t("reject")}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
