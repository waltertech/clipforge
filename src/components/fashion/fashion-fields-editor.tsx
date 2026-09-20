"use client";

import {
  AD_TEMPLATE_EDIT_VOCAB,
  FASHION_MAX_SHOTS,
  FASHION_TOTAL_SECONDS_MAX,
  defaultFashionShotRoles,
  defaultFashionShotSeconds,
  sanitizeFashionFields,
  type AdTemplate,
  type FashionFields,
  type FashionLookSource,
  type FashionScriptPattern,
  type WordAnchor,
  type WordAnchorElement,
} from "@/lib/ad-templates";
import {
  addPose,
  fashionIssues,
  movePose,
  removePose,
  removeWordAnchor,
  setShotRole,
  setShotSeconds,
  toggleLock,
  upsertWordAnchor,
} from "@/lib/fashion-editor";
import { GARMENT_CATEGORIES, POSE_PRESETS, getPosePreset, type GarmentCategory } from "@/lib/pose-presets";
import { useLocale, useT } from "@/lib/i18n";
import type { Shot } from "@/lib/db/schema";

const EDITOR_INPUT_CLS =
  "w-full px-2 py-1.5 rounded-md text-xs border border-border/50 bg-background/60 outline-none focus:border-primary/60 placeholder:text-muted-foreground/60";

const CAT_KEYS: Record<GarmentCategory, string> = {
  tops: "catTops",
  bottoms: "catBottoms",
  "one-pieces": "catOnePieces",
  outerwear: "catOuterwear",
  shoes: "catShoes",
  accessory: "catAccessory",
};

const ROLE_KEYS: Record<Shot["type"], string> = {
  hook: "shotHook",
  pain_point: "shotPain",
  product_reveal: "shotReveal",
  demo: "shotDemo",
  social_proof: "shotProof",
  cta: "shotCta",
};

const ELEMENT_KEYS: Record<WordAnchorElement, string> = {
  price_card: "elementPrice",
  selling_point: "elementPoint",
  brand_tag: "elementBrand",
  sfx: "elementSfx",
  caption_emphasis: "elementCaption",
};

function withShotAlign(fields: FashionFields, roles: Shot["type"][], seconds: number[]): FashionFields {
  const n = fields.poseSequence.length;
  return {
    ...fields,
    shotRoles: fields.shotRoles?.length === n ? fields.shotRoles : roles,
    shotSeconds: fields.shotSeconds?.length === n ? fields.shotSeconds : seconds,
  };
}

export function FashionKindToggle({
  value,
  onChange,
}: {
  value: AdTemplate;
  onChange: (next: AdTemplate) => void;
}) {
  const t = useT("fashionEditor");
  const on = value.kind === "fashion";
  return (
    <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={on}
        onChange={(e) => {
          if (e.target.checked) {
            onChange({
              ...value,
              kind: "fashion",
              fashion: sanitizeFashionFields({}).fields,
            });
            return;
          }
          const next: AdTemplate = { ...value };
          delete next.kind;
          delete next.fashion;
          onChange(next);
        }}
      />
      <span>
        <span className="font-medium text-foreground">{t("kindToggle")}</span>
        <span className="block mt-0.5">{t("kindToggleHint")}</span>
      </span>
    </label>
  );
}

export function FashionFieldsEditor({
  value,
  onChange,
}: {
  value: AdTemplate;
  onChange: (next: AdTemplate) => void;
}) {
  const t = useT("fashionEditor");
  const locale = useLocale();
  if (value.kind !== "fashion") return null;
  const fields: FashionFields = value.fashion ?? sanitizeFashionFields({}).fields;
  const n = fields.poseSequence.length;
  const roles = fields.shotRoles?.length === n ? fields.shotRoles : defaultFashionShotRoles(n);
  const seconds = fields.shotSeconds?.length === n ? fields.shotSeconds : defaultFashionShotSeconds(n);
  const total = seconds.reduce((a, b) => a + b, 0);
  const lock = fields.lock ?? { face: true, garmentPattern: true, noOutfitChange: true };
  const slots = fields.slots ?? { model: true, garmentSet: true, hook: false };
  const selectedCats = new Set(fields.garmentCategories ?? []);
  const noneScript = fields.scriptPattern === "none";
  const issues = fashionIssues(fields);
  const poseLabel = (id: string) => {
    const p = getPosePreset(id);
    if (!p) return id;
    return locale === "zh" ? p.name.zh : p.name.en;
  };

  const patch = (next: FashionFields) => onChange({ ...value, kind: "fashion", fashion: next });
  const alignedFields = () => withShotAlign(fields, roles, seconds);

  return (
    <div className="space-y-3 pt-2 border-t border-border/40">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-foreground">{t("poseSection")}</p>
          <span className={`text-[11px] ${total > FASHION_TOTAL_SECONDS_MAX ? "text-destructive" : "text-muted-foreground"}`}>
            {t("totalSeconds", { n: total })}
          </span>
        </div>
        <div className="space-y-1.5">
          {fields.poseSequence.map((poseId, i) => (
            <div key={`${poseId}-${i}`} className="grid grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1fr)_4.5rem_auto] gap-1.5 items-center">
              <span className="text-[11px] text-muted-foreground text-right">{i}</span>
              <select
                value={POSE_PRESETS.some((p) => p.id === poseId) ? poseId : POSE_PRESETS[0]?.id}
                onChange={(e) => {
                  const poseSequence = [...fields.poseSequence];
                  poseSequence[i] = e.target.value;
                  patch({ ...fields, poseSequence });
                }}
                className={EDITOR_INPUT_CLS}
                aria-label={t("poseSection")}
              >
                {POSE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{locale === "zh" ? p.name.zh : p.name.en}</option>
                ))}
              </select>
              <select
                value={roles[i]}
                onChange={(e) => patch(setShotRole(fields, i, e.target.value as Shot["type"]))}
                className={EDITOR_INPUT_CLS}
                aria-label={t("role")}
              >
                {AD_TEMPLATE_EDIT_VOCAB.shotTypes.map((st) => (
                  <option key={st} value={st}>{t(ROLE_KEYS[st] ?? st)}</option>
                ))}
              </select>
              <input
                type="number"
                min={2}
                max={15}
                step={0.5}
                value={seconds[i]}
                onChange={(e) => patch(setShotSeconds(fields, i, Number(e.target.value)))}
                className={EDITOR_INPUT_CLS}
                aria-label={t("seconds")}
              />
              <div className="flex gap-0.5">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => patch(movePose(alignedFields(), i, i - 1))}
                  className="px-1.5 py-1 rounded text-[11px] border border-border/50 text-muted-foreground hover:border-primary/40 disabled:opacity-30"
                  title={t("moveUp")}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={i === n - 1}
                  onClick={() => patch(movePose(alignedFields(), i, i + 1))}
                  className="px-1.5 py-1 rounded text-[11px] border border-border/50 text-muted-foreground hover:border-primary/40 disabled:opacity-30"
                  title={t("moveDown")}
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={n <= 1}
                  onClick={() => patch(removePose(fields, i))}
                  className="px-1.5 py-1 rounded text-[11px] border border-border/50 text-muted-foreground hover:border-destructive/40 disabled:opacity-30"
                  title={t("remove")}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={n >= FASHION_MAX_SHOTS}
          onClick={() => patch(addPose(alignedFields(), "front_stand"))}
          className="px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("addPose")}
        </button>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">{t("lookSource")}</p>
        <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <input
            type="radio"
            name="fashion-look-source"
            className="mt-0.5"
            checked={fields.lookSource === "accepted"}
            onChange={() => patch({ ...fields, lookSource: "accepted" satisfies FashionLookSource })}
          />
          <span>
            <span className="text-foreground">{t("lookSourceAccepted")}</span>
            <span className="block">{t("lookSourceAcceptedHint")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <input
            type="radio"
            name="fashion-look-source"
            className="mt-0.5"
            checked={fields.lookSource === "grid"}
            onChange={() => patch({ ...fields, lookSource: "grid" satisfies FashionLookSource })}
          />
          <span>
            <span className="text-foreground">{t("lookSourceGrid")}</span>
            <span className="block">{t("lookSourceGridHint")}</span>
          </span>
        </label>
      </div>

      <label className="text-[11px] text-muted-foreground block">
        {t("scriptPattern")}
        <select
          value={fields.scriptPattern}
          onChange={(e) => patch({ ...fields, scriptPattern: e.target.value as FashionScriptPattern })}
          className={EDITOR_INPUT_CLS}
        >
          <option value="none">{t("scriptNone")}</option>
          <option value="voiceover">{t("scriptVoiceover")}</option>
          <option value="on-camera">{t("scriptOnCamera")}</option>
        </select>
      </label>

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">{t("garmentCategories")}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {GARMENT_CATEGORIES.map((cat) => (
            <label key={cat} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={selectedCats.has(cat)}
                onChange={(e) => {
                  const next = new Set(selectedCats);
                  if (e.target.checked) next.add(cat);
                  else next.delete(cat);
                  patch({
                    ...fields,
                    garmentCategories: next.size > 0 ? GARMENT_CATEGORIES.filter((c) => next.has(c)) : undefined,
                  });
                }}
              />
              {t(CAT_KEYS[cat])}
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {(["face", "garmentPattern", "noOutfitChange"] as const).map((key) => (
          <label key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={lock[key]}
              onChange={() => patch(toggleLock({ ...fields, lock }, key))}
            />
            {key === "face" ? t("lockFace") : key === "garmentPattern" ? t("lockPattern") : t("lockOutfit")}
          </label>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-[11px] text-muted-foreground">
          {t("negativeZh")}
          <textarea
            value={fields.negative.zh}
            maxLength={300}
            rows={3}
            onChange={(e) => patch({ ...fields, negative: { ...fields.negative, zh: e.target.value.slice(0, 300) } })}
            className={EDITOR_INPUT_CLS}
          />
        </label>
        <label className="text-[11px] text-muted-foreground">
          {t("negativeEn")}
          <textarea
            value={fields.negative.en}
            maxLength={300}
            rows={3}
            onChange={(e) => patch({ ...fields, negative: { ...fields.negative, en: e.target.value.slice(0, 300) } })}
            className={EDITOR_INPUT_CLS}
          />
        </label>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] text-muted-foreground">{t("slotsSection")}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {([
            ["model", "slotModel"],
            ["garmentSet", "slotGarmentSet"],
            ["hook", "slotHook"],
          ] as const).map(([key, labelKey]) => (
            <label key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={slots[key]}
                onChange={(e) => patch({ ...fields, slots: { ...slots, [key]: e.target.checked } })}
              />
              {t(labelKey)}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-medium text-foreground">{t("anchorsSection")}</p>
        {noneScript && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">{t("anchorsNoneHint")}</p>
        )}
        <div className="space-y-1.5">
          {(fields.wordAnchors ?? []).map((anchor, ai) => {
            const atMode = typeof anchor.at === "object" ? "keyword" : anchor.at;
            const nonSfx = noneScript && anchor.element !== "sfx";
            return (
              <div
                key={ai}
                className={`grid grid-cols-1 sm:grid-cols-[minmax(0,1.2fr)_auto_minmax(0,1fr)_minmax(0,1fr)_4.5rem_auto] gap-1.5 items-end ${nonSfx ? "opacity-50" : ""}`}
              >
                <label className="text-[11px] text-muted-foreground">
                  {t("anchorShot")}
                  <select
                    value={anchor.shot}
                    onChange={(e) => patch(upsertWordAnchor(fields, { ...anchor, shot: Number(e.target.value) }, ai))}
                    className={EDITOR_INPUT_CLS}
                  >
                    {fields.poseSequence.map((id, si) => (
                      <option key={`${id}-${si}`} value={si}>{si} {poseLabel(id)}</option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-muted-foreground">
                  {t("anchorAt")}
                  <select
                    value={atMode}
                    onChange={(e) => {
                      const v = e.target.value;
                      const at: WordAnchor["at"] =
                        v === "keyword"
                          ? { keyword: typeof anchor.at === "object" ? anchor.at.keyword : "" }
                          : (v as "first" | "last");
                      patch(upsertWordAnchor(fields, { ...anchor, at }, ai));
                    }}
                    className={EDITOR_INPUT_CLS}
                  >
                    <option value="first">{t("atFirst")}</option>
                    <option value="last">{t("atLast")}</option>
                    <option value="keyword">{t("atKeyword")}</option>
                  </select>
                </label>
                {atMode === "keyword" && (
                  <label className="text-[11px] text-muted-foreground sm:col-span-1">
                    {t("atKeyword")}
                    <input
                      value={typeof anchor.at === "object" ? anchor.at.keyword : ""}
                      maxLength={20}
                      placeholder={t("keywordPlaceholder")}
                      onChange={(e) =>
                        patch(upsertWordAnchor(fields, { ...anchor, at: { keyword: e.target.value.slice(0, 20) } }, ai))
                      }
                      className={EDITOR_INPUT_CLS}
                    />
                  </label>
                )}
                <label className="text-[11px] text-muted-foreground">
                  {t("anchorElement")}
                  <select
                    value={anchor.element}
                    onChange={(e) =>
                      patch(upsertWordAnchor(fields, { ...anchor, element: e.target.value as WordAnchorElement }, ai))
                    }
                    className={EDITOR_INPUT_CLS}
                  >
                    {(Object.keys(ELEMENT_KEYS) as WordAnchorElement[]).map((el) => (
                      <option key={el} value={el} disabled={noneScript && el !== "sfx"}>
                        {t(ELEMENT_KEYS[el])}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-muted-foreground">
                  {t("anchorPayload")}
                  <input
                    value={anchor.payload ?? ""}
                    maxLength={60}
                    onChange={(e) =>
                      patch(upsertWordAnchor(fields, { ...anchor, payload: e.target.value.slice(0, 60) || undefined }, ai))
                    }
                    className={EDITOR_INPUT_CLS}
                  />
                </label>
                <label className="text-[11px] text-muted-foreground">
                  {t("anchorSeconds")}
                  <input
                    type="number"
                    min={0.5}
                    max={15}
                    step={0.5}
                    value={anchor.seconds ?? ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const seconds = raw === "" ? undefined : Number(raw);
                      patch(upsertWordAnchor(fields, { ...anchor, seconds: Number.isFinite(seconds) ? seconds : undefined }, ai));
                    }}
                    className={EDITOR_INPUT_CLS}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => patch(removeWordAnchor(fields, ai))}
                  className="px-1.5 py-1 rounded text-[11px] border border-border/50 text-muted-foreground hover:border-destructive/40"
                  title={t("remove")}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() =>
            patch(upsertWordAnchor(fields, {
              shot: 0,
              at: "first",
              element: noneScript ? "sfx" : "selling_point",
            }))
          }
          className="px-2.5 py-1 rounded-full text-xs border border-border/50 bg-muted/20 text-muted-foreground hover:border-primary/40"
        >
          {t("addAnchor")}
        </button>
      </div>

      {issues.length === 0 ? (
        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{t("issuesOk")}</p>
      ) : (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 space-y-1">
          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">{t("issuesTitle")}</p>
          <ul className="list-disc pl-4 text-[11px] text-amber-800/90 dark:text-amber-300/90">
            {issues.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
