# Aoi-system · 迭代改进日志（2026-09-06 审阅轮）

> 本日志记录 2026-09-06 对 v2.0.0 的审阅与多轮改进，每轮一个独立 Git commit
> （含当时全部项目资产，可随时 checkout 回退），并附回退方式。
> 十项问题主迭代（v1.7.0–v2.0.0）的变更见 CHANGELOG.md 与各版本 tag。

## 回退方式

```bash
git tag                       # 查看所有版本锚点
git checkout <tag|commit>     # 查看某状态（只读）
git revert <commit>           # 撤销某一轮改进
git reset --hard <tag|commit> # 整体回退到某状态（谨慎，会丢弃其后的提交）
```

| 锚点 | 说明 |
|---|---|
| `v1.7.0` / `v1.8.0` / `v1.9.0` / `v2.0.0` | 十项问题主迭代四个版本（tag 指向对应 commit） |

---

## 第 0 轮 · 状态写入与版本锚点

- **改动**：`docs/STATUS.md` 头部重写为 v2.0.0 状态速览（含待线上操作清单：重跑 schema / 重新部署 / relay 重启）；新建本日志；为 v1.7.0–v2.0.0 四个版本打 git tag。
- **目的**：固化当前状态，明确"明早测试 Supabase"前需要做什么。

## 第 1 轮 · 修复回归：周边表单 previewRmb 引用悬空（审阅发现）

- **问题**：v1.8.0 重写录入逻辑时删除了 `Aoi.orders.previewRmb` 函数，但 `index.html` 周边（预建商品）表单的 `pCurrency` / `pPrice` 仍引用它 → 录入周边价格时控制台报错、无预览。
- **改动**：
  - `js/orders.js`：恢复通用 `previewRmb(priceId, currencyId, outId)`（周边表单保留自动预览；订单表单已改用 v1.8.0 的 `previewEntry` 双模式，互不影响）。
  - `tests/orders-entry.test.js`：新增回归测试（周边表单两个元素引用的函数存在且可执行）。总用例 62，全绿。
- **教训**：删除公共函数前应全仓 grep 引用（本次主迭代遗漏了 index.html 内联 onclick 的引用方式）。

## 第 2 轮 · CI 质量门禁 + 部署前测试

- **改动**：`.github/workflows/deploy.yml` 部署前增加 `npm ci && npm test` 步骤——测试不通过则不部署。
- **目的**：把"交付前测试全绿"的工作纪律固化为 CI 强制约束（对应 AGENTS.md 注意事项第 2 条）。

## 第 3 轮 · 文件结构重组（仅移动，不删除任何文件）

- **改动**（`git mv`，内容零变更，历史保留）：
  - `DESIGN.md` / `DESIGN-claude.md` / `PRODUCT.md` → `docs/design/`（根目录只留 README / CHANGELOG / CONTRIBUTING / AGENTS / CLAUDE 五个高频入口文档）
  - 同步更新 `AGENTS.md`、`CLAUDE.md`、`README.md`、`docs/ROADMAP.md` 中的路径引用。
- **待检查清单（暂不删除，明早确认后处理）**：
  - `DESIGN-claude.md`（内容为 Claude 官网风格分析，与本项目视觉关联弱，建议明日确认后归档或删除）
  - `node_modules/` 中遗留的 `playwright` / `playwright-core`（无 package.json 声明，疑似历史残留）

## 第 4 轮 · README 重写 + CONTRIBUTING 同步

- **改动**：`README.md` 全量重写（产品概述 / 功能全景 / 架构 / 部署 / 团员侧升级 / 测试 / 结构 / QQ 机器人 / 安全）；`CONTRIBUTING.md` 项目结构章节同步 16 模块现状。

---

## 第 5 轮 · 线上 Supabase 升级与排障（与部署者实时协作）

- **过程**：指导部署者在 SQL Editor 重跑 `supabase-schema.sql` → 触发并解决三个线上实际暴露的问题：
  1. **SQL Editor "destructive" 警告**：源自 `drop function/policy if exists`，属预期，确认继续即可。
  2. **老库重跑回滚风险**：`create policy` 不支持 IF NOT EXISTS，二次执行报 "policy already exists" 并整体回滚 → 为全部 7 条 RLS 策略补 `drop policy if exists` 守卫（commit `1a11bf3`），整文件自此真正可重复执行。
  3. **42702 参数二义性（线上实测触发）**：`update_team_data_by_member_key` 的 plpgsql 参数 `member_key` 与列同名，裸引用报错（commit `af0c0c5`）。
- **连带发现安全漏洞**：`get_team_by_member_key` 为 language sql，列名优先于参数名 → `where t.member_key = member_key` 恒为真，**任意密钥可读第一个团队**。两函数一并改为 plpgsql + `#variable_conflict use_variable`（参数名不变，前端无需改动）。
- **验证 SQL 签名修正**：`has_function_privilege` 按签名精确匹配，写入 RPC 加第三参数后旧两参数检查报 42883（commit `f68f460`/`4983cfd`）。
- **结果**：写入探针 `probe_written = true`，写入链路线上验证通过。

## 第 6 轮 · 数据覆盖事故与取证（重要事故记录）

- **事故**：2026-09-06 05:33，生产站（Netlify，仍为旧版前端）某个持有陈旧内存态的标签页触发整 blob 覆盖，`cyberbutter` 团数据被数周前旧快照覆盖——orders 34 → 0。这正是 v1.7.0 修复的"整 blob 覆盖竞态"在旧前端的现场复现。
- **恢复**：部署者经备份表还原，orders 回到 32（09:28）；当前数据已双备份（线上快照表 `team_data_bak_20260906b` + 本地 `backups/team_data_snapshot.json`）。
- **取证结论**（经 `scripts/sb.js` 全库穷举 + auth.users/leader_data 的 user_id 归属确认）：
  - 注册账号共 4 个：owner（zhengxinyang@outlook.jp）、两名真实使用者（2360690621@qq.com、1214023897@qq.com，仅在 8/10-8/12 活跃于旧版系统）、一个当天注册未使用的账号。
  - `leader_data`（旧版单表模型）数据归属铁证：`ICGPClick` 12 条 = 使用者 2360690621@qq.com 的**真实订单**（Zaboll/gamin 等，买日本/买中国两批次）；`123456+` 16 条 = owner 本人的测试数据；1214023897 的数据行为空（录入从未保存成功或未录入）。
  - **不可恢复项**：团员端提交的收件地址/QQ 绑定/付款凭证（当时的保存缺陷导致从未落库）；8 月 16 日后录入的任何数据（blob 冻结证明写入全部失败）。免费版无备份/PITR，服务端无其他副本。
- **教训（已固化为流程）**：① 生产与测试共用库 + 旧前端未更新即测试 = 事故配方，测试站必须独立 Supabase 项目或仅用 debug 账号；② 任何线上操作前先建快照表。

## 第 7 轮 · v3 账号系统实施（已批准方案落地）

- **提交**：`b536949`（schema：admins/admin_sessions + 14 个 admin_* RPC，已经 `scripts/sb.js` 应用于线上并验证）→ `33df5d3`（前端登录/初始化/管理员管理 + data.js token 读写 + relay 鉴权切换）→ `6cac3ee`（文档）。
- **tag**：`v3.0.0`。
- **状态**：代码与 schema 均已上线；等待部署者首次打开网站初始化超管，并重启 ECS relay（`pm2 restart qq-relay`）。
- **测试**：75 用例全绿（新增 admin-auth 13 例，harness 补载 auth.js/team.js）。

## 第 8 轮 · v3.4.0 团员读 RPC 42703 线上事故（当夜引入，次日修复）

- **现象**：团员端进入报「读取团队数据失败：column "k" does not exist」。触发面 = **新前端**（携带 p_cn 调用
  `get_team_by_member_key`）——origin 推送后 CI 自动部署了 zhengdaode 仓库 Pages，访问即踩中；
  旧生产前端（p_cn 为空，走剔除分支）不受影响。
- **根因**：B2 Phase 1 重写该 RPC 时，QQ 映射分支 `select k ... from jsonb_each(...)` 与两处
  `jsonb_object_agg(k, v)` 用了缩写别名——`jsonb_each` 返回列名为 `key`/`value`，`k` 在计划期即报 42703。
- **为何两道防线都失守**：
  ① 昨夜线上探针只覆盖 p_cn 空路径与写路径，**带 p_cn 的读取分支零覆盖**；
  ② schema 守护测试把带 bug 的文本 `jsonb_object_agg(k, v)` 断言成了「正确答案」——测试锁死了错误。
- **修复**：`fcb7512`（k→key 三处 + 守护改锁 key/value 写法并禁止缩写别名）→ sb.js 重跑 schema →
  **逐分支**线上验证：CN 路径（解析「阿狸」，addr/meta 键集合空=零泄露）、QQ 映射（qq→「道德」）、
  p_cn 空回归（无泄露）、写路径回归（版本号更新 + history 自动存档）。
- **教训（固化为流程）**：① RPC 新增/修改的**每个执行分支**都必须有线上探针（本轮事故分支恰好是唯一没探的）；
  ② 守护测试不得从实现文本「抄答案」——应断言语义不变量（列名、白名单、上限），写完后先人为反证一次
  （把断言反转，确认测试真能抓坏实现）。

## 第 9 轮 · 2026-09-10 复盘：F5 RPC 积压入库 + S7 漏提交补正（当晚审查发现）

- **背景**：当晚（09-09 23:00 → 09-10 03:45）主仓库 24 commit / aoi-qqbot 3 commit（F9 计划六连迭代、
  v3.6.2 表头排序、v3.6.3 F10、v3.7.0 S1–S8 及收尾），推送后复盘发现两处流程缺口。
- **发现一：F5 的 3 个机器人 RPC 积压一日余未入库**。`df8a45f`（09-09 00:43）把
  `member_lookup_by_qq` / `team_summary_for_group` / `unpaid_members_by_group` 合入 schema 文件，
  但线上库一直没应用——QQ 侧功能整体不可用却无人察觉（因为没有依赖方上线，属于"静默缺口"）。
- **处置**：经 `scripts/sb.js` 探针确认缺失 → 建快照表（`team_data_bak_20260910` / `teams_bak_20260910`）
  → 重跑全量 `supabase-schema.sql` → 逐项探针（anon EXECUTE ×3、团况聚合字段与 deadline 恒 null、
  催缴名单+settings 白名单、查单未绑定返 null、orders 74 条完好）。
- **发现二：v3.7.0 S7 漏提交 index.html**。`5c810c8` 只提交了 js/css，流式宽度的 HTML 改动
  （去 max-w 上限 + `data-lowpri`）留在工作区未入库——已部署版本缺该部分，靠当晚整体复盘比对
  HEAD 与工作区才发现，补提交 `a231354`。
- **教训（固化为流程，已写入 STATUS「下一步目标」）**：
  ① 改 `supabase-schema.sql` 的提交必须**随提交即应用线上 + 逐分支探针**（sb.js 零依赖可用，无借口积压）；
  ② 每个里程碑提交后 `git status` 必须干净再进下一项——提交信息说"已完成"不等于改动真的全部入库；
  ③ 多人/多会话并行同一工作区时，收尾方必须做一次「git log 自 23:00 以来」式的全量盘点（本次即靠它抓出两处缺口）。
