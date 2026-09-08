# F6 团期复盘统计 · 功能迭代结论与并入主系统实现方案

> 2026-09-08 产出。背景：F6 原形态为「独立页面本地化 demo」（`demo/stats-demo/`，v3.4.0 产出，
> 待管理层审核）。本轮按用户指示：**先自行以审核者视角对 F6 功能做一轮迭代**（代替管理层审核产出结论），
> 再制定并入主系统的具体实现方案并实装。实装版本定号 **v3.5.0**。
>
> **2026-09-08 用户决策（追加）**：demo 已不需要，跳过 demo v2 迭代与管理层审核环节，
> 直接按本方案实装主系统。`demo/stats-demo/` 与 `demo/F6-团期复盘统计-demo.zip` 保留为历史产物
> （其「审核要点」已由本文第一节回答），后续如需清理另行删除。
>
> 约束：遵守「无框架、无构建、纯前端 + Supabase blob」架构；不动 schema（纯前端读侧统计）；
> 每步独立 commit、测试全绿才交付。

---

## 一、审核迭代结论（对 demo v1 的自行审查）

审查输入：demo v1 四模块（KPI 卡 / 按活动聚合表 / IP 排行 / 交费状态分布）、
`demo/stats-demo/说明.md` 列出的四处「审核要点」、PLAN-NEXT F6 节原始规划文本
（其中明确提到但 demo v1 未实现：**发货时效、币种分布**）。

| # | 审核意见（问题） | 迭代决定 |
|---|------|------|
| 1 | 交费回收率按**笔数**口径（已交 x 笔 / 共 y 笔），回答不了「还差多少钱」 | 回收率改为**金额口径**（已交国际费 / 应收国际费），笔数与「在途（待审核）」金额作辅助展示 |
| 2 | KPI 只有 4 项，缺经营复盘核心指标 | 扩到 8 项：新增 参与买家数、人均消费、应收/已收/未收国际费（金额）、平均发货时效 |
| 3 | 无购买人维度（说明.md 审核要点明确提问） | 新增**买家排行**模块（口径可切换：折合金额 / 件数），行内含该买家交费状态汇总（下钻到人） |
| 4 | IP 排行口径固定为金额（审核要点明确提问） | 增加**口径切换**：折合金额 / 订单条数 / 件数 |
| 5 | 每活动一行塞「交费回收」标签——交费实际按「批次 × 买家」收取，硬按活动统计口径不准 | 从活动表移除交费列，改为：活动表增「件数、到货比例」两列；交费单列独立模块（按批次金额 + 笔数） |
| 6 | 币种分布只有活动表里一个「¥ + JP¥」tag，原规划的币种分布模块缺失 | 新增**币种分布**模块：CNY/JPY/KRW 条数、原币金额、折合金额 |
| 7 | 原规划的**发货时效**缺失——主系统现有数据没有「发货时间」字段 | 主系统补数据埋点：标记发货时记录 `orders.shippedAt`（ISO 时间）；时效 = 发货时间 − 到货批次日期，按批次展示平均天数；历史订单无 `shippedAt` 优雅排除 |
| 8 | 外币订单可能尚未「批量生成人民币价」，折合口径未定义 | 口径明确：优先用已生成的人民币价 `orders.price`；缺失时按**当前**计算器汇率估算 `priceOrig × (汇率+加价)`，界面标注「含估算」 |

**团期（时间范围）口径**：主系统无显式「团期」实体。以月份为团期代理——订单维度按**活动购买时间**
（`activityMeta[活动].buyDate`）归月；交费 / 发货时效维度按**到货批次日期**（`batches[].date`）归月；
无购买时间的活动订单归入「未记录购买时间」伪团期；另有「全部时间段」。

## 二、迭代后功能集（demo v2 与主系统正式版同口径）

| 模块 | 内容 | 交互 |
|------|------|------|
| M1 KPI 卡 ×8 | 订单条数（含件数）/ 折合总金额（含估算标记）/ 参与买家数 / 人均消费 / 应收国际费 / 已收国际费（含回收率）/ 未收国际费（待审核在途另注）/ 平均发货时效（天） | 随筛选联动 |
| M2 按活动聚合表 | 活动 / IP / 进度 / 订单条数 / 件数 / 折合金额 / 币种构成 / 到货比例 | 主系统挂「导出图片 / 下载表格」 |
| M3 IP 排行 | 条形图，口径切换：折合金额 / 订单条数 / 件数 | 按钮切换 |
| M4 买家排行 | 条形图（Top 10），口径切换：折合金额 / 件数；行内交费状态汇总（已交/待审核/待交/驳回金额） | 按钮切换 |
| M5 币种分布 | 各币种条数 / 原币金额 / 折合金额 | 随筛选联动 |
| M6 交费回收 | 按「批次 × 买家」汇总（复用审批页同源逻辑）：应收 / 已交 / 待审核 / 待交 / 已驳回的金额与笔数 | 随筛选联动 |
| M7 发货时效 | 按到货批次：日期 / 订单数 / 已发数 / 平均到货→发货天数 | 主系统挂导出 |
| M8 团期筛选 | 月份下拉（全部 / 各月 / 未记录购买时间）+ IP 下拉（全部 / 各 IP） | 筛选 M1–M5、M7 |

筛选作用域：订单维度（M1 货款部分、M2–M5）按购买月份 + IP；交费与时效（M1 回收部分、M6–M7）按到货批次月份，不受 IP 筛选影响（国际费与 IP 无关）。界面脚注注明口径。

## 三、主系统实现方案（v3.5.0）

### 3.1 数据埋点：发货时间戳（唯一的数据模型增量）

- `js/shipping.js` `setShipped`：设为「已发」且该订单尚无 `shippedAt` 时写入 `new Date().toISOString()`；
  设为「未发」不删除（再次标记已发沿用首次时间，避免反复切换导致时效失真；未发状态的订单不参与时效统计）。
- `orders.shippedAt` 为可选字段，旧数据缺失时所有统计优雅排除，**无需迁移**。
- STATUS.md 数据模型同步补一行。

### 3.2 新模块 `js/stats.js`（`Aoi.stats`，第 17 个 js 模块）

纯计算函数（可单测，不碰 DOM）：

| API | 说明 |
|-----|------|
| `monthKey(dateStr)` | `'2026-09-01' → '2026-09'`；非法返回 `''` |
| `termOptions(d)` | 团期下拉数据：`'all'` + 各月份 + `'unknown'`（月份 = 活动 buyDate 月 ∪ 批次 date 月，降序） |
| `orderRmb(o)` | 单价折合：优先 `o.price`；缺失且 `priceOrig` 有值 → `Aoi.calc.toRmb` 估算；都无 → 0。返回 `{ rmb, est }` |
| `orderAmount(o)` | `orderRmb.rmb × count` 小计 |
| `ordersInTerm(d, term)` | 订单按活动 buyDate 月份过滤（`all` 全量 / `unknown` 无日期活动） |
| `ordersInIp(orders, ip)` | IP 过滤（`''` = 全部） |
| `batchesInTerm(d, term)` | 批次按 date 月份过滤（`unknown` 不含批次——批次必有日期） |
| `activityRows(d, term, ip)` | 每活动 `{ name, ip, status, count, qty, amount, currencies[], arrivedPct }`，金额降序 |
| `ipRows(d, term, ip)` | 每 IP `{ ip, count, qty, amount }` |
| `buyerRows(d, term, ip)` | 每买家 `{ buyer, qty, amount, pay{已交,待审核,待交,已驳回}（金额）}`（交费汇总自该范围内订单涉及的批次，复用 `Aoi.approval.buyerSummary`） |
| `currencyRows(d, term, ip)` | 每币种 `{ cur, count, orig, rmb }` |
| `payRows(d, term)` | 交费汇总 `{ 已交/待审核/待交/已驳回: {cnt, fee} }`（复用 `Aoi.approval.buyerSummary(batchId)`，与审批页同源） |
| `shipAgingRows(d, term)` | 每批次 `{ label, date, total, shipped, avgDays }`（仅统计 `shipped==='已发'` 且有 `shippedAt` 的订单） |
| `kpis(d, term, ip)` | M1 的 8 项 KPI 对象（含 `est` 估算标记、`paidPct` 回收率） |

渲染函数：`render()`（读下拉 → 填充各容器，含条形图 HTML）、`refill()`（重建团期 / IP 下拉，保持当前选择）。
金额格式化统一两位小数；条形图用纯 div（无图表库，与 demo 一致）。

### 3.3 页面与接线

- `index.html`：sidebar「工具」组加「复盘统计」导航项（`view-stats`）；
  新增 view：筛选栏（团期 / IP 下拉 + 口径说明脚注）、KPI 网格（`grid-cols-2 lg:grid-cols-4`）、
  活动聚合表（挂 `Aoi.exportImage` / `Aoi.tableExport` 双导出按钮，复用 v2.0.0 机制）、
  IP 排行 + 买家排行（口径切换按钮组）、币种分布 + 交费回收、发货时效表（挂双导出）。
- `js/core.js`：`Aoi.nav` 进入 `view-stats` 时 `Aoi.stats.render()`（与 view-limits 同模式）；
  `Aoi.refreshViews` 末尾补 `if (Aoi.stats) Aoi.stats.render()`（撤销恢复后同步）。
- 权限：管理端页面（登录后可见），无 RPC / schema 变更，团员端不涉及。

### 3.4 测试方案（`tests/stats.test.js` + `tests/shipping.test.js` 增补）

- 埋点：设为已发写入 `shippedAt`；重复设已发不覆盖；设为未发保留原值但不参与统计。
- 口径：`orderRmb` 三分支（有 price / 无 price 有 priceOrig 估算 / 都无）；`monthKey`；`termOptions` 含 unknown、降序。
- 聚合：ordersInTerm 按 buyDate 归月 + unknown 兜底；activityRows 件数/金额/到货比例；
  ipRows / currencyRows / buyerRows（含交费汇总）；payRows 金额口径回收率；shipAgingRows 平均天数与排除项。
- 渲染冒烟：`render()` 填充 KPI / 表格 / 条形图 DOM；口径切换按钮生效。
- 基线不回退：`npm test` 全绿（v3.4.0 基线 170 例 + 新增约 20 例）。

### 3.5 demo 处置（2026-09-08 用户决策更新）

- demo 不再迭代、不再要求管理层审核；`demo/stats-demo/` 与 zip 保留为历史产物，文档标注已被 v3.5.0 正式版取代。
- 文档同步：CHANGELOG（v3.5.0）、STATUS（版本 / 速览 / 数据模型 `shippedAt`）、README（功能全景 + 模块数 16→17）、
  AGENTS（计划入口状态）、PLAN-NEXT（F6 节 + 版本表重切：v3.5.0 = F6 并入；原 v3.5.0 链路加固顺延为 v3.6.0；
  原 v3.6.0 治理与复盘顺延为 v3.7.0）。

### 3.6 实施顺序（每步一 commit）

1. 本方案文档（docs）
2. `shippedAt` 埋点 + 测试
3. `js/stats.js` + `view-stats` + 导航/接线 + 测试
4. 文档收尾（CHANGELOG / STATUS / README / AGENTS / PLAN-NEXT）
