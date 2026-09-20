# 测试计划

四层：单元（vitest，`src/lib/__tests__/`）、接口（vitest + 临时 SQLite + mock provider）、e2e（Playwright，`e2e/`）、人工验收。每个阶段结束前对应项全部通过。

约定：
- 单元测试文件与被测模块同名，放 `src/lib/__tests__/`。
- provider 一律 mock，不在测试里调付费接口。
- e2e 用 `pnpm exec next dev --webpack -p 3000`（Turbopack 在含中文的路径下会崩）。
- 图片 fixture 放 `e2e/fixtures/fashion/`，用 AI 生成的合成图，不用真人照片。

## M0 单元

| 文件 | 用例 |
| --- | --- |
| `pose-presets.test.ts` | id 唯一；每个预设 zh / en 齐全；`aspect` 与 `framing` 合法；`listPosesFor(["shoes"])` 不含 `detail_torso`；`suggestedCamera` 的 id 都存在于 `CAMERA_PRESETS` |
| `tryon-prompt.test.ts` | 参考图位置引用顺序 = `modelRefs` 后接 `garments` 顺序；服装 notes 含 CJK 时输出中文；含 `realFaceLine`；含「无文字 / 边框 / 水印」硬规则；`lock.garmentPattern=true` 时含图案锁定句，false 时不含；叠穿按内到外描述；look 预设片段被追加 |
| `fashion-template.test.ts` | `isFashionTemplate` 对 `kind` 缺省返回 false；sanitize 拒绝未知 pose id、`poseSequence` 长度 0 或 10、`shotRoles` 长度不等、`shotSeconds` 单项 > 15 或总和 > 60、缺 `lock`、`negative` 为空、`wordAnchors[].shot` 越界、`scriptPattern="none"` 下非 sfx 锚点；合法样例原样通过；`fashion` 存在但 `kind="ad"` 时字段被丢弃 |
| `ad-template-share.test.ts`（扩展） | v1 文档解析为 `ad`；v2 fashion 往返一致；模板包混装 ad + fashion；`derivedFrom` 导出保留 |
| `ad-templates.test.ts`（扩展） | 内置 4 个时装模板通过 sanitize 与 `checkAdCompliance`；`listAdTemplates({ category: "fashion" })` 包含它们 |
| 迁移 | 空库跑全部迁移成功；含数据的旧库跑新迁移后 `assets` 旧行不变 |

## M1 单元 + 接口

单元
| 文件 | 用例 |
| --- | --- |
| `tryon-compose-route.test.ts` | 调用 `generateImage` 的 `mode="image-to-image"`；`referenceImageUrls` 顺序正确；provider 抛错时抛带 `route`、`poseId` 的包装错误 |
| `tryon-index.test.ts` | 设置 `tryon.route` 缺省为 `compose`；未知值回落 `compose` 并告警 |

接口
| 接口 | 用例 |
| --- | --- |
| `POST /api/garments` | 非图片拒绝 415；超过大小拒绝 413；外链私网地址被 `ssrf-guard` 拒绝；成功返回 `id` 且文件落 uploads |
| `POST /api/garment-sets` | `garmentIds` 引用不存在 → 400；顺序保留 |
| `POST /api/looks/generate` | 3 pose → 3 行 `pending` 立即返回；完成后 3 行 `candidate` 且 `imagePath` 存在；第 2 个 pose provider 失败 → 该行 `failed`、其余 `candidate`；每次调用前有 `ai_tasks` 记录，完成后状态更新；`poseIds` > 8 → 400；`characterId` 不存在 → 404 |
| `PATCH /api/looks/[id]` accept | 同 `garmentSetId + poseId` 旧 accepted 降为 candidate；reject 后不可再 accept 需先 rescore |
| `GET /api/looks` | 按 `garmentSetId` 过滤；按 `createdAt` 倒序；含 `score` 与 `status` |

## M2 单元 + 接口

单元
| 文件 | 用例 |
| --- | --- |
| `tryon-score.test.ts` | 正常 JSON → 四轴 + overall；缺字段补 0 并记 reasons；分数 7 钳制到 5，-1 钳制到 0；非 JSON 输出 → `overall=null` 且不抛 |
| `tryon-fashn-route.test.ts`（mock fetch） | `outerwear → tops` 映射；`shoes` 拒绝并提示回落；两件串行时第二次请求的人像是第一次输出；超时抛可重试错误；HTTP 401 → 提示配置 key |
| `tryon-compose-route.test.ts`（扩展） | 5 件叠穿提示词包含 5 个位置引用；6 件 → 400 |

接口
| 接口 | 用例 |
| --- | --- |
| 打分触发 | Look 进入 `candidate` 后 `score` 在有限轮询内非空 |
| `POST /api/looks/[id]/retry` | 新建一行，不覆盖原行；`route` 覆盖有效 |
| `POST /api/looks/export` | zip 内只含 accepted；文件名含 pose id |
| `POST /api/project/[id]/looks/import` | 写入 `assets(type=look, selected=true)`；同一 shot 已有 selected 时旧的置 false |
| FASHN 无 key | 返回 4xx 与可读提示，不 500 |

## M3 单元 + 接口

单元
| 文件 | 用例 |
| --- | --- |
| `fashion-shots.test.ts` | 4 pose → 4 shots；`type` 按 `shotRoles`，缺省首 hook 末 cta；`keyframeUrl` 指向对应 accepted Look；缺某 pose 的 accepted → 抛错列出缺失 pose；`camera` 优先 `cameraPlan`，否则 `suggestedCamera[0]`；`shotSeconds` 缺省时均分 |
| `motion-prompt.test.ts`（扩展） | `lock` 全 true 时含三条禁改句与 `negative`；`lock` 缺省时输出与现状完全一致（回归）；与 `hasCameraConflict` 结果不变 |
| `storyboard-grid.test.ts`（扩展） | `refs.garmentImage=true` 时多一行服装参考且位置编号正确；不传时输出与现状一致 |
| i2v 参数 | 首帧 = 本镜 Look；`referenceImageUrls` 不含本镜 Look；数量超过 provider 上限时被现有逻辑裁剪 |

接口
| 接口 | 用例 |
| --- | --- |
| 建项目 `source: "look"` | shots 数 = poseSequence 长度；每镜 `assets` 一行 `type=look`；未调用分镜 LLM（mock 计数为 0）；`scriptPattern="on-camera"` 时只调用一次台词 LLM 且镜数不变 |
| compose | 用现有 compose 路径成功产出 mp4；`structure-fingerprint` 与模板镜数一致 |

## M4 单元 + 接口

单元
| 文件 | 用例 |
| --- | --- |
| `reference-scenes.test.ts` | 给定 ffmpeg scdet 输出解析出边界；12 镜合并到 9 且总时长不变；无切点时整段为 1 镜 |
| `reference-reader.test.ts` | 视觉 LLM 正常输出 → 逐镜结构；缺字段补默认；畸形 JSON 不抛且标记 `lowConfidence`；镜数与输入一致 |
| `template-derive.test.ts` | 固定读片结果 → 草稿通过 sanitize；pose 文本「侧身」→ `side`；无法匹配 → `front_stand` + 「需要确认」；camera 命中 `findPresetByPrompt`；屏幕文字含 ¥ → `price_card`；`wordAnchors` 引用的词存在于转写；无口播 → `scriptPattern="none"` 且锚点只剩 sfx；`derivedFrom` 填充 |
| AI 生成 fashion 模板 | mock LLM 第 1、2 次输出非法、第 3 次合法 → 成功；3 次全非法 → `template_generation_failed` 且带最后错误 |
| 编辑器状态 | 拖拽后 `poseSequence`、`shotRoles`、`shotSeconds`、`wordAnchors.shot` 同步重排 |

接口
| 接口 | 用例 |
| --- | --- |
| `POST /api/reference/ingest` | > 90s 拒绝；非视频拒绝；链接走 `ssrf-guard`；返回 `referenceId` 与 `status` |
| `GET /api/reference/[id]` | 进度阶段递进：probe → scenes → asr → frames → read → derive → done；失败阶段带原因 |
| 保存派生模板 | `source="reference"`；再次 `GET /api/ad-template/mine` 可见；`checkAdCompliance` 命中时拒绝保存并列出词 |
| MCP | `clipforge_generate_looks` 返回 lookIds；`clipforge_accept_look` 改状态；`clipforge_fashion_video` 建项目并返回 projectId |
| CLI | `clipforge looks --character X --garments a,b --poses front_stand,side` 打印表格；`clipforge fashion --template mirror_turn --set S` 触发建项目 |

## e2e（Playwright）

| 场景 | 步骤 | 断言 |
| --- | --- | --- |
| 服装到 Look | 打开 `/garments` 上传 fixture 上衣 → 建服装组 → `/looks` 选默认模特 → 勾 2 姿态 → 生成 | 出现 2 张候选卡；刷新后仍在；分数色块出现 |
| accept 到出片 | 上一场景 accept 1 张 → `/start` 选「从 Look 出片」→ `mirror_turn` | 提示缺 3 个姿态；补生成并 accept 后建项目成功；分镜页 4 镜均有 Look 角标 |
| 模板编辑往返 | 打开我的模板 → 新建时装模板 → 拖动姿态顺序 → 导出 JSON → 删除 → 导入 | 顺序与字段一致 |
| 对标视频派生 | 编辑器「从对标视频生成」上传 15s fixture | 进度走完；草稿 3 镜；「需要确认」列表可见；保存后出现在我的模板 |
| 无 key 降级 | 设置路线 FASHN 但不填 key → 生成 | 页面提示配置，不出现 500 |

provider 用本地 stub 服务（返回固定图与固定视频），通过环境变量切换。

## 人工验收

每个阶段结束用真实 provider 跑一轮，记录到 `docs/fashion-workbench/acceptance/<date>.md`。

| 项 | 方法 | 通过标准 |
| --- | --- | --- |
| 服装保真 | 同一件印花上衣 5 姿态 | 图案、颜色、版型可辨识一致 ≥ 4/5 |
| 模特一致 | 5 张 Look 对比定妆图 | 脸、发型一致 ≥ 4/5 |
| 平铺图输入 | 平铺服装图 + 模特 | 穿上身，不出现「平铺图贴在胸前」 |
| 叠穿 | 外套 + 内搭 + 下装 | 层次正确，颜色不串 |
| 姿态符合 | 每个 pose 各 3 张 | 姿态与预设描述一致 ≥ 2/3 |
| 打分可信 | 人工评 20 张与模型分对比 | Spearman ≥ 0.6 |
| 视频不换装 | `mirror_turn` 12s，`contact_sheet` 全部抽帧 | 无变色、无换款、无换脸 |
| 模板复用 | 同模板换 3 套服装 | `structure-fingerprint` 结构一致；镜数、时长一致 |
| 对标派生 | 3 条真实对标视频 | 草稿镜数与人工数一致；pose 匹配 ≥ 2/3 正确；词锚点位置在正确台词上 |
| 成本 | 5 Look + 12s 720p | UI 估算与实际账单误差 ≤ 20%，不超过阈值 |
| gate | 每条成片 | `clipforge gate` 无 fail |

## 回归

- 现有 `pnpm test` 全量通过，尤其 `motion-prompt`、`storyboard-grid`、`ad-templates`、`ad-template-share`：新增可选字段缺省时输出与改动前逐字节一致。
- 现有 e2e `smoke.spec.ts` 不改动即通过。
- 迁移后旧项目的 `assets` 查询与合成不受 `type="look"` 枚举影响。
