# Aoi-system — 谷圈云端排单管理系统

> **原作者：秋洛 (QiuLuo)** · 原项目：[mossasari/Group-Buy-Management-System](https://github.com/mossasari/Group-Buy-Management-System)
> **当前维护者：郑 (zhengdaode)** · [GitHub](https://github.com/zhengdaode)
> **当前版本：v3.4.0**（2026-09-08）· 变更记录见 [CHANGELOG.md](CHANGELOG.md)

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/zhengdaode/Aoi-system)

专为「二次元吃谷、拼团、代购」打造的**轻量级、无服务器（Serverless）纯前端排单系统**。
让团长轻松管理排单、补邮、发货、国际运费分摊，让团员凭密钥免登录自助查单。

🌐 图文教程站：[qiuluo.netlify.app](https://qiuluo.netlify.app) · 📕 原作者小红书：[特蕾西娅全肯定bot](https://xhslink.cn/m/83wcvC8Rc2i)

---

## 功能全景（v3.5.0）

| 模块 | 能力 |
|------|------|
| 总览 | 待办统计（待审核/待催缴/待发货/未到货）+ IP 一览跳转 |
| 信息录入 | Excel 导入（排谷/拼谷/闲鱼矩阵自动识别）；**从链接导入**：粘贴排谷表/汇总表分享直链（static.zwlhome.com）即可拉取解析，经本站服务端代理规避跨域，失败自动回退直连并引导手动下载；手动录入支持**外币双模式**（直接输入外币价 / 计算器计算）、**多行购买者批量导入**、类型面板内**快捷新建** |
| 订单管理 | 筛选/勾选批量操作、标记到货分批次、**批量生成人民币价**（公式可当场改、可撤销）、**外币原价列**、行内**编辑弹窗**、**备注**（折叠展开）、批量删除 + 30 秒撤销 |
| 国际批次 | 按到货日期划分批次、可命名，跨页联动 |
| 国际计算 | 按重量分摊国际运费；**均价/加权单价拆列**（手动覆盖 + ↺ 恢复）；**目标金额差值** + **悬浮仪表盘**（插值进度，滚动常驻） |
| 事务审批 | 按批次逐人审核国际费交费（已交/驳回），一键生成催缴名单 |
| 发货管理 | 按批次录快递单号、批量合照、发货状态 |
| 通知公告 | 催缴、发货、审批结果、到货通知自动生成；QQ 机器人推送——**双通道（推荐）**：自动私聊已绑定者 + 群@全员兜底；另保留仅群发/仅私聊；**收件地址更新仅管理员可见不推送**；公告可一键「发布并推送 QQ 群」 |
| 活动管理 | 购买时间/出货日期（**精确 + 模糊：上中下旬/季节/季度**）/链接/进度；**购买人信息**（圈名+账号邮箱+送达地址）、**快递单号多行**、**备注** |
| 买家（CN）管理 | 买家清单、未完成订单数、删除级联清理、改圈名审批全局迁移 |
| 工具·计算器 | 中日韩汇率 + 加价公式（0.5 圆整），单笔/批量换算 |
| 工具·限购计划 | **限购购买计划计算器**：选活动→设限购→填包邮金额/账号数/每账号种类上限，贪心装箱输出每账号购买清单与包邮状态，结果可导出 |
| 工具·复盘统计 | **团期复盘统计（F6）**：按团期（月份）+ IP 筛选，9 项 KPI、按活动聚合（可导出）、IP/买家排行（口径切换、买家交费金额下钻）、币种分布、金额口径交费回收、按批次发货时效（`orders.shippedAt`）；只读统计不改数据 |
| 团员端 | 凭**团员密钥 + 圈名**免登录：查订单/国际费/公告、**订单进度时间线**、提交凭证、确认收货、地址与 QQ 绑定（**掩码回执**） |
| 导出 | 12 张数据表统一「**导出图片 / 下载表格**」双按钮（PNG / XLSX，CSV 回退） |
| 数据安全 | **服务端历史快照**（每次保存自动存档，保留 30 天/100 份）+ 设置页一键备份/恢复；团员读写按 CN 白名单隔离（他人地址/QQ 不再随密钥下发） |
| 界面 | 移动端抽屉导航 + 订单表卡片视图、表格自适应（首列 sticky / 换行折叠）；黑夜模式 / 自定义背景不在 v3 主线（保留在 `backup-before-cleanup` 分支，需要时可移植） |

---

## 技术架构

- **前端**：`index.html` + 17 个原生 JS 模块（全局 `window.Aoi` 命名空间），Tailwind CSS CDN。无框架、无构建。
- **管理员体系（v3）**：部署时初始化超级管理员，应用内添加管理员（用户名/密码，bcrypt + token 会话）；不依赖 Supabase Auth，无自助注册。
- **存储**：Supabase（PostgreSQL）三表 `teams` / `team_members` / `team_data`——全部业务数据存于 `team_data.data` 一个 JSONB blob；schema 与 RPC 见 [`supabase-schema.sql`](supabase-schema.sql)。
- **QQ 机器人**：前端 `js/bot.js` → ECS 上的 [`relay/relay.js`](relay/relay.js)（校验登录态与 owner/admin 角色，NapCat 转发 ≥1s 节流）→ NapCat（OneBot v11）。token 只存服务端。
- **部署**：Netlify / GitHub Pages 双通道，`scripts/build-config.js` 从环境变量注入 Supabase 密钥（不进仓库）。
- **测试**：Vitest + jsdom（`npm test`），CI 部署前强制跑测试。

---

## 快速部署（Quick Start）

对小白团长，请直接访问图文教程 [qiuluo.netlify.app](https://qiuluo.netlify.app)。

对开发者：

1. 克隆本仓库。
2. 在 [Supabase](https://supabase.com/) 创建新项目。
3. 在 Supabase **SQL Editor** 中运行仓库根目录的 **`supabase-schema.sql`**（业务三表 + v3 管理员两表 + 全部 RPC + RLS，设计为可安全重复执行）。
4. 提取 Supabase URL 和 ANON KEY；复制 `js/config.example.js` 为 `js/config.js` 填入（只用 anon key，禁止 service_role）。
5. 部署整个项目文件夹到任意静态托管平台（推荐上方 Netlify 一键部署）。
6. **首次打开网站**：自动进入「初始化超级管理员」页，设置管理员的用户名与密码（此入口在创建第一个管理员后永久关闭）。
7. 进入系统后，在「账号与设置」为其他管理人员添加独立的管理员账号/密码。
8. （可选）运行测试：`npm install && npm test`。

   > ### ⚠️ 老库升级必读
   >
   > - **v3.0.0 起管理员账号不再走 Supabase Auth 邮箱注册**：改为部署时初始化超管 + 应用内添加管理员（用户名/密码，bcrypt 哈希存 `admins` 表）。重跑最新 schema 后，首次打开网站会显示初始化页；旧邮箱账号自然失效，业务数据（`team_data` blob）不受影响。
   > - **v3.4.0（2026-09-08 已应用线上）**：新增历史快照表与 6 个 RPC；团员两个 RPC 签名扩展（旧调用兼容）。重跑本 schema 即完成升级。
   > - **v1.7.0 修复**：团员端两个 RPC 曾存在「保存静默丢失」（只 update 不 insert）与「参数名二义性」缺陷，均已修复且签名有变（脚本自动 drop 重建，重跑不会报错）。
   > - 重跑后执行文件尾部「排查 SQL」确认 RPC 就绪；忘记超管密码时，用 Supabase Dashboard → Authentication 删除后重初始化，或经 `scripts/sb.js` 重置。

   > ### 🤖 让 agent 直接操作线上 Supabase（可选）
   >
   > 生成个人 Access Token（Dashboard → Account → Access Tokens），写入仓库根目录 `.env`：`SUPABASE_ACCESS_TOKEN=sbp_xxx`（已 gitignore）。之后 agent 可用 `node scripts/sb.js "SQL"` / `-f supabase-schema.sql` / `--check` 直接执行线上 SQL，无需人工复制粘贴。

### 部署后的 QQ 机器人接入

1. 部署 `relay/relay.js` 到与 NapCat 同机的服务器（`.env.example` 有配置说明，Node 18+ 零依赖）。
2. 前端「账号与设置 → QQ 机器人」：启用、填 **https://** 的 relay 地址与群号。
   （https 站点填 http 地址会被浏览器混合内容拦截——设置页会直接拦截保存。）
3. 通知页推送：「私聊+群@（推荐）」自动检测 QQ 绑定——已绑定的逐人私聊（relay 1s 节流防风控）并在群中被 @，未绑定/私聊失败的由群@兜底（未绑定的用圈名文字 @）；「仅群发」「仅私聊」为单通道选项。收件地址更新类通知仅管理员在网页查看，不推送 QQ。
4. 公告：「发布」仅站内展示；「发布并推送 QQ 群」以【公告】前缀发送到群。

---

## 项目结构

```
├── index.html              # 页面骨架 + 全部视图（无框架 SPA）
├── css/styles.css          # 自定义样式（editorial 设计系统）+ 响应式表格/卡片
├── js/                     # 16 个功能模块（window.Aoi 命名空间）
│   ├── core.js             # 路由/通用工具/撤销/总览
│   ├── config.js           # 部署时生成（gitignore），模板 config.example.js
│   ├── data.js             # Supabase 读写 + RPC 错误分类
│   ├── auth.js / team.js   # 认证 / 团队与成员
│   ├── orders.js           # 订单/批次/活动/买家/类型（核心模块）
│   ├── import.js           # Excel 矩阵解析 + 链接导入拉取层（同源代理→直连回退）
│   ├── calc.js             # 汇率换算
│   ├── intl.js             # 国际运费分摊 + 仪表盘
│   ├── approval.js         # 交费审核
│   ├── shipping.js         # 发货管理
│   ├── member.js           # 团员端（免登录）
│   ├── notify.js           # 通知生成 + QQ 推送入口
│   ├── bot.js              # OneBot v11 客户端（群发/私聊）
│   ├── limits.js           # 限购购买计划计算器
│   ├── warehouse.js        # 囤货地
│   ├── stats.js            # 复盘统计（F6：团期聚合 KPI/排行/交费回收/发货时效）
│   └── image-upload.js     # 图床适配
├── relay/relay.js          # QQ 机器人 relay（ECS，零依赖 Node 18+）
├── supabase-schema.sql     # 数据库 schema（可重复执行，含排查 SQL）
├── scripts/build-config.js # CI 注入密钥生成 config.js
├── tests/                  # Vitest + jsdom（npm test；harness: tests/helpers/aoi.js）
├── docs/
│   ├── ROADMAP.md          # 当前路线图 + P0 团员侧故障分析
│   ├── STATUS.md           # 权威状态（已完成能力 + 已知限制）
│   ├── ITERATION_LOG.md    # 审阅轮改进日志（含回退方式）
│   ├── IMPROVEMENT_PLAN.md # v1.4.0 时期计划（历史归档）
│   └── design/             # PRODUCT / DESIGN / DESIGN-claude
├── AGENTS.md               # Agent 工作规范（改动必 commit / 测试全绿）
├── CLAUDE.md               # QQ 机器人接入专项
├── CHANGELOG.md / CONTRIBUTING.md / LICENSE
└── netlify.toml            # Netlify 部署 + 安全头
```

---

## 本地开发与测试

```bash
npm install        # 安装 vitest + jsdom（仅测试用，前端本体零依赖）
npm test           # 170 个用例（harness 把 index.html 装入 jsdom 再加载 js 模块）
npm run test:watch # 监听模式
```

- 本地调试账户：`debug` / `debug123`（绕过 Supabase，数据存 localStorage，前缀 `aoi_debug_*`）。
- 新增 js 模块时，记得加入 `tests/helpers/aoi.js` 的 MODULES 列表。
- 工作纪律（详见 [AGENTS.md](AGENTS.md)）：**每次改动一个 commit；测试全绿才交付**。CI 已强制（deploy 依赖 test job）。

---

## 安全注意事项

- **Supabase**：只用 anon key + RLS + security definer RPC；已知权衡——团员密钥仍为团队级凭证，但 v3.4.0 起读接口按 CN 裁剪 PII、写接口白名单合并（防整份覆盖与自批），密钥已升 128bit；服务端历史快照 + 备份文件兜底（见 [docs/STATUS.md](docs/STATUS.md) 已知限制）。
- **XSS**：所有用户/云端数据插入 DOM 前经 `escapeHtml()` 转义；确认弹窗统一自定义组件。
- **QQ 机器人**：token 只存 relay 服务端；前端不存任何密钥。
- 邮箱确认（Custom SMTP）建议开启。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/ROADMAP.md](docs/ROADMAP.md) | 当前路线图（10 项问题 → 4 个版本，全部完成）+ 线上排查清单 |
| [docs/STATUS.md](docs/STATUS.md) | 权威状态与已知限制 |
| [docs/ITERATION_LOG.md](docs/ITERATION_LOG.md) | 审阅轮改进日志与回退方式 |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录（v1.4.0 → v2.0.0） |
| [AGENTS.md](AGENTS.md) / [CLAUDE.md](CLAUDE.md) | 工作规范 / QQ 机器人专项 |
| [docs/design/](docs/design/) | 产品定位与视觉设计规范 |

## 参与贡献

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。发现 Bug 或有好想法：Fork → Feature 分支 → PR，或直接小红书联系作者。

## 许可与致谢

- 业务概念沿用原作者**秋洛**（CC BY-NC-SA 4.0），代码与数据模型全量重写。
- 感谢 Tailwind CSS、Supabase、SheetJS、html2canvas、Cropper.js、NapCat。
