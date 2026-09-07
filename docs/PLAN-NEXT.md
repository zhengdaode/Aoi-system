# Aoi-system · 后续改进路线（新功能 × 后端）

> 2026-09-07 由定时审查任务产出：基于 v3.3.0 基线，全量阅读项目文档（AGENTS / ROADMAP / STATUS /
> ITERATION_LOG / CHANGELOG / README / CLAUDE / design / archive）与核心代码
> （supabase-schema.sql、relay/relay.js、supabase/functions、js/ 数据层与通知/团员端模块）后的规划。
> **状态：待批准** —— 批准后按「三、建议版本切分」逐版本实施；实施时遵循 AGENTS.md 工作纪律
> （每改动一个 commit、测试全绿才交付）。
>
> 优先级排序原则：**线上稳定性与数据安全 > 团长效率/自动化 > 团员自助体验 > 长期架构健康。**
> 约束假设：保持「无框架、无构建」；以 Supabase 免费档能力为限；`deploy` 冻结期间本计划不涉及上线操作。
> 注：审查期间基线有漂移——2026-09-07 晚 `ffb7d37` 合入了 Edge Function https 入口并清理临时隧道
> （QQ 链路定型），本文 B4 已按该事实修订为「定型后加固」清单。

---

## 0. 审查结论摘要

v3.3.0 的功能面已经完整覆盖「排单录入 → 到货分批 → 国际费分摊 → 交费审批 → 发货 → 团员自助查询」全流程，
工程化（测试 134 例 + CI 门禁 + 文档一致性）在同类个人项目中属高水准。当前最值得投入的不是继续堆功能，而是：

1. **数据安全没有兜底** —— 免费档无 PITR/自动备份，2026-09-06 已发生过一次整 blob 覆盖事故
   （ITERATION_LOG 第 6 轮，orders 34→0）；同类事故再发生时仍只能靠手工快照表抢救。
2. **团员密钥即全权凭证 + PII 随整 blob 下发** —— STATUS「已知限制」两条红线未动：
   任何持 member_key 者可读全员地址/QQ 原文、可整份覆盖团队数据（乐观锁只防误覆盖，不防恶意）。
3. **推送链路刚定型、尚余加固项** —— https 入口已于 2026-09-07 晚切换为 Supabase Edge Function
   （`ffb7d37`，本审查进行中合入；trycloudflare 临时隧道已删除、NapCat 已登录），但：Edge Function 内
   `UPSTREAM` 仍硬编码 ECS IP、推送无审计与长度上限、CSP `connect-src` 放行任意 https、
   NapCat WebUI 6099 未收紧、端到端推送验证待用户执行。

因此后端路线以「备份兜底 → 凭证/PII 收敛 → 链路定型」为主线；新功能路线围绕 PRODUCT.md 的成功标准
（团员不用反复问团长「我的单子到哪了」）做推送闭环与团员端可视化，而非新增大模块。

---

## 一、后端实现改进路线

### B1（P0）数据备份与 blob 历史版本 —— 事故兜底

- **问题**：`team_data` 只有一行当前值，无任何历史；免费档无 PITR。事故取证时只能靠当时的偶然快照。
- **方案**（三层，按成本递增）：
  1. **服务端历史表**：`team_data_history`（team_id, data, saved_at, source）+
     在两个写入口 RPC（`admin_save_team_data` / `update_team_data_by_member_key`）更新前 insert 旧值；
     定期清理只留近 30 天 / 每 team 100 份（pg_cron 或 Edge Function scheduled，免费档可用）。
  2. **前端一键备份**：设置页新增「下载全量备份（JSON）」，直接下载 `Aoi.state.data` +
     元信息（团名/版本时间）；「导入恢复」走现有确认弹窗 + 乐观锁写回。
  3. **仓库侧定时快照**（可选）：GitHub Actions cron + `scripts/sb.js` 每日把 blob 拉到加密 artifact。
- **验收**：写入 N 次后 history 表有 N 条旧版；可从 history/备份文件恢复；测试覆盖恢复合并逻辑。
- **工作量**：~1 天。**理由**：事故教训已固化成流程（"线上操作前先建快照"），但流程靠人记忆，兜底应进系统。

### B2（P0）团员密钥与 PII 隔离（分两阶段）

- **问题**：
  - `get_team_by_member_key`（supabase-schema.sql:177）返回整 blob，含 `d.addresses`（全员收件地址原文）、
    `d.memberMeta`（全员 QQ）；`update_team_data_by_member_key`（schema:211）允许团员整份覆盖任意字段。
  - 密钥熵量低：`substr(md5(random()::text), 1, 8)`（schema:146、665）= 8 个十六进制字符（约 32 bit），
    且读取 RPC 无频率限制，可被穷举。
- **Phase 1（低成本，v3.4.0 建议）**：
  1. 读 RPC 服务端剥离 PII：团员端拿到的 blob 去掉 `addresses`/`memberMeta`/`cnChanges` 的他人条目，
     只回该 CN 自己的数据（团员端本来只按 `buyer === CN` 过滤，前端改动极小）；
  2. 写 RPC 字段白名单：团员写入仅接受 `addresses[自己CN]`、`memberMeta[自己CN]`、
     `payments[].receipt/receiptDate`、`orders[].received`、`transfers[]`，其余字段以服务端现值合并——
     团员端再也无法（哪怕是误操作）覆盖管理端数据；
  3. 密钥强度升级到 `encode(gen_random_bytes(16),'hex')`（32 字符），旧密钥保留兼容、下次重新生成时生效；
     UI 提示团长「重新生成后将旧密钥作废」。
- **Phase 2（商用前门槛，v4.0.0 待定）**：地址/QQ/凭证拆 `member_pii` 独立表，行级隔离 `(team_id, cn)`，
  团员读 RPC 只 join 自己的行；blob 不再含任何 PII。
- **验收**：用团员密钥拉取 blob 断言无他人 PII；白名单外字段写入被忽略；现有 member 端 11 例测试不回退。
- **工作量**：Phase 1 ~1.5 天。**理由**：这是 STATUS 明文记录的两条已知限制，也是「商用前需拆表」的唯一硬门槛。

### B3（P1）管理端会话加固 + 审计日志

- **问题**：`admin_login`（schema:436）无失败次数限制（可无限爆破）；admin token 有效期 30 天且存 localStorage；
  多管理员共用一份 blob，出事无法回答「谁在什么时候改的」（第 6 轮取证靠全库人工穷举）。
- **方案**：
  1. `admins` 加 `failed_attempts int` / `locked_until timestamptz`，连续失败 5 次锁 15 分钟；
  2. 新表 `admin_audit_log`（admin_id, action, detail jsonb, at）：在 `admin_save_team_data` /
     `admin_*` RPC 内追加一行；写保存类动作记录体积摘要（如 orders 条数 before/after）而非全文，控制膨胀；
  3. 设置页（仅 super）提供审计记录查看 + 清理。
- **工作量**：~1 天。**理由**：v3 已有多管理员（super/admin），权限有了、可追责没有；成本极低。

### B4（P1）QQ 推送链路加固（入口已定型，收尾清单）

- **现状**：https 入口已于 2026-09-07 切换为 Supabase Edge Function 并线上验证
  （`https://blfzbrivtxjxlbhgabqi.supabase.co/functions/v1/qq-relay` → ECS:8080，commit `ffb7d37`；
  trycloudflare 临时隧道已全部删除，NapCat 已登录在线）。三选一的「定型」问题已解决，
  剩余为加固收尾：
- **收尾清单**：
  1. Edge Function 内 `UPSTREAM`（supabase/functions/qq-relay/index.ts:7）硬编码 ECS IP → 移到 function env；
  2. relay（或 Edge Function）加推送审计（谁/何时/私聊 or 群发/成功与否）与单条消息长度上限；
  3. CSP `connect-src` 收紧（netlify.toml:30 现为裸 `https:`，Edge Function 已定型，可改为
     `https://*.supabase.co` 加明确白名单域）；Netlify `/qqbot` 代理保留为备选路径（未启用）；
  4. NapCat WebUI 6099 收紧为仅本机（隧道已删，暴露面已小，仍建议收口）；
  5. 小修订：relay/relay.js:8 头注释仍写 pm2，线上实际是 systemd `qq-relay.service`（文档漂移）；
  6. 用户侧最后一步（见 STATUS）：设置页把 relay 地址换成 Edge Function 地址，端到端推送验证。
- **工作量**：~0.5 天。**理由**：推送是核心运营链路，定型后应尽快补审计与暴露面收口，防止回退到临时态。

### B5（P2）schema 版本化迁移 + 线上自检例行化

- **问题**：schema 靠「SQL Editor 一次性执行」，已两次因线上库与仓库 schema 不同步出故障
  （RPC 缺失、签名陈旧 → ITERATION_LOG 第 5 轮）。`scripts/sb.js` 已具备线上执行能力但没有版本概念。
- **方案**：加 `schema_migrations` 表（version, applied_at）；`supabase-schema.sql` 保持全量基线 +
  增量变更拆 `supabase/migrations/NNN-xxx.sql`；`scripts/sb.js` 扩展 `--migrate`（按序执行未应用脚本并登记）
  与 `--check`（RPC 存在性/权限/团队行存在性只读自检，输出健康报告）。
- **工作量**：~1 天。**理由**：把第 5 轮排障经验从「排查 SQL 注释」升级为可重复执行的工具。

### B6（P2）blob 治理 + 单团硬编码显式化

- **问题**：
  - `d.notifications` 随时间无上限增长（sync 只增，已发项仅手动清除），blob 持续膨胀、整份下发变慢；
  - `admin_get/save_team_data`、`admin_regenerate_member_key`、`admin_rename_team` 均为
    `select id from teams limit 1`（如 schema:635、670、689）——多团不可能，且若误建第二团会静默操作错团。
- **方案**：已发通知超 30 天自动清理；保存前检测 blob 体积超阈值（如 2MB）toast 警告；
  单团 RPC 由隐式 `limit 1` 改为显式校验（teams 行数 >1 时报错提示），为未来多团留出明确改造点。
- **工作量**：~0.5 天。

### B7（P3，可选）Supabase Storage 替代第三方图床

- **问题**：默认免费图床 `esaimg.cdn1.vip` SSL 已过期（STATUS 已知限制），凭证/收款码/合照三处上传依赖它。
- **方案**：建 public bucket + 随机对象路径，`image-upload.js` 增加 Supabase Storage 适配器并设为默认，
  旧图床保留为可配置回退。免费档 1GB 对凭证图足够。
- **理由**：消除一个「失效即功能不可用」的第三方依赖，符合 PRODUCT.md「不绑定付费服务、可替换」原则；
  优先级低是因为现有手动换 API 的方式尚可用。

---

## 二、新功能改进路线

### F1（P0）审批/到货自动通知闭环

- **现状**：通知 sync（js/notify.js）只自动生成「催缴」「发货」两类；审批通过/驳回、订单标记到货只改状态不产生通知，
  团员感知不到「钱到账没」「货到没到」，仍需团长手动转达。
- **方案**：审批标记已交/已驳回时、批次新建/订单标记到货时，复用 `Aoi.notify` 生成对应通知
  （新 type：`paid` / `rejected` / `arrived`），进现有推送三选（双通道/群/私聊）；address 类「仅管理员可见」策略不变。
- **工作量**：~0.5 天，纯前端 + 既有推送链路。**理由**：直接命中 PRODUCT.md 成功标准；链路全部现成。

### F2（P0）团员端订单进度时间线

- **现状**：团员看板订单表是平铺字段，进度要自己从「到货状态/交费状态/快递单号」多个区块拼出来。
- **方案**：我的订单卡片头部加状态链
  `已排单 → 已到货 → 交费(待交/待审核/已交/已驳回) → 已发货 → 已收货`，当前节点高亮；
  数据全部现成（`orders.status/batchId` + `payments.status` + `orders.shipped/received`），纯前端。
- **工作量**：~0.5 天。**理由**：成本最低、团员侧感知最强的一项。

### F3（P1）汇率自动获取

- **现状**：计算器汇率靠团长手动查手动填，忘了改就用旧汇率批量生成人民币价。
- **方案**：计算器页加「同步最新汇率」按钮，拉免费汇率 API（如 open.er-api.com）回填 JPY/KRW，
  手动值保留为回退与覆盖；CSP `connect-src` 增加对应域名。
- **工作量**：~0.5 天。

### F4（P1）一键备份/恢复 UI

- 与 B1.2 配套的设置页功能（下载 JSON / 导入恢复 / 显示距上次备份天数）。
- **理由**：B1 的服务端历史面向「能操作 Supabase 的人」，这个按钮面向普通管理员。

### F5（P2）QQ 机器人双向：查单与绑定

- **方向**：团员在群里 @机器人「查单」→ 私聊返回自己订单状态；或私聊 bot 发 QQ 号完成绑定（省去网页操作）。
- **前置**：relay 需升级为双向（接收 OneBot 上行事件 → 鉴权 → 写回 RPC），并要求 NapCat 事件上报配置，
  是 relay 迄今最大改造。建议在 B4 链路定型后再排期；先出低配版——通知正文附看板链接引导网页自助。
- **工作量**：低配版 ~0.5 天；完整双向 ~2–3 天。

### F6（P2）团期复盘统计页

- 总览只有待办四项。新增工具页：按活动/团期聚合订单数、金额（人民币口径）、币种分布、交费回收率、
  发货时效；按 IP 排行。纯前端聚合 `d.orders/activityMeta/payments`，结果可导出（复用 tableExport）。
- **工作量**：~1 天。

### F7（P3）黑夜模式 / 自定义背景移植

- `backup-before-cleanup` 分支已有 P6/P15 实现（STATUS 注明不在 v3 主线）；按需移植，无新设计成本。

### F8（P3）多团 / 商用化

- 依赖 B2 Phase 2 与 B6 的单团硬编码改造，是否走这条路取决于是否决定商用——**需要用户决策**，
  本计划只预留改造点，不做设计。

---

## 三、建议版本切分

| 版本 | 主题 | 内容 | 量级 |
|------|------|------|------|
| v3.4.0 | 数据安全兜底 | B1（历史表+备份 RPC）+ F4（备份 UI）+ B2 Phase 1（PII 剥离/写白名单/密钥升强）+ F1（审批/到货通知）+ F2（团员时间线） | ~3–4 天 |
| v3.5.0 | 链路加固与追责 | B4（推送审计 + UPSTREAM 移 env + CSP/6099 收尾）+ B3（登录防爆破 + 审计日志）+ F3（汇率同步） | ~2 天 |
| v3.6.0 | 治理与复盘 | B5（迁移版本化 + 自检）+ B6（blob 治理）+ F6（统计页）+ F5 低配版（通知带链接） | ~2–3 天 |
| v4.0.0（待定） | 商用门槛 | B2 Phase 2（PII 拆表）+ B7（Storage 图床）+ F5 完整双向 + F8 多团 —— 是否启动取决于商用决策 | 待评估 |

每个版本独立可交付、可回退（tag 锚点），实施顺序可在批准时调整；B 线与 F 线同版本内并行不冲突
（B 改 schema/RPC 与 data.js，F 主要改各业务模块与 index.html）。

## 四、明确暂缓（本期不做）

- **团员端独立项目**：PRODUCT.md 已声明「保留但不主动推进」，维持。
- **实时协同编辑（OT/CRDT）**：blob 模型下成本与收益严重失衡，乐观锁 + B1 历史表已够用。
- **框架化 / 引入构建**：违背项目「无框架、无构建」约束，orders.js 偏大（1383 行）通过既有模块约定继续拆分即可。

## 附录：本次审查证据索引

- 单团硬编码：supabase-schema.sql:635 / 670 / 689（admin_* 系 RPC `limit 1`）
- 密钥熵量与生成：supabase-schema.sql:146、665（`substr(md5(random()::text),1,8)`）
- 团员读整 blob 含 PII：supabase-schema.sql:177–198；写整 blob：schema:211–246
- 登录无防爆破：schema:436–462；会话清理随读放大：schema:375（verify 内 delete）
- 备份缺失与事故：docs/ITERATION_LOG.md 第 6 轮；docs/STATUS.md「数据事故记录」「已知限制」
- 隧道临时态已解除（2026-09-07 Edge Function 定型，commit `ffb7d37`）：supabase/functions/qq-relay/index.ts:7（UPSTREAM 硬编码待移 env）；netlify.toml:7–11（/qqbot 备选未启用）
- CSP 宽松：netlify.toml:30（`connect-src … https:`）
- relay 注释 pm2 漂移：relay/relay.js:8（线上为 systemd qq-relay.service，见 STATUS）
- 通知无上限增长：js/notify.js（sync 只增、clearSent 仅手动）
- 现状能力清单：README「功能全景」、CHANGELOG v1.4.0–v3.3.0、docs/ROADMAP.md、docs/design/PRODUCT.md
- 测试基线：2026-09-07 23:07 `npm test` 134/134 全绿（本计划产出前复核）
