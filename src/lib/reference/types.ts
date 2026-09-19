import type { Shot } from "@/lib/db/schema";
import type { AdTemplate } from "@/lib/ad-templates";

export type ReferenceStage =
  | "queued"
  | "probe"
  | "scenes"
  | "asr"
  | "frames"
  | "read"
  | "derive"
  | "done"
  | "failed";

export interface ReferenceShotRead {
  index: number;
  start: number;
  end: number;
  role: Shot["type"];
  framing: "full" | "half" | "detail" | "other";
  poseText: string;
  poseId?: string;
  /** 0–1; below 0.5 the deriver falls back to front_stand and flags confirmation */
  poseConfidence: number;
  cameraText: string;
  cameraPresetId?: string;
  captionStyle?: "bold" | "standard" | "karaoke" | "minimal" | "none";
  onScreenText: string[];
  hasSpeech: boolean;
  onCamera: boolean;
  /** Words spoken in this shot from ASR if available */
  words?: string[];
  /** Relative file names under the job's frames/ directory */
  frames: string[];
}

export interface ReferenceJob {
  id: string;
  stage: ReferenceStage;
  createdAt: string;
  updatedAt: string;
  source: {
    kind: "upload" | "url";
    fileName: string;
    durationSec?: number;
    width?: number;
    height?: number;
  };
  shots?: ReferenceShotRead[];
  transcript?: { words: Array<{ w: string; s: number; e: number }> } | null;
  draft?: AdTemplate;
  needsConfirmation?: string[];
  error?: string;
}

export type SceneRange = { start: number; end: number };
