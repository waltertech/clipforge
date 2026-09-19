# 时装 Look + 模板视频工作台

在 ClipForge 之上增加一层「服装 → 模特 Look → 模板视频」的能力：上传服装参考图，让模特库里的人穿上它生成多姿态 Look；选中 Look 作为首帧，按可创建、可分享的时装模板出视频；模板既可手工创建，也可从对标视频拆解生成。

本目录是这项工作的设计与执行文档，按阅读顺序：

| 文档 | 内容 | 读者 |
| --- | --- | --- |
| [01-research.md](01-research.md) | 开源项目调研、Hypit 评估、选型结论 | 决策 |
| [02-architecture.md](02-architecture.md) | 三层架构、数据模型、Look 引擎抽象、与现有管线的接缝 | 开发 |
| [03-template-spec.md](03-template-spec.md) | `FashionTemplate` 字段规范、JSON 示例、导入导出与对标视频派生 | 开发 / 模板作者 |
| [04-roadmap.md](04-roadmap.md) | 分阶段 TODO（M0–M5），每项可独立提 PR | 开发 / 项目管理 |
| [05-test-plan.md](05-test-plan.md) | 单元、接口、e2e、人工验收的测试项与通过标准 | 开发 / QA |
| [06-license-and-compliance.md](06-license-and-compliance.md) | AGPL、试衣模型与 Hypit 的许可边界，服装图与人像合规 | 决策 / 法务 |
| [07-skill-draft.md](07-skill-draft.md) | `skills/fashion-look/SKILL.md` 草稿与 MCP / CLI 工具清单 | 开发 |

## 一句话结论

没有任何一份开源仓库同时覆盖「试衣出多 pose 图」「按模板出视频」「可创建模板」。可行方案是 **Look 先行、图生视频、JSON 模板**：试衣引擎做成 Provider（多图合成或 FASHN），姿态用固定预设库，视频复用 ClipForge 已有的 i2v / 合成 / 质检，模板在 `AdTemplate` 上扩展时装字段。

## 术语

- **服装（Garment）**：用户上传的服装参考图，平铺图或上身图，带类目。
- **服装组（Garment set）**：一次搭配用到的 1–5 件服装。
- **Look**：模特 + 服装组 + 一个姿态生成的静帧候选，有分数和 accepted / rejected 状态。
- **姿态（Pose）**：`pose-presets.ts` 中的固定预设，如正面、四分之三、背面、走姿。
- **时装模板（FashionTemplate）**：`AdTemplate` 的扩展，多了姿态序列、锁定项、负向词、词锚点等字段。
- **对标视频（Reference video）**：用户上传的、希望复刻结构的视频；只提取结构，不复用画面。
