# PLAN-TYPESAFE — TypeSafe（Jev / System One）语义判断集成方案

> 状态：**待批准** —— 批准后按「四、版本切分」实施，遵循 AGENTS.md 工作纪律（每改动一个 commit、测试全绿才交付）。
> 起草：2026-09-22。基于对 catalog / import / orders / approval / shipping / notify / limits 与 Edge 部署链路的代码级摸底（缺口行号见第一节）。
> TypeSafe 是什么：System One 模型（旗舰 Jev）把语义判断做成编程原语——输入自然语言+应用状态，输出**带概率的类型化判断**（Choice 选一项 / Noul 是否概率 / Score 等级分），**不生成文本**，~150ms 级延迟。官方文档 docs.typesafe.ai；JS SDK 需 Node 20+（服务端），浏览器侧一律经本方案的 Edge 代理。

## 0. 五条集成纪律

1. **密钥只在服务端**。本项目是静态 SPA，`TYPESAFE_API_KEY` 放前端即泄漏——新增 Supabase Edge Function `typesafe-proxy`（Deno，直调 TypeSafe HTTP API），复用 `scripts/deploy-edge.js` 的 Management API 部署与 secrets 注入先例（qq-relay v8 通道已实测可用）。
2. **级联不回退**。每个增强点都是「确定性精确匹配优先 → TypeSafe 增强 → 人工兜底」三层；proxy 不可达/超时/报错一律静默回落现状行为，**任何现有功能不因它变差**（与 catalog「词典 → ChatGPT 手工」既有风格同构）。
3. **确定性优先**。计算（汇率/限购/分摊/统计）、权限、状态机不进模型；模型只做「选与判」。
4. **低置信升级人工**。判断只产生候选与置信度，一切落库动作经现有确认弹窗/校对工作台，**模型永不直接写库**。
5. **批量并行 + 缓存 + 预筛**。同 state 多问并行发出；判断结果按输入 hash 做会话级缓存；词典/正则预筛把送判条数压到最低（典型一次导入个位数）。

## 1. 现状缺口摸底（TypeSafe 候选切入点）

| # | 环节 | 现状 | 缺口 |
|---|------|------|------|
| G1 | PCO 词典翻译 | 归一化最长前缀匹配（js/catalog.js:41-77），未命中片段存 `unmatched[]` 红字（:491-493），只能人工改输入框 | 变体/略写/新词无判断力 |
| G2 | 品类→typeMeta | 精确→包含匹配，失败落「未分类」（js/catalog.js:84-93） | 同上 |
| G3 | AI 两步流程对齐 | url 严格相等 → jpName **一字不差**（js/catalog.js:351-356）；字差即重复行 | 语义等价判断缺失 |
| G4 | AI 表列序兜底 | 无表头时固定下标 jp=0,name=1,type=2,priceJpy=3,limit=4（js/catalog.js:176-196） | 列序变化即错位 |
| G5 | 表格导入模板识别 | 关键字定位「单价」行/「【团期】」/「昵称+总数」（js/import.js:111-186），模板稍变整体失败 toast | 列角色语义识别缺失 |
| G6 | 导入×商品主档 | `productFillFor` model→nameOrig trim+小写**严格相等**（js/orders.js:235-247）；未命中静默新建骨架商品（js/orders.js:120-131） | 写法不同即重复主档/回填失效 |
| G7 | 购买人身份 | buyer 原样入库，全链**严格相等**查询（js/import.js:26、84-85；js/member.js:231-234）；团员查无数据只提示「请确认 CN」 | 昵称变体→孤儿单，纯人工对账 |
| G8 | 快递单号 | 每行手输 `o.tracking`（js/shipping.js:50-64）；活动级 trackings textarea 按行 split 不关联订单（js/orders.js:1667、1682-1686） | 「这段话里的单号属于谁」零解析 |
| G9 | 到货录入 | `markArrived` 纯手工勾选（js/orders.js:1086-1124） | 打包表/到货清单无匹配预勾 |
| G10 | bot 指令 | 固定关键词指令，查单活动名子串过滤（独立仓库 aoi-qqbot relay 侧） | 口语/错字落空 |
| G11 | 交费凭证 | 团员交截图 URL，管理员人工看图比对 goods+intlFee（js/approval.js:96-118） | 需图像判断能力（Jev 图像支持未验证） |

## 2. 应用地图（T1–T10）

### P0a 现有功能增强 · 目录链路（v3.18.0）

**T1 词典未命中兜底（覆盖 G1+G2）**
- 触发：`addToDraft` 之后，仅对 `unmatched` 非空或类型落「未分类」的草稿条目批量异步送判（词典已覆盖的行不花钱）。
- 判断（一次请求多问并行）：state = {jpName, unmatched 片段, 种名词典预筛候选（前缀/包含 ≤20 条）, 活动已有类型集}；questions = {cn: choice(候选 ∪ 无匹配), type: choice(typeMeta ∪ 未分类)}。
- 应用：校对工作台中文名输入框下挂「AI 建议：xx [采纳]」；全表按 Choice 置信度降序排序（高置信排前）；采纳 = 填输入框（走现有人工通道），不自动落库。
- 降级：proxy 不可用 → 现状红字人工改；ChatGPT 两步流程原样保留为最终兜底。

**T2 AI 表对齐合并（覆盖 G3+G4）**
- 触发：两步流程第二表粘贴后，仅对按 url/jpName **精确匹配不中**的行送判。
- 判断：预筛（jpName 子串/编辑距离 ≤5 候选）→ Noul「同一商品？」。
- 应用：≥阈值 → 自动合并并在 toast 列清单（沿用 `Aoi.undo` 30 秒可撤销惯例）；中间带 → 草稿标「疑似重复」两行并排人工点选；<阈值 → 新行。列序兜底（G4）：表头映射失败时用列角色 choice 判断替代固定下标，仍失败回落固定下标。
- 收益：`AI_PROMPT` 里「日文原名一字不差」的硬约束放开——ChatGPT 转述/复制走样不再产生重复行。

### P0b 现有功能增强 · 导入链路（v3.19.0）

**T3 表格模板识别（覆盖 G5）**
- 触发：仅当 `parseMatrix`/`parseRecords` 失败或缺关键列时（不是每次导入都跑）。
- 判断：state = {表头行 + 每列前 3 个样本值, 已知别名集 RECORD_ALIASES/LABEL}；每列 choice(buyer/model/price/count/type/无关) + 整表 choice(矩阵式/记录式/未知)。
- 应用：结果作为列映射参数喂回现有解析器；仍失败回落现状 toast「未识别到订单数据」。

**T4 商品主档语义对齐（覆盖 G6）**
- 触发：`productFillFor` 未命中时；候选 = 活动主档内预筛（子串/编辑距离 ≤10）。
- 判断：choice(同款 ∪ 无匹配)。
- 应用：命中 → 回填并在导入确认弹窗标「已对齐主档（语义匹配）」；中间带 → 「疑似同款」候选列表人工点选；无候选 → 现状自动登记骨架（开关可关）。防止重复主档静默膨胀。

**T5 购买人归一（覆盖 G7，本轮摸底新发现的高价值缺口）**
- 触发：导入/录入 buyer 时；候选 = `memberMeta` 圈名 ∪ 历史买家（相等/包含/去表情符号/首字符预筛 ≤10）。
- 判断：Noul「同一人？」。
- 应用：高置信 → 自动归一写入 canonical 名，原值存新字段 `o.buyerRaw` 保留追溯；中间带 → 确认弹窗「麻酱 ≈ 麻酱丶？」单选/保留原样；低置信 → 现状原样入库。
- 存储：blob 内新字段，**零 schema 改动**。

### P1 新功能（v3.20.0）

**T6 快递单号智能关联（覆盖 G8）**
- 入口：发货页新增「粘贴识别」textarea。
- 流程：正则预抽单号串（确定性）→ TypeSafe 只判归属：state = {单号上下文文本片段, 未发货订单候选(buyer/model/batch)}；每单号 choice(归属订单 ∪ 未知)。
- 应用：预填表格人工确认后走现有 `setShipped`（含自动私发排发表链路不变）。活动级 trackings 存档框保留。

**T7 到货清单核对（覆盖 G9）**
- 入口：订单管理「标记到货」旁新增「粘贴清单预选」。
- 流程：粘贴打包表/到货清单 → 行级 choice(对应勾选订单 ∪ 未知) → 预勾选 `markArrived` 集合人工确认。
- 与 T6 共用「抽取 → 归属 → 预操作 → 人工确认」前端组件。

### P1 已有服务增强（aoi-qqbot M8，主仓库可先行）

**T8 bot 意图路由（覆盖 G10）**
- 主仓库 Edge（typesafe-proxy 内）加 `/bot-intent`：choice(意图: 查单/我的快递/团况/绑定/解绑/我是谁/帮助/其他) + choice(活动名, 候选=现有活动列表)。
- aoi-qqbot relay 侧关键词精确命中优先（现状逻辑不动），未命中才调用；Edge 通道已通（v3.15.1 实测 v8 生效），**不依赖 SWAS relay 解冻**，可分阶段交付。

### P2 条件成立再做（挂起）

- **T9 PCO 补货监控变更判断**：F9 M1 的复活路径——负责人本地 runner 抓到新旧列表 → Noul(是否补货/价格变动) → 通知。前提 = 本地机方案拍板（PCO 按 IP 信誉拒绝数据中心段的结论不变）。
- **T10 交费凭证核验（G11）**：凭证是截图 URL、无文本申报字段，依赖 Jev 图像能力（**未验证，先探针再定**）。顺带：「同一凭证 URL 重复提交」检测是确定性的，不需要 AI，可先行独立交付。

### 明确不做

汇率换算（F3）/ 限购计算器 / 国际费分摊 / 复盘统计（纯计算）；登录/权限/审批状态机（安全要确定性）；通知与审批文案生成（System One 不生成文本）；限购重分配（金额贪心 + 30 秒撤销人工兜底已够）。

## 3. 架构增量

```
浏览器 js/typesafe.js（批量并行 / 15s 超时 / 静默降级 / 会话缓存）
   │  POST {state, questions}   （admin token 随附）
   ▼
supabase/functions/typesafe-proxy/index.ts（Deno.serve）
   │  admin_verify_session 校验 · 限频 · TYPESAFE_API_KEY = function secrets
   ▼
TypeSafe HTTP API（docs.typesafe.ai/api）
```

- 部署复用现有部署器：`node scripts/deploy-edge.js typesafe-proxy --secret TYPESAFE_API_KEY=...`。
- CSP 无需改动（netlify.toml connect-src 现为 `https:`；Pages 侧无此头）。
- 零 schema 改动：新字段（`o.buyerRaw` 等）全部在 blob 内。
- 新模块 `js/typesafe.js` 加入 `tests/helpers/aoi.js` MODULES；判断的预筛与应用逻辑全部纯函数化进 vitest，网络层 mock 测超时/降级/缓存。
- 设置页加总开关（默认开，关闭即全站回到现状）。

## 4. 版本切分

| 版本 | 内容 | 量级 |
|------|------|------|
| v3.18.0 | 基建（typesafe-proxy + js/typesafe.js + 设置页开关）+ T1 + T2（catalog） | ~1.5 天 |
| v3.19.0 | T3 + T4 + T5（import/orders） | ~2 天 |
| v3.20.0 | T6 + T7（发货/到货新功能） | ~2 天 |
| aoi-qqbot M8 | T8（主仓库 Edge 端点可先行交付） | ~1 天 |
| 挂起 | T9 / T10（待前提成立） | — |

每版本独立可交付、可回退；T1–T7 全部零 schema 改动。

## 5. 校准与验收

- **基准集**：万圣节 40 件真实目录（词典命中/未命中已有人工标注史）+ 真实排谷表/汇总表若干份。T1/T2/T5 的置信度阈值在基准集上实测后再定（TypeSafe 官方要求 thresholds evaluated on the user's data，不用 demo 阈值）。
- **验收口径**：① 基准集上未识别行/重复行/错误归一的下降幅度；② 关停 proxy 后全流程回归现状无异常；③ `npm test` 全绿 + 每个判断的预筛与应用逻辑有用例；④ 成本抽查：一次典型导入的送判条数（预期个位数——词典已覆盖绝大多数）。
