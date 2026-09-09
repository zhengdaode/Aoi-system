# Aoi System · 当前状态

> 更新日期：2026-09-10 · 版本 **v3.7.0 / v3.6.3**（v3.7.0：管理端第二轮 S1–S8 已实施上线（商品主档聚合/活动展开区/购买人体系/登记活动商品/汇总表导出/复盘并入总览/流式宽度/合照缩略图）；v3.6.3：F10 QQ 机器人用户交互迭代——绑定唯一性校验（两端）/ bot 解绑·我是谁·查单筛选·我的快递 / 网页端解绑与复制绑定指令（见 `docs/PLAN-F10-BOT-INTERACTION.md`）。F5 的 3 个机器人 RPC 已于 2026-09-10 经 sb.js 应用线上并探针验证；QQ 侧功能上线仅剩 relay 真机部署批次。v3.5：①F6 团期复盘统计并入主系统——「工具 → 复盘统计」页（js/stats.js，只读统计）+ 发货时间戳埋点 `orders.shippedAt`，demo 路线按用户决策取消（迭代结论与实现方案见 `docs/PLAN-F6-STATS.md`）；②从链接导入订单——排谷表/汇总表分享直链经 `/media-proxy` 同源代理一键导入。v3.4：数据安全兜底 + 团员感知增强（B1/F4、B2 Phase 1、F1、F2）；F5 QQ 机器人双向移出为独立项目并于 2026-09-09 实施（aoi-qqbot 仓库 M1–M7，主仓库接入 3 RPC + 设置页 + 排发钩子）；F7/F8 取消。v3.3：冗余清理与重构；v3.2：第二批实测反馈；v3.1：QQ 推送双通道；v3：管理员账号体系重设计（详见 `docs/archive/PLAN-AUTH-REDESIGN.md`）；v1.7.0–v2.0.0：十项问题迭代。变更明细见 CHANGELOG.md，路线见 PLAN-NEXT.md）

## 当前状态速览（2026-09-10 v3.7.0 / v3.6.3 后）

- **代码层**：**v3.7.0 管理端第二轮已实施完成**（2026-09-10 凌晨，S1 商品主档聚合 / S2 活动展开区 / S3 购买人体系 / S4 登记活动商品 / S5 汇总表导出 / S6 复盘并入总览 / S7 流式宽度 / S8 合照缩略图，见归档计划与 CHANGELOG）；**v3.6.3 F10 QQ 机器人用户交互迭代已实施**（绑定唯一性校验 / bot 解绑·我是谁·查单筛选·我的快递）；vitest 全套 **336 例全绿**，aoi-qqbot node:test **68 例全绿**。前端两通道（GitHub Pages / Netlify）已随推送自动部署上线（CI 全绿）。
- **✅ 线上库已再升级并验证（2026-09-10，经 `scripts/sb.js`）**：先建快照表（`team_data_bak_20260910` / `teams_bak_20260910`）→ 重跑全量 `supabase-schema.sql`（补齐 F5 的 3 个机器人 RPC）→ 探针全过：①三 RPC anon EXECUTE 均 true；②`team_summary_for_group` 阶段/计数正确、`deadline` 恒 null；③`unpaid_members_by_group` 名单与 `settings(qrUrl/adminQq)` 白名单出参正常；④`member_lookup_by_qq` 未绑定返回 null；⑤业务数据完好（orders 74 条）。
- **⚠️ 待用户操作（按优先级）**：
  1. **QQ 机器人真机部署批次（唯一阻塞 QQ 侧全部功能的事，F5+F10 同批）**：ECS 上 `git pull` aoi-qqbot（已是 F10 版）+ `pm2 restart qq-relay`；NapCat WebUI 开 HTTP POST 上报（`http://127.0.0.1:8080/onebot/event?token=<EVENT_TOKEN>`）；Caddy TLS 反代（`Caddyfile` 已附）；网页设置页 relay 改 https 域名 + 填 `botConfig.adminQq/qrUrl` 并保存。验收：QQ 私聊「帮助/查单/我的进度/我的快递/我是谁」+ 群内 @「团况」+ 绑定/解绑全链路（README 冒烟 curl 可先行）。**前置：47.101.194.103 SSH 密钥不可达，需负责人授权公钥或由负责人本人执行。**
  2. **F9 监控载体拍板**：PCO 风控实测否决自动化浏览器（Actions/本地、headless/有头全拒，3 轮实验记录见 PLAN-F9 §9）；恢复条件=日常浏览器可达性确认→择载体复验；「只粘贴链接一键抓取」入口已预留（`d.catalogConfig.dispatchUrl`）。
  3. （建议）设置页「下载全量备份」存本地/网盘一份；线上另有 `*_bak_20260908` / `*_bak_20260910` 快照表可随时查。
- **下一步目标（2026-09-10 复盘定稿）**：
  1. **完成 relay 真机部署批次**并做 F5/F10 全功能真机验收（见待用户操作 1）——这是当前唯一的大阻塞项。
  2. **v3.8.0：F9 商品目录模块点亮**——`js/catalog.js` / `catalog-dict.js` / `species-zh.js` 已随 F9 交付入库但未接入（待登记进 `tests/helpers/aoi.js` MODULES + 工具菜单入口 + 粘贴导入/校对工作台/小程序模板导出联调）；`dispatchUrl` 通道就绪即点亮一键抓取。
  3. **流程纪律固化**（2026-09-10 当夜两个教训）：①改 `supabase-schema.sql` 的提交应**随提交即经 sb.js 应用线上 + 探针**，不再积压（本次 F5 RPC 积压一日余才补）；②每个里程碑提交后 `git status` 必须干净再进下一项（S7 曾漏提交 index.html，靠复盘补正）。
  4. 小改进待办：`scripts/sb.js` 对象单元格打印 `[object Object]`，改 JSON.stringify 展开。
- **F5 / F6 / F7 / F8（2026-09-08 用户决策）**：F5 移出为独立项目并**已实施（2026-09-09，[aoi-qqbot](https://github.com/zhengdaode/aoi-qqbot) M1–M7）**：relay v4 双向；主仓库接入见 CHANGELOG v3.5.3；3 个 RPC 已入库（2026-09-10 sb.js 重跑+探针），**QQ 侧待真机部署**（NapCat 上报 / Caddy TLS / ECS relay 更新）；**F6 已并入主系统（v3.5.0）**——demo 路线取消，`demo/stats-demo/` 与 `demo/F6-团期复盘统计-demo.zip` 保留为历史产物（可另行删除），迭代结论与实现方案见 `docs/PLAN-F6-STATS.md`；F7/F8 取消，v4.0.0 商用化路线不再排期。
- **F10 QQ 机器人用户交互迭代（2026-09-10，v3.6.3）已实施**：绑定唯一性校验（relay 冲突暂拒/幂等，网页冲突拒绝/异常放行）、bot「解绑 <密钥> <圈名>」「我是谁」「查单 <活动名>」「我的快递」、网页端解绑按钮与复制绑定指令；aoi-qqbot 54→68 测试、主仓库新增 member-qq-bind 11 例；上线与 F5 同一真机部署批次（ECS relay git pull + pm2 restart 即含新指令）。
- **已知限制（v3.4.0 后）**：
  - member_key 仍为团队级凭证（一个团一把），但读已按 CN 裁剪 PII、写已白名单合并（防整份覆盖与自批「已交」）、密钥已升 128bit；设置页重新生成即作废旧密钥。
  - 服务端历史快照保留近 30 天 / 每团 100 份；更早的版本依赖手动「下载全量备份」文件。
  - 默认图床 SSL 过期问题（P14）未处理（B7 Storage 方案随商用化路线一并暂缓）。
  - v3 主线不包含旧部署线的 P15 自定义背景 / P6 黑夜模式全局切换 / P16 图床 UI（保留在 `backup-before-cleanup` 分支）。
- **测试**：`tests/`（vitest + jsdom），harness 加载 index.html + js 模块；新增 js 模块需加入 `tests/helpers/aoi.js` 的 MODULES 列表。
- **⚠️ 2026-09-06 数据事故记录**：生产站旧前端陈旧内存覆盖曾清空 cyberbutter 团 blob（orders 34→0），当日经备份还原至 32 条（**经与部署者确认为测试数据**）。取证结论：使用者真实数据 = 旧表 `leader_data` 中 `ICGPClick` 键 12 条订单（归属 2360690621@qq.com，已导出 `backups/`）；团员地址/QQ/凭证及 8/16 后录入的数据因当时保存缺陷从未落库，不可恢复。完整过程见 `docs/ITERATION_LOG.md` 第 6 轮。**v3.4.0 B1 即针对此类事故的系统性兜底**（每次保存自动存档 + 一键备份/恢复）。

## 项目定位

谷圈团购管理系统。以全新代码重写原开源项目（原作者秋洛，CC BY-NC-SA 4.0），摆脱「非商业 + 相同方式共享」两项限制。版权保护代码本身、不保护功能与想法，因此**业务概念、公式、术语可复用，代码与数据模型一律重写**。

纯 HTML/CSS/原生 JS，无框架、无构建步骤。Tailwind CSS / Supabase / SheetJS 走 CDN。

## 2026-09 迭代新增能力（v1.7.0 → v2.0.0，详单见 CHANGELOG）

- **团员端可靠性**：写入 upsert（不再静默丢失）、错误分类提示、乐观锁（`expected_updated_at`）、保存掩码回执。
- **QQ 机器人**：私聊推送链路（逐人 `send_private_msg` + relay 1s 节流）、群发 @ 映射修正、https 强制校验；**v3.1 双通道推送**（自动私聊已绑定者 + 群@全员兜底，未绑定用圈名文字 @）、公告一键推群、收件地址更新仅管理员可见不推送。
- **订单与外币**：订单字段扩展 `currency`/`priceOrig`/`remark`；录入双模式（直输外币 / 计算器计算）；订单管理「批量生成人民币价」（可改公式、可撤销）；多行购买者批量录入；行内编辑弹窗 + 备注折叠。
- **国际计算**：均价/加权单价拆列（覆盖可一键恢复）、目标金额差值、悬浮仪表盘。
- **活动管理**：购买人信息（圈名+邮箱+地址）、快递单号多行、备注、模糊出荷日期（上中下旬/季节/季度）。
- **新工具**：限购购买计划计算器（贪心装箱凑包邮，限购/种类数约束，剩余提示，结果可导出）。
- **导出与 UI**：12 张表「导出图片/下载表格」双按钮（xlsx/CSV 回退）；表格间距压缩、移动端首列 sticky + 订单表卡片视图。
- **工程化**：vitest + jsdom 测试基建（60 用例）；`.zcode` 等会话产物 gitignore。

---

## 历史阶段记录（阶段 0–11，v0.9.2 时期）

## 已完成（阶段 0–3）

### 阶段 0 · 骨架
- 单页应用外壳：`screen-app` + sidebar 导航（`Aoi.nav()` 切换 `[data-view]`）。
- 全局命名空间 `window.Aoi`，核心工具 `Aoi.core`（`genId`/`showScreen`/`nav`/`escapeHtml`/`toast`/`showLoading`/`confirm`）。
- 调试账户：`debug@aoi.local` / `debug123`，绕过 Supabase，数据走 `localStorage`（`aoi_debug_*`）。

### 阶段 1 · 认证 + 多管理员
- Supabase 邮箱注册/登录/找回/改密/退出（`js/auth.js`）。
- 团队模型：团长建团 → 邀请码 → 管理员加入（`js/team.js` + `supabase-schema.sql` 的 `teams`/`team_members`/`team_data` 表与 RPC）。
- 角色：`owner`（团长）/ `admin`（管理员），`enterApp()` 统一进入。

### 阶段 2 · 信息录入
- **Excel 导入**（`js/import.js`）：识别排谷表 / 拼谷表 / 闲鱼三种矩阵结构（汇总型 / 明细型），自动识别活动名与 IP，弹窗确认后入库。
- **手动录入**：订单（IP/活动/类型/型号/币种/价格/数量/购买者）+ 周边（预建商品）。
- **个性化计算器**（`js/calc.js`）：中日韩货币加价换算（`外币×(汇率+加价)`，0.5 圆整），非人民币价自动转人民币保存。

### 阶段 3 · 核心流程
- **国际批次**（`js/orders.js` 批次部分）：到货批次按日期划分，同日期合并；新建/删除批次，订单「标记到货」归入批次，按批次筛选。
- **国际计算**（`js/intl.js`）：按重量分摊国际运费 —— `单位国际费 = 总额/总重 × 单位重`（公式复用自 `intl-freight-calc`，原创代码）。目标总额 + 单位重量可配，支持手动覆盖单位费，输出每人应付国际费。
- **事务审批**（`js/approval.js`）：按批次逐人核实国际费交费，标记已交/驳回，一键生成催缴名单（含金额，可复制）。
- **发货管理**（`js/shipping.js`）：按批次录快递单号、批量设合照 URL、批量设发货状态（已发/未发）。

### 阶段 4a · 团员端（免登录自助）
- **团员端**（`js/member.js`，`Aoi.member`）：登录页「我是团员」入口，凭「团员密钥 + CN（圈名）」免登录进入，只看自己的数据。
- **我的订单**：按 `buyer === CN` 过滤，展示到货批次、快递单号、收货确认。
- **我的国际费**：按到货批次复用 `Aoi.intl` 分摊结果，展示应付额与交费状态。
- **缴国际费 + 传凭证**：粘贴付款凭证 URL → 写入 `payments[]`（新增 `receipt` + `待审核` 状态），团长在事务审批里核对后标记已交/驳回。
- **发货确认**：已发订单可点「确认收货」（`orders.received`）。
- **公告**：新增 `d.announcements[]`，管理员在设置页极简发布/删除，团员端首页展示（自动提醒/QQ 机器人留到 4b）。
- **密钥访问**：`teams.member_key` + 匿名 RPC（`get_team_by_member_key` / `update_team_data_by_member_key`），debug 模式走 localStorage 回退。

### 阶段 4b · 通知公告（自动提醒 + QQ 机器人接口）
- **自动提醒**（`js/notify.js`，`Aoi.notify`）：按当前数据自动生成「催缴通知」（待交/已驳回 × 国际费）与「发货通知」（已发 × 快递单号），按「类型 × 买家 × 批次」去重幂等。
- **触发时机**：进入应用时自动同步；标记已交/驳回、标记已发时自动同步。
- **通知列表**：新→旧展示，单条复制 / 复制全部未发 / 标记已发 / 删除 / 清除已发。
- **QQ 机器人接口**（`js/bot.js`，`Aoi.bot`）：〔历史记录——v1.7.0 起已完整接入，v3.1.0 双通道推送，见「2026-09 迭代新增能力」与 CLAUDE.md〕当时仅留 `config` + `sendPrivate` / `sendGroup` / `pushAll` 占位。

### 阶段 4c · 囤货地管理 + 换囤货地申请
- **囤货地管理**（`js/warehouse.js`，`Aoi.warehouse`）：团长在设置页增删囤货站点（名称 + 收款码 URL）。
- **团员申请换囤货地**：团员端选到货批次 + 目标囤货地 + 理由，写入 `d.transfers[]`（待处理）。
- **团长审核**：事务审批页列出待处理申请，同意后把该买家在该批次的订单 `warehouseId` 标记为目标囤货地，驳回则保留原状。
- **发货视图**：发货管理新增「囤货地」列，按 `orders.warehouseId` 显示（空则 —）。

### 阶段 5 · 图床配置（真实图片上传）
- **图床上传**（`js/image-upload.js`，`Aoi.img`）：本地压缩（最大边长 800，JPEG 0.85）→ 上传可配置图床 → 返回 URL。
- **沿用原免费图床方案**：默认 `esaimg.cdn1.vip`，支持 Chevereto / Lsky Pro / 通用格式；`api`/`field`/`token`/`tokenIn`/`respPath` 可在设置页配置。
- **接入点**：发货管理合照、囤货地收款码、团员端付款凭证，均在 URL 输入旁新增「上传」按钮。

### 阶段 6 · 活动管理
- **活动台账**（`js/orders.js`，`Aoi.orders`）：为每个活动记录所属 IP、购买时间、出货日期、平台链接、进度状态（未开始/进行中/已下单/已出货/已完成）。
- **数据模型**：新增 `d.activityMeta = { [活动名]: { ip, buyDate, shipDate, link, status } }`，活动名沿用 `d.activities` 字符串数组（订单 `activity` 字段不受影响）。
- **交互**：字段即时保存（onchange）；删除活动仅从台账移除，不影响历史订单。

### 阶段 8 · 分级录入 + 类型线路（设计修复）
- **分级录入**（`view-entry`）：录入订单时按 `IP → 活动 → 类型` 逐级选择，避免无效/过时内容污染索引。
  - IP：`<input list="ipOptions">` 自由输入（顶层分类，可新增）。
  - 活动：受控 `<select>`，仅显示所选 IP 下的活动（`activityMeta[活动].ip` 匹配），未选 IP 时禁用。
  - 类型：受控只读输入 + 自建面板（`Aoi.orders.toggleTypePanel`），按「发货线路」分组 + 模糊搜索 + 显式 × 关闭（不点空白关闭，防误关）。
- **类型线路标签**（`view-types` 类型管理页）：每个类型标注 `常规二次元线路 / 一般线路发送 / 大件类 / 名贵类 / 未分类`，录入与发货时按线路分组。
- **按 IP 常用类型**：`view-types` 页选中 IP 后勾选该 IP 的常用类型，录入时优先展示（`typesByIp`）。
- **发货分离**（`js/shipping.js`）：发货表新增「发货线路」列并按线路排序，排发导出 CSV 含线路字段，便于按线路分开发出。
- **数据模型**：新增 `d.typeMeta = { [类型名]: { route } }`、`d.ipTypes = { [IP]: [类型名...] }`；内置常用类型首启自动并入 `typeMeta`（route=未分类），向后兼容旧数据。

### 阶段 9 · 收件地址 + 批次选货 + IP/活动区分（修复）
- **收件地址**（区别于囤货地）：买家在团员端自行填写/修改，写入 `d.addresses = { [buyer]: string }`；密钥+CN 查询时**不回看原文**（仅显示「已填写」），只能再次修改；修改后生成「收件地址更新」通知供团长复制到 QQ。团长在发货管理表「收件地址」列查看。
- **IP（作品）与活动批次（团期）区分**：Excel 导入不再用 `团期名.split` 推 IP，改为确认弹窗中从已知 IP 选填（前缀自动匹配，如「术力口」⊆「术力口-初音未来17周年」）；导入同时写 `activityMeta[活动].ip`，使活动在录入时能按 IP 正确过滤。
- **批次选货**：国际批次列表每行新增「选货」按钮，跳转订单管理并预选该批次、只显示未分批商品，勾选后「标记到货」归入。

### 阶段 10 · 批次命名 + IP 一览 + 分摊落库（修复）
- **批次命名**：新建批次可选命名，可改名；批次列表可展开查看批次内活动（活动 × 数量）。
- **总览「开设 IP 一览」**：列出所有 IP，点 IP 查看其活动（可跳转订单管理），并可删除该 IP（清除其在订单/周边/活动/常用类型中的关联）。
- **类型筛选与大类折叠**：按 IP 常用类型加模糊搜索；手动录入类型面板按发货线路分组可折叠。
- **国际计算分摊落库**：新增「保存分摊到订单」，把分摊结果写入 `orders.intlFee`（每件商品）与 `payments.intlFee`（每人待交国际运费），审批/团员端/催缴通知优先读已保存值。
- **活动/订单联动**：活动管理点击活动名跳转订单管理（按活动筛选）。
- **买家（CN）管理**：活动管理页新增买家列表（圈名/订单数/未处理完数），可手动删除；删除活动时自动级联清理无待处理订单的买家（清除订单/交费/地址/通知等引用）。
- **修复**：批次下拉未同步刷新、国际计算器无法选批次、活动管理无法查看已有活动、删除活动无效（`ensure()` 反推复现）。

### 阶段 11 · 每人应付国际费改版 + 全表导出图片 / 行号
- **每人应付国际费 4 列**（`js/intl.js`）：表头改为 购买者 / 购买内容 / 国际金额 / 国内额外金额；购买内容按买家聚合为「类型-型号 ×数量」；国内额外金额为每人手动可编辑字段，写入 `payments[].domesticFee`（不参与国际费重算，`setDomesticFee`）。
- **全表行号**：所有数据表首列新增行号 `<td>`（订单/审核/发货/活动/买家/周边/换囤货地/改圈名/团员端/分摊明细/每人应付），`map(function (x, i)` 注入序号。
- **表格可读性**（`css/styles.css` 新增 `.data-table`）：表头底色 + 斑马纹（`tbody tr:nth-child(even)`）+ 点线行分隔，替代原 `border-b` 实线。
- **全表导出图片**（`js/core.js` `Aoi.exportImage` + html2canvas CDN）：所有数据表加「导出图片」按钮，克隆表格到离屏容器渲染为白底 PNG 下载。
- **团员端容错**：团员端提交动作（地址 / QQ 绑定 / 改圈名 / 凭证 / 收货 / 换囤货地）统一 try/catch 并 toast，避免静默失败。
- **催缴过期清理**（`js/notify.js`）：已交费 / 待审核成员自动清除过期的未发催缴通知。
- **QQ 群发 @ 提及**（`js/bot.js`）：群发改为 `[CQ:at]` 提及有绑定 QQ 的成员，替代逐条私聊。

## 数据模型（团队数据 blob，`Aoi.state.data`）

```
{
  orders:    [{ id, ip, activity, type, model, price, count, buyer,
                status, batchId, paid, shipped, shippedAt, tracking, photo, received, warehouseId, intlFee }],
  products:  [{ id, ip, type, model, price }],
  activities:[string],  ips:[string],
  batches:   [{ id, date, name, targetAmount?, weights?, manualFees? }],
  payments:  [{ id, batchId, buyer, status, intlFee?, domesticFee?, receipt?, receiptDate? }],
  warehouses: [{ id, name, qrCode }],
  transfers:  [{ id, buyer, batchId, toWarehouseId, reason, status, date }],
  announcements: [{ id, text, date }],
  notifications: [{ id, type, buyer, batchId, title, body, date, sent }],
  calc:      { jpyRate, jpyMarkup, krwRate, krwMarkup },
  imgHost:   { api, field, token, tokenIn, respPath },
  activityMeta: { [活动名]: { ip, buyDate, shipDate, shipDateFuzzy, link, status, remark,
                              buyers: [{ buyer, account, address }],
                              trackings: [string],
                              products: [{ id, type, model, refImage, refUrl,
                                           price?, priceOrig?, currency?, limit? }] } },
  limitPlans: { [活动名]: { activity, freeShip, freeShipRmb, freeCur, accountsCount, maxTypes,
                            limits: { 'type|model': n },
                            items: [{ index, total, diff, reached,
                                      items: [{ type, model, qty, price, amount, status }] }],
                            remaining: [{ type, model, qty }], updatedAt } },
  pcoItems:  [],   // v3.7.0 F9 接口预留（PCO 商品目录，本期无读写方）
  typeMeta:  { [类型名]: { route } },
  ipTypes:   { [IP]: [类型名...] },
  addresses: { [buyer]: string },
  memberMeta: { [cn]: { qq } },
  cnChanges: [{ id, oldCn, newCn, qq, status, date }]
}
```

- `orders.status`：到货状态（未到货 / 已到货）；`orders.batchId`：所属到货批次。
- `orders.shipped`：发货状态（未发 / 已发）；`orders.shippedAt`：发货时间戳（v3.5.0 F6 起首标已发时写入 ISO 时间，复盘统计发货时效数据源；旧数据缺失时统计自动排除）；`orders.tracking` / `orders.photo`：快递单号 / 合照 URL；`orders.received`：团员收货确认。
- `payments.status`：交费状态（待交 / 待审核 / 已交 / 已驳回），按「批次 × 购买者」唯一；`receipt` 为团员上传的付款凭证 URL。
- `activityMeta.products`（v3.6.0 登记；**v3.7.0 起为唯一商品主档**）：按「类型+型号」弱关联订单，数量/购买人/购买情况一律经 `Aoi.orders.productStats` 从订单与限购计划实时聚合、不在商品上存副本；`refUrl` 为空时团员端回落展示活动平台链接 `link`；v3.7.0 扩展可选字段 `price`（人民币登记价）、`priceOrig`+`currency`（外币原价）、`limit`（单账号限购），向后兼容（旧数据缺省，展示回落订单聚合值）。
- `activityMeta.buyers`（v3.7.0 同步约定）：购买人=代购工作人员，按行序对应 `limitPlans` 的账号槽位 `1..N`（限购计划页与活动计划弹窗按 `buyers[index-1]` 显示购买人标签）；保存校验一人一账号（账号必填、圈名与账号均不重复）。
- `products`（顶层旧预建商品池）：**v3.7.0 起废弃**——录入统一走「登记活动商品」写 `activityMeta[].products`，旧数据保留在 blob 中不再读写。
- `pcoItems`（v3.7.0）：F9 接口预留空数组，PCO 商品目录导入/监控（v3.8.0）的目标结构。
- `limitPlans`（v3.6.0）：限购购买计划入库，「工具 → 限购计划」与活动管理计划弹窗双侧共读共写（双向同步）；`item.status` ∈ 待购买 / 已购买 / 购买失败，切「购买失败」时按原计算器贪心把该商品整项重分配给其余账号（受 `limits` 限购与 `maxTypes` 约束，装不下的余量入 `remaining`）。
- 命名约定：`type`（制品类型）+ `model`（型号）在订单、商品主档、Excel 导入处统一（v3.7.0 起旧「周边」池并入主档）。

## 调试账户

登录页输入 `debug@aoi.local` / `debug123`，数据存在浏览器 localStorage，无需 Supabase。适合本地解压即用 / 试用。

## 部署（正式云同步）

1. 在 Supabase 建项目，跑 `supabase-schema.sql`。
2. 复制 `js/config.example.js` 为 `js/config.js`，填 `SUPABASE_URL` / `SUPABASE_ANON_KEY`（仅 anon key，禁止填 service_role）。
3. 打开 `index.html` 即可（可托管到任意静态站，如 Netlify）。

## 复用说明

- `intl-freight-calc/` 的国际运费**按重量分摊公式**为本人原创，已在 `js/intl.js` 中移植复用（新命名、新结构）。
- 业务术语（交肾、排发、囤货地、团期、CN）与货币换算思路不受版权保护，直接沿用。

## 待完成（后续阶段）

| 项 | 所属 | 说明 |
|---|---|---|
| 打磨 | 阶段 7 | 黑夜模式、教程站（自定义确认弹窗 + 两步确认 + 撤销 + 排发导出已完成） |

## 已知限制

- 图床默认走免费图床 `esaimg.cdn1.vip`（原方案），失效时需在「图床设置」里更换 API 地址。
- **团员密钥即访问凭证**：任何持有 `member_key` 者可读写整份团队数据（覆盖式写 blob）；v1.7.0 已加乐观锁（`expected_updated_at`）缓解覆盖竞态，但权限模型未变，正式商用前需拆分写入权限。
- **收件地址「不可回看」仅为 UI 层隐私措施**：`d.addresses` 仍随整份团队 blob 一起返回，持有 `member_key` 者可通过接口读到原文；当前只在团员端界面不回显，未做服务端隔离。要真正防泄露需把地址拆到服务端单独存取，或对成员写接口做字段级过滤。
- **QQ 号同样属于 PII**：`d.memberMeta[cn].qq` 与收件地址一样随整份团队 blob 返回，任何持有 `member_key` 者可读到所有已绑定买家的 QQ 号。绑定为可选、查询时不强制；正式商用前需与地址一起做服务端字段隔离。
- **QQ 机器人链路基于 NapCat（非官方协议），存在封号风控风险**：NapCat 非 QQ 官方认可生态，使用即违反 QQ 用户协议，机器人账号可能被警告/功能限制/临时甚至永久冻结（go-cqhttp 前车之鉴）。现有缓解：relay 串行队列相邻消息 ≥1s 节流、F5 白名单群 + 每 QQ ≤3 条/分钟限频、催缴每团每日 ≤1 条；**机器人应使用专用小号，勿用团长本人账号**。账号被封不损失业务数据（全在 Supabase，QQ 号仅是 `memberMeta` 一个字段）：换新号登录 NapCat → 更新设置页 relay 配置 → 团员重新绑定 QQ 即恢复；网页通知中心始终是第一通道，QQ 推送仅为增强。
- **官方 QQ 开放平台机器人已评估，结论为暂不申请（2026-09-10）**：官方机器人自 2025-04 起取消主动消息能力（[paotuan.io 实测记录](https://www.paotuan.io/setup/prepare/qqgroup/)；私聊仅剩用户主动发起后 60 分钟窗口被动回复 ≤4 条，群消息需 @ 触发后 5 分钟窗口回复），而本项目核心场景恰是主动触达（每周自动催缴、发货/交费通知、排发 xlsx 私发管理员）；且官方仅提供匿名 OpenID（拿不到真实 QQ 号，`member_lookup_by_qq` 身份模型不兼容）、群聊场景默认需企业主体（个人主体仅频道场景）、2025-06 起新注册机器人存在无群功能/暂无法进群的情况（[官方文档](https://bot.qq.com/)）。**重新评估触发条件**：官方恢复主动消息能力、腾讯封杀 NapCat 类协议致现链路不可用、或可取得企业/个体户主体资质时，再评估迁移。
