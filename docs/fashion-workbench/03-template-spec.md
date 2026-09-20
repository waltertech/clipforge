# FashionTemplate 规范

时装模板是 `AdTemplate`（`src/lib/ad-templates.ts`）的扩展。现有字段全部沿用，新增 `kind` 与 `fashion` 两个字段。模板是 JSON 配方：人在编辑器里点选，助手通过同一份 JSON 读写，SKILL 只是说明书。

## 类型

```ts
export interface AdTemplate {
  id: string;
  emoji: string;
  name: { zh: string; en: string };
  tagline: { zh: string; en: string };
  group: AdTemplateGroupId;
  goodFor?: AdTemplateCategory[];
  styleType: string;
  videoMode: "product_closeup" | "graphic_montage" | "scene_demo" | "live_presenter";
  look: string;
  cameraPlan: Partial<Record<Shot["type"], string>>;
  compose: StylePackCompose;
  scriptHint: { zh: string };
  /** 新增。缺省视为 "ad" */
  kind?: "ad" | "fashion";
  /** 新增。kind === "fashion" 时必填 */
  fashion?: FashionFields;
}

export interface FashionFields {
  /** 姿态序列，一镜一姿态，长度 1–9，值为 pose-presets id */
  poseSequence: string[];
  /** 每镜角色，与 poseSequence 等长；缺省首镜 hook、末镜 cta、其余 demo */
  shotRoles?: Array<Shot["type"]>;
  /** 每镜时长（秒），与 poseSequence 等长；缺省按 compose.quality 与总时长均分 */
  shotSeconds?: number[];
  /** 首帧来源：accepted = 该姿态的已通过 Look；grid = 九宫格裁切 */
  lookSource: "accepted" | "grid";
  /** 适用服装类目；缺省全部 */
  garmentCategories?: GarmentCategory[];
  /** 锁定项，三项必填 */
  lock: { face: boolean; garmentPattern: boolean; noOutfitChange: boolean };
  /** i2v 负向约束，追加到 motion prompt */
  negative: { zh: string; en: string };
  /** 台词模式：none = 纯画面 + BGM；voiceover = 旁白；on-camera = 出镜口播 */
  scriptPattern: "none" | "voiceover" | "on-camera";
  /** 词锚点：字幕 / 卖点卡 / 音效挂在台词的词上，而不是秒 */
  wordAnchors?: WordAnchor[];
  /** 可替换槽位声明，供批量变体使用 */
  slots?: { model: boolean; garmentSet: boolean; hook: boolean };
  /** 来源：对标视频派生时记录，不进成片 */
  derivedFrom?: { referenceId: string; derivedAt: string; shotCount: number };
}

export interface WordAnchor {
  /** 镜序号，0 起 */
  shot: number;
  /** 触发词的匹配方式：first = 该镜台词第一个词；keyword = 命中关键词；last = 最后一个词 */
  at: "first" | "last" | { keyword: string };
  /** 触发的元素 */
  element: "price_card" | "selling_point" | "brand_tag" | "sfx" | "caption_emphasis";
  /** 元素文案或音效 id */
  payload?: string;
  /** 持续时长（秒），缺省到本镜结束 */
  seconds?: number;
}
```

## 校验规则

`sanitizeCustomAdTemplate` 的 fashion 分支，全部失败即拒绝整份模板：

| 规则 | 说明 |
| --- | --- |
| `kind === "fashion"` 时 `fashion` 必填 | 反之 `fashion` 存在但 `kind` 不是 `fashion` → 丢弃 `fashion` 字段并警告 |
| `poseSequence` 长度 1–9 | 九宫格上限 |
| 每个 pose id 存在于 `POSE_PRESETS` | 未知 id 拒绝，不做近似匹配 |
| `shotRoles`、`shotSeconds` 若给出则与 `poseSequence` 等长 | |
| `shotSeconds` 每项 2–15，总和 ≤ 60 | 与现有时长上限对齐 |
| `lock` 三项均为布尔 | |
| `negative.zh` 与 `negative.en` 非空且 ≤ 300 字 | |
| `wordAnchors[].shot` 在 `[0, poseSequence.length)` | |
| `wordAnchors[].at.keyword` ≤ 20 字，`payload` ≤ 60 字 | |
| `scriptPattern === "none"` 时 `wordAnchors` 只允许 `element: "sfx"` | 没有台词就没有词 |
| `cameraPlan` 的值存在于 `CAMERA_PRESETS` | 现有规则 |
| `look` 存在于 `LOOK_PRESETS` 或为 `none` | 现有规则 |
| 文案通过 `checkAdCompliance` | 现有规则，`tagline`、`scriptHint`、`wordAnchors[].payload` 都检查 |

## 内置模板

| id | 名称 | poseSequence | lookSource | scriptPattern | 说明 |
| --- | --- | --- | --- | --- | --- |
| `runway_walk` | 走秀 | `front_stand, walk_toward, three_quarter, back` | accepted | none | BGM 驱动，`follow_track` / `lateral_track` |
| `mirror_turn` | 镜前转身 | `front_stand, side, back, front_stand` | accepted | none | `body_orbit` 为主，`selfie_front` look |
| `ootd_talk` | 试穿口播 | `front_stand, detail_torso, three_quarter, front_stand` | grid | on-camera | 词锚点挂价格卡与卖点 |
| `detail_macro` | 面料细节 | `detail_torso, hands_pocket, three_quarter` | accepted | voiceover | `macro_glide` / `focus_shift` |

## 示例

```json
{
  "kind": "clipforge-ad-template",
  "version": 2,
  "template": {
    "kind": "fashion",
    "emoji": "👗",
    "name": { "zh": "镜前转身", "en": "Mirror Turn" },
    "tagline": { "zh": "四个角度一次看全，转身即种草", "en": "Four angles in one turn" },
    "group": "presenter",
    "goodFor": ["fashion"],
    "styleType": "scenario",
    "videoMode": "live_presenter",
    "look": "selfie_front",
    "cameraPlan": { "hook": "slow_push", "demo": "body_orbit", "cta": "push_then_hold" },
    "compose": { "captionPreset": "minimal", "bgm": "chill", "bgmDuck": true, "quality": "standard", "aspectRatio": "9:16" },
    "scriptHint": { "zh": "无台词，靠转身与 BGM 节奏" },
    "fashion": {
      "poseSequence": ["front_stand", "side", "back", "front_stand"],
      "shotRoles": ["hook", "demo", "demo", "cta"],
      "shotSeconds": [3, 3, 3, 3],
      "lookSource": "accepted",
      "garmentCategories": ["tops", "bottoms", "one-pieces", "outerwear"],
      "lock": { "face": true, "garmentPattern": true, "noOutfitChange": true },
      "negative": {
        "zh": "服装变色、图案变化、换衣服、换脸、发型变化、多手指、文字水印",
        "en": "garment color shift, pattern change, outfit swap, face change, hairstyle change, extra fingers, text or watermark"
      },
      "scriptPattern": "none",
      "wordAnchors": [
        { "shot": 3, "at": "first", "element": "sfx", "payload": "whoosh_soft" }
      ],
      "slots": { "model": true, "garmentSet": true, "hook": false }
    }
  }
}
```

## 导入导出

- `AD_TEMPLATE_SHARE_VERSION` 从 1 升到 2。`exportAdTemplateShare` 输出 v2。
- `parseAdTemplateShare` 接受 v1 与 v2：v1 没有 `kind`，按 `ad` 处理。
- 模板包（`clipforge-ad-template-pack`）同样支持混装 `ad` 与 `fashion`。
- 导出时 `derivedFrom.referenceId` 保留，但接收方没有该对标视频，仅作出处记录。

## AI 生成模板

`POST /api/ad-template/generate` 请求增加：

```json
{ "kind": "fashion", "garmentCategories": ["one-pieces"], "brief": "夏季连衣裙，轻快，无口播" }
```

提示词里给出 `POSE_PRESETS` 与 `CAMERA_PRESETS` 的 id 列表与一句话说明，要求只从中选择；输出经 `sanitizeCustomAdTemplate`，失败最多重试 3 次，之后返回 `template_generation_failed` 与最后一次校验错误。

## 对标视频派生

`template-derive.ts` 把 `reference-reader.ts` 的逐镜读片结果映射为草稿：

| 读片字段 | 映射 |
| --- | --- |
| 镜头数 | `poseSequence.length`；> 9 时按相邻时长合并到 9 |
| 每镜 `pose`（自由文本） | 用向量或关键词匹配到最近的 pose id；置信度低时用 `front_stand` 并在编辑器标黄 |
| 每镜 `camera` / `motion` | 先 `findPresetByPrompt` 整句命中，再按名称 / 关键词（`matchCameraId`）落到 camera id；仍无命中则留空并列入「需要确认」 |
| 每镜时长 | `shotSeconds`，四舍五入到 0.5 |
| 每镜 `role` | `shotRoles` |
| 有无口播、是否出镜 | `scriptPattern` |
| 字幕样式 | `compose.captionPreset`（bold / standard / karaoke / minimal） |
| BGM 情绪 | `compose.bgm` |
| 屏幕文字出现时对应的词 | `wordAnchors`，`element` 由文字内容分类（含 ¥ / 价格 → `price_card`） |
| 全部 | `derivedFrom` |

草稿必须通过 sanitize 才能进编辑器；不通过的字段回落默认值并列在草稿顶部的「需要确认」列表里。

## 与 SKILL 的边界

`skills/fashion-look/SKILL.md` 不复制字段定义，只链接本文件并说明调用顺序。字段变更只改代码里的类型和本文件。
