# PLAN-C-SCHEMA-SPLIT — 方案 C：业务数据拆规范表（用户拍板直接实施）

> 2026-11-11 用户拍板：跳过方案 B，直接按 C（拆规范表）执行，迁移前先备份数据库与网页。
> 调研与 B/C 对照见 [REPORT-CONCURRENCY.md](REPORT-CONCURRENCY.md)。本文档为实施设计定稿。

## 〇、备份锚点（已完成，2026-11-11）

| 项 | 位置 | 内容 |
|----|------|------|
| 数据库快照 | 仓库外 `D:\AI works\aoi-backups\pre-c-migration-2026-11-11\` | teams.json（1 行）/ team_data.json（blob 全量，序列化 202,809 B）/ auth-users-summary.json（4 行）/ manifest.json（行数+SHA-256）/ blob-survey.txt（全键字段摸底） |
| 导出/校验工具 | `scripts/export-db-backup.js`、`scripts/verify-backup.js`、`scripts/survey-blob.js` | 经 Management API（同 sb.js 通道），重跑即得新快照 |
| 代码/站点锚点 | git tag `pre-c-migration`（= f71a184，已推送 origin） | GitHub Pages 站点即该 commit 产物，tag 即回退点 |

**回退总原则**：迁移后旧 `team_data` 行**只读保留、永不删除**——它就是迁移时刻的完整快照；
出问题把前端 `DATA_MODE` 开关切回 `'blob'` 即回到旧通道，零数据损失。

## 一、架构核心决策（保住「29 个模块不改」）

1. **服务端组装**：新 RPC `aoi_get_all(p_token)` 把全部新表**组装成与旧 blob 完全同构的 JSON**
   返回 `{data, updatedAt}`。前端拿到的对象形状不变 → orders.js 等全部业务模块**零改动**。
2. **前端 diff 同步引擎**：`js/data.js` 的 `saveTeamData(newData)` 内部改为
   「与上次基线深比较 → 生成变更集（每类 {upsert[], delete[]}）→ `aoi_sync(p_token, p_changes)`」。
   业务代码依旧「改内存对象 → saveTeamData」，感知不到下层已变行级。
3. **行 id 全部保留原形态**（`o_xxx`/`p_xxx`/`s_xxx` text 主键，不换 uuid）——前端撤销/引用/导出
   全在用这些 id，换 uuid 徒增映射风险。无 id 的行（buyers/trackings/entries/logs）迁移时生成 uuid。
4. **活动以名称引用**（orders.activity 等）——与现状一致，改名同步仍是前端既有逻辑
   （v3.28.0 三端同步）。`aoi_activities` 主键 (team_id, name)。
5. **复合结构用 jsonb、扁平集合拆行**：高频写的扁平集合（orders/products/paigu 排位/…）逐行拆
   （并发冲突面最小）；语义整体、低频写的复合结构（limitPlans 内容、batches 费用参数、
   settings 类 KV）保留 jsonb。这是「行级并发收益」与「工程量/回归风险」的平衡点。
6. **乐观锁退役**：行级 upsert 天然并发安全，残余同字段并发 = 后写覆盖（C 的既定语义）；
   `expected_updated_at` 整包锁只保留在旧 blob 通道（回退用）。
7. **Realtime 第二阶段**：先上 diff 同步（行为同现状：他人改动需刷新可见，但**不再保存失败**）；
   postgres_changes 订阅自动合并作为后续增强（v3.36.x 可选）。

## 二、表设计（blob 键 → 新表映射）

命名 `aoi_*`，全部带 `team_id uuid not null references teams(id)`。DDL 见
`supabase/migrations/002-c-schema-split.sql`（经 sb.js migrate 机制应用，幂等）。

| blob 键（规模@快照） | 新表 | 主键/唯一 | 备注 |
|---|---|---|---|
| activities[] (34) | `aoi_activities` | (team_id, name) | 数组顺序 = sort_order；列含 ip/status/buy_date/ship_date/ship_date_fuzzy/deadline/link/cover/remark/created_at/updated_at（现有 meta 全字段，nullable） |
| activityMeta[].buyers[] (0) | `aoi_activity_buyers` | uuid id | activity_id → 拆表后由名称关联（fk aoi_activities(team_id,name) on delete cascade） |
| activityMeta[].trackings[] (0) | `aoi_activity_trackings` | uuid id | 同上 |
| activityMeta[].products[] (319) | `aoi_products` | id text（保留 p_xxx） | type/model/name_orig/ref_image/ref_url/price/price_orig/currency/limit/stock/listed；unique(team_id, activity_name, type, model) |
| orders[] (309) | `aoi_orders` | id text（保留 o_xxx） | activity_name/ip/type/model/buyer/currency/price/price_orig/count/status/remark/batch_id/intl_fee/shipped/shipped_at/shop_order_id/shop_order_no/ai_aligned/sort_order |
| batches[] (5) | `aoi_batches` | id text | weights/manual_fees/target_amount jsonb/numeric（结构整体保留） |
| payments[] (47) | `aoi_payments` | id text | buyer/batch_id/intl_fee/domestic_fee/status |
| notifications[] (89) | `aoi_notifications` | id text | type/title/body/buyer/batch_id/date/sent |
| announcements[] (2) | `aoi_announcements` | id text | date/text |
| cnChanges[] (1) | `aoi_cn_changes` | id text | old_cn/new_cn/qq/status/date |
| pcoItems[] (40) | `aoi_pco_items` | id text | jp_name/name/type/type_suggest/url/image/price_jpy/price_cny/limit/sale_date/status/selected/watched/unmatched/first_seen_at |
| reservoirs[] (3, entries 79) | `aoi_reservoirs` + `aoi_reservoir_entries` + `aoi_reservoir_settlements` | id text / uuid / uuid | entries(order_id text 引用 o_xxx、side、added_at)；settlements 现无数据，按 PLAN-RESERVOIR 结构建 |
| paigu{活动:{slots{键:[排位]},log}} (93 排位, 131 日志) | `aoi_paigu_slots` + `aoi_paigu_logs` | id text（s_xxx）/ bigserial | slots 键 'type\|model' 拆 type/model 两列 + sort；logs(activity_name, at, text) |
| limitPlans{} (5) | `aoi_limit_plans` | (team_id, activity_name) | limits/items/remaining 等整体 jsonb（账号槽结构复合、低频写） |
| typeMeta{} (44) | `aoi_type_meta` | (team_id, type) | route |
| ips[] (6) | `aoi_ips` | (team_id, ip) | sort |
| memberMeta{} (2) | `aoi_member_meta` | (team_id, cn) | qq + extras jsonb |
| addresses{} (1) | `aoi_addresses` | (team_id, cn) | address |
| calc / botConfig / imgHost / ipTypes | `aoi_team_settings` | (team_id, key) | value jsonb（KV 统一，未来配置免改表） |
| （遗留空：products[]/warehouses[]/transfers[]） | 不迁移 | — | 顶层 products 已废弃（v3.7.0），warehouses/transfers 空数组；warehouses 若启用按 v3.x 逻辑补表 |
| shopUsers / shopOrders（blob 中尚无数据） | `aoi_shop_users` / `aoi_shop_orders` | uuid / id | 按 PLAN-F12 结构预建空表，shop RPC v3.36 适配 |

## 三、RPC 设计（security definer，复用现有 admin 鉴权）

| RPC | 职责 |
|-----|------|
| `aoi_get_all(p_token)` | 校验 admin token（复用 admin_verify_session）→ 读全部 aoi_* 表 → **组装成旧 blob 形状** `{data, updatedAt}` |
| `aoi_sync(p_token, p_changes jsonb)` | p_changes = 每集合 `{upsert:[行], delete:[id]}`（前端 diff 产物）→ 逐表 apply（WHERE team_id=… AND id=…，天然行级）→ 返回 `{ok, updatedAt}` |
| `aoi_member_get(p_key, p_cn)` | 团员端组装（复刻 get_team_by_member_key 的 PII 裁剪语义：addresses/memberMeta/cnChanges 裁到本人） |
| `aoi_member_sync(p_key, p_changes, p_cn)` | 团员端写入白名单（复刻 update_team_data_by_member_key 合并语义：仅本人地址/交费确认等） |
| shop 系 RPC 重写 | 读写 aoi_shop_* / aoi_products（橱窗）——v3.36 适配 |

## 四、前端改造面（唯一动点 = js/data.js）

- `Aoi.DATA_MODE`（config.js 生成）：`'tables'`（新）/ `'blob'`（旧，回退开关）。
- tables 模式：登录后 `aoi_get_all` 拉组装 JSON → 存深拷贝为**基线** →
  `saveTeamData(data)` 改为 diff(aoi._baseline, data) → `aoi_sync` → 成功后**更新基线**。
- 深比较：按集合 id 对齐后逐字段 JSON 归一化比较；对象类（activityMeta/paigu/limitPlans/…）按键对齐。
- **删除检测**：基线有、新数据无 → delete（业务「清理/移除」类操作天然覆盖）。
- debug 通道（localStorage）行为不变（本机开发/测试不受影响）。
- 团员端 `js/member.js` 与 `shop.js` 走各自 member/shop RPC（v3.36 切）。

## 五、阶段切分

| 阶段 | 内容 | 状态 |
|------|------|------|
| P0 备份与锚点 | 数据库快照（仓库外）+ git tag pre-c-migration | ✅ 2026-11-11 |
| P1 设计与迁移脚本 | 本文档 + `002-c-schema-split.sql`（DDL）+ `scripts/migrate-blob-to-tables.js`（blob→INSERT 生成器，dry-run 对账） | ✅ 本轮 |
| P2 建表（真库应用 DDL） | `sb.js migrate` 应用 002（幂等；空表零风险，旧通道不受影响） | ✅ 本轮 |
| P3 RPC + diff 引擎（v3.35.0） | aoi_get_all / aoi_sync + data.js DATA_MODE 切换 + 测试（含 tables 模式 mock 全量回归） | 待做 |
| P4 真迁移（v3.36.0，低峰执行） | 重跑备份 → `migrate-blob-to-tables.js --apply`（对账通过才继续）→ 前端 DATA_MODE=tables 发布 → 线上探针验证（登录/录入/保存/排位/导出） | 待做 |
| P5 团员端与商城切换 | aoi_member_get/sync + shop RPC 重写 + 切换 | 待做 |
| P6 Realtime（可选） | postgres_changes 订阅 + 前端字段级合并 | 待做 |

**P4 回退预案**：DATA_MODE 切回 'blob'（旧 team_data 行未被动过）→ 重发 Pages；
新表数据保留供排查。两通道并存期间**严禁**双写（blob 通道只读）。

## 六、风险与对策

| 风险 | 对策 |
|------|------|
| 组装 RPC 与旧 blob 形状有出入（字段名/缺省值/顺序） | P3 建「形状对拍」测试：c_get_all 输出 vs 备份 blob 深比较（键集合/类型/样例） |
| diff 引擎漏算删除/误判变化 | 对拍 + 全量业务测试（harness 798 例跑 tables mock）；上线前 dry-run 对账 |
| 迁移脚本丢数据 | 只对**备份 JSON** dry-run 出对账报告（行数+抽样字段），对账全绿才允许 --apply；apply 后再导一次快照互验 |
| 切换窗口期数据分叉 | P4 选择低峰窗口；切换后旧通道立即只读（config 开关），杜绝双写 |
| 团员端/商城断档 | 管理端切 tables 后团员端仍走旧 RPC 读 blob（只读视角，短期可接受）；P5 补齐后再切 |
