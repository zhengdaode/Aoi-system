# PLAN v3.6.0 — 管理端体验升级（买家管理 / 活动商品 / 购买计划同步）

> 2026-09-09 立项。来源：用户实测后的六条新建议（本文件即其任务分解）。
> 原则：全部数据仍存 `team_data.data` 单 blob（无 schema 迁移）；纯 HTML/CSS/原生 JS；
> 每特性独立 commit + vitest 用例；不做任何服务端（Supabase/relay）改动。

## 需求 → 特性映射

| # | 用户原话（摘要） | 特性 | 主要落点 |
|---|------------------|------|----------|
| 1 | 买家cn管理独立为新 tab「买家管理」，点击买家筛选其订单并按状态标注 | S1 | `index.html`（nav + view-buyers）、`js/orders.js`、`js/core.js` |
| 2 | 商品参考图片 + 跳转链接；活动管理按型号分类管理商品（增改删）；团员查询界面展示；链接空时回落平台链接；按商品筛购买者；活动备注 | S2 | `js/orders.js`、`js/member.js`、`index.html` |
| 3 | 购买计划自动同步到活动管理；两侧双向同步可编辑；确认购买状态，失败自动按原计算器重分配给剩余账户 | S3 | `js/limits.js`、`js/orders.js`、`index.html` |
| 4 | 添加图片支持复制粘贴上传 | S4 | `js/image-upload.js` + 各图 URL 输入框 |
| 5 | 导出图片/表格文件名加活动名和表格类型 | S5 | `js/core.js` + 按钮 `data-activity-from` |
| 6 | 复盘统计 UI 布局与其他 tab 不统一 | S6 | `index.html`（HTML 结构修复） |

## S6 复盘统计布局修复（根因）

`view-stats` 被写在 `</main>` 之后、`</section>` 之前（946 行提前闭合 main，1014 行多出一个
`</main>`），导致该视图不在 main 内容流里：无 p-6 内边距、不随 main 布局，与其它 tab 观感不一致。
修复 = 删除提前闭合的 `</main>`，让 view-stats 回到 main 内。加 DOM 结构回归测试
（view-stats.closest('main') 非空、页面只有一个 main）。

## S5 导出文件名

`Aoi.exportBaseName(btn)`：取 `data-name`（表格类型）；若按钮带 `data-activity-from="<selectId>"`，
且该下拉当前选中活动非空 → 文件名 = `活动名-表格类型`（非法文件名字符 `\ / : * ? " < > |` 替换为 `-`）。
`exportImage` / `tableExport` 改用之。接线：订单管理两枚按钮（`fActivity`）、限购计划结果表两枚按钮（`limActivity`）。

## S4 粘贴上传

`Aoi.img.bindPaste()`：document 级 paste 监听；目标为带 `data-img-paste` 属性的输入框且剪贴板含图片时，
preventDefault → `Aoi.img.upload(file)`（复用压缩+图床上传）→ URL 回填输入框。
标记范围：设置页缴费二维码 `botQrUrl`、囤货地收款码 `whQr`、发货合照 `shipPhoto`、
团员端付款凭证输入（member.js 动态行）、S2 新增的活动商品参考图全部输入框。

## S1 买家管理独立 tab

- 侧边栏「基础数据」组新增 `买家管理`（view-buyers）；原活动管理页内的买家（CN）卡片整体迁出。
- 买家表升级：圈名可点击 → `jumpToBuyer(buyer)` 跳订单管理并按购买者筛选；列改为
  行号 / 圈名 / 订单数 / 未到货 / 待发货 / 已发待收 / 已完成 / 操作；新增圈名搜索框。
- 订单表「到货状态」列升级为组合状态徽标 `combinedStatus(o)`：
  未到货（灰）→ 已到货·待发货（琥珀）→ 已发货（绿）→ 已收货（深绿）。
- `Aoi.nav('view-buyers')` 进入时自动重渲染；`refreshViews`/`enterApp` 补 renderBuyers。

## S2 活动商品（参考图 / 跳转链接 / 型号分类）

- 数据：`activityMeta[act].products = [{ id, type, model, refImage, refUrl }]`。
- 活动管理行新增「商品」按钮（显示数量）→ 活动商品弹窗：按制品类型分组列出型号，
  行内可改型号/参考图（URL、上传、Ctrl+V 粘贴）/跳转链接，可保存、删除；顶部表单新增商品（类型+型号必填，同型号去重）。
- 链接回落：`productLink(act, p)` = `p.refUrl || activityMeta[act].link || ''`（跳转链接为空默认活动平台链接）。
- 按商品筛购买者：弹窗内每行显示「N 人购买」→ `jumpToProduct(act, type, model)` 跳订单管理
  并同时设置活动筛选 + 新增的型号筛选（`fModel`）。
- 团员端「我的订单」新增「参考」列：命中商品显示参考图缩略图 + 商品链接（空则回落平台链接，均无显示 —）。
- 活动备注：活动管理表已有行内「备注」列（activityMeta.remark），本版保留不动。

## S3 购买计划双向同步 + 失败重分配

- 数据：`d.limitPlans[act] = { activity, freeShip, freeShipRmb, freeCur, accountsCount, maxTypes,
  limits: {'type|model': n}, items: [{ index, total, diff, reached, items: [{ type, model, qty, price, amount, status }] }],
  remaining, updatedAt }`（status ∈ 待购买/已购买/购买失败）。
- 限购计划页点「计算购买计划」：结果入库（同名 (账号,商品) 保留既有购买状态）并渲染带新
  「购买状态」列的 8 列结果表（行号/账号/购买内容/件数/金额/外币原价/包邮状态/购买状态）。
  结果表内即可改件数、切状态 —— 与活动管理侧读写同一份 `d.limitPlans`，自动双向同步。
- 活动管理行新增「计划」按钮（显示账号数）→ 购买计划弹窗：同一渲染器，展示各账号商品、
  件数输入、状态下拉；无计划时提示去限购计划页生成。
- 失败重分配 `reallocateCore(stored, idx, key)`（纯函数）：把 (账号 idx, 商品 key) 整项移出，
  按「原计算器阶段一」的同一贪心（逐件给金额最低的可收账号）分配给其余账号；
  受单账号限购（plan.limits）与每账号种类上限（maxTypes）约束；装不下的余量计入 `remaining` 并告警。
  触发：状态切到「购买失败」→ 二次确认 → 重分配 → 保存 → 两侧重渲染。
- 件数编辑：`setItemQty` 重算 item.amount → 账号 total/diff/reached；状态切换（非失败）直接写回。

## 测试计划（vitest，全部走现有 harness）

- `tests/v360-layout.test.js`：view-stats 在 main 内；全局仅一个 main。
- `tests/v360-export-paste.test.js`：exportBaseName 组合/回落/非法字符；tableExport 文件名接线；
  粘贴上传回填与非图片粘贴忽略。
- `tests/v360-buyers.test.js`：combinedStatus 四态；买家分桶计数；搜索过滤；点击跳转筛选；nav 触发渲染。
- `tests/v360-products.test.js`：商品 CRUD；链接回落；productBuyers 计数；jumpToProduct；
  订单型号筛选；团员端参考列（缩略图/链接回落/占位）。
- `tests/v360-plan-sync.test.js`：plan() 入库 + 状态保留；结果表 8 列；reallocateCore 约束/余量；
  失败确认→重分配→保存；件数编辑重算；活动侧弹窗渲染与双向同步。
- 既有用例同步更新：limits.test.js 结果表 7→8 列断言；相关 describe 补 saveTeamData stub。

## 版本

CHANGELOG 记 `v3.6.0`（2026-09-09）。仅前端改动，部署随 origin 推送自动生效（Netlify / Pages 构建即得）。
