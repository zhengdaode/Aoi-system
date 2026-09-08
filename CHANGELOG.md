# Changelog

## v3.5.3 (2026-09-09)

> **F5 · QQ 机器人双向实施完成**——主体在独立仓库 [aoi-qqbot](https://github.com/zhengdaode/aoi-qqbot)
> （relay v4 双向，M1–M7 每里程碑独立 commit + node:test 54 用例；设计文档
> `docs/PLAN-F5-QQBOT-BIDIRECTIONAL.md` v3 定稿）。本仓库仅两处接入改动 + 审阅材料清理，
> 全部可独立回退；**待真机部署**：SQL Editor 重跑 `supabase-schema.sql`（3 个新 RPC）、
> ECS 部署 aoi-qqbot relay + NapCat 开 HTTP POST 上报 + Caddy TLS 反代（解除 GitHub Pages mixed content）。

### Added（主仓库接入，commit df8a45f / 3f3db01）
- **3 个只读 Supabase RPC**（security definer，drop 重建、可重复执行；返回字段白名单，不含地址/凭证/他人数据）：
  ① `member_lookup_by_qq(p_qq)`——QQ→CN 解析后只返回本人订单/交费摘要（查单/进度数据源，附录 A 字段）；
  ② `team_summary_for_group()`——团级聚合（阶段/匿名计数/DDL 恒 null，附录 B 白名单，群内团况数据源）；
  ③ `unpaid_members_by_group()`——待缴费名单（cn/qq 可空/amount/batchDates）+ botConfig 白名单出参（qrUrl/adminQq）
- **设置页「QQ 机器人」卡扩展**：管理员转发 QQ（`botConfig.adminQq`，排发表私发目标）+
  缴费二维码（`botConfig.qrUrl`，复用 `Aoi.img` 图床上传；网页换图保存后下次催缴自动生效，relay 实时读取）
- **排发表私发管理员**：`Aoi.bot.exportShipping(batchId)` 按 `Aoi.ship.export` 同款 8 字段组包
  （购买者/制品/发货线路/数量/囤货地/快递单号/合照/状态），带 admin token POST relay
  `/onebot/export-shipping`；`shipping.js` 批量「设为已发」后自动触发（异步、失败仅 toast 不影响本操作）

### Removed
- `demo/review/`（F5/F6 手机审阅页）——审阅使命完成（F5 已定稿实施、F6 已并入主系统），按用户指示删除

### Tests
- 203 → 211 用例：`f5-rpc-and-settings.test.js`（新字段持久化/回填/控件存在/schema 守护 + 42703 k 别名纪律）
  + `f5-shipping-export.test.js`（exportShipping 组包/配置缺失/非 2xx/钩子触发/跳过/失败隔离）；全套全绿
- 独立仓库侧：relay v4 全功能 node:test 54 用例（管线/绑定/查单/团况/催缴/xlsx/安全过滤），`npm test` 零依赖运行


## v3.5.2 (2026-09-09)

### Fixed
- **链接导入拉取通道加固（三通道回退）** — 用户实测两份直链「不可用」：复核链接本身仍 200（curl 字节一致），
  问题定位为访问通道——Netlify 出海访问境内源站可能超时/被拒（公共 CORS 代理 522 同因）。
  新增第二代理通道：netlify.toml `/media-relay/static.zwlhome.com/*` → ECS relay `/fetch/...`（国内中转）；
  `relay/relay.js` 新增免鉴权 `GET /fetch/<host>/<path>`（仅放行白名单主机 + 10MB 上限 + 20s 超时，防开放代理/SSRF；
  原有 `POST /` 管理员鉴权链路不变）。前端拉取链升级：`/media-proxy` → `/media-relay` → 直连逐通道尝试。
  报错分级：直连通道拿到明确 404/410 → 「链接已失效（HTTP xxx）」；否则提示通道不可用 + 环境指引
  （本地打开 / GitHub Pages 通道 / Netlify 构建未完成时会出现，附手动导入兜底）
- **GitHub Pages 通道可用性（本轮补充）** — Pages 无服务端重写，前两个同源通道必然 404、直连被跨域拦截，
  链接导入在 Pages 上此前无法成功。qq-relay Edge Function 新增 `GET /fetch/<host>/<path>` 白名单透传
  （host 与 relay.js FETCH_HOSTS 双层校验），前端按设置页配置的 https relay 地址（即 Edge Function 地址）
  拼出第三代理通道；通道链升级为：同源 `/media-proxy` → 同源 `/media-relay` → 设置页 relay（Edge）→ 直连

### Tests
- import.test.js 13 → 15 用例（mapRelayUrl 白名单、直连 404 失效文案）；全套 197 全绿。
  relay `/fetch` 本地起服实测：白名单内 200 且 content-type/字节数与源一致，白名单外 403，POST 鉴权不受影响

### 部署
- Netlify 侧随 origin 推送自动生效；ECS 侧需更新部署 `relay/relay.js`（拉取后 `pm2 restart qq-relay`）
  点亮 `/media-relay` 通道——未部署时该通道返回 404/405 被前端自动跳过，不影响其余通道
- GitHub Pages 测试链接导入还需两步：`supabase functions deploy qq-relay --project-ref blfzbrivtxjxlbhgabqi --no-verify-jwt`
  （含 /fetch 透传的新版），并在设置页把 relay 地址配置为该 Edge Function 地址（此配置机器人推送本就要求）


## v3.5.1 (2026-09-08)

### Fixed
- **限购计划算法修订：全量分配优先，再调剂包邮** — 旧逻辑「逐账号装箱、凑到包邮线即停手」与真实业务相反（排单商品本就必须全部由可用账号买回，无论最终是否包邮），导致大量商品被留在「剩余未分配」。改为两阶段：①**全量分配**——全部排单数量硬性分配到账号（受单账号单品限购 + 每账号最大种类数约束；每件分给当前金额最低的账号，各账号金额天然均衡），仅当约束真装不下时才计入剩余提示；②**包邮调剂**——a) 已达标账号在不跌破包邮线的前提下向未达标账号补差（普通挪动优先；盈余放不出任何单品时用等价交换——换出一件、换回一件以净额补差），b) 总货值不足以全员包邮时牺牲金额最低的账号、把最接近包邮线的账号逐个顶过线（最大化达标账号数，已达标账号绝不动）。配套：结果统计行新增「N 个达标包邮」；未填包邮金额时包邮列显示「—」；剩余提示附处置建议（加账号或放宽限购）

### Tests
- 192 → 195 用例：limits 算法用例按两阶段语义重写——全量分配回归守护（旧逻辑凑线即停的场景现全部分配）、限购/种类数约束贯穿分配与调剂、等价交换补差、牺牲式集中凑邮、限购卡死时如实输出未达标

## v3.5.0 (2026-09-08)

> 双特性：①从链接导入订单（排谷表/汇总表分享直链一键导入，独立小版本）；②F6 团期复盘统计**并入主系统**
> （demo 路线按用户决策取消，迭代结论与实现方案见 `docs/PLAN-F6-STATS.md`）。

### Added
- **团期复盘统计页（F6）** — sidebar「工具 → 复盘统计」（`js/stats.js`，第 17 个模块，只读不写业务数据）：
  团期（月份）+ IP 双筛选；9 项 KPI（订单条/件数、折合总金额、参与买家、人均消费、应收/已收/未收国际费、平均发货时效、到货比例）；
  按活动聚合表（条数/件数/折合金额/币种构成/到货比例，可导出图片/xlsx）；IP 排行（金额/订单数/件数口径切换）；
  买家排行 Top10（金额/件数切换，行内交费金额下钻）；币种分布；交费回收（**金额口径**，与审批页 `buyerSummary` 同源，按「批次×买家」）；
  发货时效（按批次平均「到货→发货」天数）。口径：货款维度按「活动购买时间」归月、交费/时效按「到货批次日期」归月；
  外币金额优先取已生成人民币价，缺失时按当前计算器汇率估算并在 KPI 标注
- **发货时间戳埋点（F6 配套）** — 发货管理「批量设发货」标记已发时写入 `orders.shippedAt`（ISO 时间，
  首标已发记录、重复标记不覆盖、切回未发不删除）；旧数据无该字段时时效统计自动排除，无需迁移
- **Excel 导入支持「从链接导入」** — 信息录入页新增直链输入框：粘贴 `static.zwlhome.com` 排谷表/汇总表分享链接即可拉取并复用既有「确认导入」弹窗（活动名/IP 预填、可编辑后入库）。解析器零改动即兼容两种线上真实格式：排表详情=明细型矩阵（分类/谷子/单价 行 + 买家名填格）、汇总表=汇总型矩阵（「昵称/总数」买家列 + 数量格 +「总金额」汇总行）；【团期】自动识别为活动名（实测样例「宝可梦万圣节」两表各 30 条、买家×数量互相印证）
- **netlify.toml 新增 `/media-proxy` 直链代理** — 该类直链响应无 CORS 头（实测 OPTIONS 预检 405、GET 无 `Access-Control-Allow-Origin`），浏览器直接 fetch 被跨域拦截；由 Netlify 服务端同源转发（与 `/qqbot` 同模式），白名单仅 `static.zwlhome.com`，置于 SPA catch-all 之前。前端拉取通道依次尝试：同源代理 → 直连（200 的 HTML 回退页判定为代理未部署，自动跳过）；全部失败时 toast 引导「点开链接下载文件 → 选择文件导入」兜底。公共 CORS 代理方案实测不可用（allorigins/codetabs 522、corsproxy.io 401）且会把含买家昵称的表格经第三方转发，故不采用

### Tests
- stats.test.js 新增 13 用例：monthKey / termOptions（月份降序 + unknown）/ orderRmb 三分支（人民币直用、缺失估算标记、双缺为 0）/ 按月与 IP 过滤 / 活动·IP·买家·币种聚合 / 金额口径交费汇总与回收率 / 发货时效（排除未发与无时间戳）/ KPI 筛选联动 / 渲染冒烟与口径切换；shipping.test.js 增 2 用例（已发写 shippedAt 且重复不覆盖、未发不写且保留原值）
- import.test.js 6 → 13 用例：zwlhome 排谷表/汇总表真实结构解析回归 ×2；链接拉取层 `mapProxyUrl`（白名单外返回 null）/`fileNameFromUrl`/`fetchFromUrl` 通道优先、HTML 回退页跳过、全失败引导 ×5；另以 Node 直连两份线上真实链接端到端验证 30×2 条订单解析一致


## v3.4.0 (2026-09-08)

> 数据安全兜底 + 团员感知增强（PLAN-NEXT v3.4.0：B1 / B2 Phase 1 / F1 / F2 / F4），后端改进路线首批落地。
> 另：F5（QQ 机器人双向）按用户决策移出为独立项目（设计见 `docs/PLAN-F5-QQBOT-BIDIRECTIONAL.md`，待审核）；
> F6 产出独立本地 demo（`demo/stats-demo/`，供管理层审核）；F7/F8 取消。

### Added
- **服务端 blob 历史快照（B1）** — 新表 `team_data_history`：管理端/团员端每次保存前自动存档旧版本（保留近 30 天 / 每团 100 份，写入口顺带清理，无需 cron）；`admin_list_team_data_history`（摘要：时间/来源/订单数/体积）/ `admin_get_team_data_history`（全文）供回滚；RLS 无策略，仅经 RPC 访问
- **设置页「数据备份与恢复」卡（F4）** — 下载全量备份 JSON（带 kind/version/exportedAt 元信息）；从备份文件恢复（parseImport 校验防任意 JSON 覆盖 + 确认摘要 + 乐观锁写回 + 全视图刷新）；服务端历史快照列表 +「恢复此版」一键回滚（恢复前服务端又会自动存档当前版本，可连续回滚）；debug 模式提示无服务端历史
- **审批/到货自动通知（F1）** — 新类型 paid（交费确认）/ rejected（交费驳回）/ arrived（到货通知）；审批标记已交/驳回、订单标记到货时自动生成（到货按「买家×批次」幂等去重），走既有 QQ 双通道推送；address 类仅管理员可见策略不变
- **团员端订单进度时间线（F2）** — 我的订单新增「进度」列：排单→到货→交费→发货→收货，●已完成/○待完成，交费节点带状态色（待审核琥珀/已驳回红/待交灰/已交绿）

### Security
- **团员读接口按 CN 裁剪 PII（B2 Phase 1）** — `get_team_by_member_key(+p_cn)`：addresses/memberMeta/cnChanges 只回本人条目（QQ 号输入由服务端映射为 CN 并回传）；p_cn 为空（旧客户端）时整体剔除三类 PII——STATUS「已知限制」中「一份密钥读全团地址/QQ 原文」就此关闭
- **团员写接口白名单合并（B2 Phase 1）** — `update_team_data_by_member_key(+p_cn)`：整份覆盖改为按 CN 白名单合并（本人地址/QQ 绑定/收货确认/付款凭证/换囤货地/改圈名申请/address·cnchange 两类通知）；payments 状态设上限——「已交/已驳回」仅管理端可写（防自批）；其余字段一律以服务端现值为准；旧客户端（p_cn 为空）走整份覆盖兼容桥
- **团员密钥升 128bit** — regenerate_member_key / admin_regenerate_member_key 从 8 位 hex（~32bit，可穷举）改为 gen_random_bytes(16)（32 字符）；旧密钥在下次重新生成时自然替换

### Tests
- 152 → 170 用例：backup-restore（18）+ member-pii（9）+ action-notify（9）；含 schema 守护用例（历史链路 / 白名单合并 / 状态上限 / 密钥强度防回退）

### 线上操作（2026-09-08 已完成）
- 快照表（`team_data_bak_20260908` / `teams_bak_20260908`）→ `scripts/sb.js` 重跑 `supabase-schema.sql` → 探针验证：PII 裁剪生效（anon 读回无 addresses）、写链路端到端可用（同数据回写 + history 自动存档 1 行）、业务 blob 完好
- 建议下一步：重新部署前端（团员端 PII 隔离与全部新功能生效；旧前端经兼容桥仍可用，但 QQ 号输入进看板依赖新版）

## v3.3.0 (2026-09-07)

> 冗余清理与重构：全仓审计（死代码 / 重复实现 / 文档漂移 / 隐私风险）后的集中清理版本。

### Removed
- **死代码删除** — `Aoi.getTeamData`（data.js 兼容入口，全仓 0 调用）、`Aoi.DEBUG_USERNAME/DEBUG_PWD`（core.js，auth.js 用字面量绕过）、`Aoi.state.members`（全仓无读写）
- **死 DOM 删除** — `index.html` 的 `activityOptions`/`typeOptions` 两个 datalist 及 `refillDatalists` 对应填充分支（无任何 `list=` 引用；活动下拉按 IP 过滤由 `refillActivitySelect` 负责）
- **死数据字段** — 订单对象 `paid: '未交'`（orders.js / import.js 共 3 处写入、0 处读取；交费状态实际存于 `d.payments`）
- **隐私快照清理** — 删除本地 `backups/` 下 4 份线上真实用户数据快照（未跟踪文件；同数据仍在线上库可再导出）
- **杂项** — `--surface-dark` 死 CSS 变量、登录页调试账户明文提示、"阶段 4b"过时 UI 文案；`.gitignore` 过期的 `index-original.html` 条目

### Changed
- **重复实现合并** — 新增 `Aoi.orders.refillBatchSelect` 通用批次下拉填充，intl/approval/shipping/notify 四份逐字重复的 `refillBatches` 改为薄壳（公共 API 不变）；`approval.copyRemind` 复用 `Aoi.copyText`；新增 `Aoi.downloadCsv`，core.tableExport 回退与 ship.export 两套 CSV 下载逻辑收敛；新增 `Aoi.currencySymbol`，orders/limits 三处币种符号映射收敛
- **文档一致性修正** — README（版本号 v3.0.0→v3.3.0、测试数 62→134、黑夜模式/自定义背景标注不在 v3 主线、调试账户用户名误写 `debug@aoi.local`→`debug`）；CLAUDE.md（bot.js 从"占位未接入"更正为 v1.7.0 接入 / v3.1.0 双通道）；STATUS.md（"必须重跑 schema"回写为已完成，见 ITERATION_LOG 第 5 轮；机器人占位历史段加注）；ROADMAP.md（基线 v1.6.0→v3.3.0、5 个已完成的 P0 checkbox 勾选）；AGENTS.md（模块数 15→16、归档路径、遗留项指向 STATUS.md）
- **计划文档归档** — `PLAN-AUTH-REDESIGN.md` / `PLAN-v3.2.0.md` / `IMPROVEMENT_PLAN.md` / `PR-v1.4.0-final.md` 移入 `docs/archive/`

### Added
- **测试补齐（106 → 134 用例）** — `tests/helpers/aoi.js` MODULES 修正为与 index.html script 顺序严格一致并补入 shipping/warehouse/image-upload 三个此前不加载的模块；新增 approval-flow（审批流转/两步确认/催缴/复制）、shipping（排发表/勾选/发货/单号/囤货地）、warehouse（囤货地/换地审批）三组测试；新增 enter-app 回归守护（enterApp 必须刷新限购计算器活动下拉，防 v3.2.0 修复回退）

## v3.2.0 (2026-09-06)

> 2026-09 用户实测第二批反馈，计划与根因见 `docs/PLAN-v3.2.0.md`。

### Fixed
- **Excel 导入识别本站导出的表格** — 导入此前只支持外部「排谷/拼谷/闲鱼」矩阵模板；新增记录式解析分支 `Aoi.import.parseRecords`（表头含 购买者/型号/单价 即按一行一订单解析，剥离 行号/勾选/到货状态/小计/操作 等噪声列，外币原价带币种识别），矩阵式失败后自动回退命中；文件选择器接受 `.csv`（`accept` 补齐，下载表格的 CSV 回退产物可回导）
- **限购计算器无法选择活动** — `Aoi.limits.render()` 此前从未在登录后/视图切换时被调用（enterApp 漏刷、nav 只切显隐），活动下拉恒为空；登录后与切回限购页时刷新
- **批量生成人民币价等 5 处面板「黑字黑背景」** — tailwind config 未启用 `darkMode:'class'`，`dark:bg-gray-800` 随系统暗色触发且无配套文字色；移除全部 5 处 `dark:` 类（genRmbBox、actBuyersModal、actTrackModal、orderEditModal、intlGauge）

### Changed
- **订单管理表格桌面端 UI 重设计** — 表格容器限高视口内滚动（横向滚动条常驻可视区，不必滚到页面底部）、桌面端表头吸顶 + 首列吸附（原仅移动端）、换行单元格最大列宽 12rem 防长内容撑爆单列、悬停 title 显示全文；视图容器放宽 `max-w-5xl → max-w-7xl` 消除宽屏右侧空白；移动端卡片视图不受影响
- **限购计算器：包邮金额可选币种** — 「每单包邮金额」新增币种下拉（人民币/日元/韩元），非人民币经当前汇率公式换算为人民币包邮线参与分配，结果统计行同时显示原币种金额与人民币等值；商品表新增「外币原价」列（同款订单 `priceOrig` 均价 + 币种符号），计算包邮/限购时可见外币价格词条
- **活动管理：购买人/购买账号搜索下拉** — 购买人弹窗三输入框接 datalist 候选（圈名 = 订单购买者 ∪ 团员元数据 ∪ 既有购买人；邮箱 = 全站既有购买账号去重）；选中已知圈名自动带出团员端提交过的送达地址（可手改）

### Added
- **导出图片支持行选择** — 表内有勾选行时「导出图片」询问仅导出选中行或整表（克隆裁剪、表头完整保留），全站 13 处入口通用

## v3.1.0 (2026-09-06)

### Added
- **QQ 推送双通道（新默认）** — 「推送·私聊+群@（推荐）」：自动检测 QQ 绑定，已绑定者逐人私聊（relay 1s 节流）且在群中被 @；未绑定/私聊失败由群 @ 兜底；私聊通道异常自动降级纯群发；群发成功才标记已发送
- **公告推送 QQ 群** — 「发布并推送 QQ 群」按钮，公告以【公告】前缀发到群；机器人未接入/推送失败不影响站内发布
- **未绑定 QQ 用圈名 @ 兜底** — 群发时未绑定 QQ 的买家以「@圈名」文字提及（不触发 QQ 客户端提醒）

### Changed
- **收件地址更新仅管理员可见** — address 类通知不再推送 QQ（群聊/私聊均不推），仅显示在网页通知列表
- **推送报错可操作化** — relay 401 转为「重新登录 / 检查 relay 版本」引导；debug 账号明确提示无法推送（无管理员会话）；批量私聊遇登录态失效立即中止
- **部署对齐** — deploy 分支曾停滞在 8-11 旧前端，已 `merge -s ours` 对齐并上线 GitHub Pages（v3 前端）；relay v3 已部署 ECS（systemd `qq-relay.service`），临时 Cloudflare 隧道提供 https 入口（详见 docs/STATUS.md）

## v2.0.0 (2026-09-06)

### Added
- **限购购买计划计算器**（工具页新增，与计算器并列）— 选活动展示商品种类与排单数量；逐项/批量设限购数；填每单包邮金额、可用账号数、每账号最大购买种类数（空=不限）；贪心装箱算法（单价降序、恰好凑满包邮线、受限购/种类约束）输出每个账号的购买内容、金额、距包邮差额，未分配完的提示剩余；结果可导出图片/表格
- **表格文件下载** — 新增 `Aoi.tableExport`（SheetJS .xlsx，CDN 未加载回退 CSV）；订单管理、国际计算（明细/每人应付）、活动管理、买家管理、审批、换囤货地、改圈名、发货管理、团员端等 12 张表统一「导出图片 / 下载表格」双按钮
- **移动端订单表卡片视图** — 窄屏（≤640px）下订单表每行变卡片，`data-label` 显示列名，避免长距离横向滚动

### Changed
- 计算器页说明同步：录入不再自动转换，汇率公式用于「订单管理 → 批量生成人民币价」与单笔换算

> **2026-09 十项问题迭代至此全部完成**（问题 0/1/2 线上生效需重跑 `supabase-schema.sql`，见 README 升级说明）。

## v1.9.0 (2026-09-06)

### Added
- **国际计算：均价与加权单价拆列** — 均价列只读展示（总额/总重×单位重），加权单价列可编辑覆盖（手动优先），附「↺」一键清除覆盖恢复均价
- **目标金额差值 + 悬浮仪表盘** — 统计行显示 `已分摊/目标 · 差值±`；右下角悬浮仪表盘（可收起）显示插值进度条、差值、总重，表格滚动时常驻可查
- **活动管理：购买人信息** — 每个活动可填多行「购买人 + 购买账号（邮箱）+ 送达地址」（弹窗多行编辑，存 `activityMeta[].buyers`）
- **活动管理：快递单号** — 每个活动可填多行快递单号（每行一个，随时加行，存 `activityMeta[].trackings`）
- **活动管理：备注 + 模糊出荷日期** — 备注列即时保存；出荷日期除精确日期外支持模糊选项（`x年x月上/中/下旬`、`x年春/夏/秋/冬`、`x年第N季度`，datalist 建议，存 `shipDateFuzzy`）

### Changed
- **全站 UI（问题 4 第一批）** — 数据表水平间距压缩（px-3→0.5rem）；移动端：表格首列 sticky 便于横向对照、容器贴边减少大留白

## v1.8.0 (2026-09-06)

### Added
- **外币原价保留** — 订单新增 `currency` / `priceOrig` / `remark` 字段（旧数据自动迁移视为人民币）；订单管理与团员端展示「外币原价」列，随时可查最初设定的外币价格
- **录入页双模式（取消自动转换）** — 选非人民币时提供两种勾选：①直接输入外币价（人民币留空，显示"待生成"）；②计算器计算（外币价 + 人民币价实时预览，人民币可手改后同入库）
- **批量生成人民币价** — 订单管理工具行（与批量删除同排）新增：勾选订单 → 套用公式（默认回填计算器汇率/加价，可当场修改）→ 立即回填当前页，支持 30 秒撤销
- **多行购买者批量录入** — 购买者输入改 textarea，每行一个用户，提交时逐行生成同款订单
- **订单编辑与备注** — 每行「编辑」弹窗（活动/类型/型号/数量/币种/原价/人民币价/备注）；备注列默认 2 行折叠、点击展开
- **类型快捷新建** — 制品类型选择面板内置"新建"行（名称 + 线路），即建即选，无需跳转类型管理页

### Fixed
- 人民币价未生成（null）时，审批汇总 / 团员端订单表 / 总览统计不再产生 NaN，显示"待生成"占位

### Changed
- 订单表格：文本单元格自动换行（opt-in `.wrap`，不回退横向滚动修复），备注列 line-clamp 折叠

## v1.7.0 (2026-09-06)

### Fixed
- **团员端保存静默丢失（P0 根因①）** — `update_team_data_by_member_key` 旧版只执行 update：`team_data` 缺行时影响 0 行仍返回成功，表现为"保存成功但什么都没写"（仅团员端复现，团长端走 upsert 自动补行故正常）。改为 `insert ... on conflict do update`
- **错误吞噬（P0 根因②）** — `getTeamDataByMemberKey` 此前把 RPC 缺失 / 网络失败 / 密钥错误全部吞成"密钥无效"。新增 `Aoi.explainRpcError` 分类透出（RPC 不存在→提示重跑 schema；版本冲突→提示刷新；密钥无效→提示向团长确认），`member.enter` 补 try/catch
- **整 blob 覆盖竞态（P0 根因③）** — 写入 RPC 新增可选 `expected_updated_at` 乐观锁参数并返回新 `updated_at`；团员端 `Aoi.member.persist` 统一携带/更新版本号，冲突时清空本地版本并提示刷新
- **`supabase-schema.sql` 幂等升级** — 团员端两个 RPC 改为 drop 后重建（`create or replace` 无法变更签名，旧库重跑会报错），文件头附线上重跑验证清单与排查 SQL

### Added
- **QQ 机器人私聊推送** — 此前 `sendPrivate` 定义了但全链路无调用方，私聊功能实际不存在；新增 `Aoi.bot.pushPrivate`（按 `memberMeta` QQ 逐人私聊，返回成功/失败/未绑定清单），通知推送提供「群发(@) / 私聊 / 全部」三选；群发 @ 改为直接按 buyer→qq 映射，不再依赖 body 前缀格式
- **relay 转发节流** — NapCat 转发改串行队列，相邻两条间隔 ≥1s（批量私聊防风控）
- **relay https 校验** — https 站点下保存 http relay 地址直接拦截并说明原因（浏览器混合内容拦截）；设置页 placeholder 同步提示
- **团员端掩码回执** — 地址保存成功后显示掩码回执（首尾各 2 字 + `****`），确认"保存的确实是刚输入的"且不暴露原文
- **测试基建** — `package.json` + vitest + jsdom（`npm test`）；harness 将 index.html 装入 jsdom 并 eval `js/` 模块，首批 26 个用例覆盖 calc 换算、intl 分摊、错误分类、乐观锁 persist、私聊推送、掩码

### Changed
- `getTeamDataByMemberKey` 返回结构新增 `updatedAt`（数据版本），失败改为抛错（不再返回 null 吞错）

## v1.6.0 (2026-08-17)

### Added
- **每人应付国际费改版** — 表头改为 4 列（购买者 / 购买内容 / 国际金额 / 国内额外金额）；国内额外金额为每人手动可编辑字段（`payments[].domesticFee`），不参与国际费重算
- **全表导出图片** — 所有数据表新增「导出图片」按钮（html2canvas CDN，白底 PNG 下载）
- **全表行号** — 各数据表首列新增行号，方便核对行数

### Changed
- **表格可读性** — 表头底色 + 斑马纹（`tbody tr:nth-child(even)`）+ 点线行分隔，方便查行数

### Fixed
- 团员端提交动作（地址 / QQ 绑定 / 改圈名 / 凭证 / 收货 / 换囤货地）统一 try/catch 容错并 toast
- 催缴通知：已交费 / 待审核成员自动清除过期的未发催缴
- QQ 机器人群发改为 @ 提及（`[CQ:at]`，有绑定 QQ 者），替代逐条私聊
- `get_team_by_member_key` SQL 的 `member_key = member_key` 自引用歧义 → 表别名 + `limit 1`

## v1.5.1 (2026-08-16)

### Fixed
- **登录页下滑露出主体内容** — `#screen-app` 的 `md:flex` 在桌面端覆盖 `hidden`，导致主体常驻可见；改为 `flex`
- **建立我的团无任何效果** — `team_members` 的 `members_select` 策略自引用触发 `infinite recursion`，读团队/成员/数据全部失败；新增 `is_team_member`（security definer）替代自引用 EXISTS
- **建团/读团失败被静默吞掉** — `loadTeam` 不再把 `r.error` 当「无团队」，改为抛错并在 `enterApp` 里 toast 出真实原因

### Added
- **团名可修改** — 团长在「账号与设置」团队信息卡可改名（复用 `teams_update_owner` RLS，无新 RPC）

### Changed
- **部署密钥注入** — `js/config.js`（真实 anon key）已 gitignore，新增 `js/config.example.js` 模板；GitHub Actions（`.github/workflows/deploy.yml`）与 Netlify（`netlify.toml` + `scripts/build-config.js`）在部署时注入密钥

## v1.5.0 (2026-08-16)

### Added
- **批次命名** — 新建到货批次支持命名（可改名），可展开查看批次内活动
- **总览「开设 IP 一览」** — 列出所有 IP，点 IP 查看其活动，活动可跳转订单管理
- **删除 IP** — 清除该 IP 在订单/周边/活动/常用类型中的关联
- **类型筛选与大类折叠** — 按 IP 常用类型加模糊搜索；手动录入类型面板按发货线路分组可折叠
- **国际计算「保存分摊到订单」** — 分摊结果落库到每件商品（`orders.intlFee`）与每人待交国际运费（`payments.intlFee`），配合催缴通知
- **活动/订单联动** — 活动管理点击活动名跳转订单管理（按活动筛选）
- **买家（CN）管理** — 活动管理页新增买家列表（圈名 / 订单数 / 未处理完数），可手动删除；删除活动时自动清理无待处理订单的买家 CN

### Fixed
- 无法删除到货批次（各批次下拉未同步刷新）
- 国际计算器无法选择已创建的到货批次
- 活动管理无法查看已有活动（订单反推活动补全）
- 删除活动无效（`ensure()` 反推导致活动复现）

## v1.4.0 (2026-08-12)

### 🧭 项目方向
Aoi-system 从 mossasari fork 独立为完全独立仓库，聚焦**团长管理端**。团员端代码保留不再主动推进。

### Added
- **国际运费加权计算器** — 嵌入为独立 screen，按重量分摊国际运费
  - 实时计算面板（去皮总重、目标金额、差额、均价）
  - 可编辑表格（单重和加权费用可手动覆盖）
  - 从团购系统按团次导入商品，同商品数量按 CN 累加
  - 国际排发表 tab（按买家汇总清单、国际运费、打包费）
  - CSV 导出和复制表格
  - localStorage 持久化（`ifc_` 前缀隔离）
  - 独立仓库 [zhengdaode/intl-freight-calc](https://github.com/zhengdaode/intl-freight-calc)
- **P6 黑夜模式** — 全局切换按钮，57 条 CSS 覆盖，`prefers-color-scheme` 自动检测
- **P12 功能开关** — 云端可配置，`applyFeatureToggles` 统一控制
- **P15 自定义背景** — 纯色/图片背景 + 自动遮罩层
- **图片裁切** — Cropper.js CDN + `image-crop.js` 弹窗式裁切 UI
- **本地调试账户** — `test@test.com` / `test123`，绕过 Supabase 认证
- **P1 首次引导** — 首次访问自动弹出覆盖层，逐一说明功能入口

### Security
- 自定义确认弹窗 `showConfirmModal` 替换所有 `confirm()`
- 30 秒撤销机制（柄图删除和订单删除后可恢复）
- 交肾两步确认（提交前弹出摘要确认卡）
- 行内表单验证（blur 实时校验，空字段红框）
- 63 处 `innerHTML` 全部包裹 `escapeHtml()`
- 移除硬编码 Supabase URL/Key → 占位符
- 移除硬编码图床 API 默认值

### Changed
- **模块化拆分** — ~2900 行单文件 index.html → 11 个独立 JS 模块
- **仪表盘 tab 调整** — 国际运费 + 云端设置移至 tab 栏末尾
- **首页精简** — 移除计算器入口，仅在仪表盘显示（受功能开关控制）
- P2 云端设置信息过载 → 6 区块拆为 3 分组
- P3 对比度修复（11 处）+ 触控目标 36→44px

### Fixed
- CSP 阻止外部图床
- `initCloudData` 竞态条件
- XLSX 矩阵导入行偏移（fake header 导致数据下移一行）
- 图床上传 API 灵活适配
- `saveQueryKey` 模块拆分丢失
- Debug 模式刷新改为页面重载

### Docs
- CHANGELOG.md
- IMPROVEMENT_PLAN.md (P0-P24)
- CONTRIBUTING.md
- DESIGN.md, PRODUCT.md

---

## v1.3.0 and earlier

See git history for details prior to v1.3.0.
