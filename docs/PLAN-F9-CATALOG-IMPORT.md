# F9 · PCO 商品目录导入 + 补货监控 —— 实施计划 v3.2（v3.7.0 提案，待审核通过后实施）

> **版本号更正（2026-09-10，管理端第二轮 v3.7.0 实施时注）**：v3.7.0 已被「管理端第二轮迭代」（[docs/PLAN-v3.7.0.md](PLAN-v3.7.0.md)）占用并发布，本计划的交付版本号顺延为 **v3.8.0**；主仓库侧接口已在 v3.7.0 预留：`orders.ensure` 的 `d.pcoItems: []` 与 `activityMeta[].products` 可选 `price/priceOrig/currency/limit` 字段（即 §3「一键推入」目标结构，向后兼容）。
> v3 修订（2026-09-10，按负责人第二轮批复）：①手动导入**放弃书签脚本**，改为纯网页端形态；②定时监控评估并采纳 **GitHub Actions**；③按指令核查了仓库内的服务器部署权限记录并给出部署可行性判定（写入 §5 与 AGENTS.md）；④明确 v3.7.0 内容（§7）。
> v3.1 修订（2026-09-10，负责人追加确认）：手动导入主入口 = 只粘贴活动链接（经 Edge Function 转发 GitHub Actions 按需抓取，异步约 1–2 分钟）；富文本/文本粘贴降为兜底。见 §3 S1、§4 M2。
> **v3.2 修订（2026-09-10，两台服务器 SSH 实测后）**：工作机 47.101.194.103 **SSH 密钥不可达**（root/ecs-user/admin/ubuntu 均拒；relay :8080 在线），自用机 106.14.28.206 可登录但为 napcat+astrbot 自用机、内存仅剩 ~98MB，**承载不了 Chromium**（数据见 §5）。故负责人原定的「服务器为主、Actions 可选」前提不成立——**Actions 为主方案**；工作机 SSH 授权后即可升级为常驻同步形态（15–30 秒），Actions 降为兜底。
> v2 要点延续：数据源 = PCO 本体五要素（商品图/链接/名称/价格/限购）；LLM 完全舍弃（仅词典）；回流方向不开发（`import.js` 已覆盖）；小程序模板已解析（§2）。
> 技术边界（不变）：「忽略 PCO 对机器人的限制」以**真实浏览器执行站点自身 JS** 实现；不做验证码破解/指纹伪造/反检测对抗；低频（≥30 分钟）、单会话、不自动下单。剩余 ToS 风险由负责人知悉并承担。

> **实施记录（2026-09-10）**：主仓库侧（§3 S1–S5）已随 commit `2bed645` 交付并 CI 通过（含「工具 → PCO 目录」粘贴导入/词典翻译/校对工作台/模板导出/目录页，tests/catalog.test.js 18 例）。**监控 M1 实测否决自动化浏览器方案**（§9 三组对照实验）：PCO 风控对自动化 Chromium 一律「Restricted access」，监控载体待负责人拍板；正文 §0/§4/§5 中关于 Actions 可行性的表述已被实测修正。

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 只输入活动链接能否完成导入？ | **能，列为正式交付（v3.1）**：Aoi 目录页粘贴链接 → Edge Function 鉴权转发 `workflow_dispatch` → Actions Playwright 抓取该页五要素写库 → 刷新可见（异步约 1–2 分钟）。纯前端直抓不可行（CORS + PCO 对非浏览器请求 302 质询），必须经抓取服务；同步 15–30 秒形态可选 NapCat 机常驻（§5） |
| 手动导入能否不用书签脚本、纯网页端实现？ | **能（v1 即可用）**：主入口为「输入活动链接」（上行）；抓取通道未就绪或失败时，回落「打开链接 → Ctrl+A/C → 回 Aoi 粘贴」——富文本粘贴携带 `text/html`（含图片 URL、商品链接、名称、价格文本）解析五要素，另有纯文本正则兜底。书签脚本降级为可选加速器（P3） |
| 自动监控能否用 GitHub Actions？ | **能，且实测后确定为主方案**（服务器常驻前提不成立，见下行）：Playwright 官方支持 Actions（自带 Chromium），public 仓库免费；service key 存 Actions Secret；定时 cron 60 分钟 + 按需抓取（M2）。数据写 Supabase blob，通知先走应用内通知（`d.notifications`，今天已可用），QQ 推送待 F5 链路真机部署后接入 |
| 服务器常驻（同步化）是否可行？ | **当前不可行，工作机授权 SSH 后即可升级（2026-09-10 实测）**：工作机 47.101.194.103 SSH 密钥不可达、配置无法查询；唯一可登录的自用机 106.14.28.206 内存仅剩 ~98MB，承载不了 Chromium。解锁方式 = 在工作机为部署者公钥授权 → 部署常驻 monitor（同步抓取 15–30 秒 + 定时监控），Actions 降为兜底。详见 §5（已同步写入 AGENTS.md） |
| v3.7.0 是什么？ | 主仓库下一个功能版本 = F9 主仓库侧交付：PCO 目录页 + 粘贴导入解析 + 词典翻译 + 校对工作台 + 小程序模板导出（§3/§7）。监控是独立仓库 `aoi-pco-monitor`，不占主仓库版本号 |

## 1. 目标工作流 → 交付物映射

| 你的步骤 | 承载 |
|---|---|
| 手动：只输入活动链接 | Aoi 目录页粘贴链接 → 提交抓取 → Actions 按需抓取写库（约 1–2 分钟）→ 刷新即见五要素草稿；通道未就绪/失败时回落「打开链接+复制粘贴」 |
| 自动：监控新活动上架（开售前一天公布） | `aoi-pco-monitor`（GitHub Actions cron）扫新着列表 → 与 `d.pcoItems` diff → 新商品写库 + 应用内通知 |
| 自动：监控商品变动（补货/售罄/限购变化） | watch 列表状态 diff → `history` 记录 + 通知（补货为最高优先级） |
| 同步信息到网站 | monitor 直写 Supabase `team_data.data` blob 的 `d.pcoItems`，Aoi 打开即见 |
| 人工检查修改 | S3 校对工作台（中文名/分类/价格换算/限购/参考图/链接） |
| 生成小程序表格上架 | S4 按已解析模板生成 xlsx |
| 从小程序导出拼团情况回流 | 现有 `import.js` 已覆盖，不开发 |

## 2. 小程序导入模板（已实测解析 `D:\download\goods_import_template.xlsx`）

- Sheet 名 `Sheet1`，有效列 A–F；**第 1–6 行使用说明文字导出时原样保留**（模板注明勿删）；第 7 行表头；第 8 行起数据（自带示例行清空不带入）。
- 表头：`谷子分类（选填）｜谷子名称（必填）｜价格（必填）｜库存（选填）｜冻结（选填：是或否）｜采购状态（选填）`。
- 列映射：分类←词典匹配类型（空=小程序默认分类）；名称←校对后中文名；**价格←日元价×`d.calc` 汇率**（≤2 位小数，工作台逐条可改）；库存留空=不限；冻结默认「否」；采购状态默认「备货中」。

## 3. 主仓库 Aoi-system 交付（= v3.7.0）

新增 `js/catalog.js`（挂 `Aoi.catalog`）+ `js/catalog-dict.js`（品类/杂项词表）+ `js/species-zh.json`（PokeAPI 一次性预生成 `ja→zh-hans` 种名表入仓）；页面「工具 → PCO 目录」。

| 项 | 内容 |
|---|---|
| S1 导入（主入口：输入活动链接） | ①**链接抓取**：粘贴活动链接 → Edge Function `catalog-dispatch`（团长登录态校验，GH token 存函数 env）转发 monitor `workflow_dispatch` → Playwright 抓取写库，页面提示约 1–2 分钟后刷新；通道未点亮/失败时回落②③。②富文本粘贴（`paste` 事件 `text/html`：`<img src>`/`<a href>`/价格文本）；③纯文本正则兜底（`名称　X,XXX円` 逐行）；relay 直抓保留为尽力而为（当前必 302，报错分级）。统一产出 `d.pcoItems` 草稿 |
| S2 词典翻译（仅 L0，无 LLM/无在线机翻） | 中文名草稿 + 品类建议；品类词表 ~60 条 + 官方种名表 + 杂项词表（设置页可扩充，存 blob）；未识别片段高亮人工补 |
| S3 校对工作台 | 表格编辑：中文名/分类/价格（日元↔人民币换算）/限购/参考图（v3.6.1 图片弹窗，PCO 图链防盗链时一键转存图床）/PCO 链接；可一键推入活动 `activityMeta.products`（v3.6.0 S2 模型扩展可选 `price/limit`，向后兼容） |
| S4 小程序模板导出 | 按 §2 结构 SheetJS 生成 xlsx；文件名带活动名（`exportBaseName`）；测试读回断言（说明行/表头行/数据起始/示例不带入） |
| S5 目录页 | 展示 `d.pcoItems`（售况/限购/最后检查时间/watch 标记）；「立即检查」按钮 v1 隐藏（待 M5 dispatch 通道点亮） |

**数据模型**（blob 新增）：`d.pcoItems = [{ id, url, jpName, name, type, priceJpy, limit, image, status ∈ {在售,售罄,预约,终止,未知}, saleDate, watched, firstSeenAt, lastCheckedAt, lastChangedAt, history:[{at,from,to}] }]`。约 30 商品/活动，blob 增量可忽略。

**测试**：富文本/文本解析 fixtures（真实 DOM 快照脱敏）、词典映射、价格换算、模板读回断言、diff 逻辑；`tests/helpers/aoi.js` MODULES 按序插入 `js/catalog.js`。预估新增 40–60 用例。

## 4. 独立项目 `aoi-pco-monitor`（GitHub Actions 形态）

独立仓库（public，Actions 免费；Playwright 自带 Chromium 不依赖系统浏览器）。**主方案 = Actions 运行，不依赖任何服务器**——实测确认工作机 SSH 不可达、自用机内存不足（§5），服务器常驻同步形态调整为「待工作机 SSH 授权后的升级项」，不阻塞任何里程碑。

| 里程碑 | 内容 |
|---|---|
| M1 Actions 实抓验证 + 锚点锁定 | workflow 手动触发：Playwright 打开 PCO 新着页/详情页 → 验证 JS 质询在 Actions 环境（Azure 出口 IP）通过 → 锁定解析锚点（SFCC 商品数据通常在 DOM `data-*`/内嵌 JSON）。**此步是整个监控方案的前置验证**，若被风控拦截 → 备选：NapCat 机（106.14.28.206，SSH 可登录）部署同代码 |
| M2 抓取内核 + 按需抓取通道 | `grab` workflow（`workflow_dispatch` 传 urls 输入）：Playwright 逐链接抓五要素 → upsert `d.pcoItems`；Edge Function `catalog-dispatch`（Management API 部署，先例 qq-relay v5；GH token 存 env、团长登录态校验）→ 主仓库「输入活动链接」入口点亮（异步约 1–2 分钟） |
| M3 定时新活动监控 | cron 60 分钟（下限 30 分钟硬编码）扫新着列表 → diff `d.pcoItems` → 新商品/新発売日组写库 + `d.notifications` 应用内通知 |
| M4 变动监控 | watch 商品状态 diff：售罄→在售（**补货**，最高优先级）/在售→售罄/预约开启/限购数变动 → `lastChangedAt`+`history`+通知 |
| M5 通知与健壮性 | 通知先走应用内 `d.notifications`（今天可用）；QQ 推送待 F5 relay v4/NapCat 真机部署后接入；连续失败/解析失败告警；HTML 快照存 workflow artifact 供锚点修复 |

**维护注意**：public 仓库 scheduled workflow 60 天无活动会被 GitHub 自动停用——monitor 自身每周都有 run 即为活动；另在 README 记录「停用自查」一条。

## 5. 服务器实测记录与部署可行性判定（2026-09-10 SSH 实测，已同步 AGENTS.md）

负责人确认拥有两台服务器：一台自用（astrbot 等聊天机器人），一台用于本项目。实测结果：

| 机器 | 实测数据 | 判定 |
|---|---|---|
| **工作机** `47.101.194.103`（relay 所在；`GET :8080/` 返回 405，服务存活） | SSH **密钥不可达**：root / ecs-user / admin / ubuntu 均 `Permission denied (publickey,password)`（本机 ed25519 密钥未被授权；与 CHANGELOG v3.5.2「无法登录」记录一致）。**配置无法查询** | 常驻 monitor **当前不可部署**。解锁方式：负责人在该机为部署者公钥授权（`~/.ssh/authorized_keys` 或阿里云控制台绑定密钥对）→ 即可查询配置、部署常驻形态（同步抓取 15–30 秒 + 定时监控），Actions 降为兜底 |
| **自用机** `106.14.28.206`（hostname iZuf640ixbfb6be6sn5s3vZ；Ubuntu 24.04；**2 vCPU / 内存 1.6Gi——已用 1.5Gi、available 98Mi**；swap 2G 未动；磁盘 40G 用 32%；docker 跑 napcat + astrbot，Up 4 weeks / 12 hours） | SSH 密钥**可登录**（F5 待真机部署动作在此机执行） | ❌ **不部署 monitor**：内存余量 ~98MB 远低于 Chromium 需求（~300MB+），且为自用聊天机器人机不应挤占 |
| Supabase Edge Function | qq-relay v5 先例（Management API 免 SSH 部署）；无浏览器、禁子进程 | ❌ 不能跑抓取；承担 M2 的 `catalog-dispatch` 转发 |
| **GitHub Actions** | 仓库已有 Actions 基建；public 仓库免费；Playwright 官方支持 | ✅ **主方案**（M1 先验证 PCO 对 Azure 出口 IP 的风控） |

**同步化方案结论**：「监控网页变化 + 导入网页内容」的全部能力（定时新活动监控、补货 diff、按链接即时抓取五要素）在架构上都已就绪，唯一分歧是运行位置——Actions（当前可行，异步 1–2 分钟）vs 工作机常驻（体验最优，同步 15–30 秒，**待 SSH 授权**）。两者共用同一套抓取/解析/diff 代码，切换只是运行载体变化。

凭据纪律：服务器凭据/密钥不入仓库（AGENTS「密钥不进仓库」红线），本节只记录实测结论与授权缺口。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| Actions 出口 IP（Azure 数据中心）触发 PCO 更严风控 | M1 首项实抓验证；被拦 → 优先解锁工作机 SSH 授权转常驻部署（自用机内存不足不可用）；最坏回落手动粘贴链路 |
| PCO 改版锚点失效 | 锚点集中定义 + HTML 快照 artifact + 解析失败告警；粘贴导入在用户真实浏览器侧读所见 DOM，最抗改版 |
| 富文本粘贴解析因浏览器/站点结构差异缺字段 | 纯文本正则兜底 + 缺失字段留空由工作台人工补 |
| Actions cron 延迟/停排 | 60 分钟粒度对补货监控足够；README 停用自查条目 |
| 汇率波动 → 价格失真 | 默认 `d.calc` 汇率换算，导出前工作台逐条确认 |
| 频率失控 | 间隔下限 30 分钟硬编码、单会话、不做购买自动化 |

## 7. 版本切分（明确回答「v3.7.0 是什么」）

- **v3.7.0（主仓库，本计划主体）** = §3 全部：S1 导入（**输入活动链接主入口**——在 M2 通道点亮前显示「抓取通道未就绪」并回落粘贴 + 富文本/文本粘贴兜底）+ S2 词典翻译 + S3 校对工作台 + S4 小程序模板导出 + S5 目录页；新增 `js/catalog.js`/词典/种名表，blob 新增 `d.pcoItems`，测试 40–60 例。**监控不在 v3.7.0 里**。
- **`aoi-pco-monitor`（独立仓库，与 v3.7.0 并行开工）** = §4 M1→M5 顺序交付：M1 风控验证是前置；**M2 即点亮「只输入活动链接」**；M3 上线即有新活动监控价值，M4 补货通知为核心卖点。
- P2/P3 增强项（M5 一键抓取、书签脚本加速器）默认不做，需要时另批。

## 8. 与现有基建复用对照

| 现有能力 | 位置 | F9 复用方式 |
|---|---|---|
| 活动商品模型 `{id,type,model,refImage,refUrl}` | `d.activityMeta[活动].products`（`js/orders.js:1292`） | S3 一键推入，扩展可选 `price/limit` |
| 类型字典 `typeMeta` / 汇率 `d.calc` | `js/orders.js:17` / `js/calc.js` | S2 品类匹配 / S3·S4 价格换算 |
| SheetJS 导出 + `exportBaseName` | `js/core.js:148-247`、`:180` | S4 模板导出 |
| 图片三合一弹窗 | v3.6.0 S4 / v3.6.1 | S3 参考图与图床转存 |
| 应用内通知 `d.notifications` | F1 已建 | monitor 通知第一通道 |
| Supabase Edge Function 部署通道（Management API） | qq-relay v5 先例 | M5 dispatch 转发端点 |
| GitHub Actions 基建 | `.github/workflows/deploy.yml` | monitor 仓库 cron 载体 |
| 排谷表/汇总表导入 | `js/import.js` | 回流方向，已覆盖不开发 |

## 9. 实施记录与 M1 结论（2026-09-10）

**已交付（主仓库，commit `2bed645`，CI 绿）**：`js/catalog.js` + `js/catalog-dict.js` + `js/species-zh.js`（PokeAPI 官方种名 1025 条，`scripts/build-species-dict.js` 生成）+ 「工具 → PCO 目录」视图 + `tests/catalog.test.js`（18 例；全套 336 例绿）。粘贴导入（富文本三策略/文本正则）→ 词典翻译草稿（无 LLM，未识别高亮）→ 校对工作台（汇率换算/类型映射 `d.typeMeta`/经 `registerProduct` 同构推入活动商品）→ 小程序模板导出（说明 6 行 + 表头 + 数据，Sheet1）→ `d.pcoItems` 目录。链接一键抓取入口已预留（`d.catalogConfig.dispatchUrl`，通道就绪即点亮）。

**M1 实测：PCO 风控否决自动化浏览器**（监控仓 aoi-pco-monitor，grab workflow + 本地对照）：

| 实验 | 环境 | 结果 |
|---|---|---|
| Actions grab workflow | ubuntu-latest + Playwright headless Chromium（Azure 数据中心 IP） | ❌ 「Restricted access」，卡 `wr.` 质询页 |
| 本地 headless | 负责人 Windows + 家庭网络 + Playwright headless Chromium | ❌ 同样 Restricted access |
| 本地有头 | 同机同网络，`headless: false` 真实窗口 | ❌ 同样 Restricted access |
| （对照）curl 直取 | 非浏览器 HTTP 客户端 | ❌ 302 质询死循环（v1 实测） |

结论：拦截对象是「自动化浏览器」本身（Playwright 指纹/webdriver 特征），与 IP、headless 与否无关。负责人日常浏览器不受影响——**粘贴导入链路完全可用**；在计划边界内（不做指纹伪造/反检测对抗），**自动监控暂无可行载体**，monitor 仓定时抓取已暂停（保留 workflow_dispatch 复验入口）。

**待负责人拍板的监控载体选项**：
1. **维持人工粘贴**（现状可用，零风险）：日常浏览 PCO 时顺手整页复制粘贴；
2. **浏览器内脚本**（半自动）：Tampermonkey 用户脚本跑在负责人自己的日常浏览器会话里，PCO 页面一键提取→自动回填 Aoi——自动化发生在天然合法的会话内，不新建自动化浏览器；
3. **放宽边界**（需明确授权）：对自动化浏览器做常规去自动化特征处理（如 AutomationControlled 规避）——属于此前划定的「反检测对抗」红线，默认不做，负责人明确要求才立项；
4. **工作机真实会话**：SSH 授权解锁后在负责人 Windows 工作机以其真实浏览器配置定时驱动（CDP attach 真实 profile），同为边界灰色项，需拍板。

**后续实验与挂起记录（2026-09-10，负责人指示「暂时不考虑继续」）**：负责人批准放宽边界（授权对自动化浏览器做去自动化特征处理），已实现于 aoi-pco-monitor `monitor/grab.js`（`navigator.webdriver` 抹除 + 正常 Chrome UA + ja-JP/Asia-Tokyo 环境一致 + `CHANNEL` 可选系统真实浏览器）。追加三轮实验仍全部「Restricted access」：headless Chromium、`CHANNEL=msedge` headless、`CHANNEL=msedge` 有头。

**负责人判断「我的网络环境可能存在问题」，监控整体挂起。** 待验证假设：当前网络直连 PCO 可能本身不可达（日常访问或经代理）。**恢复条件**：①先用日常浏览器直接打开 PCO 搜索页确认可达性；②可达后按上述选项 1–4 择载体，手动触发 grab.yml（或本地 `URLS=… node monitor/grab.js`，`CHANNEL=msedge` 走系统 Edge）即可复验——去自动化版抓取代码已就绪。挂起期间：手动粘贴导入链路不受影响（已上线可用）；monitor 仓 cron 保持暂停。
