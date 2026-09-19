# 开源调研与选型结论

调研日期 2026-09-19。数据来自 GitHub API 与各仓库 README / LICENSE，未在本机跑通试衣或成片。

## 需求拆解

1. 上传服装参考图，让指定模特穿上，生成多个姿态的 Look。
2. 用同一模特按模板生成视频。
3. 模板可以自己创建，包括从对标视频拆解。

开源圈把「试衣出图」和「按模板出视频」拆成两条线，没有一份仓库三项齐全。

## 产品层候选

| 项目 | Stars | 许可 | 与三项需求的重合 | 结论 |
| --- | ---: | --- | --- | --- |
| [iamsaurabhc/drape-ai](https://github.com/iamsaurabhc/drape-ai) | 1 | MIT | 模特生成 + 服装库 + Seedream 4.5 Edit 一次多图合成；Stage 4 已有 Seedance / Kling 图生视频与 7 个运镜预设 | 功能上最接近，MIT。姿态库仍在 TODO，运镜是写死预设，不是可创建模板。适合抄管线 |
| [Prompt-Haus/OpenVTO](https://github.com/Prompt-Haus/OpenVTO) | 66 | MIT | 自拍 + 姿态图出模特，目录图换装，4–8 秒转身循环 | 管线最像功能 1+2。绑 Google Vertex（Gemini 出图、Veo 出视频），前端是 React Native 试玩，无模板系统 |
| [isurulkh/ateliersynth-studio](https://github.com/isurulkh/ateliersynth-studio) | 1 | 无 LICENSE | 109 模特、53 姿态、试衣、六镜 lookbook、四轴视觉打分 | 体验最像功能 1，但无许可证不能商用；视频试衣官方推迟 |
| [xixihhhh/clipforge](https://github.com/xixihhhh/clipforge) | 844 | AGPL-3.0 | 模特库、四视图定妆、九宫格、脚本钩子、广告模板 JSON 导入导出、Seedance / Kling 成片、质检 | 功能 2、3 的底座。没有服装试衣，商品锁定不是试衣形变 |
| [Cyanex1702/Fashionlab-AI](https://github.com/Cyanex1702/Fashionlab-AI) | 1 | 自定义非商用 | 本地时装工作室、试衣、插件 | 许可证禁止 SaaS 与商用，排除 |

## 试衣引擎候选（不是网站）

| 项目 | Stars | 许可 | 能力 | 用法 |
| --- | ---: | --- | --- | --- |
| [fashn-AI/fashn-vton-1.5](https://github.com/fashn-AI/fashn-vton-1.5) | 323 | Apache-2.0 | 无 mask 像素空间试衣，平铺图和上身图都能当服装输入；tops / bottoms / one-pieces | 自托管 GPU 推理或走 FASHN 官方 API。首选自托管路线 |
| [franciszzj/Leffa](https://github.com/franciszzj/Leffa) | 1,677 | MIT | 试衣 + 姿态迁移同一框架 | 多姿态最对口，Gradio / ComfyUI 形态 |
| [Zheng-Chong/CatVTON](https://github.com/Zheng-Chong/CatVTON) | 1,844 | 研究许可 | 轻量图试衣，< 8GB 显存 | 社区最大，商用需单独确认许可 |
| [Zheng-Chong/CatV2TON](https://github.com/Zheng-Chong/CatV2TON) | 239 | 无 LICENSE | 图 + 视频换装 | 输入是「人体视频 + 衣服」，不是按模板拍片 |
| [vivoCameraResearch/Magic-TryOn](https://github.com/vivoCameraResearch/Magic-TryOn) | 592 | 自定义 | 视频试衣 DiT | 同上，视频换装路线 |
| [snuvclab/vanast](https://github.com/snuvclab/vanast) | 161 | 无 LICENSE | 单图 + 服装 + 姿态视频 → 换装动画（CVPR 2026） | 研究代码，一步到位但无法商用 |

## 视频 / 模板层参考

| 项目 | Stars | 许可 | 可借鉴 |
| --- | ---: | --- | --- |
| [Emily2040/seedance-2.0](https://github.com/Emily2040/seedance-2.0) | 7,364 | MIT | `seedance-recipes` Skill 的 Product I2V 配方字段 |
| [charlesdove977/UGC-Factory](https://github.com/charlesdove977/UGC-Factory) | 75 | MIT | 锁人物 + 锁商品 Element 后分镜 |
| [TuolaGe/reference-led-ugc-product-video](https://github.com/TuolaGe/reference-led-ugc-product-video) | 17 | MIT | 9:16 Fashion Reel Skill，拆参考视频节奏再套自己的货 |
| [hypit-ai/hypit](https://github.com/hypit-ai/hypit) | 10,664 | 修改版 Apache-2.0（禁多租户 / 禁商业再分发） | 对标视频拆解方法、词锚点、单维度变体 |

## Hypit 评估

Hypit 是给 AI Agent（Claude Code / Codex）用的视频编排语言和运行时，约 120 个包。「复刻视频」不是确定性 API：Agent 用 `hypit transcribe`（WhisperX 逐词）、`hypit media probe / boundaries / frames / tiles` 读片并写参考笔记，再由 LLM 手写 `.svml`（XML 式 DSL）+ `.svs` 配方 + `.svrun`，最后无头 Chromium 渲染。全库没有试衣、姿态、服装相关能力。

不能用作工作台组件的原因：

1. 许可证附加条款 (a) 禁止用其源码或衍生代码运营多租户环境或向第三方提供托管 / SaaS，不论是否收费；(b) 禁止商业再分发；(c) 不得移除 Hypit 名称和 logo。多用户收费网站正好命中 (a)。
2. 模板形态是几百行 DSL，靠 Agent 写和改；工作台用户需要点选式模板。
3. 时装 Look 视频的模板核心是姿态序列、运镜、节奏、字幕样式，用不上图形重的 Chromium 渲染农场。

可借鉴的三点：

1. 对标视频拆解流程：逐词 ASR → 镜头边界 → 每镜带词标注的帧网格 → 视觉模型读「这一镜做什么、为什么起效」→ 结构化笔记 → 区分换人换货后必须保留与需要重设计的关系。ClipForge 已有 `local-asr.ts`、`media-analysis.ts`、`transcript-*`、`structure-fingerprint.ts` 半套零件。
2. 字幕、卖点卡、音效锚定在台词的词上，而不是秒。
3. 变体只换一个维度：换模特、换服装、换钩子，对应模板里的显式槽位。

许可证明确允许「自己组织内部工具」。团队可在本地用 Hypit 深读爆款视频、手工打磨模板，再手动导出为本项目的 `FashionTemplate` JSON；Hypit 本体和运行时不进服务器、不面向用户。

## 选型结论

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 工作台底座 | 继续现有 ClipForge fork | 已有模特、九宫格、模板 JSON、成片、质检、MCP / CLI；已本地部署 |
| Look 引擎 | Provider 抽象，先接多图合成（Seedream Edit / gpt-image edit），再接 FASHN | 零新依赖先闭环；FASHN Apache-2.0 可自托管，面料保真更好 |
| 姿态 | 固定预设库 | 不依赖模型即兴，结果可复现、可打分 |
| 视频 | Look 首帧 → 现有 i2v | 不做视频试衣；接 API 无需 GPU |
| 模板 | `AdTemplate` 扩展 + JSON 导入导出 + SKILL 说明书 | 复用 `ad_template_recipes` 与 share 格式 |
| 对标视频导入 | 自研 `reference-reader` + `template-derive` | 借鉴 Hypit 方法，不引入其代码 |

不做：fork CatVTON / Leffa 当 SaaS；视频试衣当主路径；引入 Hypit 或 Fashionlab-AI 代码。
