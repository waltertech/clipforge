# 时装 Look 工作台

在 ClipForge 里走「服装图 → 模特 Look → 模板视频」。试衣只出静帧，视频用已有图生视频，不换装。

需要先在设置里配好生图与对话模型（自带 Key）。主持人不进数据库，存在浏览器本地的角色库。

## 做一套 Look

1. 打开「角色」，建一个主播（正面定妆图越清楚，脸越稳）。
2. 打开「服装」，上传平铺图或上身图，选类目（上装 / 下装 / 连体 / 外套 / 鞋履 / 配饰），需要时再传背面。
3. 在服装库勾 1–5 件，组成一套搭配。
4. 打开「Look」，选搭配和主播，勾姿态（正面、侧面、背面、走姿等），点「生成 Look」。
5. 看分数和原因。低分可以换姿态或换路线重试。同一姿态只保留一张「已验收」。
6. 设置页「试衣」可选合成路线（默认，用现有生图模型）或 FASHN。没有 FASHN Key 时不要选手动试衣路线。

## 从 Look 出片

1. 起始页点「从 Look 出片」，或打开 `/looks/video`。
2. 选已验收的搭配、时装模板、确认主播。
3. 内置模板：
   - `runway_walk` 走秀：正面 → 走来 → 四分之三 → 背面
   - `mirror_turn` 镜前转身：正面 → 侧面 → 背面 → 正面
   - `ootd_talk` 试穿口播：要九宫格首帧，出镜说话
   - `detail_macro` 面料细节：特写 + 旁白
4. 缺某个姿态的已验收 Look 时，页面会提示回 Look 工作台补齐（走秀模板需要走姿和四分之三）。
5. 建项目后走原来的分镜 / 成片 / 质检。分镜页带「Look」角标的首帧不要随便换成别的衣服。

## 做自己的时装模板

1. 打开「新建项目」里的「我的模板」。
2. 打开「时装模板」开关，编辑姿态顺序、每镜角色和秒数、锁定（脸 / 图案 / 不换装）、负向词、词锚点。
3. 也可以让 AI 按一句话生成 `kind=fashion` 的模板；失败时看返回的校验原因。
4. 从对标视频生成：上传不超过 90 秒的 MP4 / WebM / MOV。系统只抽结构（镜数、姿态、运镜、口播模式），不复用原文案和画面。低置信度的姿态或运镜会列在「需要确认」里，改完再保存。
5. 导出的分享 JSON 是 v2；旧的 v1 广告模板仍能导入。

## 助手 / 命令行

Skill：`skills/fashion-look/SKILL.md`。

常用命令：

```
clipforge garments list
clipforge garments add --name "黑T" --category tops --front ./front.jpg
clipforge looks --set <搭配id> --poses front_stand,side,back --character-name Ada --yes
clipforge looks accept <lookId>
clipforge fashion --template mirror_turn --set <搭配id> --character-name Ada --yes
clipforge template derive ./ref.mp4 --yes
```

对话模型、生图、FASHN 分别读 `CLIPFORGE_LLM_*`、`CLIPFORGE_IMAGE_*`、`CLIPFORGE_FASHN_*`。

## 现在还没有

- 账号登录和按次扣费（上线前的 M5）
- 对标视频的服务端口播转写（结构能抽，台词时间轴为空）
- Look 打包成 zip（现在是 JSON 清单 + 图片地址）
- 把别人的试衣仓库嵌进本站

改过的代码按 AGPL-3.0 开源；可以卖托管和额度，不能闭源改版再分发。服装图和人像只上传你有权使用的。
