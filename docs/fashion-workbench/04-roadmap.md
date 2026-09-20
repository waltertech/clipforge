# 分阶段 TODO

每一条可独立提 PR。顺序为 M0 → M1 → M2 → M3 → M4；M2 与 M3 可并行；M5 上线前做。每个阶段的测试项见 [05-test-plan.md](05-test-plan.md)。

**状态（2026-09-20）**：M0–M4 已在本分支落地。用户向说明见 [../fashion-workbench-guide.md](../fashion-workbench-guide.md)。M5（计费、多用户、FASHN 自托管、合规提示、CI e2e）未做。已知缺口：对标视频服务端 ASR 未接线（`transcript` 恒为 null）；Look 导出是 JSON manifest，不是 zip。

标记：`[lib]` 纯逻辑，`[db]` schema 与迁移，`[api]` 路由，`[ui]` 页面，`[skill]` MCP / CLI / SKILL，`[docs]` 文档。

## M0 地基（纯数据 + schema，无 UI）

目标：类型、预设、表结构落地，后续阶段不再改 schema。

- [ ] `[lib]` `src/lib/pose-presets.ts`：8 个姿态预设，`getPosePreset`、`listPosesFor`、`POSE_PRESETS`
- [ ] `[db]` `garments`、`garment_sets`、`looks` 三表 + drizzle 迁移；`assets.type` 增加 `"look"`
- [ ] `[lib]` `src/lib/tryon/types.ts`：`LookRequest`、`LookResult`、`LookScore`、`TryOnRoute`、`GarmentCategory`
- [ ] `[lib]` `src/lib/tryon/prompt.ts`：`buildLookPrompt(req)`，zh / en，参考图位置引用，锁定句，真人约束
- [ ] `[lib]` `ad-templates.ts`：`kind`、`FashionFields`、`WordAnchor` 类型；`isFashionTemplate`
- [ ] `[lib]` `sanitizeCustomAdTemplate` fashion 分支（规则见 03）
- [ ] `[lib]` share 格式 v2，兼容 v1
- [ ] `[docs]` 本目录文档随实现更新

验收：`pnpm test` 通过；`pnpm lint` 无新增告警；迁移在空库与现有库上都能跑。

## M1 服装库 + 单张 Look（功能 1 最小闭环）

目标：上传一件服装，选默认模特，勾 2–3 个姿态，拿到候选 Look。

- [ ] `[api]` `POST /api/garments`（复用 `/api/upload` 落盘、`media-validate`、`ssrf-guard`）；`GET /api/garments`；`PATCH /api/garments/[id]`；`DELETE`
- [ ] `[api]` `POST /api/garment-sets`、`GET`、`DELETE`
- [ ] `[lib]` `src/lib/tryon/compose-route.ts`：基于现有 provider 的多图合成
- [ ] `[lib]` `src/lib/tryon/index.ts`：路线注册与选择，读设置 `tryon.route`
- [ ] `[api]` `POST /api/looks/generate`：校验、建行、并发生成、`ai_tasks` 两阶段、落盘
- [ ] `[api]` `GET /api/looks?garmentSetId=`；`PATCH /api/looks/[id]`（accept / reject，唯一 accepted 约束）
- [ ] `[ui]` `/garments`：上传、类目、正 / 背面、颜色标签、搜索、组建服装组
- [ ] `[ui]` `/looks`：模特 + 服装组选择、姿态勾选、look 预设、路线、候选网格、accept / reject
- [ ] `[ui]` 设置页「试衣」区块：路线选择（先只有 compose）
- [ ] `[ui]` 成本估算：按 provider 单价 × 姿态数显示在生成按钮旁
- [ ] `[ui]` 导航加入「服装」「Look」

验收：本地 provider stub 下，3 个姿态产生 3 行 `looks`，网格显示；一格失败不影响其余；刷新后状态不丢。

## M2 Look 质检 + FASHN 路线（功能 1 做稳）

目标：候选有分数，低分能重试，面料保真有第二条路线。

- [ ] `[lib]` `src/lib/tryon/score.ts`：视觉 LLM 四轴打分，畸形输出钳制
- [ ] `[api]` 生成完成后异步打分；`PATCH /api/looks/[id] { action: "rescore" }`
- [ ] `[api]` `POST /api/looks/[id]/retry { poseId?, route? }`
- [ ] `[ui]` 分数色块、原因展开、「换姿态重试 / 换路线重试」
- [ ] `[lib]` `src/lib/tryon/fashn-route.ts`：FASHN API 适配，类目映射，串行叠穿，超时重试
- [ ] `[ui]` 设置页 FASHN key / baseUrl；每件服装可单独指定路线
- [ ] `[lib]` compose 路线支持 2–5 件叠穿（内到外描述）
- [ ] `[api]` `POST /api/looks/export`：zip 打包 accepted Look
- [ ] `[api]` `POST /api/project/[id]/looks/import`：accepted Look 写入 `assets(type=look)`
- [ ] `[ui]` Look 页批量 accept、按分数排序、按姿态筛选

验收：同一件印花上衣 5 姿态，服装保真 ≥ 4/5；FASHN 路线在无 key 时给出清晰提示而非 500。

## M3 Look → 模板视频（功能 2）

目标：选服装组 + 时装模板 → 建项目 → 首帧全是 Look → 走现有成片。

- [ ] `[lib]` `src/lib/fashion-shots.ts`：`buildFashionShots(template, looks, garmentSet)`
- [ ] `[lib]` `motion-prompt.ts`：`lock` 注入与 `negative` 追加
- [ ] `[lib]` i2v 调用处：首帧 Look + 其它 Look 进 `referenceImageUrls`，走现有数量裁剪
- [ ] `[lib]` `storyboard-grid.ts`：`garmentImage` 参考位与提示行
- [ ] `[lib]` 内置 4 个时装模板（`runway_walk`、`mirror_turn`、`ootd_talk`、`detail_macro`）
- [ ] `[api]` 新建项目支持 `source: "look"`：`garmentSetId` + `templateId` → shots + assets 预填，跳过分镜 LLM
- [ ] `[api]` `scriptPattern !== "none"` 时只让 LLM 写台词，镜数固定
- [ ] `[ui]` `/start` 来源「从 Look 出片」：选服装组、模板、模特确认
- [ ] `[ui]` 分镜页对 `type=look` 资产显示「Look」角标与来源姿态
- [ ] `[ui]` 缺姿态 Look 时的引导：跳回 `/looks` 生成缺失姿态

验收：`mirror_turn` 4 镜出片，`contact_sheet` 抽帧检查全程不换装；`gate` 通过。

## M4 模板创作 + 对标视频导入 + Skill（功能 3）

目标：用户能手工建时装模板、让 AI 生成、从对标视频派生，并能被助手调用。

模板编辑器
- [ ] `[ui]` 「我的模板」编辑器时装区块：姿态序列拖拽排序、`shotRoles` / `shotSeconds`、锁定开关、负向词、`slots`
- [ ] `[ui]` 词锚点编辑：选镜、选触发词方式、选元素、填文案
- [ ] `[api]` `/api/ad-template/generate` 支持 `kind: "fashion"`，输出必过 sanitize，3 次失败返回可读错误
- [ ] `[ui]` 模板卡片显示 `kind` 角标；筛选「时装」

对标视频导入
- [ ] `[api]` `POST /api/reference/ingest`：上传或链接，`media-probe`、`ssrf-guard`，时长 ≤ 90s
- [ ] `[lib]` `src/lib/reference/scenes.ts`：ffmpeg 场景切分，> 9 镜合并
- [ ] `[lib]` `src/lib/reference/frames.ts`：每镜抽首 / 中 / 尾三帧
- [ ] `[lib]` 逐词转写复用 `local-asr.ts`；无口播跳过
- [ ] `[lib]` `src/lib/reference/reader.ts`：视觉 LLM 逐镜结构化输出
- [ ] `[lib]` `src/lib/reference/template-derive.ts`：读片结果 → 草稿（映射见 03）
- [ ] `[api]` `GET /api/reference/[id]`：进度、每镜依据帧、草稿
- [ ] `[ui]` 编辑器「从对标视频生成」：上传 → 进度 → 草稿 + 依据帧 + 「需要确认」列表 → 保存
- [ ] `[api]` 保存时 `source: "reference"`，`derivedFrom` 写入
- [ ] `[lib]` 抽帧与原视频存 `uploads/reference/<id>/`，不进模板与成片

Skill / MCP / CLI
- [ ] `[skill]` `skills/fashion-look/SKILL.md`（草稿见 07）
- [ ] `[skill]` MCP：`clipforge_list_characters`、`clipforge_list_garments`、`clipforge_upload_garment`、`clipforge_create_garment_set`、`clipforge_list_poses`、`clipforge_generate_looks`、`clipforge_get_looks`、`clipforge_accept_look`、`clipforge_retry_look`、`clipforge_list_fashion_templates`、`clipforge_fashion_video`、`clipforge_derive_template`、`clipforge_get_reference`、`clipforge_save_template`（清单见 07）
- [ ] `[skill]` `skills.sh.json` 增加 `fashion-look`
- [ ] `[skill]` CLI：`clipforge looks`、`clipforge fashion`
- [ ] `[skill]` `clipforge-video` SKILL 的路由表增加时装入口

验收：一段 15s、3 镜、有口播的测试视频派生出 3 镜草稿；改姿态顺序后导出 JSON 再导入一致；助手通过 MCP 完成「生成 Look → accept → 出片 → gate」。

## M5 上线前

- [ ] 计费：Look 与视频按次计入用户额度（新表，与 `asset-credits.ts` 的素材署名无关）
- [ ] 多用户：现有单机 SQLite 无登录；上线前决定放在反向代理层还是应用层
- [ ] FASHN 自托管：GPU 节点 Docker 镜像、健康检查、工作台侧超时与降级到 compose
- [ ] 服装图与人像的使用授权提示（见 06）
- [ ] Docker 镜像验证 amd64；e2e 在 CI 用 `next dev --webpack`
- [ ] 文档：用户向 `docs/fashion-workbench-guide.md`，与现有 `docs/*.md` 同风格

## 不做

- fork CatVTON / Leffa 当网站
- 视频试衣（CatV2TON / Magic-TryOn / Vanast）当主路径
- 引入 Hypit、Fashionlab-AI 代码
- 自训练 LoRA
