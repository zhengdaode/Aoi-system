# Aoi System · 当前状态

> 更新日期：2026-09-13 · 版本 **v3.15.0**（v3.15.0 商品联动闭环 + 活动级价格生成与导出 + PCO 目录瘦身 +
> 复盘性能治理，见 `docs/PLAN-v3.15.0.md`；v3.10.0 安全止血：p_cn 空值整份覆盖后门封堵 / admin_login 防爆破 /
> escapeHtml 引号 + safeUrl 协议白名单 / v2 账号体系（邀请码·team_members）归档；v3.11.0 数据信任：管理端保存
> 失败强提示 / notify.sync 不吞错 / B6 通知·blob 治理 + assert_single_team 单团守卫；v3.12.0 B3 审计日志 +
> B4 推送链路加固（Edge UPSTREAM env 化 / 长度上限 / 重定向逐跳校验 / CSP 收紧）+ B5 迁移机制
> （schema_migrations + sb.js --migrate），⚠️ 修正 v3.10.0 锁定因事务回滚从未生效的缺陷 → 序列节流；
> v3.13.0 团员端移动卡片化 / 通知筛选 / 备份提醒。v3.9.x：导出链路与 PCO 粘贴导入迭代（详单见 CHANGELOG）。
> 历史里程碑：v3.7.0 管理端第二轮 S1–S8；v3.6.3 F10 机器人交互；v3.5 复盘统计并入 + 链接导入；
> v3.4 数据安全兜底；v3.0 账号体系重设计；v1.7.0–v2.0.0 十项问题迭代）

## 当前状态速览（2026-09-13 v3.15.0 后）

- **代码层**：v3.15.0 功能轮；vitest 全套 **439 例全绿**，aoi-qqbot node:test **68 例全绿**。前端两通道
  （GitHub Pages / Netlify）随推送自动部署（CI 全绿）。Edge Function `qq-relay` 已部署 v7（UPSTREAM 走
  env `RELAY_UPSTREAM`，经 `scripts/deploy-edge.js --secret` 注入）。零 schema 改动。
- **v3.15.0 要点**：手动录入选活动后商品下拉联动回填；表格导入按主档识别回填+新商品自动登记；
  活动管理新增 生成人民币价（公式可临时调整）/导出商品列表/导出到小程序（模板自 PCO 页迁入，全活动可用）；
  PCO 页不再默认生成人民币价、AI 提示词 8 列支持一次性导入、导航移入工具组；
  「已存目录」（d.pcoItems）UI 与写入下线（D1：数据删除+代码归档，`scripts/archive-pco.mjs` 可删可恢复）。
- **✅ 线上库已应用并探针验证（2026-09-12，v3.10.0–v3.12.0 schema，写前快照 `*_bak_20260912`）**：
  p_cn 空值写入拒绝、admin_login 序列节流（失败→5 秒冷却）、审计表/RPC 权限、F5 RPC 走单团守卫、
  v2 函数/表/列收敛删除、orders 104 条完好。
- **⚠️ 待用户操作（按优先级）**：
  1. **QQ 机器人真机部署批次（唯一阻塞 QQ 侧全部功能的事，F5+F10+relay v5 加固同批）**：ECS 上
     `git pull` aoi-qqbot + 主仓库 relay/relay.js（v3.12.0 加固：body/消息上限、限频、/audit）+
     `systemctl restart qq-relay`；NapCat WebUI 开 HTTP POST 上报；Caddy TLS 反代（顺带消除明文 http
     token 链路）；网页设置页 relay 改 https 域名 + botConfig。**前置：47.101.194.103 SSH 密钥不可达，
     需负责人授权公钥或由负责人本人执行。**
  2. **PCO 已存目录数据清理（v3.15.0 S7，D1 已批准）**：`AOI_ADMIN_TOKEN=<token> node scripts/archive-pco.mjs`
     预览快照 → 确认后加 `--apply` 删除线上 `d.pcoItems`/`d.catalogConfig`（删前自动快照到本地 archives/，
     误删可 `--restore`；写回前服务端亦自动存档旧版）。F9 监控已被风控实测否决，原「载体拍板」遗留随之关闭；
     「只粘贴链接一键抓取」预留入口已随本版下线。
  3. （建议）设置页「下载全量备份」每周一份（卡片顶部有距上次备份天数提醒）；线上另有 `*_bak_*`
     快照表可随时查。
- **下一轮方向（2026-09-13 更新）**：v3.15.0 已消化 2026-09-13 九项实测反馈；剩余遗留为「relay 真机批次
  （上 1）」与「archive-pco 数据清理（上 2）」；F3 汇率自动同步经用户决策**暂缓**。后续新需求按 AGENTS.md 流程立项。
- **F5 / F6 / F7 / F8**：F5 独立项目已实施（QQ 侧待真机部署）；F6 已并入主系统（v3.5.0）；
  F7/F8 取消，v4.0.0 商用化不再排期。
- **已知限制（v3.15.0 后）**：
  - member_key 仍为团队级凭证；读已按 CN 裁剪 PII、写白名单合并且**空 p_cn 整份覆盖桥已封堵**
    （v3.10.0）——但 member_key 本体泄露仍可读他人订单与全员名单，商用前需拆表（设计保留）。
  - 服务端历史快照保留近 30 天 / 每团 100 份；审计日志保留 90 天。
  - 登录防爆破为「失败后 5 秒全局冷却」（序列节流）——比逐账号锁定弱，但回滚免疫、单团部署够用。
  - relay 与 Netlify→ECS 一跳仍为明文 http（token 过网）——Caddy TLS 在真机部署批次解决。
  - PCO 目录一次性导入的「图片链接」列受 ChatGPT 客户端限制常为空（D3）：粘贴富文本时 `<img>` src
    在进入模型前被剥离；缺图用两步流程补图（页面粘贴带图 → AI 表格按日文原名合并）。
  - 团员端密钥 + CN 免登录模型不变；debug/debug123 后门账户生产常开（数据仅本机）。
  - v3 主线不包含旧部署线的 P15/P6/P16（保留在 `backup-before-cleanup` 分支）。
- **测试**：`tests/`（vitest + jsdom），harness 加载 index.html + 22 个 js 模块；新增 js 模块需加入
  `tests/helpers/aoi.js` 的 MODULES 列表。
- **⚠️ 2026-09-06 数据事故记录**：生产站旧前端陈旧内存覆盖曾清空 cyberbutter 团 blob（orders 34→0），
  当日经备份还原。完整过程见 `docs/ITERATION_LOG.md` 第 6 轮；v3.4.0 B1 为系统性兜底，v3.10.0 封堵
  同模型的恶意利用面（空 p_cn 整份覆盖），v3.11.0 修复「保存静默失败」体验黑洞。

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
