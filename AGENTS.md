# AGENTS.md — Aoi-system 工作规范与项目计划入口

> 谷圈团购排单系统（团长管理端 + 团员自助看板）。纯 HTML/CSS/原生 JS 单页应用 + Supabase（无框架、无构建；package.json 仅为测试工具链）。
> 业务概念沿用原作者（秋洛，CC BY-NC-SA 4.0）；代码与数据模型全量重写为原创。

## 注意事项（每次改动必须遵守）

1. **每次改动完成后，必须创建一个对应的 Git commit**，以便后续追踪和回滚。
2. **每次改动完成后，必须编写或更新相关测试，并在交付给用户前，确保所有测试和验证全部通过。**
   （测试基建已建立：vitest + jsdom，`npm test`；harness 见 `tests/helpers/aoi.js`，新增 js 模块需加入其 MODULES 列表。）
3. **推送规则（2026-09-12 修订，以实测为准）：`origin`（zhengdaode/Aoi-system）可随时随意推送，无需逐次请示——GitHub Pages 通道由 origin 驱动（push main 触发 `.github/workflows/deploy.yml`：先跑测试、通过后自动部署 Pages）。**Netlify 站点挂靠的是 `deploy` 仓库（ICGP-Click/Click_sales_system），不随 origin 更新**——实测 deploy 停在 v3.1.0（2026-09-06）、落后 origin 100+ 提交，其对应的 Netlify 站是 v3.1.0 旧前端（2026-09-06 数据事故中的「旧生产站」即它），**勿在该站测试/使用**。**使用、测试与开发一律基于 Pages**；`deploy` 远端未经部署者明确允许禁止 push 及任何其他改动（确需操作时由部署者明确指示后执行）。
4. **服务器部署权限现状（2026-09-12 复测）**：工作服务器 `47.101.194.103`（relay 所在）**整机入网不可达**——SSH 22 与 relay 8080 从本机直连与 Supabase Edge 双侧均超时（2026-09-12 凌晨 03:16 Edge 探针尚返回 relay 401，其后失联；2026-09-10 旧记录「SSH Permission denied」说明当时可达仅密钥未授权，现状更严重），需负责人在阿里云控制台核查实例运行状态/防火墙 22+8080 入方向，并为部署者公钥授权（authorized_keys 或控制台远程连接手工追加）。**该机实为阿里云「轻量应用服务器」（SWAS），与 ECS 是不同产品线**——独立控制台（swas.console.aliyun.com）、用「防火墙」而非「安全组」、套餐含流量包（流量超额会直接断网，是 SWAS 特有故障模式）；历史文档中出现的「ECS」均为口语误称，均指这台 SWAS。`106.14.28.206` 为负责人**自用机**（docker 跑 napcat + astrbot；2C/1.6G 内存仅剩 ~98MB）SSH 可登录（F5 待真机部署在此执行）但**不可承载 Chromium 类负载**；免 SSH 的服务端部署走 Supabase Edge Function（先例：qq-relay v7 经 Management API，2026-09-12）。**服务器凭据一律不入仓库**，此处仅记录授权范围与结论。

## 当前项目计划

**现状以 [docs/STATUS.md](docs/STATUS.md)「当前状态速览」为准**（2026-09-12 起；ROADMAP 已转为历史文档）——2026-09 用户实测 10 项问题的迭代计划
（v1.7.0 团员侧修复/QQ 机器人/测试基建 → v1.8.0 订单改版 → v1.9.0 国际计算/活动管理 → v2.0.0 限购计算器/导出/响应式），
**四个版本已全部实施完成**（2026-09-06，详见 CHANGELOG）；v3.0.0 账号体系重设计亦已实施（见 `docs/archive/PLAN-AUTH-REDESIGN.md`）；
**v3.2.0 第二批实测反馈迭代已实施完成**（2026-09-06，见 `docs/archive/PLAN-v3.2.0.md`）；
**v3.3.0 冗余清理与重构已实施完成**（2026-09-07：死代码删除 / 重复实现合并 / 隐私快照清理 / 测试 134 用例 / 文档一致性）；
**v3.4.0 数据安全兜底 + 团员感知已实施完成**（2026-09-08：B1 历史快照与备份卡 / B2 P1 密钥与 PII 隔离 / F1 自动通知 / F2 进度时间线 / 测试 170 用例；线上库已应用并探针验证；F5 独立项目设计待审核、F6 demo 待管理层审核、F7/F8 取消）；
**v3.5.0 已实施完成**（2026-09-08 双特性：①从链接导入——信息录入页粘贴排谷表/汇总表分享直链一键导入，直链无 CORS 头，经 netlify.toml `/media-proxy` 同源代理拉取、直连回退；②F6 团期复盘统计并入主系统——「工具 → 复盘统计」页（js/stats.js）+ `orders.shippedAt` 发货时间戳埋点，demo 路线取消、`demo/stats-demo/` 保留为历史产物（见 `docs/PLAN-F6-STATS.md`））；
**v3.5.2 已实施完成**（2026-09-09 链接导入三通道加固：`/media-proxy` → `/media-relay`（ECS relay `/fetch` 国内中转，需部署 relay/relay.js 点亮）→ 直连；报错分级区分「链接 404 失效」与「通道不可用」）；
**v3.6.0 管理端体验升级已实施完成**（2026-09-09，见 `docs/PLAN-v3.6.0.md`：S1 买家管理独立 tab（状态分桶 + 点击圈名筛单）/ S2 活动商品按型号管理（参考图 + 跳转链接，空链接回落平台链接，团员端参考列）/ S3 购买计划入库 `d.limitPlans` 双向同步 + 购买失败自动重分配 / S4 图片粘贴上传 `data-img-paste` / S5 导出文件名带活动名 / S6 复盘统计布局修复（view-stats 曾在 `</main>` 外）；测试 254 用例）；
**F5 QQ 机器人双向已实施完成**（2026-09-09，独立仓库 [aoi-qqbot](https://github.com/zhengdaode/aoi-qqbot) M1–M7：relay v4 双向/绑定/查单/团况/自动催缴/排发 xlsx/非文本兜底 + 54 测试；主仓库接入 = 3 个 Supabase RPC（`member_lookup_by_qq` / `team_summary_for_group` / `unpaid_members_by_group`）+ 设置页 `botConfig.adminQq/qrUrl` + 排发「设为已发」自动私发管理员；**部署动作待真机执行**：NapCat 上报 / Caddy TLS / SQL Editor 重跑 schema / ECS 部署新 relay，见 aoi-qqbot README）；
**v3.6.2 订单管理表头排序已实施完成**（2026-09-09：活动/制品类型/型号/单价/数量/购买者/到货状态/小计 8 列可排序，点击表头循环 不排→升→降，中文拼音 `Intl.Collator('zh-Hans-CN')`、空值恒最后、稳定排序；≤640px 卡片视图无表头，筛选行排序下拉兜底；排序记忆存 `localStorage['aoi_orders_sort']`；仅作用渲染副本不写回 blob，导出行序自动跟随；测试 275 用例）；
**F9 PCO 商品目录导入+补货监控——主仓库侧已交付（2026-09-10，随 commit 2bed645 入库；版本顺延 v3.8.0）**：「工具 → PCO 目录」页（粘贴导入富文本/纯文本双入口 + 词典翻译【品类词典 + PokeAPI 官方种名 1025 条 + 地区形态前缀，无 LLM】+ 校对工作台【计算器汇率换算/未识别高亮/经 registerProduct 同构推入活动商品】+ 小程序模板导出【说明 6 行+表头+数据，Sheet1】+ `d.pcoItems` 目录与监控标记；tests/catalog.test.js 18 例，全套 336 例绿）。**监控 M1 实测否决自动化浏览器→已挂起（负责人 2026-09-10 指示）**：PCO 风控对 Actions 数据中心 IP 与本地家庭网络、headless 与有头 Chromium、去自动化特征前后共 7 轮对照一律「Restricted access」（去自动化已获负责人批准并实现于监控仓 grab.js）；**终局（2026-09-10 负责人关代理复验）**：本地直连全流程打通（40 件商品五要素全中、去自动化一次过质询），同一代码在 Actions 数据中心 IP 仍被拒——**PCO 按 IP 信誉拒绝数据中心段（阿里云同理），自动监控唯一可行载体=负责人本地 Windows 机**（计划任务+本地 .env 写库方案待确认），Actions 保留为复验工具；粘贴解析已按真实 DOM 修复（JAN.html/data-pid/连写价格，commit 6770ebe）；「只粘贴链接一键抓取」入口已预留（`d.catalogConfig.dispatchUrl`，通道就绪即点亮）：见 [docs/PLAN-F9-CATALOG-IMPORT.md](docs/PLAN-F9-CATALOG-IMPORT.md)；
**F10 QQ 机器人用户交互迭代已实施完成（2026-09-10，v3.6.3，见 [docs/PLAN-F10-BOT-INTERACTION.md](docs/PLAN-F10-BOT-INTERACTION.md)）**：QQ 绑定唯一性校验（两端：relay 冲突暂拒/幂等，网页冲突拒绝/异常放行）/ bot「解绑 密钥 圈名」「我是谁」「查单 <活动名>」「我的快递」指令 + 帮助更新（aoi-qqbot commit 69ebe1b/abde065，node:test 54→68）/ 网页端解绑按钮 + 复制绑定指令（js/member.js，vitest 275→286）；零 schema 改动；**上线待 relay 真机部署批次（与 F5 同批：ECS pm2 更新 + NapCat 上报 + Caddy TLS + schema 重跑）**；
**v3.7.0 管理端第二轮已实施完成（2026-09-10，见 [docs/PLAN-v3.7.0.md](docs/PLAN-v3.7.0.md)）**：S1 商品主档聚合（`activityMeta[].products` 升级唯一商品主档 + `productStats` 实时聚合 + `d.pcoItems` F9 预留）/ S2 活动管理展开区（点击活动名展开商品卡片，取代 v3.6.0 商品弹窗，活动表 14→11 列）/ S3 购买人体系（候选仅以往购买人 + 一人一账号 + 计划账号槽位标签同步）/ S4 信息录入改「登记活动商品」（`d.products` 废弃保留）/ S5 汇总表导出（`js/summary-export.js` 复刻 7.8汇总表：采购表 + 每活动汇总矩阵，exceljs/SheetJS 双通道）/ S6 复盘并入总览 + 删发货 CSV / S7 流式宽度（去 max-w 上限 + data-lowpri 响应式隐藏列）/ S8 合照缩略图；测试 275→336+ 全绿；
**v3.9.0 购买清单图片导出 + 汇总表参考图内嵌已实施完成（2026-09-10，见 CHANGELOG v3.9.0）**：①限购计划结果区「导出购买清单图（每账号一张）」+ 结果表账号列「导出清单图」（新模块 `js/plan-export.js`：逐账号 canvas 生成大字简洁 PNG——账号名 + 参考图占行高 75% / 原语言商品名字号 10%（refUrl 回查 `d.pcoItems.jpName`，无原文回落中文型号）/ 数量字号 5%；缺图「图片缺失」占位，只绘 CORS 干净图源防画布污染）；②汇总表导出参考图拉取转 base64 内嵌 exceljs 单元格（失败回落图片链接）+ 商品跳转/图片链接两通道均可点击直达（exceljs hyperlink / SheetJS `.l` + `absUrl` 绝对化，相对链接回落 PCO 主站）；测试 336+→357 全绿（v390-plan-export / v390-summary-embed）；
**v3.9.1 图片内嵌 CORS 根因修复（2026-09-10，见 CHANGELOG v3.9.1）**：图床/商品图源站无 CORS 头（esaimg 实测连 301 无 ACAO）致 v3.9.0 的汇总表内嵌与购买清单图片在浏览器 fetch 必败回落链接——图片拉取改为「直连 → /media-proxy → /media-relay」候选链（`Aoi.exportSummary.imageCandidates`；`PROXY_HOSTS`、netlify.toml、relay `FETCH_HOSTS` 三处白名单同步追加 PCO 主站与 esaimg；relay 通道需 ECS 重新部署生效）；另交付 `scripts/supplement-activity.mjs` 活动订单对账补充工具（排谷表 xlsx，dry-run 默认 / --apply，AOI_ADMIN_TOKEN 环境变量）；测试 359 全绿；
**v3.9.2 商品原名元数据 + 参考图转存自有图床 + 万圣节订单统一（2026-09-10，见 CHANGELOG v3.9.2）**：商品主档新增可选 `nameOrig`（registerProduct/目录推入/商品卡展示/购买清单图片名称解析优先链贯通）；esaimg 存储自动转 webp → 汇总表内嵌加 canvas 解码转 JPEG、`img.cdn1.vip` 入三处白名单；宝可梦万圣节数据治理（Management API SQL 直写 + 写前快照）：11 件排谷表商品对齐 PCO 主档（29 笔订单 + 29 项限购计划键改写、去重）、40 张参考图经去自动化 Chromium 抓取转存自有图床（PCO 图片 CDN 对数据中心 IP/非浏览器指纹 403，代理/relay 均不可行）；测试 362 全绿；
**v3.9.3 导出链路可用性修复（2026-09-10，见 CHANGELOG v3.9.3）**：实测「Excel 仍只有图片超链接」「导出图片没反应」根因治理——①`imageCandidates` 接入 Edge `/fetch` 通道 + 线上 qq-relay Edge 白名单扩四主机（+PCO/esaimg/img.cdn1.vip）并经 Management API 重部署（version 6，`scripts/deploy-edge.js` 部署器；metadata 字段为 `entrypoint_path`，PATCH 只改配置不更新代码）——Pages/本地环境的汇总表参考图内嵌与购买清单图自此真实可用（端到端实测 xlsx 含 `xl/media`、toast「参考图已全部内嵌」），ECS relay 重部署不再是前置条件；②supabase/xlsx/exceljs/html2canvas 自托管 `js/vendor/`（实测本机对 cdn.jsdelivr.net 返回伪造证书）；③`Aoi.promiseTimeout` + 导出图片 30s 超时/loading 防无限挂起；测试 370 全绿；
**v3.9.4 购买清单导出表格化 + 汇总表外币原价 + PCO 导入 ChatGPT 翻译工作流（2026-09-11，见 CHANGELOG v3.9.4）**：①`js/plan-export.js` 原地重写——v3.9.0 逐账号 PNG 方案废除（实测太慢），整活动一个 xlsx、每账号一个 Sheet（账号名大标题 + 参考图内嵌 + 外文原名/外币单价/件数/外币小计 + 合计行），入口 = 限购计划结果区 + 活动管理展开区/计划弹窗「导出购买清单表」，单账号导出按钮删除；②汇总表购买人金额旁新增「外币原价」列（采购表购买人子表 4→5 列、每活动汇总矩阵 A=金额/B=外币原价/C=昵称，商品矩阵右移，v370/v390 测试同步新布局）；③PCO 导入接入 ChatGPT 翻译：`Aoi.catalog.AI_PROMPT`（页面可复制/可查看，固定列表格输出、常见官方宝可梦译名、品类词与 catalogDict 同源）+ `Aoi.catalog.parseAi`（Markdown/TSV、表头关键字映射、无表头列序兜底）+ `addToDraft` 中文译名/类型直入（词典翻译降为兜底）；④侧边导航「PCO 目录导入」移入业务组与「信息录入」并列；测试 370→377 全绿；
**v3.9.5 粘贴导入图片保留（2026-09-11，见 CHANGELOG v3.9.5）**：v3.9.4 ChatGPT 工作流图片/链接丢失的修正——两步导入按「日文原名」对齐合并（顺序无关）：①PCO 页整页复制先直接粘贴（富文本商品卡带出商品图/链接/价格/限购）；②ChatGPT 回复表格再粘贴，`addToDraft` 对齐键放宽（任一方缺链接按 jpName 对齐），AI 中文译名/类型覆盖词典草稿建议并清未识别高亮，图片/链接/价格以页面数据保留；新增 `Aoi.catalog.parseAiHtml` 兼容 ChatGPT 页面渲染表格（text/html `<table>`）粘贴，`importPaste` 解析顺序 = 纯文本 AI 表 → HTML AI 表 → 富文本商品卡 → 纯文本行；提示词修正（无需图片列、日文原名为对齐键须一字不差）；测试 377→382 全绿；
**v3.15.0 商品联动闭环 + 活动级价格生成与导出 + PCO 目录瘦身 + 复盘性能治理（2026-09-13，见 [docs/PLAN-v3.15.0.md](docs/PLAN-v3.15.0.md) 与 CHANGELOG v3.15.0）**：①手动录入选定活动后型号下拉联动已登记商品（datalist 型号+原名，命中回填类型/币种/单价，`productFillFor`）；②表格导入按「活动+型号」识别主档回填缺失字段 + 新商品自动登记骨架（弹窗可关）；③活动管理展开区新增「生成人民币价」（商品主档+外币订单、汇率/加价弹窗内临时调整不写回、仅补空缺/全部覆盖，自订单管理勾选版迁入并移除原入口，D2）、「导出商品列表」、「导出到小程序」（模板自 PCO 页迁入，全活动可用，缺价可临时换算）；④PCO 页不再默认生成人民币价（人工填写优先）；⑤AI 提示词扩为 8 列（+商品链接/图片链接，禁止编造、联网可读图），一次性导入中文版，缺图回落两步流程（D3：ChatGPT 客户端剥离 `<img>` src 的预期管理）；⑥「PCO 目录导入」导航移入工具组；⑦复盘性能治理：`buyerSummary` 记忆化（数据信号+同 tick 过期）+ `stats.render` 聚合缓存 + 登录期 notify.sync 延后；⑧「已存目录」d.pcoItems 下线（D1：UI/写入/抓取通道移除、git 历史即代码归档、数据经 `scripts/archive-pco.mjs` dry-run 快照→--apply 删除→--restore 可恢复）；零 schema 改动；测试 422→439 全绿；
线上排障、数据事故取证与回退锚点见 `docs/ITERATION_LOG.md`；**遗留项与线上操作清单见 `docs/STATUS.md`「当前状态速览」**。
**下一轮计划（待批准）：见 [docs/PLAN-NEXT.md](docs/PLAN-NEXT.md)** —— v3.3.0 审查后产出的「新功能 × 后端」双路线规划（B1–B7 后端 / F1–F8 功能 + 版本切分），批准后按其版本切分实施。

## 技术栈与架构速览

- 前端：`index.html`（页面骨架 + 全部 screen）+ `js/` 下 22 个功能模块（挂全局 `window.Aoi` 命名空间，无模块打包）。
  核心模块：`core.js`（路由/通用）、`data.js`（Supabase 读写）、`auth.js`、`team.js`、`member.js`（团员端）、
  `orders.js`（订单/活动/批次/类型/商品主档）、`calc.js`（汇率换算）、`intl.js`（国际运费分摊）、`approval.js`（交费审批）、
  `shipping.js`、`warehouse.js`、`notify.js`（通知 + QQ 推送入口）、`bot.js`（OneBot v11 客户端）、`import.js`、
  `limits.js`（限购计算器）、`stats.js`（复盘统计）、`image-upload.js`、`summary-export.js`（v3.7.0 汇总表导出）；
  另有 `catalog.js`/`catalog-dict.js`/`species-zh.js` 为 F9 并行引入（待 v3.8.0 点亮）。
- 存储：Supabase 三表（`teams` / `team_members` / `team_data`）；**全部业务数据存在 `team_data.data` 一个 JSONB blob 里**，
  schema 与 RPC 见 `supabase-schema.sql`（手工在 SQL Editor 执行，无版本化迁移）。
- QQ 机器人链路：前端 `js/bot.js` → `relay/relay.js`（ECS，校验登录态+owner/admin）→ NapCat（OneBot v11）。
- 部署：Netlify + GitHub Pages 双通道，`scripts/build-config.js` 从环境变量生成 `js/config.js`（密钥不进仓库）。
- 样式：Tailwind CDN + `css/styles.css`（editorial 设计系统；黑夜模式覆盖已删除，旧版保留在 `backup-before-cleanup` 分支）；设计规范见 `docs/design/DESIGN.md`。

## 常用命令

- 本地运行：任意静态服务器指向仓库根目录（或直接打开 `index.html`），无需构建。
- 部署构建：`node scripts/build-config.js`（CI 中自动执行）。
- 测试（v1.7.0 起）：`npm test`。
- 调试账户：`debug` / `debug123`（绕过 Supabase，数据存 localStorage，前缀 `aoi_debug_*`）。

## 文档索引

| 文档 | 内容 |
|------|------|
| `docs/ROADMAP.md` | **当前唯一有效路线图**：10 项问题 → v1.7.0–v2.0.0 任务分解 + P0 团员侧故障分析（基线已更新至 v3.3.0） |
| `docs/PLAN-NEXT.md` | **下一轮计划（待批准）**：新功能（F1–F8）× 后端（B1–B7）双路线 + 版本切分 |
| `docs/PLAN-F5-QQBOT-BIDIRECTIONAL.md` | F5 QQ 机器人双向（独立项目 [aoi-qqbot](https://github.com/zhengdaode/aoi-qqbot)）：**已实施（2026-09-09，M1–M7）**，部署动作待真机执行 |
| `docs/PLAN-F6-STATS.md` | F6 团期复盘统计：审核迭代结论 + 并入主系统实现方案（v3.5.0 已实装） |
| `docs/PLAN-F9-CATALOG-IMPORT.md` | F9 PCO 商品目录导入 + 补货监控：**主仓库侧已交付（2026-09-10，v3.8.0）**——粘贴导入+词典翻译+校对工作台+小程序模板导出；监控被 PCO 风控实测否决（自动化浏览器一律 Restricted access），载体待拍板 |
| `docs/PLAN-F10-BOT-INTERACTION.md` | F10 QQ 机器人用户交互迭代：**已实施（2026-09-10，v3.6.3）**——QQ 绑定唯一性校验 / bot 解绑·我是谁·查单筛选·我的快递 / 网页端解绑与复制绑定指令，零 schema 改动，上线随 relay 真机部署批次 |
| `docs/STATUS.md` | 权威状态：已完成阶段、数据模型（blob 结构）、已知限制、**遗留项与线上操作清单** |
| `CLAUDE.md` | QQ 机器人接入专项（NapCat / relay / 安全红线） |
| `README.md` | 功能、部署、安全、项目结构 |
| `docs/design/PRODUCT.md` / `docs/design/DESIGN.md` | 产品定位 / 视觉设计规范 |
| `CHANGELOG.md` | 版本变更记录 |
| `docs/archive/` | 已完成计划归档：`PLAN-AUTH-REDESIGN.md`（v3.0.0）、`PLAN-v3.2.0.md`、`IMPROVEMENT_PLAN.md`（v1.4.0）、`PR-v1.4.0-final.md` |
