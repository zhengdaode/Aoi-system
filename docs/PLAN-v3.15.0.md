# PLAN v3.15.0（草案，待批准）— 商品联动闭环 + 活动级价格生成与导出 + PCO 目录瘦身 + 复盘性能治理

> 2026-09-13 负责人提出九项需求：①手动录入商品下拉联动 ②表格导入识别已有商品自动回填 ③活动商品列表下载
> ④「已存目录」作用解释与去留 ⑤PCO 目录导入归位工具组 ⑥团期复盘时快时慢根因与修复
> ⑦PCO 页不再默认生成人民币价、批量生成移入活动管理（公式可临时调整）⑧导出到小程序移入活动管理（全活动可用）
> ⑨AI 提示词优化争取一次性导入中文版。**本文档为审阅稿，批准后按切片实施。**

## 0. 现状确认（九项逐条落点，均已在代码核实）

| # | 需求 | 现状 |
|---|------|------|
| 1 | 手动录入商品下拉 | `oModel` 是**纯自由文本**（index.html:533）；`oActivity` 选定后**无任何联动**（无 onchange，js/orders.js 全文仅 addManual 读取 :193）。商品主档 `activityMeta[act].products[]`（`{type,model,refImage,refUrl,price,priceOrig,currency,limit,nameOrig}`，registerProduct orders.js:1459）已具备联动数据源 |
| 2 | 表格导入识别商品 | `confirmImport`（orders.js:95-115）把解析结果**直接 concat 进 d.orders（:103）**，无主档匹配、无回填；主档补齐靠事后手动「从订单同步商品」（orders.js:1503-1515，仅 type+model 骨架）。列映射 RECORD_ALIASES（import.js:37-46）已含 activity/type/model/price/priceOrig |
| 3 | 活动商品列表下载 | 无此功能。展开区现有导出=购买清单表/汇总表（orders.js:1620-1622），商品数据只在页面卡片里 |
| 4 | 已存目录 | `d.pcoItems` + 「已存目录」卡片（index.html:382-395）。作用见 §1.1 |
| 5 | PCO 导航位置 | v3.9.4 移入**业务组**（index.html:182，「信息录入」与「订单管理」之间）；工具组现有 计算器/限购计划（index.html:201-204） |
| 6 | 复盘时快时慢 | 根因见 §1.2 |
| 7 | 默认生成人民币价 | 草稿表「人民币价」列留空=**自动按计算器汇率换算**（`priceCnyOf` catalog.js:380-384；文案 index.html:380「价格留空按计算器汇率自动换算」），推入活动商品（:466-477）与导出小程序表（:510）都走此逻辑；「批量生成人民币价」目前在**订单管理**（showGenRmb/applyGenRmb orders.js:634-688：弹窗内 rate/markup 预填 `d.calc`、可临时改、不写回——正是「公式临时调整」的现成范式） |
| 8 | 导出到小程序 | 仅在 PCO 页（index.html:366），只作用于**勾选的校对草稿**（catalog.js:501-519，TEMPLATE_NOTES 6 行说明+表头+数据）；活动管理侧无入口 |
| 9 | AI 提示词 | 两步工作流（v3.9.5）：提示词明确「**不需要图片列**」（catalog.js:103），图片靠第一步粘贴 PCO 富文本带出，AI 表格只补译名/类型，按日文原名对齐合并（addToDraft :339-355）。解析层其实**已支持** 图片/链接 列（AI_HEADER_KEYS :151-152、parseAi :200-201、safeUrl :329-330），只是提示词不让 AI 输出 |

## 1. 两项说明（需求 ④ ⑥ 的正面回答）

### 1.1 「已存目录」（d.pcoItems）是干什么的

它有三个历史身份：

1. **补货监控的数据面（主用途，已被否决）**：F9 立项时规划 aoi-pco-monitor 自动监控 PCO 补货，往 `d.pcoItems` 读写商品、`watched` 勾选=纳入监控、`status` 列显示售况（index.html:383 的「勾选=纳入补货监控」）。监控 M1 已被 PCO 风控实测否决并挂起，链接抓取通道（grab/saveDispatch，catalog.js:523-554）也因此一直是预留状态。
2. **导入草稿的跨会话存档（次要）**：「保存目录」把本次校对草稿并入 `d.pcoItems`（catalog.js:432-449）。但它**不会**反哺下次导入（addToDraft 只在当前会话草稿内去重），所以存档只是留底。
3. **购买清单导出的原名兜底（边缘）**：plan-export 解析外文原名时按 主档 nameOrig → pcoItems 按 refUrl/名称回查 → 型号 兜底（js/plan-export.js:12-24）。只要商品是「推入活动商品」进的主档，nameOrig 已在主档上，这条兜底几乎不会触发。

**结论**：监控否决后它只剩「留底 + 几乎不触发的兜底」，且带图条目会撑大 blob（加剧需求 ⑥ 的加载负担）。**建议方案 B：下线**——删除「已存目录」卡片与 save/toggleWatch/removeSaved/renderCatalogList 及抓取通道预留 UI（代码 git 历史即归档，同 F6 demo 先例）；`d.pcoItems`、`d.catalogConfig` **数据保留不删**（plan-export 兜底继续只读、历史可查、日后想恢复监控零成本）。若你想保留留底习惯，方案 A=仅把卡片折叠并标注「监控已挂起」。→ **决策点 D1，批 A 或 B。**

### 1.2 团期复盘为什么时快时慢

先排除两个常见嫌疑：**复盘渲染本身不发任何网络请求、也不加载图片**（条形图是纯 div，参考图/合照都在别的页面）。慢的分野来自两处：

1. **页面级（「时快时慢」的主因）**：每次刷新页面自动恢复会话都会重新整包下载 blob（auth.js:116, 157-175，`admin_get_team_data`），登录后 `notify.sync` 还可能整包写回（notify.js:124）。Supabase RPC 的冷启动/跨境延迟波动直接决定这次是 1 秒还是 8 秒——blob 越大波动越明显。
2. **视图级（数据量大后「常需一段时间」）**：每次进入总览，overview.render（core.js:366-370）、stats.render（stats.js:278-405）、notify.sync（notify.js:91-99）**三方各自对「批次×全量订单」做无缓存重算**；单次渲染内 batchSummaries 算两遍（stats.js:285 与 :197）、shipAgingRows 算两遍（:210 与 :392）、每买家 getRecord 线性扫 payments（approval.js:12-19）。全部同步阻塞主线程，算完才出画面。

**修复分档（可只批其一）**：
- **P0 纯去重（低风险，建议必做）**：单次渲染内 summaries/aging 算一次传参复用（stats.js:195 签名微调、:286/:392 传参）；`buyerSummary(batchId)` 加记忆化、`saveTeamData` 成功后统一失效（approval.js:22 一处改动同时消掉 stats/overview/notify 三份重复）。
- **P1 缓存与延后**：stats 渲染结果按「数据版本号+团期+IP+口径」缓存（saveTeamData 成功后 bump 版本，口径切换 :408-415 走缓存）；notify.sync 延后到首帧之后（auth.js:143）。效果：第二次进总览近乎瞬时。
- **P2 blob 瘦身（可选）**：D1 方案 B 停写 pcoItems；通知 prune 已有（v3.11.0）；localStorage 会话级缓存 blob+后台刷新改动较大，默认不做。

## 2. 改进方案切片

| 切片 | 需求 | 内容 | 主要落点 |
|---|---|---|---|
| S1 | ① | **手动录入商品联动**：`oActivity` oninput → 读 `activityMeta[act].products` 填 `<datalist>` 挂到 `oModel`（仍可自由输入）；选中匹配项（model 或 nameOrig 精确命中）→ 回填 制品类型/币种/单价（外币商品填 priceOrig+currency，人民币商品填 price；按当前录入模式分支），**仅在命中瞬间回填一次，手改不覆盖**。回填逻辑抽纯函数便于测试 | index.html:517/533；orders.js 新增 `refillProductOptions`/`productFillFor` |
| S2 | ② | **表格导入识别已有商品**：confirmImport 写入前逐单按 活动名+model 匹配主档，订单缺失字段（type/price/priceOrig/currency）回填、已有值不覆盖；未命中的 model 自动登记主档骨架（复用 registerProduct，与「从订单同步商品」同构，保证下次可识别），导入确认弹窗加统计行「回填 N 笔 / 新登记 M 个商品」+ 自动登记开关（默认开） | orders.js:95-115；import.js 预览 |
| S3 | ③ | **活动商品列表导出**：展开区 head 行加「导出商品列表」→ xlsx：类型/型号/原语言名/币种/外币原价/人民币价/限购/参考图/商品链接，点击即当前数据（天然同步），文件名=活动名 | orders.js actExpandHtml:1615-1623 + click 委托:1136-1167 |
| S4 | ⑦a | **PCO 页停止默认生成人民币价**：pushSelected 仅在人工填写了草稿「人民币价」时才推 price（否则只推 priceOrig/currency/limit）；priceCnyOf 的自动换算仅保留给显式填写；列 placeholder「自动」→「选填」，文案同步 | catalog.js:466-477/380-384；index.html:380 |
| S5 | ⑦b | **活动管理「生成人民币价」**：展开区按钮 → 弹窗（复用 showGenRmb 范式）：rate/markup 预填 d.calc、**可临时改、不写回**；作用对象=该活动商品主档（priceOrig→price，人民币商品跳过）+ 该活动外币订单，可只选其一；模式「仅补空缺 / 全部覆盖」。**决策点 D2**：订单管理原「批量生成人民币价」入口按你的字面要求移除（函数保留复用）；若想保留跨活动勾选场景可改双入口 | orders.js:634-688 复用；actExpandHtml |
| S6 | ⑧ | **导出到小程序迁入活动管理**：TEMPLATE_NOTES/HEADER 与导出函数迁至 orders.js `exportMiniProgram(act)`，展开区按钮，**所有活动可用**；数据源=该活动商品主档（分类=type、名称=model、价格=price、采购状态=备货中），输出与现模板完全一致（说明 6 行+表头+数据，Sheet1）。价格缺失时 confirm 提示「按当前汇率临时换算写入导出表（不改商品数据）」。PCO 页按钮与 exportTemplate 移除 | catalog.js:491-519 → orders.js；index.html:366 删 |
| S7 | ④ | **已存目录处置**：按 D1 结论执行（建议 B=UI+预留通道下线、数据保留） | index.html:382-395；catalog.js |
| S8 | ⑥ | **复盘性能治理**：P0+P1（见 §1.2；P2 只随 D1=B 顺带） | stats.js/approval.js/core.js/auth.js/notify.js |
| S9 | ⑨ | **AI 提示词一次导入优化**：提示词输出列扩为 `| 日文原名 | 中文名 | 类型 | 日元价 | 限购 | 発売日 | 商品链接 | 图片链接 |`，要求：粘贴内容中出现的商品页链接原样保留、可见的图片地址一并保留（看不到则留空）。解析层 image/url 列**已支持**，仅需补列名别名；addToDraft 合并逻辑不变（缺图时两步流程仍可用，v3.9.5 对齐合并不产生重复行） | catalog.js:98-120/144-153；index.html:347 文案 |
| S10 | ⑤ | **PCO 导航归位工具组**：nav 项自业务组（index.html:182）移至工具组（:201-204 之后） | index.html |
| S11 | — | 文档与测试收尾：CHANGELOG/STATUS/AGENTS 同步（含 D1 处置结论、PCO 归位） | docs |

### 决策点汇总（审阅时请一并拍板）

- **D1（需求④）**：已存目录 A 保留留底 / **B 下线（推荐，数据保留）**。
- **D2（需求⑦）**：订单管理原「批量生成人民币价」入口 **移除（按字面）** / 保留双入口。
- **D3（需求⑨）预期管理**：ChatGPT 输入框粘贴富文本时通常**剥离 `<img>` 的 src**——「商品链接」列大概率可得（正文里的 URL/超链接会保留），「图片链接」列尽力而为、常为空。即：一次性导入可达「中文版+链接完整」，图片完整仍以两步流程最稳。此为外部产品行为限制，无法从我端根治。

## 3. 数据模型与兼容

- **无 schema 变化**。行为变化仅一处：PCO 推入的商品主档 `price` 由「自动生成」改为「仅人工填写时才有」（priceOrig/currency/limit/nameOrig 不变，外币原价数据完整保留）。
- D1=B：`d.pcoItems`/`d.catalogConfig` 现网数据原样保留（只读兜底），ensure 幂等初始化保留（无害），停写入口。
- 汇总表/购买清单/小程序导出对 `price` 缺失的呈现：外币原价列照常，人民币列留空 → 由 S5 一键生成补齐。

## 4. 测试计划（vitest，沿用 tests/helpers/aoi.js）

- S1：`productFillFor` 命中/未命中/外币与人民币分支/手改不覆盖。
- S2：导入回填（已有值不覆盖）、新商品自动登记骨架、开关关闭时不登记。
- S3/S6：商品列表 xlsx 与小程序模板 xlsx 的 aoa 结构（含价格缺失兜底路径）。
- S4/S9：pushSelected 不再自动生成 price；AI_PROMPT 含新列说明；parseAi 识别 8 列表格。
- S5：临时公式不写回 d.calc、仅补空缺/覆盖两模式、人民币商品跳过。
- S8：buyerSummary 记忆化命中与 saveTeamData 失效、单次渲染 summaries 只算一次（可用计数桩断言）。

## 5. 风险与回退

- S2 自动登记骨架会让主档条目变多（无价格骨架）——导入弹窗开关可关，回退零成本。
- S5/D2 若保留双入口需注意两弹窗预填口径一致，避免公式理解分叉。
- S8 记忆化失效边界：所有业务写路径均经 `Aoi.saveTeamData`（含 debug 本地通道），失效钩子放在 saveTeamData 成功回调即可全覆盖；P1 缓存键含数据版本号，不存在脏读窗口。
- S9 图片列受 ChatGPT 客户端行为限制（见 D3），不达预期时两步流程原样可用，无破坏性。
