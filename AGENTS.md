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
**四个版本已全部实施完成**（2026-09-06，详见 CHANGELOG）；v3.0.0 账号体系重设计亦已实施（见 `docs/PLAN-AUTH-REDESIGN.md`）；
**进行中：v3.2.0 第二批实测反馈迭代（Excel 导入往返 / 限购计算器活动与币种 / 购买人搜索下拉 / 订单表桌面 UI / 导出图片行选择），见 [docs/PLAN-v3.2.0.md](docs/PLAN-v3.2.0.md)**；
线上排障、数据事故取证与回退锚点见 `docs/ITERATION_LOG.md`；遗留项与线上操作见 ROADMAP 尾部。

## 技术栈与架构速览

- 前端：`index.html`（页面骨架 + 全部 screen）+ `js/` 下 15 个功能模块（挂全局 `window.Aoi` 命名空间，无模块打包）。
  核心模块：`core.js`（路由/通用）、`data.js`（Supabase 读写）、`auth.js`、`team.js`、`member.js`（团员端）、
  `orders.js`（订单/活动/批次/类型）、`calc.js`（汇率换算）、`intl.js`（国际运费分摊）、`approval.js`（交费审批）、
  `shipping.js`、`warehouse.js`、`notify.js`（通知 + QQ 推送入口）、`bot.js`（OneBot v11 客户端）、`import.js`、`image-upload.js`。
- 存储：Supabase 三表（`teams` / `team_members` / `team_data`）；**全部业务数据存在 `team_data.data` 一个 JSONB blob 里**，
  schema 与 RPC 见 `supabase-schema.sql`（手工在 SQL Editor 执行，无版本化迁移）。
- QQ 机器人链路：前端 `js/bot.js` → `relay/relay.js`（ECS，校验登录态+owner/admin）→ NapCat（OneBot v11）。
- 部署：Netlify + GitHub Pages 双通道，`scripts/build-config.js` 从环境变量生成 `js/config.js`（密钥不进仓库）。
- 样式：Tailwind CDN + `css/styles.css`（黑夜模式 57 条覆盖）；设计规范见 `docs/design/DESIGN.md`。

## 常用命令

- 本地运行：任意静态服务器指向仓库根目录（或直接打开 `index.html`），无需构建。
- 部署构建：`node scripts/build-config.js`（CI 中自动执行）。
- 测试（v1.7.0 起）：`npm test`。
- 调试账户：`debug@aoi.local` / `debug123`（绕过 Supabase，数据存 localStorage，前缀 `aoi_debug_*`）。

## 文档索引

| 文档 | 内容 |
|------|------|
| `docs/ROADMAP.md` | **当前唯一有效路线图**：10 项问题 → v1.7.0–v2.0.0 任务分解 + P0 团员侧故障分析 |
| `docs/STATUS.md` | 权威状态：已完成阶段、数据模型（blob 结构）、已知限制 |
| `CLAUDE.md` | QQ 机器人接入专项（NapCat / relay / 安全红线） |
| `README.md` | 功能、部署、安全、项目结构 |
| `docs/design/PRODUCT.md` / `docs/design/DESIGN.md` | 产品定位 / 视觉设计规范 |
| `CHANGELOG.md` | 版本变更记录 |
| `docs/IMPROVEMENT_PLAN.md` | v1.4.0 时期改进计划（历史归档，已并入 ROADMAP） |
