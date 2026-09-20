#!/usr/bin/env node
/**
 * ClipForge CLI — generate a video from a topic in one command: auto-write script, match footage, add voiceover, and compose.
 *
 * Thin wrapper around the ClipForge HTTP API (same orchestration as mcp/clipforge-mcp.mjs: DB / FFmpeg / free TTS / free stock),
 * zero third-party deps, pure Node. Requires a running instance (pnpm dev / pnpm start). Stock + voiceover need no API key; only script generation needs an LLM key.
 *
 * Usage:
 *   node bin/clipforge.mjs create --topic "在家手冲咖啡" [--duration 25] [--style knowledge]
 *        [--footage auto|image|video] [--voice <id>] [--aspect 9:16|16:9|1:1]
 *        [--quality fast|standard|hd] [--bgm] [--bgm-mood upbeat] [--bgm-volume 5-40] [--audio-stems] [--karaoke] [--caption standard|bold|minimal|karaoke]
 *        [--cta "👇 点击下方下单"] [--json]
 *   node bin/clipforge.mjs compose --project <id> [same compose options]   compose an existing project with script + assets
 *   node bin/clipforge.mjs list                     list projects
 *   node bin/clipforge.mjs voices                   list free voices
 *   node bin/clipforge.mjs get --project <id>       fetch the latest composed video URL
 *   node bin/clipforge.mjs --help | --version
 *
 * Environment variables (same as MCP):
 *   CLIPFORGE_BASE_URL (default http://localhost:3000)
 *   CLIPFORGE_LLM_BASE_URL / CLIPFORGE_LLM_API_KEY / CLIPFORGE_LLM_MODEL (required for create, OpenAI-compatible)
 *   CLIPFORGE_PEXELS_KEY / CLIPFORGE_PIXABAY_KEY (optional, for supplemental paid high-quality video sources)
 *   CLIPFORGE_IMAGE_PROVIDER / CLIPFORGE_IMAGE_MODEL / CLIPFORGE_IMAGE_API_KEY / CLIPFORGE_IMAGE_BASE_URL (Look compose)
 *   CLIPFORGE_FASHN_API_KEY / CLIPFORGE_FASHN_BASE_URL (Look vton)
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, basename, resolve } from "path";

const BASE_URL = (process.env.CLIPFORGE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const LLM = {
  baseUrl: process.env.CLIPFORGE_LLM_BASE_URL || "",
  apiKey: process.env.CLIPFORGE_LLM_API_KEY || "",
  model: process.env.CLIPFORGE_LLM_MODEL || "",
};
const IMAGE = {
  provider: process.env.CLIPFORGE_IMAGE_PROVIDER || "",
  model: process.env.CLIPFORGE_IMAGE_MODEL || "",
  apiKey: process.env.CLIPFORGE_IMAGE_API_KEY || "",
  baseUrl: process.env.CLIPFORGE_IMAGE_BASE_URL || "",
};
const FASHN = {
  apiKey: process.env.CLIPFORGE_FASHN_API_KEY || "",
  baseUrl: process.env.CLIPFORGE_FASHN_BASE_URL || "",
};
const STOCK_KEYS = {};
if (process.env.CLIPFORGE_PIXABAY_KEY) STOCK_KEYS.pixabay = process.env.CLIPFORGE_PIXABAY_KEY;
if (process.env.CLIPFORGE_PEXELS_KEY) STOCK_KEYS.pexels = process.env.CLIPFORGE_PEXELS_KEY;

const NARRATION_STYLES = ["knowledge", "story", "lifestyle", "inspiration", "travel"];
const FOOTAGE_KINDS = ["auto", "image", "video"];
const ASPECT_RATIOS = ["9:16", "16:9", "1:1"];
const QUALITY_PRESETS = ["fast", "standard", "hd"];
const BGM_MOODS = ["upbeat", "chill", "energetic", "emotional"];
const CAPTION_PRESETS = ["standard", "bold", "minimal", "karaoke"]; // caption style presets (mirrors src/lib/caption-presets.ts)

function parseBgmVolume(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  const normalized = raw > 1 ? raw / 100 : raw;
  return normalized >= 0.05 && normalized <= 0.4 ? Math.round(normalized * 100) / 100 : null;
}

/** Read own package version (parent of bin/ is the repo root) */
function readVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Minimal argv parser (zero deps): first non-flag token becomes the subcommand; --key value reads a value, --flag sets true.
 * Exported for unit testing (see __tests__).
 */
export function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith("--")) {
      const eqBody = tok.slice(2);
      const eq = eqBody.indexOf("=");
      if (eq !== -1) {
        out.flags[eqBody.slice(0, eq)] = eqBody.slice(eq + 1); // --key=value syntax
        continue;
      }
      const key = eqBody;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.flags[key] = true; // boolean flag
      } else {
        out.flags[key] = next;
        i++;
      }
    } else {
      out._.push(tok);
    }
  }
  return out;
}

/** Build a compose request body from flags (equivalent to MCP composeBody, CLI-style input) */
export function composeBodyFromFlags(flags) {
  const body = { freeTts: { enabled: true } };
  if (typeof flags.voice === "string") body.freeTts.voice = flags.voice;
  if (ASPECT_RATIOS.includes(flags.aspect)) body.aspectRatio = flags.aspect;
  if (QUALITY_PRESETS.includes(flags.quality)) body.renderPreset = flags.quality;
  if (flags.bgm === true) body.freeBgm = true;
  if (BGM_MOODS.includes(flags["bgm-mood"])) body.bgmMood = flags["bgm-mood"];
  const bgmVolume = parseBgmVolume(flags["bgm-volume"]);
  if (bgmVolume !== null) body.bgmVolume = bgmVolume;
  if (flags["audio-stems"] === true) body.exportAudioStems = true;
  if (flags["bgm-duck"] === true) body.bgmDuck = true;
  if (flags.karaoke === true) body.karaoke = true;
  if (CAPTION_PRESETS.includes(flags.caption)) body.captionPreset = flags.caption;
  if (flags["product-card"] === true) body.productCard = true;
  // AIGC visible badge is ON by default (2026-07 platform labeling rules); --no-ai-badge opts out.
  // --ai-disclosure is kept as an accepted no-op for backward compatibility (it used to opt in).
  if (flags["no-ai-badge"] === true) body.aigcBadge = false;
  if (typeof flags.cta === "string" && flags.cta.trim()) body.ctaText = flags.cta.trim();
  return body;
}

/** Pick a default free voice based on topic language (same logic as MCP defaultVoiceForTopic); null = use server-side Chinese default */
export function defaultVoiceForTopic(topic) {
  const t = String(topic || "");
  if (/[぀-ヿ]/.test(t)) return "ja-JP-NanamiNeural";
  if (/[가-힯]/.test(t)) return "ko-KR-SunHiNeural";
  if (/[一-鿿]/.test(t)) return null;
  return "en-US-AriaNeural";
}

/** Call the ClipForge HTTP API; throws with the backend error message on non-2xx responses */
async function api(path, { method = "GET", body, timeoutMs = 600000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res, text;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`请求超时：${path}`);
    throw new Error(`连不上 ClipForge（${BASE_URL}）。请先启动实例：pnpm dev 或 pnpm start。原始错误：${e?.message || e}`);
  } finally {
    clearTimeout(timer);
  }
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.raw || `HTTP ${res.status}`);
    err.payload = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Poll the compose result until done/failed.
 * Pass the compositionId returned by POST to poll that exact run — polling "latest" is racy when
 * concurrent composes (retries, A/B variants) exist. No-id fallback kept for older servers whose
 * GET does not support ?compositionId=. Client deadline (660s) intentionally exceeds the server-side
 * render timeout (600s, composer COMPOSE_TIMEOUT_MS) so slow-but-successful renders aren't misreported.
 */
async function pollCompose(projectId, { compositionId, timeoutMs = 660000, intervalMs = 2500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const query = compositionId ? `?compositionId=${encodeURIComponent(compositionId)}` : "";
  for (;;) {
    const { composition } = await api(`/api/project/${projectId}/compose${query}`);
    const status = composition?.status;
    if (status === "done") return composition;
    if (status === "failed") throw new Error("合成失败（FFmpeg/TTS 出错），请检查素材与脚本");
    if (Date.now() > deadline) throw new Error("合成超时，可稍后用 `get --project` 再查");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const absVideoUrl = (c) => (c?.url ? `${BASE_URL}${c.url}` : null);
/** Progress goes to stderr (stdout is reserved for the final result, so scripts can pipe the videoUrl) */
const step = (m) => process.stderr.write(`· ${m}\n`);

function requireLlm() {
  if (!LLM.baseUrl || !LLM.apiKey || !LLM.model) {
    throw new Error(
      "create 需要 LLM。请设置环境变量 CLIPFORGE_LLM_BASE_URL、CLIPFORGE_LLM_API_KEY、CLIPFORGE_LLM_MODEL（OpenAI 兼容，如 Atlas Cloud / DeepSeek / OpenRouter）。",
    );
  }
}

/**
 * Judge pass — the same quality bar the web hands-off chains run: five narrow judges
 * (pacing / spoken voice / freshness / structure / visuals) tear the lines apart and
 * their length-preserving rewrites are applied in place BEFORE footage/voice work.
 * Best-effort: any failure returns 0 and the chain continues with the original lines.
 * Returns the number of rewritten lines.
 */
async function judgePass(projectId, scriptId) {
  if (!scriptId) return 0;
  try {
    const report = await api(`/api/project/${projectId}/script-judge`, {
      method: "POST",
      body: { scriptId, llmConfig: LLM },
    });
    // tier gate (judge v2): auto-apply invariant/default only — taste tier is opinion, not defect;
    // the visual judge's description rewrites ride the same shotTexts PATCH
    const gated = (rows) => (Array.isArray(rows) ? rows.filter((r) => r.tier !== "taste") : []);
    const shotTexts = new Map();
    for (const r of gated(report?.rewrites)) shotTexts.set(r.shotId, { shotId: r.shotId, voiceover: r.voiceover });
    for (const r of gated(report?.descriptionRewrites)) {
      shotTexts.set(r.shotId, { ...(shotTexts.get(r.shotId) ?? { shotId: r.shotId }), description: r.description });
    }
    if (shotTexts.size === 0) return 0;
    await api(`/api/project/${projectId}/scripts`, {
      method: "PATCH",
      body: { scriptId, shotTexts: Array.from(shotTexts.values()) },
    });
    return shotTexts.size;
  } catch {
    return 0;
  }
}

async function cmdCreate(flags) {
  requireLlm();
  const topic = String(flags.topic || "").trim();
  if (topic.length < 2) throw new Error("--topic 太短，请给一句完整主题，如 --topic \"在家手冲咖啡\"");
  const narrationStyle = NARRATION_STYLES.includes(flags.style) ? flags.style : "knowledge";
  const targetDuration = Number.isFinite(Number(flags.duration)) && flags.duration ? Number(flags.duration) : 25;
  const mediaType = FOOTAGE_KINDS.includes(flags.footage) ? flags.footage : "auto";

  step(`写脚本：「${topic}」（${narrationStyle} · ${targetDuration}s）`);
  const scriptRes = await api("/api/topic/script", {
    method: "POST",
    body: { topic, narrationStyle, targetDuration, llmConfig: LLM },
  });
  const projectId = scriptRes.projectId;
  const shots = scriptRes?.scripts?.[0]?.shots ?? [];
  step(`脚本完成：${shots.length} 个分镜 · 项目 ${projectId}`);

  // judge pass: weak lines get rewritten before any footage/voice work (best-effort, never fatal)
  const judged = await judgePass(projectId, scriptRes?.scripts?.[0]?.id);
  if (judged) step(`判官团过词：重写 ${judged} 句`);

  step(`配画面（${mediaType}，免费素材库）…`);
  const fill = await api(`/api/project/${projectId}/stock-fill`, {
    method: "POST",
    body: { source: "all", mediaType, apiKeys: STOCK_KEYS, ...(LLM.baseUrl && LLM.model ? { llmConfig: LLM } : {}) },
  });
  if (!fill.filled) {
    throw new Error(
      `免费素材库没给「${topic}」配到画面，无法合成。换个更常见/具体的主题，或设置 CLIPFORGE_PEXELS_KEY 后重试。`,
    );
  }
  step(`画面就绪：${fill.filled}/${fill.total}${fill.sameSourceHits ? ` · 同源连贯 ${fill.sameSourceHits} 镜` : ""}`);

  const body = composeBodyFromFlags(flags);
  if (!body.freeTts.voice) {
    const v = defaultVoiceForTopic(topic);
    if (v) body.freeTts.voice = v;
  }
  const usedVoice = body.freeTts.voice || "zh-CN-XiaoxiaoNeural";
  step(`合成中（Edge TTS 配音 · 音色 ${usedVoice}）…`);
  // POST returns the compositionId of this run — poll that exact one, not "latest"
  const { compositionId } = await api(`/api/project/${projectId}/compose`, { method: "POST", body });
  const composition = await pollCompose(projectId, { compositionId });

  return {
    ok: true,
    projectId,
    topic,
    voice: usedVoice,
    aspectRatio: ASPECT_RATIOS.includes(flags.aspect) ? flags.aspect : "9:16",
    shots: shots.length,
    footageFilled: `${fill.filled}/${fill.total}`,
    videoUrl: absVideoUrl(composition),
    status: composition.status,
  };
}

// Product link → commerce script (→ optional full render). Chains ingest + /api/llm/script so a
// single command turns a shop URL into a ready带货脚本; add --compose to render all the way to a video.
async function cmdProduct(flags) {
  requireLlm();
  const url = String(flags.url || "").trim();
  if (!/^https?:\/\/.+/i.test(url)) throw new Error('--url 必须是合法的 http/https 商品链接，如 --url "https://item.example.com/123"');

  step(`抓取商品信息：${url}`);
  const ingest = await api("/api/ingest/product", { method: "POST", body: { url, createProject: true } });
  const projectId = ingest.projectId;
  if (!projectId) throw new Error("未能从该链接建项目（可能被反爬或缺少标准商品标签），请换一个链接。");
  const productName = ingest.product?.title?.trim();
  if (!productName) throw new Error("未能解析出商品标题，无法生成带货脚本，请换一个带标准 OG/JSON-LD 标签的链接。");
  step(`商品：${productName}${ingest.product?.priceText ? ` · ${ingest.product.priceText}` : ""} · 图 ${ingest.productImages?.length ?? 0} 张`);

  const styleType = ["pain_point", "scene", "comparison", "story", "drama", "reversal", "interview", "unboxing", "product_pov", "talking_head", "auto"].includes(flags.style) ? flags.style : "auto";
  const targetDuration = Number.isFinite(Number(flags.duration)) && flags.duration ? Number(flags.duration) : 30;
  step(`写带货脚本（${styleType} · ${targetDuration}s）…`);
  const scriptRes = await api("/api/llm/script", {
    method: "POST",
    body: {
      projectId,
      productName,
      productDescription: ingest.product?.description ?? "",
      productImages: ingest.productImages ?? [],
      ...(flags.category ? { category: String(flags.category) } : {}),
      styleType,
      targetDuration,
      llmConfig: LLM,
    },
  });
  const scripts = Array.isArray(scriptRes?.scripts) ? scriptRes.scripts : [];
  step(`脚本完成：${scripts.length} 套方案 · 项目 ${projectId}`);

  // Without --compose, stop at scripts (mirrors clipforge_product_script MCP tool)
  if (!flags.compose) {
    step(`下一步：clipforge compose --project ${projectId}（配画面+配音+合成出片）`);
    return { ok: true, projectId, product: ingest.product ?? null, scripts: scripts.length };
  }

  // --compose: go all the way to a rendered video (product-image + free stock fill)
  // judge pass on the selected (first) variant — the compose below reads the same one
  const judged = await judgePass(projectId, scripts[0]?.id);
  if (judged) step(`判官团过词：重写 ${judged} 句`);

  const mediaType = FOOTAGE_KINDS.includes(flags.footage) ? flags.footage : "auto";
  step(`配画面（${mediaType}，商品图 + 免费素材库）…`);
  const fill = await api(`/api/project/${projectId}/stock-fill`, {
    method: "POST",
    body: { source: "all", mediaType, apiKeys: STOCK_KEYS, ...(LLM.baseUrl && LLM.model ? { llmConfig: LLM } : {}) },
  });
  step(`画面就绪：${fill.filled ?? 0}/${fill.total ?? 0}${fill.sameSourceHits ? ` · 同源连贯 ${fill.sameSourceHits} 镜` : ""}`);

  const body = composeBodyFromFlags(flags);
  const usedVoice = body.freeTts.voice || "zh-CN-XiaoxiaoNeural";
  step(`合成中（Edge TTS 配音 · 音色 ${usedVoice}）…`);
  const { compositionId } = await api(`/api/project/${projectId}/compose`, { method: "POST", body });
  const composition = await pollCompose(projectId, { compositionId });
  return {
    ok: true,
    projectId,
    product: ingest.product ?? null,
    scripts: scripts.length,
    voice: usedVoice,
    footageFilled: `${fill.filled ?? 0}/${fill.total ?? 0}`,
    videoUrl: absVideoUrl(composition),
    status: composition.status,
  };
}

async function cmdCompose(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  if (flags["no-fill"] !== true) {
    step("自动配缺失画面…");
    await api(`/api/project/${projectId}/stock-fill`, {
      method: "POST",
      body: { source: "all", mediaType: FOOTAGE_KINDS.includes(flags.footage) ? flags.footage : "auto", apiKeys: STOCK_KEYS, ...(LLM.baseUrl && LLM.model ? { llmConfig: LLM } : {}) },
    }).catch(() => {});
  }
  const body = composeBodyFromFlags(flags);
  if (!body.freeTts.voice) {
    const proj = await api(`/api/project/${projectId}`).catch(() => null);
    const v = proj?.topic ? defaultVoiceForTopic(String(proj.topic)) : null;
    if (v) body.freeTts.voice = v;
  }
  step("合成中…");
  // POST returns the compositionId of this run — poll that exact one, not "latest"
  const { compositionId } = await api(`/api/project/${projectId}/compose`, { method: "POST", body });
  const composition = await pollCompose(projectId, { compositionId });
  return { ok: true, projectId, voice: body.freeTts.voice || "zh-CN-XiaoxiaoNeural", videoUrl: absVideoUrl(composition), status: composition.status };
}

async function cmdList() {
  const rows = await api("/api/project");
  const projects = (Array.isArray(rows) ? rows : []).map((p) => ({ id: p.id, name: p.name, contentType: p.contentType, status: p.status }));
  return { ok: true, count: projects.length, projects };
}

async function cmdVoices() {
  const res = await api("/api/tts/free");
  return { ok: true, default: res.default, voices: res.voices ?? [] };
}

// Cover/thumbnail: render a cover image from the latest composed video with a bold title overlay
async function cmdCover(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const title = String(flags.title || "").trim();
  if (!title) throw new Error('--title 不能为空（如 --title "手冲咖啡 三步搞定"）');
  const body = { title };
  if (["center", "lower", "upper"].includes(flags.position)) body.position = flags.position;
  if (flags.frame && Number.isFinite(Number(flags.frame))) body.frameAt = Number(flags.frame);
  const res = await api(`/api/project/${projectId}/cover`, { method: "POST", body });
  step(`封面已生成：${res.cover}`);
  return { ok: true, projectId, cover: res.cover };
}

// Shop QR: generate a scannable "scan to buy" QR for the project's shop link (UTM-tagged)
async function cmdQr(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (typeof flags.url === "string" && flags.url.trim()) body.url = flags.url.trim();
  if (typeof flags.platform === "string" && flags.platform.trim()) body.platform = flags.platform.trim();
  if (flags.size && Number.isFinite(Number(flags.size))) body.size = Number(flags.size);
  const res = await api(`/api/project/${projectId}/shop-qr`, { method: "POST", body });
  step(`商品二维码已生成：${res.qr}`);
  if (res.shopLink) step(`追踪链接：${res.shopLink}`);
  if (res.warning?.zh) step(`⚠️ ${res.warning.zh}`);
  return { ok: true, projectId, qr: res.qr, shopLink: res.shopLink };
}

// End-card: burn a "scan to buy" QR onto the last few seconds of the composed video
async function cmdEndcard(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (typeof flags.url === "string" && flags.url.trim()) body.url = flags.url.trim();
  if (typeof flags.platform === "string" && flags.platform.trim()) body.platform = flags.platform.trim();
  // --force overrides the douyin off-site-diversion refusal (in-video QR risks shop-window closure there)
  if (flags.force === true) body.force = true;
  if (flags.seconds && Number.isFinite(Number(flags.seconds))) body.seconds = Number(flags.seconds);
  if (typeof flags.cta === "string" && flags.cta.trim()) body.ctaText = flags.cta.trim();
  const res = await api(`/api/project/${projectId}/end-card`, { method: "POST", body });
  step(`片尾扫码购买成片已生成：${res.video}`);
  if (res.warning?.zh) step(`⚠️ ${res.warning.zh}`);
  return { ok: true, projectId, video: res.video, shopLink: res.shopLink };
}

// Native feel: hand-shot look post-process (handheld micro-jitter + grain + de-polish color)
async function cmdNative(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (flags.strength === "medium" || flags.strength === "subtle") body.strength = flags.strength;
  if (flags.seed && Number.isFinite(Number(flags.seed))) body.seed = Number(flags.seed);
  if (flags["no-grain"]) body.grain = false;
  if (flags.vignette) body.vignette = true;
  const res = await api(`/api/project/${projectId}/native-feel`, { method: "POST", body });
  step(`原生感成片已生成（${res.strength}）：${res.video}`);
  return { ok: true, projectId, video: res.video, strength: res.strength };
}

// Credits: export the asset license manifest (per-shot provenance + commercial-risk flags + attribution lines)
async function cmdCredits(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const lang = flags.lang === "en" ? "en" : "zh";
  if (flags.format === "md") {
    const res = await api(`/api/project/${projectId}/credits?format=md&lang=${lang}`);
    // markdown comes back as text (api() wraps non-JSON as { raw }) — print it verbatim for piping to a file
    process.stdout.write(typeof res.raw === "string" ? res.raw : JSON.stringify(res, null, 2));
    return { ok: true, projectId };
  }
  const m = await api(`/api/project/${projectId}/credits`);
  step(`素材 ${m.summary.total} 项：需署名 ${m.summary.needsAttribution}，需人工复核 ${m.summary.needsReview}`);
  step(m.summary.commercialSafe ? "✓ 未发现商用限制素材" : "⚠ 有素材需人工复核，投流前请确认或替换");
  for (const i of [...(m.items || []), ...(m.bgm ? [m.bgm] : [])]) {
    if (i.attributionLine) step(`署名: ${i.attributionLine}`);
    if (i.risk === "review") step(`复核: ${i.shotId >= 0 ? `分镜${i.shotId + 1}` : "BGM"} · ${i.license || "许可未知"}`);
  }
  return { ok: true, projectId, summary: m.summary, items: m.items, bgm: m.bgm };
}

// Release gate: one aggregated pre-publish verdict (script readiness + video QC + asset licenses).
// Exit code 2 when the gate blocks (fail, or warn under --strict) so shell scripts and agents can gate on it.
async function cmdGate(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (typeof flags.composition === "string" && flags.composition.trim()) body.compositionId = flags.composition.trim();
  const res = await api(`/api/project/${projectId}/gate`, { method: "POST", body });
  const icon = { pass: "✓", warn: "⚠", fail: "✗" };
  for (const item of res.report?.items || []) {
    step(`${icon[item.status] || "·"} ${item.message?.zh || item.id}`);
    for (const p of item.problems || []) step(`    · ${p.zh || p.en || ""}`);
  }
  const status = res.report?.status;
  step(res.report?.verdict?.zh || (status === "pass" ? "发布门禁通过" : "发布门禁未通过"));
  const blocked = status === "fail" || (flags.strict === true && status !== "pass");
  if (blocked && flags.strict === true && status === "warn") step("（--strict 模式：警告项也视为拦截）");
  return { ok: !blocked, projectId, status, report: res.report, exitCode: blocked ? 2 : 0 };
}

// Platform export: re-encode the latest composed video to a platform's specs with the
// anti-recompression bitrate cap, and print the measured-vs-line report
async function cmdExport(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const platform = String(flags.platform || "").trim();
  if (!platform) throw new Error("--platform 不能为空（douyin|kuaishou|xiaohongshu|shipinhao|tiktok|reels|shorts）");
  const body = { platform };
  if (typeof flags.composition === "string" && flags.composition.trim()) body.compositionId = flags.composition.trim();
  const res = await api(`/api/project/${projectId}/export-platform`, { method: "POST", body });
  step(`${res.platformName} 导出完成（${res.size}）：${res.url}`);
  if (res.report) step(`${res.report.withinCap ? "✓" : "⚠"} ${res.report.message?.zh || ""}`);
  return { ok: true, projectId, compositionId: res.compositionId ?? null, platform, url: res.url, size: res.size, report: res.report };
}

// QC: run the automated quality check over the latest composed video (black frames / silence / loudness / streams)
async function cmdQc(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (typeof flags.composition === "string" && flags.composition.trim()) body.compositionId = flags.composition.trim();
  const res = await api(`/api/project/${projectId}/qc`, { method: "POST", body });
  const icon = { ok: "✓", warn: "⚠", fail: "✗" };
  for (const c of res.checks || []) step(`${icon[c.level] || "·"} ${c.message?.zh || c.id}`);
  step(res.status === "ok" ? "质检通过" : res.status === "warn" ? "质检有警告，建议人工复核" : "质检不通过，请勿直接发布");
  return { ok: res.status !== "fail", projectId, status: res.status, checks: res.checks };
}

// Local master: analyze shot-boundary continuity and loudness by default; only
// create a new non-destructive composition when --apply names an explicit operation.
async function cmdMaster(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const apply = flags.apply === true;
  const normalizeAudio = flags["normalize-audio"] === true;
  const deflicker = flags.deflicker === true;
  if (!apply && (normalizeAudio || deflicker)) {
    throw new Error("--normalize-audio / --deflicker 需要同时添加 --apply；不加处理项时默认只分析");
  }
  if (apply && !normalizeAudio && !deflicker) {
    throw new Error("--apply 需要至少选择 --normalize-audio 或 --deflicker");
  }
  const body = { action: apply ? "render" : "analyze" };
  if (typeof flags.composition === "string" && flags.composition.trim()) body.compositionId = flags.composition.trim();
  if (apply) {
    body.normalizeAudio = normalizeAudio;
    body.deflicker = deflicker;
    if (typeof flags.label === "string" && flags.label.trim()) body.label = flags.label.trim();
  }
  const res = await api(`/api/project/${projectId}/mastering`, { method: "POST", body });
  const analysis = res.analysis || {};
  const summary = analysis.summary || {};
  const loudness = analysis.loudness;
  step(`连续性分析：${summary.total || 0} 个切点，${(summary.review || 0) + (summary.strong || 0)} 个建议复核`);
  if (loudness) step(`整片响度：${Number(loudness.inputI).toFixed(1)} LUFS，真峰值 ${Number(loudness.inputTp).toFixed(1)} dBTP`);
  if (analysis.recommendations?.normalizeAudio) step("建议：可启用两遍响度母版（--apply --normalize-audio）");
  for (const item of (analysis.boundaries || []).filter((entry) => entry.level !== "ok")) {
    step(`⚠ ${Number(item.at).toFixed(2)}s · 连续性 ${item.score}/100 · 亮度差 ${item.lumaDelta}% · 色度差 ${item.chromaDelta}%`);
  }
  if (!apply) return { ok: true, projectId, compositionId: res.compositionId, analysis };
  step(`母版版本已提交：${res.compositionId}`);
  if (flags["no-wait"] === true) {
    return { ok: true, projectId, compositionId: res.compositionId, status: res.status, analysis, options: res.options };
  }
  const composition = await pollCompose(projectId, { compositionId: res.compositionId });
  return {
    ok: true,
    projectId,
    compositionId: composition.id,
    status: composition.status,
    videoUrl: absVideoUrl(composition),
    analysis,
    options: res.options,
  };
}

// GIF preview: turn a slice of the latest composed video into a shareable looping GIF
async function cmdPreview(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (flags.start && Number.isFinite(Number(flags.start))) body.startSec = Number(flags.start);
  if (flags.duration && Number.isFinite(Number(flags.duration))) body.durationSec = Number(flags.duration);
  if (flags.width && Number.isFinite(Number(flags.width))) body.width = Number(flags.width);
  const res = await api(`/api/project/${projectId}/preview-gif`, { method: "POST", body });
  step(`预览 GIF 已生成：${res.gif}`);
  return { ok: true, projectId, gif: res.gif };
}

// Contact sheet: one PNG overview of the latest composed video for eyeball QC.
// Smart mode (default) samples real scene cuts and marks splice points; --proxy adds a
// short-side-720 review clip with burned-in timecode for frame-accurate human feedback.
async function cmdSheet(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (flags.frames && Number.isFinite(Number(flags.frames))) body.frames = Number(flags.frames);
  if (flags["thumb-width"] && Number.isFinite(Number(flags["thumb-width"]))) body.thumbWidth = Number(flags["thumb-width"]);
  if (flags.mode === "even" || flags.mode === "smart") body.mode = flags.mode;
  if (flags.proxy === true) body.proxy = true;
  const res = await api(`/api/project/${projectId}/contact-sheet`, { method: "POST", body });
  const cutNote = res.mode === "smart" ? `，检测到 ${(res.cuts || []).length} 个拼接点` : "";
  step(`成片速览已生成：${res.sheet}（${res.layout.frames} 帧胶片条${res.layout.waveHeight ? " + 波形" : ""}${cutNote}）`);
  if (res.proxy) step(`审片小样（720p+时间码）：${res.proxy}`);
  return { ok: true, projectId, ...res };
}

// Carousel: render image cards (title + key lines) from the script for image-first platforms (Xiaohongshu)
async function cmdCarousel(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const body = {};
  if (flags.width && Number.isFinite(Number(flags.width))) body.width = Number(flags.width);
  if (flags.height && Number.isFinite(Number(flags.height))) body.height = Number(flags.height);
  if (typeof flags.theme === "string") body.theme = flags.theme;
  const res = await api(`/api/project/${projectId}/carousel`, { method: "POST", body });
  step(`图文卡片已生成 ${res.count} 张：`);
  (res.cards || []).forEach((c, i) => process.stderr.write(`  ${i}. ${c}\n`));
  return { ok: true, projectId, count: res.count, cards: res.cards };
}

// Trending topics: suggest what topic to produce next (then use create --topic).
// Default = domestic boards (Douyin hot search / Toutiao fallback, matching the web landing page);
// pass --geo for Google Trends daily searches of a region instead.
async function cmdTrends(flags) {
  const geo = typeof flags.geo === "string" ? flags.geo : "";
  const res = await api(geo ? `/api/trends?geo=${encodeURIComponent(geo)}` : "/api/trends?source=cn");
  const topics = res.topics || [];
  step(`${res.geo || res.source || "cn"} 热搜选题 ${topics.length} 条：`);
  topics.forEach((t, i) => process.stderr.write(`  ${i + 1}. ${t.title}${t.traffic ? ` (${t.traffic})` : ""}\n`));
  return { ok: true, source: res.source, geo: res.geo, count: topics.length, topics };
}

async function cmdGet(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const { composition } = await api(`/api/project/${projectId}/compose`);
  if (!composition) return { ok: true, projectId, status: "none", videoUrl: null, timelineUrl: null };
  return {
    ok: true,
    projectId,
    status: composition.status,
    videoUrl: absVideoUrl(composition),
    timelineUrl: composition.timelineUrl ? `${BASE_URL}${composition.timelineUrl}` : null,
  };
}

async function cmdClips(flags) {
  const projectId = String(flags.project || "").trim();
  const mediaId = String(flags.media || "").trim();
  if (!projectId || !mediaId) throw new Error("--project 和 --media 不能为空");
  const params = new URLSearchParams({ query: String(flags.query ?? ""), targetSeconds: String(flags.seconds ?? 30), limit: String(flags.limit ?? 6) });
  return api(`/api/project/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/clips?${params}`);
}

async function cmdTranscriptInspect(flags) {
  const projectId = String(flags.project || "").trim();
  const mediaId = String(flags.media || "").trim();
  if (!projectId || !mediaId) throw new Error("--project 和 --media 不能为空");
  const offset = Number.isInteger(Number(flags.offset)) ? Math.max(0, Number(flags.offset)) : 0;
  const limit = Number.isInteger(Number(flags.limit)) ? Math.min(2000, Math.max(1, Number(flags.limit))) : 500;
  return api(`/api/project/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/edit?offset=${offset}&limit=${limit}`);
}

async function cmdTranscriptEdit(flags) {
  const projectId = String(flags.project || "").trim();
  const mediaId = String(flags.media || "").trim();
  if (!projectId || !mediaId) throw new Error("--project 和 --media 不能为空");
  if (!flags.plan) throw new Error("用 --plan <edit-plan.json> 提供网页导出的剪辑计划");
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(String(flags.plan), "utf8"));
  } catch (error) {
    throw new Error(`剪辑计划 JSON 无法读取：${error?.message || error}`);
  }
  const plan = envelope?.plan && typeof envelope.plan === "object" ? envelope.plan : envelope;
  const revisionValue = flags.revision ?? envelope?.baseRevision;
  const baseRevision = Number(revisionValue);
  if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new Error("--revision 必须是 transcript 返回的 latestRevision，或写在计划 JSON 的 baseRevision");
  const apply = flags.apply === true;
  const operationId = String(flags.operation || envelope?.operationId || "").trim();
  if (apply && !operationId) throw new Error("--apply 必须搭配 --operation <稳定ID>，或使用网页导出的 operationId；重试时复用同一个值");
  const result = await api(`/api/project/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/edit`, {
    method: "POST",
    body: {
      action: apply ? "apply" : "preview",
      operationId: operationId || undefined,
      actor: "cli",
      baseRevision,
      plan,
    },
  });
  step(apply ? "剪辑版本已提交；可用 transcript 命令查询 latestEdit.status" : "dry-run 完成：未写库、未渲染；确认 diff 后再加 --apply");
  return { ok: true, projectId, mediaId, ...result };
}

async function cmdTimelineExport(flags) {
  const projectId = String(flags.project || "").trim();
  const mediaId = String(flags.media || "").trim();
  if (!projectId || !mediaId) throw new Error("--project 和 --media 不能为空");
  if (!flags.plan) throw new Error("用 --plan <edit-plan.json> 提供网页导出的剪辑计划");
  const format = ["otio", "edl", "csv"].includes(flags.format) ? flags.format : "otio";
  let envelope;
  try {
    envelope = JSON.parse(readFileSync(String(flags.plan), "utf8"));
  } catch (error) {
    throw new Error(`剪辑计划 JSON 无法读取：${error?.message || error}`);
  }
  const plan = envelope?.plan && typeof envelope.plan === "object" ? envelope.plan : envelope;
  const revision = Number(flags.revision ?? envelope?.baseRevision);
  const result = await api(`/api/project/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}/timeline`, {
    method: "POST",
    body: { format, plan, inline: true, ...(Number.isInteger(revision) && revision > 0 ? { revision } : {}) },
  });
  const outputPath = String(flags.out || result.fileName || `clipforge-draft.${format}`);
  writeFileSync(outputPath, result.content, "utf8");
  step(`专业时间线已导出：${outputPath}（${result.clips} 段 · ${result.frameRate}fps）`);
  return { ok: true, projectId, mediaId, format, outputPath, clips: result.clips, duration: result.duration, frameRate: result.frameRate };
}

// Import your own script: split a pre-written script into shots and save as the current script, then use compose to render (combine with local assets for a fully self-sufficient pipeline)
async function cmdImport(flags) {
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  let script = typeof flags.text === "string" ? flags.text : "";
  if (!script && flags.file) script = readFileSync(String(flags.file), "utf8");
  if (!script.trim()) throw new Error('用 --file <路径> 或 --text "你的脚本文案" 提供稿子');
  const res = await api(`/api/project/${projectId}/import-script`, {
    method: "POST",
    body: { script, title: typeof flags.title === "string" ? flags.title : undefined },
  });
  step(`已导入 ${res.shots} 个分镜（约 ${res.totalDuration}s）。下一步：clipforge compose --project ${projectId}`);
  return { ok: true, projectId, ...res };
}

// Dubbing / localization: translate the current script into the target language and save as a dubbed version; compose with the recommended voice to produce a localized voiceover (for international distribution)
async function cmdDub(flags) {
  requireLlm();
  const projectId = String(flags.project || "").trim();
  if (!projectId) throw new Error("--project 不能为空");
  const lang = String(flags.lang || "").trim();
  if (!lang) throw new Error('--lang 不能为空（如 --lang en）');
  const res = await api(`/api/project/${projectId}/dub`, { method: "POST", body: { targetLang: lang, llmConfig: LLM } });
  step(`已生成 ${lang} 译制脚本（${res.shots} 镜）。下一步：clipforge compose --project ${projectId} --voice ${res.recommendedVoice || "<目标语种音色>"}`);
  return { ok: true, projectId, ...res };
}

const GARMENT_CATEGORIES = ["tops", "bottoms", "one-pieces", "outerwear", "shoes", "accessory"];
const GARMENT_VIEWS = ["flat", "on-model"];
const TRYON_ROUTES = ["compose", "vton"];
/** Keep in sync with src/lib/pose-presets.ts */
const FASHION_POSE_IDS = ["front_stand", "three_quarter", "side", "back", "walk_toward", "hands_pocket", "seated", "detail_torso"];

function slugId(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "presenter";
}

function optionalLlm() {
  if (!LLM.baseUrl || !LLM.model) return undefined;
  return { baseUrl: LLM.baseUrl, apiKey: LLM.apiKey || "", model: LLM.model };
}

function estimateLookCalls({ route, poses, garments, scoring }) {
  const r = route === "vton" ? "vton" : "compose";
  const poseN = Math.max(0, Number(poses) || 0);
  const garmentN = Math.max(0, Number(garments) || 0);
  return {
    poses: poseN,
    garments: garmentN,
    calls: {
      image: r === "compose" ? poseN : 0,
      tryon: r === "vton" ? poseN * garmentN : 0,
      vision: scoring ? poseN : 0,
    },
  };
}

function requireYes(flags, estimatedCost) {
  step(`付费调用估算：${JSON.stringify(estimatedCost)}`);
  if (flags.yes === true) return;
  const err = new Error("付费调用需要 --yes 确认后再执行（本次未调用接口）");
  err.exitCode = 3;
  throw err;
}

function characterFromFlags(flags) {
  const name = String(flags["character-name"] || "").trim();
  if (!name) throw new Error("--character-name 不能为空（主持人不在服务端，请内联传入姓名；id 可用 --character-id 或 --character）");
  const id = String(flags["character-id"] || flags.character || "").trim() || slugId(name);
  const refs = typeof flags["character-ref"] === "string" && flags["character-ref"]
    ? String(flags["character-ref"]).split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const appearance = typeof flags.appearance === "string" ? flags.appearance.trim() : "";
  return { id, name, ...(appearance ? { appearance } : {}), referenceImages: refs };
}

function imageJobFields(route) {
  if (route === "vton") {
    if (!FASHN.apiKey) throw new Error("vton 路线需要 CLIPFORGE_FASHN_API_KEY");
    return {
      provider: IMAGE.provider || "fashn",
      model: IMAGE.model || "tryon-v1.6",
      apiKey: IMAGE.apiKey || "",
      baseUrl: IMAGE.baseUrl || "",
      tryon: { apiKey: FASHN.apiKey, ...(FASHN.baseUrl ? { baseUrl: FASHN.baseUrl } : {}) },
    };
  }
  if (!IMAGE.provider || !IMAGE.model || !IMAGE.apiKey) {
    throw new Error("compose 路线需要 CLIPFORGE_IMAGE_PROVIDER、CLIPFORGE_IMAGE_MODEL、CLIPFORGE_IMAGE_API_KEY");
  }
  return { provider: IMAGE.provider, model: IMAGE.model, apiKey: IMAGE.apiKey, baseUrl: IMAGE.baseUrl || "" };
}

function fileBlob(filePath) {
  const path = String(filePath || "").trim();
  if (!path) throw new Error("文件路径不能为空");
  let buf;
  try {
    buf = readFileSync(path);
  } catch (e) {
    throw new Error(`读不了本地文件：${path}（${e?.message || e}）`);
  }
  const name = basename(path).replace(/[/\\]/g, "") || "upload.bin";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : ext === "mp4"
            ? "video/mp4"
            : ext === "webm"
              ? "video/webm"
              : ext === "mov"
                ? "video/quicktime"
                : "application/octet-stream";
  return { blob: new Blob([buf], { type: mime }), name, mime };
}

async function pollLooks(garmentSetId, lookIds, { timeoutMs = 360000, intervalMs = 2500 } = {}) {
  const want = new Set(lookIds);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { looks } = await api(`/api/looks?garmentSetId=${encodeURIComponent(garmentSetId)}`);
    const mine = (looks ?? []).filter((l) => want.has(l.id));
    const busy = mine.some((l) => l.status === "pending" || l.status === "generating");
    if (!busy && mine.length >= lookIds.length) return mine;
    if (Date.now() > deadline) throw new Error("Look 生成超时，可稍后用 `looks list --set` 再查");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function pollReference(referenceId, { timeoutMs = 360000, intervalMs = 2500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await api(`/api/reference/${encodeURIComponent(referenceId)}`);
    if (job.stage === "done" || job.stage === "failed") return job;
    if (Date.now() > deadline) throw new Error("对标任务超时，可稍后用 `template get-reference` 再查");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

const GARMENTS_HELP = `clipforge garments — 服装库

用法：
  clipforge garments list [--category tops|bottoms|one-pieces|outerwear|shoes|accessory] [--q 关键词]
  clipforge garments add --name "黑T" --category tops --front ./front.jpg [--back ./back.jpg] [--view flat|on-model] [--notes "..."] [--color-tags black]

只走 API 上传，不要写数据目录。`;

const LOOKS_HELP = `clipforge looks — 生成 / 列出 / 接受模特 Look

用法：
  clipforge looks --set <id> --poses front_stand,side,back --character-name Ada
                 [--character-id ada] [--character-ref <url>] [--appearance "..."]
                 [--route compose|vton] [--look <preset>] [--yes] [--no-wait]
  clipforge looks list --set <id> [--status accepted]
  clipforge looks accept <lookId>

主持人不在服务端：必须 --character-name（id 可自拟）。付费生成会打印 { poses, garments, calls }，需要 --yes。`;

const FASHION_CMD_HELP = `clipforge fashion — 从已接受 Look + 时装模板建项目

用法：
  clipforge fashion --template mirror_turn --set <id> --character-name Ada
                    [--character-id ada] [--character-ref <url>] [--name "..."] [--lang zh|en] [--yes]

内置模板：runway_walk / mirror_turn / ootd_talk / detail_macro。
缺姿态时返回 missingPoses（不建项目）。成功后用 compose --project <id> 出片。`;

const TEMPLATE_HELP = `clipforge template — 从对标视频衍生时装模板

用法：
  clipforge template derive <video|url> [--yes] [--no-wait]
  clipforge template get-reference <referenceId>

derive 为付费视觉 LLM 调用，需要 CLIPFORGE_LLM_* 与 --yes。只提取结构，不复用对方成片/音频/文案。`;

async function cmdGarments(flags, rest = []) {
  const sub = rest[0];
  if (!sub) throw new Error("用法：garments list|add。详见 clipforge garments --help");
  if (sub === "list") {
    const params = new URLSearchParams();
    if (GARMENT_CATEGORIES.includes(flags.category)) params.set("category", flags.category);
    const q = typeof flags.q === "string" ? flags.q.trim() : "";
    if (q) params.set("q", q);
    const qs = params.toString();
    const res = await api(`/api/garments${qs ? `?${qs}` : ""}`);
    return { ok: true, count: (res.garments ?? []).length, garments: res.garments ?? [] };
  }
  if (sub === "add") {
    const name = String(flags.name || "").trim();
    if (!name) throw new Error("--name 不能为空");
    const category = String(flags.category || "").trim();
    if (!GARMENT_CATEGORIES.includes(category)) throw new Error("--category 必须是 tops/bottoms/one-pieces/outerwear/shoes/accessory");
    const frontPath = String(flags.front || "").trim();
    if (!frontPath) throw new Error("--front <file> 不能为空");
    const view = GARMENT_VIEWS.includes(flags.view) ? flags.view : "flat";
    const front = fileBlob(frontPath);
    if (!["image/jpeg", "image/png", "image/webp"].includes(front.mime)) throw new Error("--front 仅支持 JPEG / PNG / WebP");
    const form = new FormData();
    form.append("name", name);
    form.append("category", category);
    form.append("view", view);
    form.append("front", front.blob, front.name);
    if (typeof flags.notes === "string" && flags.notes.trim()) form.append("notes", flags.notes.trim());
    if (typeof flags["color-tags"] === "string" && flags["color-tags"].trim()) form.append("colorTags", flags["color-tags"].trim());
    if (typeof flags.back === "string" && flags.back.trim()) {
      const back = fileBlob(flags.back);
      if (!["image/jpeg", "image/png", "image/webp"].includes(back.mime)) throw new Error("--back 仅支持 JPEG / PNG / WebP");
      form.append("back", back.blob, back.name);
    }
    const res = await api("/api/garments", { method: "POST", body: form });
    step(`已上传服装 ${res.garment?.id}`);
    return { ok: true, garmentId: res.garment?.id ?? null, garment: res.garment };
  }
  throw new Error(`未知 garments 子命令：${sub}。用 list 或 add。`);
}

async function cmdLooks(flags, rest = []) {
  const sub = rest[0];
  if (sub === "list") {
    const garmentSetId = String(flags.set || "").trim();
    if (!garmentSetId) throw new Error("--set 不能为空");
    const params = new URLSearchParams({ garmentSetId });
    if (typeof flags.status === "string" && flags.status.trim()) params.set("status", flags.status.trim());
    const res = await api(`/api/looks?${params}`);
    return { ok: true, count: (res.looks ?? []).length, looks: res.looks ?? [] };
  }
  if (sub === "accept") {
    const lookId = String(rest[1] || flags.id || "").trim();
    if (!lookId) throw new Error("用法：looks accept <lookId>");
    const res = await api(`/api/looks/${encodeURIComponent(lookId)}`, { method: "PATCH", body: { action: "accept" } });
    step(`已接受 Look ${res.look?.id}（同姿态旧 accepted 已降级）`);
    return { ok: true, look: res.look };
  }
  if (sub && sub !== "generate") {
    throw new Error(`未知 looks 子命令：${sub}。用（默认 generate）/ list / accept。`);
  }
  const garmentSetId = String(flags.set || "").trim();
  if (!garmentSetId) throw new Error("--set 不能为空。查看用法：clipforge looks --help");
  const poseIds = String(flags.poses || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (poseIds.length < 1) throw new Error("--poses 不能为空（逗号分隔，如 front_stand,side,back）");
  const unknown = poseIds.filter((id) => !FASHION_POSE_IDS.includes(id));
  if (unknown.length) throw new Error(`未知姿态 id：${unknown.join("、")}`);
  const character = characterFromFlags(flags);
  const route = TRYON_ROUTES.includes(flags.route) ? flags.route : "compose";
  const llmConfig = optionalLlm();
  const estimatedCost = estimateLookCalls({
    route,
    poses: poseIds.length,
    garments: Number.isFinite(Number(flags.garments)) ? Number(flags.garments) : route === "vton" ? 1 : 0,
    scoring: Boolean(llmConfig),
  });
  requireYes(flags, estimatedCost);
  const creds = imageJobFields(route);
  const body = {
    garmentSetId,
    character,
    poseIds,
    route,
    lock: { face: true, garmentPattern: true },
    ...creds,
    ...(typeof flags.look === "string" && flags.look.trim() ? { lookPresetId: flags.look.trim() } : {}),
    ...(llmConfig ? { llmConfig } : {}),
  };
  step(`提交 Look 生成（${route} · ${poseIds.length} 姿态）…`);
  const submitted = await api("/api/looks/generate", { method: "POST", body });
  const lookIds = submitted.lookIds ?? [];
  if (flags["no-wait"] === true) {
    return { ok: true, lookIds, estimatedCost, status: "pending" };
  }
  const looks = await pollLooks(garmentSetId, lookIds);
  return { ok: true, lookIds, estimatedCost, looks };
}

async function cmdFashion(flags) {
  const templateId = String(flags.template || "").trim();
  const garmentSetId = String(flags.set || "").trim();
  if (!templateId) throw new Error("--template 不能为空（runway_walk|mirror_turn|ootd_talk|detail_macro）");
  if (!garmentSetId) throw new Error("--set 不能为空");
  const character = characterFromFlags(flags);
  const estimatedCost = { calls: { compose: "later" }, note: "from-look 本身不生图；随后 clipforge compose 为付费视频管线" };
  requireYes(flags, estimatedCost);
  const body = {
    garmentSetId,
    templateId,
    character,
    ...(typeof flags.name === "string" && flags.name.trim() ? { name: flags.name.trim() } : {}),
    ...(flags.lang === "en" || flags.lang === "zh" ? { lang: flags.lang } : {}),
  };
  try {
    const res = await api("/api/project/from-look", { method: "POST", body });
    step(`已建项目 ${res.projectId}。下一步：clipforge compose --project ${res.projectId}`);
    return {
      ok: true,
      projectId: res.projectId,
      storedTemplate: res.storedTemplate,
      keyframes: res.keyframes,
      voiceoverPending: res.voiceoverPending,
    };
  } catch (e) {
    if (e?.status === 409 || Array.isArray(e?.payload?.missingPoses)) {
      return { ok: false, missingPoses: e.payload?.missingPoses ?? [], error: e.message, exitCode: 1 };
    }
    throw e;
  }
}

async function cmdTemplate(flags, rest = []) {
  const sub = rest[0];
  if (!sub) throw new Error("用法：template derive <video|url> | template get-reference <id>。详见 clipforge template --help");
  if (sub === "get-reference") {
    const referenceId = String(rest[1] || flags.id || "").trim();
    if (!referenceId) throw new Error("用法：template get-reference <referenceId>");
    const job = await api(`/api/reference/${encodeURIComponent(referenceId)}`);
    return {
      ok: true,
      referenceId,
      stage: job.stage,
      draft: job.draft ?? null,
      needsConfirmation: job.needsConfirmation ?? [],
      error: job.error ?? null,
    };
  }
  if (sub !== "derive") throw new Error(`未知 template 子命令：${sub}。用 derive 或 get-reference。`);
  requireLlm();
  const target = String(rest[1] || flags.url || flags.file || "").trim();
  if (!target) throw new Error("用法：template derive <video|url>");
  const estimatedCost = { calls: { vision: 1 }, note: "一次对标流水线（抽帧 + 视觉 LLM）" };
  requireYes(flags, estimatedCost);
  const llmConfig = { baseUrl: LLM.baseUrl, apiKey: LLM.apiKey || "", model: LLM.model };
  let submitted;
  if (/^https?:\/\//i.test(target)) {
    submitted = await api("/api/reference/ingest", { method: "POST", body: { url: target, llmConfig } });
  } else {
    const file = fileBlob(target);
    const form = new FormData();
    form.append("video", file.blob, file.name);
    form.append("llmConfig", JSON.stringify(llmConfig));
    submitted = await api("/api/reference/ingest", { method: "POST", body: form });
  }
  const referenceId = submitted.referenceId;
  if (flags["no-wait"] === true) {
    return { ok: true, referenceId, estimatedCost, stage: submitted.stage ?? "queued" };
  }
  const job = await pollReference(referenceId);
  return {
    ok: true,
    referenceId,
    estimatedCost,
    stage: job.stage,
    draft: job.draft ?? null,
    needsConfirmation: job.needsConfirmation ?? [],
    error: job.error ?? null,
  };
}

const HELP = `ClipForge CLI · 命令行一句话出片

用法：
  clipforge create --topic "在家手冲咖啡" [--duration 25] [--style knowledge]
                   [--footage auto|image|video] [--voice <id>] [--aspect 9:16|16:9|1:1]
                   [--quality fast|standard|hd] [--bgm] [--bgm-mood upbeat] [--bgm-volume 5-40] [--audio-stems] [--karaoke] [--cta "..."] [--json]
                   [--caption standard|bold|minimal|karaoke]   字幕样式预设(标准底板/重击大字/极简/逐字高亮)
  clipforge product --url "<商品链接>" [--style pain_point|scene|comparison|story|drama|reversal|interview|unboxing|product_pov|talking_head|auto] [--duration 30]
                   [--category beauty|food|home|fashion|tech|other] [--compose 同款成片选项]   贴链接→带货脚本(加 --compose 直接出片)
  clipforge import --project <id> (--file <路径> | --text "你的脚本") [--title "..."]   自带脚本出片
  clipforge dub --project <id> --lang en                                              配音译制(换语种,出海)
  clipforge compose --project <id> [同款成片选项] [--no-fill]
  clipforge trends [--geo US]   拉热搜选题(默认抖音/头条国内榜;--geo 走 Google Trends)
  clipforge list                列出项目
  clipforge voices              列出免费 Edge TTS 音色
  clipforge cover --project <id> --title "手冲咖啡 三步搞定" [--position center|lower|upper]   生成封面图
  clipforge qr --project <id> [--platform douyin --url <shopUrl> --size 512]   生成商品「扫码购买」二维码(UTM追踪)
  clipforge endcard --project <id> [--platform douyin --seconds 3 --cta "扫码购买"]   把扫码购买二维码烧进成片片尾(需先合成)
  clipforge export --project <id> --platform douyin|kuaishou|xiaohongshu|shipinhao|tiktok|reels|shorts [--composition <id>]   按平台导出(码率卡线免二压+实测报告)
  clipforge qc --project <id> [--composition <id>]   成片质检(黑屏/静音/响度/流完整性,批量出片前把关)
  clipforge master --project <id> [--composition <id>]   分析切点连续性与响度(默认只读,不调用模型)
                   [--apply --normalize-audio|--deflicker] [--label "投流母版" --no-wait]
                                显式应用后生成新版本且不覆盖原片;deflicker 会重编码画面,仅在确认闪烁时使用
  clipforge gate --project <id> [--strict] [--composition <id>]   发布门禁:一条命令聚合 脚本就绪+成片质检+素材授权 三层检查
                                fail(或 --strict 下 warn)退出码为 2,可直接接进脚本/CI 拦截发布
  clipforge credits --project <id> [--format md --lang zh|en]   素材授权清单(商用风险+署名行,投流审核用)
  clipforge native --project <id> [--strength subtle|medium --seed 3 --no-grain --vignette]   原生感处理(手持感+颗粒,反AI精致感)
  clipforge preview --project <id> [--start 0 --duration 4 --width 360]   生成预览 GIF
  clipforge sheet --project <id> [--frames 8 --proxy --mode smart|even]   成片速览一张图(scene感知抽帧+拼接点标注+波形;--proxy 出720p时间码审片小样)
  clipforge carousel --project <id> [--theme night|warm|mint|mono|rose]   生成小红书图文卡片(标题+逐条要点)
  clipforge transcript --project <id> --media <id> [--offset 0 --limit 500]   分页检查逐字稿、latestRevision 和当前计划
  clipforge clips --project <id> --media <id> [--query 关键词 --seconds 30 --limit 6]   本地片段建议(只读)，返回原话、时间范围和可预演 plan
  clipforge transcript-edit --project <id> --media <id> --plan edit-plan.json [--revision 0 --operation <id> --apply]
                                默认只预演 diff；用户确认后加 --apply，重试必须复用 operation ID
  clipforge timeline --project <id> --media <id> --plan edit-plan.json [--format otio|edl|csv --out edit.otio]
                                导出可编辑专业时间线；素材按原文件名重链，不写本机绝对路径
  clipforge garments list|add --name --category --front <file> [--back <file>] [--view flat|on-model]
                                服装库：列出或上传（JPEG/PNG/WebP）
  clipforge looks --set <id> --poses front_stand,side,back --character-name Ada [--character-ref <url>]
                 [--route compose|vton] [--look <preset>] [--yes] [--no-wait]
                                生成模特 Look（付费，需 --yes）；looks --help 看完整用法
  clipforge looks list --set <id> [--status accepted]
  clipforge looks accept <lookId>
  clipforge fashion --template mirror_turn --set <id> --character-name Ada [--character-ref <url>] [--yes]
                                用已接受 Look 建时装项目，再 compose 出片
  clipforge template derive <video|url> [--yes] [--no-wait]   从对标视频抽结构（付费视觉 LLM）
  clipforge template get-reference <referenceId>
  clipforge get --project <id>  查最新成片地址
  clipforge --help | --version

环境变量：
  CLIPFORGE_BASE_URL（默认 http://localhost:3000，需先 pnpm dev/start）
  CLIPFORGE_LLM_BASE_URL / CLIPFORGE_LLM_API_KEY / CLIPFORGE_LLM_MODEL（create / template derive 必需）
  CLIPFORGE_IMAGE_PROVIDER / CLIPFORGE_IMAGE_MODEL / CLIPFORGE_IMAGE_API_KEY / CLIPFORGE_IMAGE_BASE_URL（looks compose）
  CLIPFORGE_FASHN_API_KEY / CLIPFORGE_FASHN_BASE_URL（looks --route vton）
  CLIPFORGE_PEXELS_KEY / CLIPFORGE_PIXABAY_KEY（可选）

进度打印到 stderr，最终结果（含 videoUrl）打印到 stdout，便于管道取值。`;

const COMMANDS = { create: cmdCreate, product: cmdProduct, import: cmdImport, dub: cmdDub, compose: cmdCompose, cover: cmdCover, qr: cmdQr, endcard: cmdEndcard, export: cmdExport, qc: cmdQc, master: cmdMaster, gate: cmdGate, credits: cmdCredits, native: cmdNative, preview: cmdPreview, sheet: cmdSheet, carousel: cmdCarousel, clips: cmdClips, transcript: cmdTranscriptInspect, "transcript-edit": cmdTranscriptEdit, timeline: cmdTimelineExport, list: cmdList, voices: cmdVoices, get: cmdGet, trends: cmdTrends, garments: cmdGarments, looks: cmdLooks, fashion: cmdFashion, template: cmdTemplate };

const COMMAND_HELP = { garments: GARMENTS_HELP, looks: LOOKS_HELP, fashion: FASHION_CMD_HELP, template: TEMPLATE_HELP };

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  if (flags.version || flags.v) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }
  const cmd = _[0];
  if (cmd && COMMAND_HELP[cmd] && (flags.help || flags.h || _[1] === "help")) {
    process.stdout.write(COMMAND_HELP[cmd] + "\n");
    return 0;
  }
  if (!cmd || flags.help || flags.h || cmd === "help") {
    process.stdout.write(HELP + "\n");
    return cmd && !COMMANDS[cmd] ? 1 : 0;
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`未知命令：${cmd}\n\n${HELP}\n`);
    return 1;
  }
  const result = await handler(flags, _.slice(1));
  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.videoUrl) {
      step("完成 ✓");
      process.stdout.write(result.videoUrl + "\n");
    } else {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    }
  }
  // commands with gate semantics (e.g. `gate`) surface their own exit code; everything else exits 0
  return typeof result?.exitCode === "number" ? result.exitCode : 0;
}

// Only run when executed as an entry point (not when imported by unit tests)
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((e) => {
      process.stderr.write(`✗ ${e?.message || e}\n`);
      process.exit(typeof e?.exitCode === "number" ? e.exitCode : 1);
    });
}
