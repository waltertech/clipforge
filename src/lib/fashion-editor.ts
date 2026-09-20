/**
 * Pure helpers for the fashion-template editor.
 *
 * poseSequence is the source of truth for shot count. shotRoles / shotSeconds /
 * wordAnchors.shot must stay in lockstep when the sequence is reordered, grown,
 * or shrunk — otherwise a later sanitize would drop the arrays as mismatched.
 */
import {
  defaultFashionShotRoles,
  defaultFashionShotSeconds,
  FASHION_MAX_SHOTS,
  FASHION_SHOT_SECONDS_MAX,
  FASHION_SHOT_SECONDS_MIN,
  sanitizeFashionFields,
  type FashionFields,
  type WordAnchor,
} from "@/lib/ad-templates";
import type { Shot } from "@/lib/db/schema";

function cloneAnchor(a: WordAnchor): WordAnchor {
  return {
    ...a,
    at: typeof a.at === "object" ? { keyword: a.at.keyword } : a.at,
  };
}

/** Apply the same from→to permutation used by Array.splice to a parallel list. */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** oldIndex → newIndex after moving `from` to `to` in a list of length `n`. */
function indexMap(n: number, from: number, to: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  const moved = moveItem(order, from, to);
  const map = Array<number>(n);
  moved.forEach((old, neu) => {
    map[old] = neu;
  });
  return map;
}

export function movePose(fields: FashionFields, from: number, to: number): FashionFields {
  const n = fields.poseSequence.length;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return fields;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return fields;
  const map = indexMap(n, from, to);
  const poseSequence = moveItem(fields.poseSequence, from, to);
  const shotRoles =
    fields.shotRoles?.length === n ? moveItem(fields.shotRoles, from, to) : fields.shotRoles;
  const shotSeconds =
    fields.shotSeconds?.length === n ? moveItem(fields.shotSeconds, from, to) : fields.shotSeconds;
  const wordAnchors = fields.wordAnchors?.map((a) => ({
    ...cloneAnchor(a),
    shot: map[a.shot] ?? a.shot,
  }));
  return {
    ...fields,
    poseSequence,
    ...(shotRoles && { shotRoles }),
    ...(shotSeconds && { shotSeconds }),
    ...(wordAnchors && { wordAnchors }),
  };
}

export function addPose(fields: FashionFields, poseId: string): FashionFields {
  const n = fields.poseSequence.length;
  if (n >= FASHION_MAX_SHOTS) return fields;
  const poseSequence = [...fields.poseSequence, poseId];
  const shotRoles =
    fields.shotRoles?.length === n ? [...fields.shotRoles, "demo" as Shot["type"]] : fields.shotRoles;
  const lastSec = fields.shotSeconds?.length === n ? fields.shotSeconds[n - 1] : undefined;
  const shotSeconds =
    fields.shotSeconds?.length === n
      ? [...fields.shotSeconds, lastSec ?? defaultFashionShotSeconds(1)[0]]
      : fields.shotSeconds;
  return {
    ...fields,
    poseSequence,
    ...(shotRoles && { shotRoles }),
    ...(shotSeconds && { shotSeconds }),
  };
}

export function removePose(fields: FashionFields, index: number): FashionFields {
  const n = fields.poseSequence.length;
  if (!Number.isInteger(index) || index < 0 || index >= n || n <= 1) return fields;
  const poseSequence = fields.poseSequence.filter((_, i) => i !== index);
  const shotRoles =
    fields.shotRoles?.length === n ? fields.shotRoles.filter((_, i) => i !== index) : fields.shotRoles;
  const shotSeconds =
    fields.shotSeconds?.length === n
      ? fields.shotSeconds.filter((_, i) => i !== index)
      : fields.shotSeconds;
  const wordAnchors = fields.wordAnchors
    ?.filter((a) => a.shot !== index)
    .map((a) => ({
      ...cloneAnchor(a),
      shot: a.shot > index ? a.shot - 1 : a.shot,
    }));
  return {
    ...fields,
    poseSequence,
    ...(shotRoles && { shotRoles }),
    ...(shotSeconds && { shotSeconds }),
    wordAnchors,
  };
}

export function setShotRole(fields: FashionFields, index: number, role: Shot["type"]): FashionFields {
  const n = fields.poseSequence.length;
  if (!Number.isInteger(index) || index < 0 || index >= n) return fields;
  const shotRoles =
    fields.shotRoles?.length === n ? [...fields.shotRoles] : defaultFashionShotRoles(n);
  shotRoles[index] = role;
  return { ...fields, shotRoles };
}

export function setShotSeconds(fields: FashionFields, index: number, seconds: number): FashionFields {
  const n = fields.poseSequence.length;
  if (!Number.isInteger(index) || index < 0 || index >= n) return fields;
  const shotSeconds =
    fields.shotSeconds?.length === n ? [...fields.shotSeconds] : defaultFashionShotSeconds(n);
  const raw = Number.isFinite(seconds) ? seconds : FASHION_SHOT_SECONDS_MIN;
  const clamped = Math.min(
    FASHION_SHOT_SECONDS_MAX,
    Math.max(FASHION_SHOT_SECONDS_MIN, Math.round(raw * 2) / 2),
  );
  shotSeconds[index] = clamped;
  return { ...fields, shotSeconds };
}

export function upsertWordAnchor(
  fields: FashionFields,
  anchor: WordAnchor,
  index?: number,
): FashionFields {
  const wordAnchors = (fields.wordAnchors ?? []).map(cloneAnchor);
  const next = cloneAnchor(anchor);
  if (index !== undefined && Number.isInteger(index) && index >= 0 && index < wordAnchors.length) {
    wordAnchors[index] = next;
  } else {
    wordAnchors.push(next);
  }
  return { ...fields, wordAnchors };
}

export function removeWordAnchor(fields: FashionFields, index: number): FashionFields {
  const current = fields.wordAnchors ?? [];
  if (!Number.isInteger(index) || index < 0 || index >= current.length) return fields;
  const wordAnchors = current.filter((_, i) => i !== index).map(cloneAnchor);
  return { ...fields, wordAnchors: wordAnchors.length > 0 ? wordAnchors : undefined };
}

export function toggleLock(
  fields: FashionFields,
  key: keyof FashionFields["lock"],
): FashionFields {
  const lock = fields.lock ?? { face: true, garmentPattern: true, noOutfitChange: true };
  return { ...fields, lock: { ...lock, [key]: !lock[key] } };
}

export function fashionIssues(fields: FashionFields): string[] {
  return sanitizeFashionFields(fields).issues;
}
