"use client";

/* eslint-disable @next/next/no-img-element -- garment thumbs are local /api/files URLs, same as products */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  createGarment,
  createGarmentSet,
  deleteGarment,
  deleteGarmentSet,
  FashionApiError,
  formatColorTagsInput,
  GARMENT_CATEGORY_VALUES,
  listGarmentSets,
  listGarments,
  MAX_SET_GARMENTS,
  moveItem,
  parseColorTags,
  patchGarment,
  patchGarmentSet,
  validateGarmentImage,
  type Garment,
  type GarmentCategory,
  type GarmentSet,
  type GarmentView,
} from "@/lib/fashion-api";
import { useT } from "@/lib/i18n";
import { useCharacterStore } from "@/lib/stores/project-store";
import {
  LuChevronDown,
  LuChevronUp,
  LuCircleAlert,
  LuImage,
  LuLoader,
  LuPencil,
  LuPlus,
  LuShirt,
  LuTrash2,
  LuX,
} from "react-icons/lu";

const CATEGORY_LABEL: Record<GarmentCategory | "all", string> = {
  all: "categoryAll",
  tops: "categoryTops",
  bottoms: "categoryBottoms",
  "one-pieces": "categoryOnePieces",
  outerwear: "categoryOuterwear",
  shoes: "categoryShoes",
  accessory: "categoryAccessory",
};

const CATEGORY_COLOR: Record<GarmentCategory, string> = {
  tops: "bg-pink-500/20 text-pink-400",
  bottoms: "bg-blue-500/20 text-blue-400",
  "one-pieces": "bg-purple-500/20 text-purple-400",
  outerwear: "bg-amber-500/20 text-amber-400",
  shoes: "bg-cyan-500/20 text-cyan-400",
  accessory: "bg-zinc-500/20 text-zinc-400",
};

type GarmentForm = {
  name: string;
  category: GarmentCategory;
  view: GarmentView;
  notes: string;
  colorTags: string;
  frontFile: File | null;
  backFile: File | null;
};

const EMPTY_GARMENT: GarmentForm = {
  name: "",
  category: "tops",
  view: "flat",
  notes: "",
  colorTags: "",
  frontFile: null,
  backFile: null,
};

function FileSlot({
  label,
  required,
  file,
  existingUrl,
  onChange,
  t,
}: {
  label: string;
  required?: boolean;
  file: File | null;
  existingUrl?: string | null;
  onChange: (file: File | null) => void;
  t: (key: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const blobUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);
  const src = blobUrl || existingUrl || "";
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : (
            <span className="ml-1 text-xs font-normal text-muted-foreground">{t("optional")}</span>
          )}
        </Label>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed border-border/60 bg-muted/20 text-center hover:border-primary/50"
      >
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-3 text-xs text-muted-foreground">{t("dropHint")}</span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const next = e.target.files?.[0] ?? null;
          e.target.value = "";
          if (!next) {
            onChange(null);
            setLocalError(null);
            return;
          }
          const result = validateGarmentImage(next);
          if (result === "type") {
            setLocalError(t("fileTypeError"));
            return;
          }
          if (result === "size") {
            setLocalError(t("fileSizeError"));
            return;
          }
          setLocalError(null);
          onChange(next);
        }}
      />
      {localError && <p className="text-xs text-destructive">{localError}</p>}
      <p className="text-[11px] text-muted-foreground">{t("dropHintFormats")}</p>
    </div>
  );
}

export function GarmentLibrary() {
  const t = useT("garments");
  const characters = useCharacterStore((s) => s.characters);

  const [garments, setGarments] = useState<Garment[]>([]);
  const [sets, setSets] = useState<GarmentSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<GarmentCategory | "all">("all");

  const [garmentOpen, setGarmentOpen] = useState(false);
  const [editingGarment, setEditingGarment] = useState<Garment | null>(null);
  const [form, setForm] = useState<GarmentForm>(EMPTY_GARMENT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [setOpen, setSetOpen] = useState(false);
  const [editingSet, setEditingSet] = useState<GarmentSet | null>(null);
  const [setName, setSetName] = useState("");
  const [setGarmentIds, setSetGarmentIds] = useState<string[]>([]);
  const [setCharacterId, setSetCharacterId] = useState<string>("none");
  const [setBusy, setSetBusy] = useState(false);
  const [setDialogError, setSetDialogError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQ(qInput), 300);
    return () => window.clearTimeout(id);
  }, [qInput]);

  const loadGarments = useCallback(async () => {
    const { garments: rows } = await listGarments({
      category: category === "all" ? undefined : category,
      q,
    });
    setGarments(rows);
  }, [category, q]);

  const loadSets = useCallback(async () => {
    const { sets: rows } = await listGarmentSets();
    setSets(rows);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadGarments(), loadSets()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [loadGarments, loadSets, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const characterName = useCallback(
    (id: string | null) => {
      if (!id) return null;
      return characters.find((c) => c.id === id)?.name ?? null;
    },
    [characters],
  );

  const openCreateGarment = () => {
    setEditingGarment(null);
    setForm(EMPTY_GARMENT);
    setFormError(null);
    setGarmentOpen(true);
  };

  const openEditGarment = (g: Garment) => {
    setEditingGarment(g);
    setForm({
      name: g.name,
      category: g.category,
      view: g.view,
      notes: g.notes ?? "",
      colorTags: formatColorTagsInput(g.colorTags ?? []),
      frontFile: null,
      backFile: null,
    });
    setFormError(null);
    setGarmentOpen(true);
  };

  const saveGarment = async () => {
    if (!form.name.trim() || saving) return;
    if (!editingGarment && !form.frontFile) {
      setFormError(t("frontRequired"));
      return;
    }
    if (form.frontFile) {
      const check = validateGarmentImage(form.frontFile);
      if (check !== "ok") {
        setFormError(t(check === "type" ? "fileTypeError" : "fileSizeError"));
        return;
      }
    }
    if (form.backFile) {
      const check = validateGarmentImage(form.backFile);
      if (check !== "ok") {
        setFormError(t(check === "type" ? "fileTypeError" : "fileSizeError"));
        return;
      }
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingGarment) {
        await patchGarment(editingGarment.id, {
          name: form.name.trim(),
          category: form.category,
          view: form.view,
          notes: form.notes.trim() || null,
          colorTags: parseColorTags(form.colorTags),
        });
      } else {
        await createGarment({
          name: form.name.trim(),
          category: form.category,
          view: form.view,
          notes: form.notes.trim() || undefined,
          colorTags: parseColorTags(form.colorTags),
          front: form.frontFile!,
          back: form.backFile,
        });
      }
      setGarmentOpen(false);
      await Promise.all([loadGarments(), loadSets()]);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeGarment = async (g: Garment) => {
    if (!window.confirm(t("deleteConfirm", { name: g.name }))) return;
    try {
      await deleteGarment(g.id);
      setBanner(null);
      await Promise.all([loadGarments(), loadSets()]);
    } catch (e) {
      const msg =
        e instanceof FashionApiError && e.status === 409
          ? e.message || t("deleteBlocked")
          : e instanceof Error
            ? e.message
            : t("loadFailed");
      setBanner(msg);
    }
  };

  const openCreateSet = () => {
    setEditingSet(null);
    setSetName("");
    setSetGarmentIds([]);
    setSetCharacterId("none");
    setSetDialogError(null);
    setSetOpen(true);
  };

  const openEditSet = (s: GarmentSet) => {
    setEditingSet(s);
    setSetName(s.name);
    setSetGarmentIds([...s.garmentIds]);
    setSetCharacterId(s.characterId ?? "none");
    setSetDialogError(null);
    setSetOpen(true);
  };

  const toggleSetGarment = (id: string) => {
    setSetGarmentIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SET_GARMENTS) return prev;
      return [...prev, id];
    });
  };

  const saveSet = async () => {
    if (!setName.trim() || setBusy) return;
    if (setGarmentIds.length < 1 || setGarmentIds.length > MAX_SET_GARMENTS) {
      setSetDialogError(t("setNeedGarments"));
      return;
    }
    setSetBusy(true);
    setSetDialogError(null);
    try {
      const characterId = setCharacterId === "none" ? null : setCharacterId;
      if (editingSet) {
        await patchGarmentSet(editingSet.id, {
          name: setName.trim(),
          garmentIds: setGarmentIds,
          characterId,
        });
      } else {
        await createGarmentSet({
          name: setName.trim(),
          garmentIds: setGarmentIds,
          characterId,
        });
      }
      setSetOpen(false);
      await loadSets();
    } catch (e) {
      setSetDialogError(e instanceof Error ? e.message : t("loadFailed"));
    } finally {
      setSetBusy(false);
    }
  };

  const removeSet = async (s: GarmentSet) => {
    if (!window.confirm(t("setDeleteConfirm", { name: s.name }))) return;
    try {
      await deleteGarmentSet(s.id);
      await loadSets();
    } catch (e) {
      setBanner(e instanceof Error ? e.message : t("loadFailed"));
    }
  };

  const allGarmentsForPicker = useMemo(() => {
    const byId = new Map(garments.map((g) => [g.id, g]));
    for (const s of sets) {
      for (const g of s.garments ?? []) byId.set(g.id, g);
    }
    return [...byId.values()];
  }, [garments, sets]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("pageTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("pageSubtitle")}</p>
        </div>
        <Button className="brand-gradient text-white shrink-0" onClick={openCreateGarment}>
          <LuPlus className="mr-1.5 h-4 w-4" />
          {t("uploadGarment")}
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="sm:max-w-xs bg-muted/30"
        />
        <div className="flex flex-wrap gap-1.5">
          {(["all", ...GARMENT_CATEGORY_VALUES] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                category === c
                  ? "bg-primary/15 font-medium text-primary"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(CATEGORY_LABEL[c])}
            </button>
          ))}
        </div>
      </div>

      {banner && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          <LuCircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{banner}</span>
          <button type="button" onClick={() => setBanner(null)} className="text-muted-foreground hover:text-foreground">
            <LuX className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void reload()}>
            {t("retry")}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="glass-card animate-pulse">
              <CardContent className="p-0">
                <div className="aspect-[3/4] bg-muted/40" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-2/3 rounded bg-muted/50" />
                  <div className="h-3 w-1/3 rounded bg-muted/40" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : garments.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
              <LuShirt className="h-7 w-7 text-muted-foreground" />
            </div>
            <h2 className="mb-1 text-sm font-semibold">{t("emptyTitle")}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t("emptyText")}</p>
            <Button className="brand-gradient text-white" onClick={openCreateGarment}>
              <LuPlus className="mr-1.5 h-4 w-4" />
              {t("uploadGarment")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t("garmentCount", { n: garments.length })}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {garments.map((g) => (
              <Card key={g.id} className="card-hover glass-card group">
                <CardContent className="p-0">
                  <div className="relative aspect-[3/4] overflow-hidden bg-muted/30">
                    {g.frontUrl ? (
                      <img src={g.frontUrl} alt={g.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <LuImage className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                    )}
                    <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                      <Badge className={`${CATEGORY_COLOR[g.category]} border-0 text-[10px]`}>
                        {t(CATEGORY_LABEL[g.category])}
                      </Badge>
                      <Badge variant="outline" className="bg-black/40 text-[10px] text-white border-0">
                        {g.view === "on-model" ? t("viewBadgeOnModel") : t("viewBadgeFlat")}
                      </Badge>
                    </div>
                    <div className="absolute right-2 top-2 flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => openEditGarment(g)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-primary"
                        aria-label={t("edit")}
                      >
                        <LuPencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeGarment(g)}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-500"
                        aria-label={t("delete")}
                      >
                        <LuTrash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="p-3">
                    <h3 className="truncate text-sm font-medium">{g.name}</h3>
                    {g.colorTags?.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {g.colorTags.map((tag) => (
                          <span key={tag} className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{t("setsTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("setsSubtitle")}</p>
          </div>
          <Button variant="outline" onClick={openCreateSet} disabled={garments.length === 0 && allGarmentsForPicker.length === 0}>
            <LuPlus className="mr-1.5 h-4 w-4" />
            {t("newSet")}
          </Button>
        </div>

        {sets.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">{t("setEmpty")}</CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sets.map((s) => {
              const presenter = characterName(s.characterId);
              const pieces = s.garmentIds
                .map((id) => s.garments.find((g) => g.id === id) ?? allGarmentsForPicker.find((g) => g.id === id))
                .filter((g): g is Garment => Boolean(g));
              return (
                <Card key={s.id} className="glass-card">
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="flex -space-x-2">
                      {pieces.slice(0, 5).map((g) => (
                        <div key={g.id} className="h-12 w-12 overflow-hidden rounded-md ring-2 ring-background bg-muted">
                          {g.frontUrl ? (
                            <img src={g.frontUrl} alt={g.name} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                              {t("noImage")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold">{s.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {presenter ?? (s.characterId ? t("setPresenterMissing") : t("setPresenterNone"))}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEditSet(s)}>
                        {t("edit")}
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void removeSet(s)}>
                        <LuTrash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={garmentOpen} onOpenChange={(open) => { if (!open) setGarmentOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingGarment ? t("formEditTitle") : t("formAddTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                {t("fieldName")}
                <span className="ml-0.5 text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t("namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t("fieldCategory")}</Label>
              <Select
                value={form.category}
                onValueChange={(val) =>
                  setForm((f) => ({ ...f, category: (val as GarmentCategory) ?? "tops" }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string) => t(CATEGORY_LABEL[value as GarmentCategory] ?? "categoryTops")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {GARMENT_CATEGORY_VALUES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(CATEGORY_LABEL[c])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t("fieldView")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["flat", "on-model"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, view: v }))}
                    className={`h-9 rounded-lg border text-xs font-medium ${
                      form.view === v
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {v === "flat" ? t("viewFlat") : t("viewOnModel")}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">{t("fieldNotes")}</Label>
                <span className="text-xs text-muted-foreground">{t("optional")}</span>
              </div>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder={t("notesPlaceholder")}
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t("fieldColorTags")}</Label>
              <Input
                value={form.colorTags}
                onChange={(e) => setForm((f) => ({ ...f, colorTags: e.target.value }))}
                placeholder={t("colorTagsPlaceholder")}
              />
            </div>
            {!editingGarment && (
              <div className="grid grid-cols-2 gap-3">
                <FileSlot
                  label={t("fieldFront")}
                  required
                  file={form.frontFile}
                  onChange={(frontFile) => setForm((f) => ({ ...f, frontFile }))}
                  t={t}
                />
                <FileSlot
                  label={t("fieldBack")}
                  file={form.backFile}
                  onChange={(backFile) => setForm((f) => ({ ...f, backFile }))}
                  t={t}
                />
              </div>
            )}
            {editingGarment && (
              <div className="grid grid-cols-2 gap-3">
                {editingGarment.frontUrl && (
                  <div className="overflow-hidden rounded-lg border border-border/50">
                    <img src={editingGarment.frontUrl} alt="" className="aspect-[3/4] w-full object-cover" />
                  </div>
                )}
                {editingGarment.backUrl && (
                  <div className="overflow-hidden rounded-lg border border-border/50">
                    <img src={editingGarment.backUrl} alt="" className="aspect-[3/4] w-full object-cover" />
                  </div>
                )}
              </div>
            )}
            {formError && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <LuCircleAlert className="h-4 w-4 shrink-0" />
                {formError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGarmentOpen(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button className="brand-gradient text-white" onClick={() => void saveGarment()} disabled={!form.name.trim() || saving}>
              {saving ? t("saving") : editingGarment ? t("save") : t("addSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={setOpen} onOpenChange={(open) => { if (!open) setSetOpen(false); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingSet ? t("formEditSetTitle") : t("formAddSetTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t("fieldName")}</Label>
              <Input value={setName} onChange={(e) => setSetName(e.target.value)} placeholder={t("setNamePlaceholder")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{t("setPresenterLabel")}</Label>
              <Select value={setCharacterId} onValueChange={(val) => setSetCharacterId(val ?? "none")}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      value === "none"
                        ? t("setPresenterNone")
                        : characters.find((c) => c.id === value)?.name ?? t("setPresenterNone")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("setPresenterNone")}</SelectItem>
                  {characters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("setGarmentsLabel")}</Label>
              <p className="text-[11px] text-muted-foreground">{t("setGarmentsHint")}</p>
              <div className="flex flex-wrap gap-1.5">
                {allGarmentsForPicker.map((g) => {
                  const on = setGarmentIds.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleSetGarment(g.id)}
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        on ? "bg-primary/15 text-primary" : "bg-muted/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-2">
                {setGarmentIds.map((id, index) => {
                  const g = allGarmentsForPicker.find((item) => item.id === id);
                  return (
                    <div key={id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2 py-1.5">
                      <span className="w-5 text-xs text-muted-foreground">{index + 1}</span>
                      {g?.frontUrl ? (
                        <img src={g.frontUrl} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded bg-muted" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-sm">{g?.name ?? id}</span>
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSetGarmentIds((ids) => moveItem(ids, index, -1))} aria-label={t("setMoveUp")}>
                        <LuChevronUp className="h-4 w-4" />
                      </button>
                      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSetGarmentIds((ids) => moveItem(ids, index, 1))} aria-label={t("setMoveDown")}>
                        <LuChevronDown className="h-4 w-4" />
                      </button>
                      <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => toggleSetGarment(id)} aria-label={t("setRemove")}>
                        <LuX className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            {setDialogError && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <LuCircleAlert className="h-4 w-4 shrink-0" />
                {setDialogError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSetOpen(false)} disabled={setBusy}>
              {t("cancel")}
            </Button>
            <Button className="brand-gradient text-white" onClick={() => void saveSet()} disabled={!setName.trim() || setBusy}>
              {setBusy ? <LuLoader className="h-4 w-4 animate-spin" /> : null}
              {setBusy ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
