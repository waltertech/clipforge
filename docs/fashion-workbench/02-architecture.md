# 方案与架构设计

基于当前仓库（ClipForge 0.9.5，Next.js 16 + SQLite / Drizzle + FFmpeg）。不换底座，在现有管线上加一层 Look，视频与模板层复用并扩展。

## 总体流程

```
服装参考图 ──► garments / garment_sets
                       │
模特(characters) ──────┤   ① Look 引擎：按姿态并发生成
姿态(pose-presets) ────┘        compose 路线 | vton 路线
                       │
                       ▼
                looks（候选 ×N，四轴打分）──人工/自动 accept──► assets(type=look)
                       │
                       │   ② 首帧 = accepted Look；模板给 poseSequence / camera / lock
                       ▼
        现有 i2v（Seedance / Kling）→ compose → master → gate → 成片
                       ▲
                       │   ③ FashionTemplate（AdTemplate 扩展，JSON）
        手工创建 / AI 生成 / 对标视频派生 ──► ad_template_recipes
```

## 复用与新增

| 层 | 复用 | 新增 |
| --- | --- | --- |
| 模特 | `characters` 表；`character-sheet.ts` 四视图定妆；`presenters.ts` 真人约束 | 无 |
| 服装 | `/api/upload`；`ssrf-guard.ts`；`media-validate.ts`；`paths.ts` 的 uploads 目录 | `garments`、`garment_sets` 表；`/api/garments` |
| Look | `AIProvider.generateImage` 已支持 `referenceImageUrls`（fal edit、Atlas、Volcengine）；`concurrency.ts`；`ai-tasks.ts` 两阶段记录；`generation-quality-evaluator.ts` | `pose-presets.ts`；`src/lib/tryon/*`；`looks` 表；`/api/looks/*`；`/looks` 页 |
| 视频 | `motion-prompt.ts`；`camera-presets.ts`；`storyboard-grid.ts`；i2v 管线；compose / master / gate | `fashion-shots.ts`（姿态序列 → 分镜）；motion prompt 的 `lock` 注入 |
| 模板 | `AdTemplate`；`ad_template_recipes` 表；share JSON 导入导出；`/api/ad-template/generate` | `FashionTemplate` 字段；`reference-reader.ts`；`template-derive.ts`；模板编辑器时装区块 |
| 助手接入 | MCP server；CLI；`skills/clipforge-video` | `skills/fashion-look/SKILL.md`；3 个 MCP 工具；2 个 CLI 子命令 |

## 数据模型

新增三张表，放在 `src/lib/db/schema.ts`，与现有表同风格（`text` 主键 + `crypto.randomUUID()`，时间戳 `integer mode timestamp`）。

```ts
export const garments = sqliteTable("garments", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  category: text("category", { enum: ["tops", "bottoms", "one-pieces", "outerwear", "shoes", "accessory"] }).notNull(),
  view: text("view", { enum: ["flat", "on-model"] }).notNull().default("flat"),
  frontPath: text("front_path").notNull(),
  backPath: text("back_path"),
  colorTags: text("color_tags", { mode: "json" }).$type<string[]>().default([]),
  notes: text("notes"),            // 面料 / 版型 / 需要保留的图案说明，注入提示词
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const garmentSets = sqliteTable("garment_sets", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  garmentIds: text("garment_ids", { mode: "json" }).$type<string[]>().notNull(), // 叠穿顺序：内到外
  characterId: text("character_id").references(() => characters.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const looks = sqliteTable("looks", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  garmentSetId: text("garment_set_id").notNull().references(() => garmentSets.id, { onDelete: "cascade" }),
  characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  poseId: text("pose_id").notNull(),
  lookPresetId: text("look_preset_id"),
  route: text("route", { enum: ["compose", "vton"] }).notNull(),
  provider: text("provider"),
  model: text("model"),
  prompt: text("prompt"),
  imagePath: text("image_path"),
  aiTaskId: text("ai_task_id"),
  score: text("score", { mode: "json" }).$type<LookScore>(),
  status: text("status", { enum: ["pending", "generating", "candidate", "accepted", "rejected", "failed"] }).notNull().default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

`LookScore` 四轴 0–5：`garment`（服装保真）、`pose`（姿态符合）、`identity`（脸 / 发型一致）、`artifact`（瑕疵，越高越好），加 `overall` 与 `reasons: string[]`。

约束：同一 `garmentSetId + poseId` 只能有一个 `accepted`，accept 新的时旧的降为 `candidate`。Look 不删除，与 `generation_reviews` 的「保留证据」原则一致。

`assets.type` 枚举增加 `"look"`：accepted Look 进项目时以 `type=look` 写入 `assets`，`shotId` 对应分镜，`filePath` 指向 Look 图。

## 姿态预设

`src/lib/pose-presets.ts`，纯数据 + 纯函数，与 `camera-presets.ts` 同约定。

```ts
export interface PosePreset {
  id: string;
  name: { zh: string; en: string };
  /** 注入 Look 提示词的姿态描述 */
  prompt: { zh: string; en: string };
  /** 建议画幅 */
  aspect: "3:4" | "9:16";
  /** 全身 / 半身 / 局部 */
  framing: "full" | "half" | "detail";
  /** 不适合的服装类目（如 detail_torso 不适合 shoes） */
  excludeCategories?: string[];
  /** i2v 时该姿态天然适合的运镜（camera-presets id） */
  suggestedCamera?: string[];
}
```

首批 8 个：`front_stand`、`three_quarter`、`side`、`back`、`walk_toward`、`hands_pocket`、`seated`、`detail_torso`。

导出：`getPosePreset(id)`、`listPosesFor(categories)`、`POSE_PRESETS`。

## Look 引擎

### 接口

`src/lib/tryon/types.ts`

```ts
export interface LookRequest {
  /** 模特参考：优先四视图定妆图，其次 characters.referenceImages */
  modelRefs: string[];
  garments: Array<{ url: string; category: GarmentCategory; view: "flat" | "on-model"; notes?: string }>;
  pose: PosePreset;
  lookPresetId?: string;
  aspect: "3:4" | "9:16";
  lock: { face: boolean; garmentPattern: boolean };
  lang: "zh" | "en";
}

export interface LookResult {
  imageUrl: string;
  provider: string;
  model: string;
  prompt: string;
  taskId?: string;
}

export interface TryOnRoute {
  readonly id: "compose" | "vton";
  generateLook(req: LookRequest, ctx: { providerConfig: ProviderConfig }): Promise<LookResult>;
}
```

### compose 路线

`src/lib/tryon/compose-route.ts`。调用现有 `AIProvider.generateImage({ mode: "image-to-image", referenceImageUrls: [...modelRefs, ...garmentUrls], prompt })`。提示词由 `src/lib/tryon/prompt.ts` 的 `buildLookPrompt(req)` 生成：

- 参考图按位置引用：「第 1 张是模特定妆四视图，第 2–N 张是服装」，与 `storyboard-grid.ts` 的位置约定一致。
- 一次合成全部服装，叠穿按内到外顺序描述，不做链式多次试衣。
- 追加 `realFaceLine`、look-presets 的 `image` 片段、姿态 `prompt`。
- 锁定句：服装图案 / 颜色 / 版型与参考完全一致；脸与发型与定妆图一致；不出现文字、边框、水印。
- 语言跟随服装 notes 与模特 appearance 是否含 CJK。

支持 2–5 件；单件时同样走这条路。

### vton 路线

`src/lib/tryon/fashn-route.ts`。FASHN API 或自托管 FASHN VTON 1.5。单件精确试衣，多件时串行：one-pieces 或 tops → bottoms → outerwear，每步输出作为下一步的人像输入。类目映射：`outerwear → tops`，`shoes / accessory` 不走此路线（回落 compose）。

配置：设置页新增 `tryon.route`（默认 `compose`）、`tryon.fashn.apiKey`、`tryon.fashn.baseUrl`（自托管时填）。

### 编排

`POST /api/looks/generate`：

1. 校验 `characterId`、`garmentIds`、`poseIds`（≤ 8）、`route`。
2. 每个 pose 一行 `looks`（`status=pending`），先返回 `lookIds`。
3. 后台用 `mapWithConcurrency`（并发 3）逐个生成；调用前 `recordAiTask`，成功 / 失败 `updateAiTask`，与 issue #16 的两阶段做法一致。
4. 成功后落盘到 `uploads/looks/<garmentSetId>/`，写 `imagePath`，`status=candidate`，异步触发打分。
5. 一格失败不影响其余；失败行 `status=failed`，带可读错误（`friendly-error.ts`）。

`GET /api/looks?garmentSetId=`、`PATCH /api/looks/[id] { action: "accept" | "reject" | "rescore" }`、`POST /api/looks/[id]/retry { poseId?, route? }`。

### 打分

`src/lib/tryon/score.ts`。复用 `generation-quality-evaluator.ts` 的视觉 LLM 调用方式，输入 Look 图 + 定妆图 + 服装图，输出 `LookScore`。解析失败或越界时钳制并记 `reasons`。UI 用色块显示，低于 3 分提供「换姿态重试 / 换路线重试」。

## Look → 视频

### 分镜生成

`src/lib/fashion-shots.ts`：`buildFashionShots(template, looks, garmentSet)` → `Shot[]`。

- 分镜数 = `poseSequence.length`，每镜 `type` 由模板 `shotRoles` 指定（hook / product_reveal / demo / cta），默认首镜 hook、末镜 cta。
- 每镜 `keyframeUrl` = 该 pose 的 accepted Look；缺 Look 时报错，不静默跳过。
- `description` 由姿态 prompt + camera 预设 + 服装名拼出，`camera` 取模板 `cameraPlan`，否则用姿态的 `suggestedCamera[0]`。

### i2v 注入

- `firstFrameUrl` = 本镜 Look。
- 其它已 accepted 的 Look 进 `referenceImageUrls`，数量上限沿用 `atlas-video-params.ts` / `volcengine.ts` 现有裁剪逻辑，不在路由层硬编码。
- `motion-prompt.ts` 的 `MotionPromptInput` 增加可选 `lock`，为真时追加「不改服装图案与颜色、不换衣、不换脸、不换发型」和模板 `negative`。与 `hasCameraConflict` 不冲突。

### 九宫格兼容

`lookSource: "grid"` 时走现有 `buildStoryboardGridPrompt`，参考图增加 `garmentImage` 位：`[定妆图?, 服装图?, 商品图?]`，提示词增加一行「第 N 张是服装参考，九格中服装图案与款式必须一致」。九宫格适合口播类模板；走秀 / 转身类默认 `accepted`。

### 新建项目入口

新建项目表单增加来源「从 Look 出片」：选 `garmentSet` + 时装模板 → 预填 style / videoMode / look / cameraPlan / compose（与现有 `AdTemplate` 预填路径相同）→ 创建项目时调用 `buildFashionShots` 写入 shots 与 `assets(type=look)`，跳过脚本 LLM 的分镜生成，仅让 LLM 写台词（`scriptPattern !== "none"` 时）。

## 模板层

字段规范见 [03-template-spec.md](03-template-spec.md)。这里只说接缝：

- `AdTemplate` 增加可选 `kind?: "ad" | "fashion"` 与 `fashion?: FashionFields`。旧模板无 `kind` 视为 `ad`。
- `sanitizeCustomAdTemplate` 增加 fashion 分支：pose id 必须存在，`poseSequence` 长度 1–9，`lock` 三项必填，`wordAnchors` 引用的镜号在范围内。
- share JSON `AD_TEMPLATE_SHARE_VERSION` 升到 2；`parseAdTemplateShare` 同时接受 v1。
- `/api/ad-template/generate` 接受 `kind: "fashion"` 与 `garmentCategories`，输出必过 sanitize，连续 3 次失败返回可读错误。
- 内置 4 个时装模板放在 `ad-templates.ts`（`goodFor: ["fashion"]`）。

## 对标视频导入

```
上传 / 链接 ──► media-probe + ssrf-guard
      │
      ├─► ffmpeg 场景切分（scdet）→ 镜头边界，> 9 镜时按时长合并
      ├─► local-asr 逐词转写（可选，无口播时跳过）
      └─► 每镜抽 3 帧（首 / 中 / 尾）
                │
                ▼
      reference-reader.ts：视觉 LLM 逐镜输出
        { role, framing, pose, camera, motion, captionStyle, onScreenText, wordsCovered }
                │
                ▼
      template-derive.ts → FashionTemplate 草稿
        shotCount / poseSequence / cameraPlan / captionPreset / bgm / scriptPattern / wordAnchors
                │
                ▼
      编辑器展示草稿 + 每镜依据帧 ──保存──► ad_template_recipes(source="reference")
```

只提取结构。对标视频文件与抽帧存于 `uploads/reference/<id>/`，不进模板 JSON，不进成片素材。`checkAdCompliance` 照常对模板文案生效。

## 页面

| 路由 | 内容 |
| --- | --- |
| `/garments` | 服装库：上传、类目、正 / 背面、颜色标签、搜索；组建服装组 |
| `/looks` | 左：模特 + 服装组；中：姿态勾选、look 预设、路线；右：候选网格，分数色块，accept / reject / 重试；底部：成本估算 |
| `/start` | 来源新增「从 Look 出片」 |
| 模板编辑器 | 现有「我的模板」编辑器增加时装区块：姿态序列拖拽、锁定开关、负向词、词锚点；「从对标视频生成」入口 |
| `/settings` | 试衣路线与 FASHN 配置 |

## 成本与安全

- Look 与视频按次估价显示在生成按钮旁，默认 720p，沿用 issue #28 之后的保守默认。
- 服装图与对标视频上传复用 `media-validate.ts` 的大小 / 格式 / 时长限制；外链走 `ssrf-guard.ts`。
- 所有付费调用先落 `ai_tasks` 再轮询。
- FASHN 自托管时 GPU 节点单独部署，工作台通过 HTTP 访问，Docker 镜像不含模型权重。

## 模块边界

`src/lib/tryon/*`、`pose-presets.ts`、`fashion-shots.ts` 只依赖 `providers/types.ts`、`presenters.ts`、`look-presets.ts`、`camera-presets.ts` 这类纯数据模块，不依赖 DB 与路由，方便以后抽成独立包。
