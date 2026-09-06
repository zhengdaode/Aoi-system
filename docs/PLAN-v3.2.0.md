# Aoi-system · v3.2.0 计划（2026-09-06 用户实测第二批反馈）

> 来源：2026-09-06 用户反馈的 4 个界面问题 + 1 项全局功能需求，经代码探查后整理为可执行任务。
> 基线版本：v3.1.0（CHANGELOG）。本文档为 v3.2.0 迭代的执行计划；总路线图见 `docs/ROADMAP.md`。

---

## 工作纪律（沿用 AGENTS.md）

1. 每次改动完成后，必须创建一个对应的 Git commit。
2. 每次改动完成后，必须编写或更新相关测试，交付前 `npm test` 全部通过。
3. commit 后只推 `origin`；`deploy` 远端默认冻结（上线需部署者明确指示）。

---

## 任务总览

| # | 用户反馈 | 根因要点 | 状态 |
|---|----------|----------|------|
| T1 | 信息录入：Excel 导入不识别本站导出的表格 | 导入只支持外部矩阵模板，本站导出是一行一订单扁平表；文件选择器不收 .csv | 待做 |
| T2 | 限购计算器：无法选择活动 | `Aoi.limits.render()` 从未被调用，活动下拉永远为空 | 待做 |
| T2b | 限购计算器：包邮金额可选货币 + 对照外币原价 | 计算只用人民币 `o.price`，未接 `currency`/`priceOrig` | 待做 |
| T3 | 活动管理：购买人/购买账号/送达地址需搜索下拉 | 三项全是纯手敲 input；数据源（圈名/地址）已现成 | 待做 |
| T4 | 订单管理：桌面端右侧空白、长列撑爆、横向滚动条在页面最底部；批量生成人民币价黑字黑背景 | 全局 `width:max-content`+`nowrap`；容器限宽 `max-w-5xl`；5 处 `dark:bg-gray-800` 无配套文字色 | 待做 |
| T5 | 全局：导出图片可选整表或选中几行 | `exportImage` 只会克隆整表；行勾选基建已存在 | 待做 |
| T6 | 收尾：测试全绿 + CHANGELOG/STATUS/ROADMAP 更新 + 推 origin | — | 待做 |

---

## T1 · Excel 导入识别本站导出表格

### 根因（代码证据）

- `js/import.js:33-108` `parseMatrix` 专为外部「排谷表/拼谷表/闲鱼汇总表」设计：谷子为**列**、交叉格填买家；表头定位依赖「单价行」（import.js:36-38），且要求单价行上还有一行表头——本站导出表第 0 行即表头（含「单价(¥)」），在 `import.js:39`（`if (priceIdx < 1) return []`）直接判空，用户看到「未识别到订单数据」。
- 即使绕过，列语义也全错：`LABEL` 白名单（import.js:6）精确匹配，「型号」「购买者」「数量」等本站列名一概不认识。
- `index.html:335` 文件选择器 `accept=".xlsx,.xls"` 不含 `.csv`——`Aoi.tableExport` 的 CSV 回退产物（core.js:181-192）与排发表 CSV（shipping.js:119-148）根本选不进导入框。

### 任务

- [ ] `js/import.js` 新增 `parseRecords(rows)` 记录式解析分支：表头含「购买者/购买人」且含「型号|单价」时按行解析；列映射 活动/制品类型/型号/单价/外币原价/数量/购买者/备注；剥离 行号/checkbox 空列/到货状态/到货批次/小计/操作 等 UI 噪声列。
- [ ] `parse()` 中先试记录式、命中即用，否则回退矩阵式（外部模板功能保持兼容）。
- [ ] `index.html` accept 增加 `.csv`。
- [ ] `js/import.js` 加入 `tests/helpers/aoi.js` MODULES；新建 `tests/import.test.js`：本站导出表头同构往返用例 + 矩阵式旧用例回归。

---

## T2 · 限购计算器

### T2 根因（无法选择活动）

`Aoi.limits.refillActivities()`（limits.js:109-119）是 `#limActivity` 唯一填充入口，由 `Aoi.limits.render()`（limits.js:167-169）调用；而 `Aoi.limits.render()` 全仓库唯一调用点是 `Aoi.refreshViews()`（core.js:248），后者仅在撤销操作时触发。`auth.js` `enterApp`（107-153）逐视图刷新了所有其它模块、**唯独漏了 limits**；`core.js nav()`（32-43）只做显隐切换。结果：进入限购页时 select 恒为空，表现为"无法选择活动"。

- [ ] `auth.js` enterApp 末尾补 `Aoi.limits.render()`；`core.js nav('view-limits')` 时也触发（数据变化后回到页面即可见）。

### T2b 根因（包邮金额无货币概念）

- `Aoi.limits.productsForActivity`（limits.js:63-79）只取人民币 `o.price` 均价，完全没用 `o.priceOrig`/`o.currency`（订单字段见 orders.js:197-202，v1.8.0 引入）。
- 包邮金额 `#limFreeShip`（limits.js:134）纯数字，结果硬编码 `¥`。

用户需求（原话）："每单包邮金额需要可以选择货币种类, 然后对照原价货币的金额, 即算包邮和限购的时候，检测一下对应的外币价格词条"。落地设计：

- [ ] 商品表新增「外币原价」列：同 `type|model` 订单的 `priceOrig` 均价 + 币种符号（JP¥/₩/¥，与 orders.js formatOrig 同规则）。
- [ ] 「每单包邮金额」旁加币种下拉（人民币/日元/韩元），非人民币经 `Aoi.calc.toRmb()`（calc.js:54-60，汇率配置 `d.calc`）换算为人民币包邮线参与 `planCore`；结果统计行同时显示所选币种金额与人民币等值。
- [ ] `tests/limits.test.js` 增加货币换算路径用例。

---

## T3 · 活动管理：购买人搜索下拉

### 现状

`#actBuyersModal`（index.html:462-477）三列（购买人/购买账号/送达地址）由 `buyerRowHtml`（orders.js:955-962）生成，全是纯 text input。数据存 `d.activityMeta[活动名].buyers: [{buyer, account, address}]`（orders.js:988-1008）。

可用数据源（均已存在）：

- 购买人候选：`Aoi.orders.collectBuyers(d)`（orders.js:804-808，从订单购买者去重）∪ `Object.keys(d.memberMeta)` ∪ 既有 buyers。
- 送达地址：`d.addresses[圈名]`（js/member.js:185-216，团员端提交）→ 选中购买人后自动回填。
- 购买账号：全站既有 `activityMeta.*.buyers[].account` 去重（暂无其他存储）。

### 任务

- [ ] 三个输入框改 `input list=` + 动态 datalist（项目已有 `#oIp`/`#ipOptions` 等成熟模式）；购买人选中后自动回填 `d.addresses[cn]` 地址（可手改）。
- [ ] 测试：候选收集与地址回填纯函数用例。

---

## T4 · 订单管理 UI 重设计（纯 CSS）

### 根因

- `css/styles.css:84-92`：`.overflow-x-auto table { width: max-content }` + `th,td { white-space: nowrap }` → 长内容列无限伸长（`.wrap` 单元格在 max-content 下实际不换行）。
- `index.html:416`：`#view-orders` 容器 `max-w-5xl`（1024px）+ 外层 `main.p-6` 全宽 → 宽屏右侧大量空白。
- 横向滚动条属于整张表容器、位于所有行之下 → 长表需滚到页面底部才能左右滑；sticky 首列仅 ≤767px 生效（styles.css:137-148）。
- `genRmbBox`（index.html:433-446）等 5 处 `dark:bg-gray-800`（433/464/481/494/677）：tailwind config 无 `darkMode:'class'`，`dark:` 变体随系统暗色触发，且均无配套 `dark:text-*` → 近黑背景配近黑文字（"批量生成人民币价黑字黑背景"）。

### 任务

- [ ] 桌面端（≥768px）：订单表容器限高视口内滚动（overflow auto + max-height），sticky 表头 + sticky 首列；`#view-orders` 容器放宽（max-w-7xl）。
- [ ] 列宽治理：内容列 max-width + 单行省略 + `title` 悬停全文（复用 `.remark-cell` 模式）；全局表规则 `width:max-content` 改 `min-width:100%`（移动端断点规则保持不变）。
- [ ] 移除 index.html 5 处 `dark:bg-gray-800` 类（与全站其余部分一致的浅色面板，主线本无黑夜模式全局支持）。
- [ ] 冒烟验证 ≤640px 卡片视图不受影响。

---

## T5 · 导出图片支持整表 / 选中行

### 现状

`Aoi.exportImage`（core.js:141-164）：按 `data-table` 取表 → 克隆进离屏 holder → html2canvas 截图下载。订单表已有勾选框 `.row-check[data-id]`（orders.js:438）与 `Aoi.orders.selectedIds()`。全站 13 处入口共用同一函数。

### 任务

- [ ] `core.js exportImage` 支持行过滤：所在表存在勾选行时弹三选（整表 / 仅选中行 / 取消）；克隆后按勾选框 `data-id` 删除未选中 `<tr>`（保留完整表头）。未勾选时维持现状直接整表导出。
- [ ] 测试：行过滤裁剪逻辑用例。

---

## T6 · 收尾

- [ ] `npm test` 全绿 + debug 冒烟（导入往返 / 限购活动与币种 / 购买人回填 / 订单表滚动 / 导出三选）。
- [ ] `CHANGELOG.md` v3.2.0；`docs/STATUS.md`、`docs/ROADMAP.md` 指针同步。
- [ ] 逐任务 commit，完成后推 `origin`（不推 `deploy`）。
