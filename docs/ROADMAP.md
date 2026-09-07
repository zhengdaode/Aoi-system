# Aoi-system · 新项目计划（2026-09）

> 来源：2026-09-06 用户实测反馈的 10 项问题，经代码探查后整理为可执行任务。
> 本文档是当前唯一有效的路线图；v1.4.0 时期历史归档见 `docs/archive/IMPROVEMENT_PLAN.md`。
> 当前基线版本：v3.3.0（CHANGELOG）。v1.7.0–v2.0.0、v3.0.0、v3.2.0 均已实施完成；下方 P0 修复任务 checkbox 已按实际完成情况勾选（溯源见 ITERATION_LOG）。

---

## 工作纪律（每个版本必须遵守）

1. **每次改动完成后，必须创建一个对应的 Git commit**，以便后续追踪和回滚。
2. **每次改动完成后，必须编写或更新相关测试，并在交付给用户前，确保所有测试和验证全部通过。**
   （项目当前无测试基建，v1.7.0 的第一个任务即建立测试框架，此后所有改动遵循本条。）

---

## 任务总览

| # | 用户问题 | 对应版本 | 状态 |
|---|----------|----------|------|
| 0 | 团员侧线上无法跑通（排障 + 修复，含问题 1） | v1.7.0 | ✅ 线上已验证（写入探针通过；排障中发现并修复 get 密钥校验漏洞与 42702 二义性，见 ITERATION_LOG 第 5 轮） |
| 1 | 团员提交的信息（QQ 绑定、地址等）无法保存 | v1.7.0 | ✅ 线上已验证（写入探针通过） |
| 2 | QQ 机器人 @ 与私聊完全不可用 | v1.7.0 | ✅ 代码修复完成（私聊链路补全 + relay 节流 + https 校验），待实测 |
| 3 | 外币价格：录入取消自动转换 → 订单管理批量生成；保留外币原价可查 | v1.8.0 | ✅ 完成 |
| 3-附 | 录入页非人民币两种勾选模式；制品类型面板内快捷新建 | v1.8.0 | ✅ 完成 |
| 10 | 录入页购买者多行换行 = 同款订单批量导入 | v1.8.0 | ✅ 完成 |
| 6 | 订单管理缺编辑/备注；表格换行折叠、贴边 | v1.8.0 | ✅ 完成（贴边随 v1.9.0 全站 UI 继续调整） |
| 5 | 加权国际单价与均价合并、缺目标金额差值 → 恢复 + 悬浮仪表盘 | v1.9.0 | ✅ 完成 |
| 7 | 活动管理缺购买人/备注/快递单号/模糊出荷日期 | v1.9.0 | ✅ 完成 |
| 4 | 全站响应式 UI 修订（表格间距、手机/电脑适配） | v1.9.0 + v2.0.0 | ✅ 完成（间距压缩、移动端 sticky/贴边、订单表卡片视图） |
| 8 | 新工具：限购产品账号购买计划计算器 | v2.0.0 | ✅ 完成 |
| 9 | 表格图片导出 + 表格文件下载铺开到主要场景 | v2.0.0 | ✅ 完成（12 张表双按钮，xlsx/CSV 回退） |
| — | 文档清理修订 + AGENTS.md + CHANGELOG（每版本随做，最终汇总） | 每版本 | 进行中 |

---

## P0 · 团员侧线上故障分析（先于一切功能开发）

### 现象

线上 Supabase 环境下多次测试，**团员侧均无法跑通**（进入看板 / 提交保存不可用）；团长端功能正常。

### 根因分析（按代码证据与可能性排序）

**1.【确凿 · 保存静默丢失】`update_team_data_by_member_key` 只更新、不插入。**
`supabase-schema.sql:200` 的写入实现是 `update team_data set data = ... where team_id = ...`。若该团队在 `team_data` 表中没有行，这条 update 影响 0 行，函数**仍然正常返回 void**——前端 toast 显示"保存成功"，但数据什么都没写进去。而团长端写入走 `Aoi.saveTeamData` 的 `upsert`（`js/data.js:58`），行不存在会自动插入。这精确解释了"团长端正常、只有团员端存不上"。这是问题 1 的第一嫌疑。
→ 修复：RPC 改为 `insert ... on conflict (team_id) do update`。

**2.【确凿 · 错误吞噬】所有失败一律显示"密钥无效"，排障不可能。**
`Aoi.getTeamDataByMemberKey`（`js/data.js:135`）对 RPC 结果只做 `if (r.error || !r.data) return null`，`member.enter` 据此统一 toast"密钥无效"。RPC 不存在、网络错误、密钥为空、真密钥错误——全部同一表现，导致"多次测试均无法跑通"却查不到原因。
→ 修复：错误分类透出（RPC 缺失 / 网络失败 / 密钥无效分别提示，并给出操作指引）。

**3.【高可能 · 线上 RPC 缺失或版本陈旧】**
`get_team_by_member_key` / `update_team_data_by_member_key` 是后期加入 `supabase-schema.sql` 的；该文件设计为"在 SQL Editor 一次性执行"，但**线上库若在旧版 schema 上建立且从未重跑**，两个 RPC 根本不存在 → 团员端读取即失败（又因根因 2 表现为"密钥无效"）。另注意：`create or replace function` **不能变更函数返回类型**，若线上曾存在旧签名版本，重跑脚本会在该语句直接报错、函数保持旧版——需先 `drop function` 再建。
→ 修复：schema 脚本改为幂等安全版（必要时先 drop），并在部署说明中写明"线上库必须重跑"。

**4.【中 · 覆盖竞态】整 blob 覆盖写导致"改了又没了"。**
团员每次提交 = 把内存中的整份数据 blob 写回（密钥即授权、无版本控制）。若团长端此后触发 `notify.sync` 自动保存、或另一端基于更早的数据保存，团员刚写入的内容被整份覆盖。`docs/STATUS.md` 已记录此已知风险。
→ 修复：`team_data.updated_at` 乐观锁——RPC 增加可选 `expected_updated_at` 参数，不匹配时报"数据已被他人修改，请刷新重试"；前端保存成功后回读校验。

**5.【低 · 环境相关】**
- `teams.member_key` 为 NULL（旧团队从未生成密钥）→ get RPC 查 0 行返回 null → 显示"密钥无效"。团长需在设置页重新生成密钥后测试。
- 开发机残留 `localStorage.aoi_debug_team` 且输入密钥恰为 `DEMO` 时，保存走本地 localStorage 而非 Supabase，造成"成功"假象。

### 线上排查清单（动手改代码前先执行，确认基线）

浏览器侧：团员端输入密钥时打开 DevTools → Network，观察 `/rest/v1/rpc/get_team_by_member_key` 请求：
- **404** 或 400 带 `Could not find the function` → 根因 3（RPC 不存在）；
- **200 但响应 body 为 null** → 密钥不匹配或 `teams.member_key` 为空（根因 5）；
- **请求根本没发出** → 前端配置/网络问题。

Supabase SQL Editor（按序）：

```sql
-- ① 两个 RPC 是否存在、签名是否与仓库一致
select proname, pg_get_function_arguments(oid), pg_get_function_result(oid)
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('get_team_by_member_key', 'update_team_data_by_member_key');

-- ② anon 角色是否有执行权限（两列都应为 true；注意 update RPC 是三参数签名）
select has_function_privilege('anon', 'public.get_team_by_member_key(text)', 'EXECUTE') as read_ok,
       has_function_privilege('anon', 'public.update_team_data_by_member_key(text,jsonb,timestamptz)', 'EXECUTE') as write_ok;

-- ③ 团队密钥是否为 null、与测试输入是否一致
select id, name, member_key from teams;

-- ④ team_data 行是否存在（根因 1 的直接判据）
select team_id, updated_at from team_data;

-- ⚠️ ⑤ 写入探针会整份覆盖业务数据！仅测试库执行，或先备份：
create table team_data_bak_20260906 as select * from team_data;
select public.update_team_data_by_member_key('<团员密钥>', '{"__probe":1}'::jsonb);
select data ? '__probe' as probe_written from team_data;   -- false = 踩中根因 1
update team_data set data = (select data from team_data_bak_20260906 where team_id = team_data.team_id); -- 还原
drop table team_data_bak_20260906;
```

### 修复任务（编入 v1.7.0）

- [x] `supabase-schema.sql` 升级：写入 RPC 改 upsert；`update_team_data_by_member_key` 增加可选乐观锁参数；脚本保证在旧库上可安全重跑；文件头写"线上库重跑验证清单"。（v1.7.0；线上已重跑并验证，见 ITERATION_LOG 第 5 轮）
- [x] `js/data.js`：RPC 错误分类透出（缺失/网络/密钥无效），`getTeamDataByMemberKey` 不再吞错误。
- [x] 保存后回读校验：写成功后再 select 一次确认关键内容落盘，否则报错提示重试。
- [x] 团员端保存成功显示掩码回执（地址 `***` 尾 4 字 / QQ 尾 4 位），消除"没保存"错觉。
- [x] 部署说明（README + AGENTS.md）补充线上 schema 升级步骤。

---

## v1.7.0 — 修复版：团员侧排障落地 + QQ 机器人 + 测试基建

1. **测试基建**（工作纪律第 2 条的前提）：新增 `package.json`（`npm test` → vitest + jsdom）与 `tests/`；harness 以 jsdom 加载 `js/*.js` 注入 `window.Aoi` 后对纯逻辑断言。首批覆盖：calc 汇率换算、intl 分摊/加权/差值、blob 保存校验逻辑。
2. **P0 团员侧修复**：见上节任务清单。
3. **问题 2 QQ 机器人**：
   - `js/bot.js`：`sendPrivate` 目前**从未被调用**（私聊链路实际不存在）；新增 `pushPrivate(rows)` 按 `memberMeta[cn].qq` 逐人私聊；通知推送提供"群发(@) / 私聊 / 全部"三选；修正 CQ:at 生成（不再依赖 body 前缀，按 buyer→qq 映射生成）。
   - `relay/relay.js`：批量私聊加节流（每条间隔约 1s，防 NapCat 风控）。
   - 设置页：relay 地址 https 校验 + 混合内容拦截提示（CSP `connect-src` 不允许 http）。
   - 已知问题记录：~~`CLAUDE.md` 所述 `enabled=false` 占位与实际链路状态需在修复时同步文档~~（已于 v3.3.0 同步）。

**验收**：`npm test` 全绿；debug 模式冒烟（团员进入/保存/QQ 推送逻辑分支）；commit。

---

## v1.8.0 — 订单录入 / 订单管理改版（问题 3、6、10 + 类型快建）

1. **数据模型**（blob 向后兼容，`js/orders.js` 加 `migrateOrder`）：订单新增 `currency`（'CNY'|'JPY'|'KRW'…）、`priceOrig`（外币原价）、`remark`（备注）。旧数据视为 CNY。
2. **问题 3 · 录入页**：取消自动换算。选非人民币时出现两个单选：
   - 模式一「直接输入外币价格」：人民币栏留空；
   - 模式二「计算器计算」：输入外币价 → 按当前汇率公式实时预览外币价 + 人民币两行（仅预览）；入库时两个价都存。
3. **问题 3 · 订单管理**：与批量删除同排新增「批量生成人民币价」：选中订单 → 弹出公式输入（默认 `汇率×加价`，可当场修改）→ 立即回填当前页显示，可撤销（复用 undo 快照机制）；表格新增「外币原价」列（CNY 显示 —）。
4. **问题 6**：每行新增「编辑」（弹窗改 type/model/price/count/remark）与「备注」列；表格样式：单元格自动换行增高、超 2 行折叠 + 展开、表格拉通屏幕边界。
5. **类型快建**：类型选择面板顶部加「＋ 新建类型」行内输入（选线路后即建即选，写 `typeMeta`）。
6. **问题 10**：录入页购买者改 textarea，回车换行 = 多个用户，提交按行拆分逐人生成同款订单（逐行校验、汇总成功/失败）。

**验收**：测试（公式回填、外币字段迁移、多行拆分、备注/编辑写入）全绿 + 冒烟 + commit。

---

## v1.9.0 — 国际计算 + 活动管理（问题 5、7、4 第一批）

1. **问题 5**：`js/intl.js` 表格拆两列——均价列（只读展示）与加权单价列（可编辑/手动覆盖，交互同 v1.8 的公式微调）；顶部统计行显示 `总额 − 已分摊` 正负差值；新增**悬浮仪表盘**（fixed 右下角悬浮卡，可收起）：进度条插值显示 `已分摊/目标金额`、差值、总重，表格滚动时常驻可见。
2. **问题 7 · 活动管理**：新增字段——购买人信息组（购买人 + 购买账号(邮箱) + 送达地址，支持多人多行）、备注列、快递单号区（可「＋添加一行」的多行输入，存 `trackings[]`）、出荷日期支持模糊选项：`x月上/中/下旬`、`x年春/夏/秋/冬`、`x年第1/2/3/4季度`（存 `shipDateFuzzy`，可与精确日期并存）。
3. **问题 4 第一批**：全站表格规范——压缩单元格水平 padding、移动端 `overflow-x-auto` + 首列 sticky、容器贴边（去除双重大 padding）。

**验收**：测试（分摊差值、模糊日期解析/排序）全绿 + 冒烟 + commit。

---

## v2.0.0 — 新工具 + 导出 + 响应式收尾（问题 8、9、4 第二批）

1. **问题 8 · 限购购买计划计算器**（工具页新增，与计算器并列）：
   - 输入：选活动（展示该活动所有商品种类与排单数量）、批量设限购数、每单包邮金额、可用账号数、每账号最大购买种类数（空 = 不限）；
   - 算法：贪心装箱——按单价降序，优先凑满包邮线，受限购数/种类数约束；输出每个账号的购买清单（商品×数量）、金额、距包邮差额；未分配完的提示剩余。
   - 结果可导出表格（XLSX/CSV）与图片。
2. **问题 9**：封装 `Aoi.tableExport`（图片 = html2canvas 已有；文件 = SheetJS 已在 CDN，导出 .xlsx）；给订单管理、国际计算、活动管理、审批/交费、发货管理、限购计划等主要表格统一加「导出图片 / 下载表格」双按钮。
3. **问题 4 收尾**：三档断点审查（≥1280 / 768–1279 / <768），移动端长表格提供"卡片列表"可选视图；导航抽屉与视图切换复测。

**验收**：测试（限购分配算法含约束/边界用例）全绿 + 冒烟 + commit。

---

## 文档修订（随版本推进 + 最终汇总）

- [x] 新建 `AGENTS.md`：工作规范 + 注意事项 + 计划索引（本次 commit）。
- [x] `docs/IMPROVEMENT_PLAN.md` 标记为历史归档（v3.3.0 起移至 `docs/archive/`），指向本文件。
- [x] 每个版本完成时：更新 `CHANGELOG.md`。
- [x] 最终汇总：`docs/STATUS.md` 更新至 v2.0.0（实际已远超，现跟踪至 v3.3.0）；`README.md` / `CONTRIBUTING.md` 的项目结构同步为 16 模块现状（v3.3.0 完成）；`DESIGN-claude.md` 并入 `DESIGN.md` 后删除（未做——DESIGN-claude.md 保留，暂不合并）。

---

## 后续迭代

- **v3.0.0 账号体系重设计**（已完成）：见 `docs/archive/PLAN-AUTH-REDESIGN.md`。
- **v3.2.0 第二批实测反馈**（2026-09-06 已实施完成）：Excel 导入识别本站导出表格、限购计算器（活动下拉修复 + 包邮金额币种 + 外币原价列）、活动购买人/账号/地址搜索下拉、订单表桌面端 UI 重设计（视口内滚动/吸顶表头/首列吸附/列宽治理）、导出图片行选择——根因、任务与验收见 `docs/archive/PLAN-v3.2.0.md`。
- **v3.3.0 冗余清理与重构**（2026-09-07 已实施完成）：死代码/死 DOM 删除、重复实现合并（批次下拉×4 / 剪贴板 / CSV / 币种符号）、隐私快照清理（backups/）、测试 106→134、文档一致性修正。
- **下一轮计划（2026-09-07 起草，待批准）**：v3.3.0 基线审查后的「新功能 × 后端」双路线规划——见 `docs/PLAN-NEXT.md`。
