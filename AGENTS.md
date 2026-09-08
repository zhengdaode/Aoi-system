# AGENTS.md — Aoi-system 工作规范与项目计划入口

> 谷圈团购排单系统（团长管理端 + 团员自助看板）。纯 HTML/CSS/原生 JS 单页应用 + Supabase（无框架、无构建、无 package.json）。
> 业务概念沿用原作者（秋洛，CC BY-NC-SA 4.0）；代码与数据模型全量重写为原创。

## 注意事项（每次改动必须遵守）

1. **每次改动完成后，必须创建一个对应的 Git commit**，以便后续追踪和回滚。
2. **每次改动完成后，必须编写或更新相关测试，并在交付给用户前，确保所有测试和验证全部通过。**
   （测试基建已建立：vitest + jsdom，`npm test`；harness 见 `tests/helpers/aoi.js`，新增 js 模块需加入其 MODULES 列表。）
3. **推送规则：commit 后只推 `origin`（zhengdaode/Aoi-system），`deploy` 远端（ICGP-Click/Click_sales_system，GitHub Pages 部署通道）暂时不推送**——需要上线部署时由部署者明确指示后再推 `deploy`（推送 deploy 会直接触发线上更新，2026-09-06 起默认冻结）。

## 当前项目计划

**见 [docs/ROADMAP.md](docs/ROADMAP.md)** —— 2026-09 用户实测 10 项问题的迭代计划
（v1.7.0 团员侧修复/QQ 机器人/测试基建 → v1.8.0 订单改版 → v1.9.0 国际计算/活动管理 → v2.0.0 限购计算器/导出/响应式），
**四个版本已全部实施完成**（2026-09-06，详见 CHANGELOG）；v3.0.0 账号体系重设计亦已实施（见 `docs/archive/PLAN-AUTH-REDESIGN.md`）；
**v3.2.0 第二批实测反馈迭代已实施完成**（2026-09-06，见 `docs/archive/PLAN-v3.2.0.md`）；
**v3.3.0 冗余清理与重构已实施完成**（2026-09-07：死代码删除 / 重复实现合并 / 隐私快照清理 / 测试 134 用例 / 文档一致性）；
**v3.4.0 数据安全兜底 + 团员感知已实施完成**（2026-09-08：B1 历史快照与备份卡 / B2 P1 密钥与 PII 隔离 / F1 自动通知 / F2 进度时间线 / 测试 170 用例；线上库已应用并探针验证；F5 独立项目设计待审核、F6 demo 待管理层审核、F7/F8 取消）；
**v3.5.0 已实施完成**（2026-09-08 双特性：①从链接导入——信息录入页粘贴排谷表/汇总表分享直链一键导入，直链无 CORS 头，经 netlify.toml `/media-proxy` 同源代理拉取、直连回退；②F6 团期复盘统计并入主系统——「工具 → 复盘统计」页（js/stats.js）+ `orders.shippedAt` 发货时间戳埋点，demo 路线取消、`demo/stats-demo/` 保留为历史产物（见 `docs/PLAN-F6-STATS.md`））；
**v3.5.2 已实施完成**（2026-09-09 链接导入三通道加固：`/media-proxy` → `/media-relay`（ECS relay `/fetch` 国内中转，需部署 relay/relay.js 点亮）→ 直连；报错分级区分「链接 404 失效」与「通道不可用」）；
**v3.6.0 管理端体验升级已实施完成**（2026-09-09，见 `docs/PLAN-v3.6.0.md`：S1 买家管理独立 tab（状态分桶 + 点击圈名筛单）/ S2 活动商品按型号管理（参考图 + 跳转链接，空链接回落平台链接，团员端参考列）/ S3 购买计划入库 `d.limitPlans` 双向同步 + 购买失败自动重分配 / S4 图片粘贴上传 `data-img-paste` / S5 导出文件名带活动名 / S6 复盘统计布局修复（view-stats 曾在 `</main>` 外）；测试 254 用例）；
**F5 QQ 机器人双向已实施完成**（2026-09-09，独立仓库 [aoi-qqbot](https://github.com/zhengdaode/aoi-qqbot) M1–M7：relay v4 双向/绑定/查单/团况/自动催缴/排发 xlsx/非文本兜底 + 54 测试；主仓库接入 = 3 个 Supabase RPC（`member_lookup_by_qq` / `team_summary_for_group` / `unpaid_members_by_group`）+ 设置页 `botConfig.adminQq/qrUrl` + 排发「设为已发」自动私发管理员；**部署动作待真机执行**：NapCat 上报 / Caddy TLS / SQL Editor 重跑 schema / ECS 部署新 relay，见 aoi-qqbot README）；
线上排障、数据事故取证与回退锚点见 `docs/ITERATION_LOG.md`；**遗留项与线上操作清单见 `docs/STATUS.md`「当前状态速览」**。
**下一轮计划（待批准）：见 [docs/PLAN-NEXT.md](docs/PLAN-NEXT.md)** —— v3.3.0 审查后产出的「新功能 × 后端」双路线规划（B1–B7 后端 / F1–F8 功能 + 版本切分），批准后按其版本切分实施。

## 技术栈与架构速览

- 前端：`index.html`（页面骨架 + 全部 screen）+ `js/` 下 17 个功能模块（挂全局 `window.Aoi` 命名空间，无模块打包）。
  核心模块：`core.js`（路由/通用）、`data.js`（Supabase 读写）、`auth.js`、`team.js`、`member.js`（团员端）、
  `orders.js`（订单/活动/批次/类型）、`calc.js`（汇率换算）、`intl.js`（国际运费分摊）、`approval.js`（交费审批）、
  `shipping.js`、`warehouse.js`、`notify.js`（通知 + QQ 推送入口）、`bot.js`（OneBot v11 客户端）、`import.js`、
  `limits.js`（限购计算器）、`stats.js`（复盘统计）、`image-upload.js`。
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
| `docs/STATUS.md` | 权威状态：已完成阶段、数据模型（blob 结构）、已知限制、**遗留项与线上操作清单** |
| `CLAUDE.md` | QQ 机器人接入专项（NapCat / relay / 安全红线） |
| `README.md` | 功能、部署、安全、项目结构 |
| `docs/design/PRODUCT.md` / `docs/design/DESIGN.md` | 产品定位 / 视觉设计规范 |
| `CHANGELOG.md` | 版本变更记录 |
| `docs/archive/` | 已完成计划归档：`PLAN-AUTH-REDESIGN.md`（v3.0.0）、`PLAN-v3.2.0.md`、`IMPROVEMENT_PLAN.md`（v1.4.0）、`PR-v1.4.0-final.md` |
