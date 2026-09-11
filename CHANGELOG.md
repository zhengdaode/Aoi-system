# Changelog

## v3.11.0 (2026-09-12)

> **数据信任 + B6 治理**——管理端保存失败从「静默丢失」变为强提示；通知/blob 治理（B6）落地；
> 单团硬编码显式化。schema 改动已随提交经 sb.js 应用线上 + 探针。

### Fixed（数据信任）
- **管理端保存失败强提示**：`saveTeamData` 此前失败只抛错，orders 29 处调用仅 3 处 try（且非保存用途）——断网/乐观锁冲突/会话过期时是无提示的 unhandled rejection，「以为存了其实没存」（与 09-06 事故同体验黑洞）。现保存失败在 data.js 统一 toast（网络异常明确提示「本次改动未上传」）后照旧抛错，全部调用方一次修复；已有 catch 的调用方最多双重提示、可接受。
- **`notify.sync` 不再完全静默**：异常 console.warn 留痕 + 每会话一次轻提示（自动同步高频触发，避免刷屏）。

### Added（B6 blob 治理）
- **通知治理**：`notify.prune`——已发超 30 天自动清理 + 总量上限 500 条（超限按「已发优先、组内最旧优先」裁剪）；sync 时顺带执行并落库。此前 notifications 只增不减，blob 无限膨胀。
- **blob 体积预警**：保存时检测整包 >2MB toast 警告（每会话一次），提示清理数据。
- **单团显式化（schema）**：新增 `assert_single_team()` 守卫（teams >1 行时显式报错），替换 admin_get/save_team_data、admin_list_team_data_history、admin_regenerate_member_key、admin_rename_team 与 F5 三个 RPC 共 9 处 `limit 1` 硬编码——误建第二团不再静默操作错团。线上探针：守卫返回唯一团 id、F5 RPC 走守卫后正常。

### Tests
- 396 → 406 例全绿：新增 `tests/v311-trust.test.js` 10 例（保存失败 toast/抛错/成功无噪音、2MB 预警一次性、sync 失败标记与单次提示、prune 三态：30 天清理/上限裁剪/正常保留、schema 守卫：守卫函数 + 10 处引用 + 硬编码防回潮）。

## v3.10.0 (2026-09-12)

> **安全止血**——全量复审产出的高优漏洞治理：p_cn 空值整份覆盖后门封堵、管理员登录防爆破、
> escapeHtml 引号转义 + URL 协议白名单（存储型 XSS 双修）、v2 账号体系（邀请码/team_members）
> 归档移除。**schema 已随提交经 sb.js 应用线上 + 逐分支探针**（写前快照 `team_data_bak_20260912`
> / `teams_bak_20260912` / `team_members_bak_20260912` / `admins_bak_20260912`）。

### Security
- **团员写入「空 p_cn 整份覆盖」后门封堵（高）**：`update_team_data_by_member_key` 原「p_cn 为空 = 旧版客户端兼容桥」允许任何持密钥者省略 p_cn 绕过整个白名单、整份覆盖 blob（含他人地址/QQ）——与 2026-09-06 数据事故同模型。现 p_cn 缺失/空/超 64 字符一律拒绝；现役前端写入必带 p_cn，线上探针确认拒绝路径无副作用（版本号/数据/历史表全不变）。`data.js explainRpcError` 新增对应中文映射（旧页面被拒时提示刷新）。
- **admin_login 防爆破（B3 前半，高）**：`admins` 表新增 `failed_attempts` / `locked_until`；连续失败 5 次锁 15 分钟，成功登录清零——此前 anon 可无限暴力破解管理员口令。
- **escapeHtml 补引号转义（高）**：原实现经 textNode 只转义 `& < >`，`value="…"/href="…"/title=` 等属性插值点可被含 `"` 输入突破属性边界注入事件；改为字符串替换式五字符转义（文本节点渲染结果不变）。
- **新增 `Aoi.safeUrl` URL 协议白名单（高）**：仅放行 http/https（含 `//` 协议相对与站内相对路径），`javascript:`/`data:` 等一律空串。写入侧接入：团员付款凭证（`submitReceipt`——此前 `javascript:` 凭证可存库并被团长点击，存储型 XSS 主向量）、商品参考图/跳转链接（`registerProduct` 统一入口 + `saveActProduct` 行内编辑）、活动平台链接（`setActivityField`）、囤货地收款码、发货合照；渲染侧兜底旧数据：团员看板参考图/链接/凭证、审批凭证、发货合照、囤货地收款码、活动商品卡、PCO 目录（`pcoItems` 可被外部监控仓直写，渲染侧必须白名单）。

### Removed（v2 账号体系归档——经核实现役前端零调用）
- **邀请码方案与 v2 Supabase-Auth 成员体系退役**：`team_members` 表、`create_my_team` / `join_team_by_code` / `regenerate_invite_code` / `regenerate_member_key`(auth.uid 版) / `is_team_member`、`teams.owner_id` / `teams.invite_code` 列、6 条成员 RLS 策略全部移除（线上已收敛删除，历史值在 `*_bak_20260912` 快照表；被归档代码见 git 历史 v3.9.5 及更早 tag）。`teams`/`team_data` 保留 RLS 且无策略 = RPC 之外全拒绝；schema 自此零 Supabase Auth 依赖。
- **`admin_bootstrap` 首次初始化自动建团**（v2 建团函数归档后的补位）：全新部署此前无任何建团路径（会卡死在「尚未创建团队」）；存量库已有团队不受影响。

### Tests
- 382 → 396 例全绿：新增 `tests/v310-security.test.js` 14 例（escapeHtml 引号/属性突破失效、safeUrl 白名单放行与拒绝、凭证/商品/活动链接/收款码写入清洗、schema 守护——桥封堵防回潮 + 防爆破列与逻辑 + v2 归档防回退）；`member-pii.test.js` 守护同步（兼容桥断言反转为「不得存在」、128bit 密钥函数计数 2→1）。

## v3.9.5 (2026-09-11)

> **粘贴导入图片保留**——v3.9.4 ChatGPT 工作流把页面全文交给 AI 后图片/链接丢失的修正。零 schema 改动。

### Fixed
- **两步导入、按「日文原名」对齐合并（顺序无关）**：① PCO 页整页复制**先直接粘贴**——富文本商品卡照旧带出商品图/链接/价格/限购（词典翻译出建议名）；② ChatGPT 回复表格**再粘贴**——`addToDraft` 对齐键放宽（任一方缺链接时按 `jpName` 对齐，不再只认「无 url 项」单向匹配），AI 中文名/类型**覆盖**词典草稿建议、清掉未识别高亮，图片/链接/价格/限购以页面数据为准保留；两步先后顺序可互换，均不产生重复行。
- **识别逻辑兼容 ChatGPT 渲染表格**：在 ChatGPT 页面上直接复制表格（剪贴板为 text/html `<table>`）粘进导入框也可解析——新增 `Aoi.catalog.parseAiHtml`（DOM 表格还原为管道行 → `parseAi`，表头无 AI 关键字时返回 null 继续回落商品卡解析）；`importPaste` 解析顺序改为 纯文本 AI 表 → HTML AI 表 → 富文本商品卡 → 纯文本行。

### Changed
- **提示词修正**：明确「不需要图片列——图片/链接由系统从页面直接粘贴自动带出」「日文原名为对齐关键，必须与页面文字一字不差」；粘贴导入卡文案改为两步工作流说明。

### Tests
- 377 → 382 用例全绿：页面先/AI 后合并（图片保留 + AI 译名覆盖词典 + unmatched 清除）、AI 先/页面后（对齐不重复 + 图片回填）、parseAiHtml、富文本 <table> 粘贴合并、提示词断言。

## v3.9.4 (2026-09-11)

> **导出提速（图片→表格）+ 汇总表外币原价 + PCO 导入 ChatGPT 翻译工作流**。零 schema 改动；`js/plan-export.js` 原地重写。

### Changed
- **购买清单导出：图片方案 → 表格方案（v3.9.0 PNG 方案废除）**——实测逐账号 canvas 生成太慢。`js/plan-export.js` 重写为 `buildWorkbook` 纯函数：整个限购计划导出为一个 xlsx，**每个账号一个 Sheet**；版式沿用原图片方案（顶部账号名大字标题 + 逐商品行），列为 **参考图（exceljs 通道转 base64 内嵌图片，失败回落链接）/ 商品名（外文原名，nameOrig → pcoItems 回查 → 型号兜底）/ 型号 / 外币单价 / 件数 / 外币小计** + 合计行（件数与按币种分组的外币合计）；渲染复用 `exportSummary.renderExcelJS/renderPlain`（renderExcelJS 改为返回写入 promise，exportAll 以 loading 包裹）。外币价解析：商品主档 `priceOrig/currency` 优先 → 订单外币原价均价（`limits.productsForActivity` 同源）。
- **导出入口**：限购计划结果区「导出购买清单表（每账号一个 Sheet）」；活动管理展开区新增「导出购买清单表」按钮（`data-act-planexport` 委托）+ 购买计划弹窗同款按钮。**单账号「导出清单图」按钮与 `data-plan-export` 委托删除**（不再提供单账号导出）。
- **侧边导航**：「PCO 目录导入」自「工具」组移入「业务」组，与「信息录入」**并列**（两者实为重叠功能）；工具组保留计算器/限购计划。

### Added
- **汇总表新增「外币原价」列（与 RMB 金额同地位）**：①采购表购买人子表由 4 列扩为 5 列（购买人/购买金额(¥)/**外币原价**/购买总数/实际购买总数），商品矩阵右移至 F 列起，需求总数行 C 列顺势承载日元总计；②每活动【活动名】汇总买家矩阵新增外币原价列（A=金额/B=外币原价/C=昵称/D..=商品矩阵）；口径均为逐件 qty×外币原价均价按币种累加，多币种以 `+` 连接，缺数据 `—`。
- **PCO 导入接入 ChatGPT 翻译工作流**：新方案 = PCO 页 Ctrl+A/Ctrl+C → 粘贴给 ChatGPT（用页面「复制翻译提示词」按钮一键复制的 `Aoi.catalog.AI_PROMPT`：固定列 Markdown 表格输出，命名遵循本系统「型号=简短中文名+类型独立列」逻辑，宝可梦物种用常见官方译名，品类词与 catalogDict 同源）→ 回复表格贴回导入框。`Aoi.catalog.parseAi` 解析器（Markdown 管道表/TSV、表头关键字映射列、无表头按固定列序兜底、代码围栏/加粗/千分位容错），`addToDraft` 支持 AI 中文译名/类型直入（词典翻译降为无 AI 兜底）；UI 提示词可复制、可展开查看。

### Tests
- 370 → 377 用例全绿：v394-plan-table-export（buildWorkbook 版式/名称链/外币价链/合计行、exportAll 接线与兜底、按钮入口、单账号按钮移除）9 例；catalog parseAi/草稿直入/copyPrompt 6 例；v370/v390 汇总测试同步新列布局并补外币原价断言。

## v3.9.3 (2026-09-10)

> 导出链路可用性修复：实测「导出的 Excel 仍只有图片超链接」「list 点导出图片没反应」的根因治理。
> 检索佐证：SheetJS CE 不支持内嵌图（[官方文档](https://docs.sheetjs.com/docs/api/write-options)、[issue #2330](https://github.com/SheetJS/sheetjs/issues/2330)）；
> jsDelivr 自 2022-05 起大陆被 DNS 污染/SNI 阻断（[jsdelivr #18407](https://github.com/jsdelivr/jsdelivr/issues/18407)），实测本机对该域名返回**伪造证书**。

### Fixed
- **GitHub Pages / 本地环境的参考图内嵌与购买清单图真实可用（三处断点全打通）**：
  ① 前端 `imageCandidates` 拉图候选链接入**已部署的 Edge `/fetch` 通道**（v3.5.2 起它只服务链接导入，图片拉取一直没接——Pages/本地唯一已部署代理路径）；
  ② 线上 qq-relay Edge 函数 `/fetch` 白名单由硬编码单主机扩为共享四主机表（+PCO 主站/esaimg/img.cdn1.vip），经 Management API **重新部署生效**（version 6；实测 `GET /fetch/img.cdn1.vip/…` → 200 image/png + ACAO=\*，非白名单仍 403，原有 POST 机器人链路零改动）；
  ③ 新增 `scripts/deploy-edge.js`（Management API 部署器，免 CLI/SSH；实测教训：bundle 接口 metadata 字段为 `entrypoint_path`，PATCH 通道只改配置不更新代码）
- **端到端实测（本地 Chromium）**：真图上传图床 → 候选链（直连无 ACAO 失败 → /media-\* 本地 404 → **Edge 200**）→ 导出的 xlsx 内含 `xl/media` 图片文件、toast「参考图已全部内嵌」；购买清单图 `loadImage` 装载 369×800 真图。Edge 通道就绪后，ECS relay 重部署不再是内嵌功能的前置条件

### Added
- **第三方组件库本地自托管（`js/vendor/`）** —— supabase-js@2.116.0 / xlsx@0.18.5 / exceljs@4.4.0 / html2canvas@1.4.1 改同源加载，index.html 不再引用 cdn.jsdelivr.net（该 CDN 抽风曾致「导出图片没反应」、Excel 回退无图通道、甚至登录不可用）；升级方法见 `js/vendor/README.md`（经 npm registry 官方 tarball，不经 jsdelivr）
- `Aoi.promiseTimeout` + 导出图片 30s 超时 + loading 遮罩——html2canvas 遇挂起外域图不再无限 pending（此前 toast 一闪即逝、观感"点了没反应"），超时/失败均显式 toast

### Tests
- 362 → 370 用例：Edge 候选链（配 relay 四通道 / 无 relay 三通道 / 非白名单仅直连）、index.html 去 jsDelivr + vendor 接线与文件存在性、promiseTimeout 三态；全套全绿

## v3.9.2 (2026-09-10)

> **商品元数据「原名」+ 参考图转存自有图床 + 万圣节订单统一**（宝可梦万圣节活动数据治理）。**零 schema 改动**（`nameOrig` 为商品主档可选扩展字段）。

### Added
- **商品元数据「原名」（原语言名称）**：商品主档新增可选 `nameOrig` 字段——`registerProduct` 建档/重复合并两路落库、目录「一键推入」自动携带 `pcoItems.jpName`、活动管理商品卡展示原名行；购买清单图片导出的名称解析链改为 **nameOrig 优先 → pcoItems 回查 → 型号兜底**。
- **汇总表内嵌支持 webp**：esaimg 图床存储会自动把上传图转 webp（exceljs 不支持），`fetchImageBase64` 对 `image/webp` 经 `<img>`+canvas 解码重编码为 JPEG 后内嵌（非浏览器环境优雅回落链接）；`img.cdn1.vip`（esaimg 实际存储主机）加入 `PROXY_HOSTS`/netlify.toml/relay `FETCH_HOSTS` 三处白名单。

### 数据治理（经 Management API SQL 直写，写前 `source=admin` 快照存档，B1 可恢复）
- **宝可梦万圣节订单统一**：排谷表 12 件商品与 PCO 目录 40 件对比，11 件高置信匹配（中文名↔日文原名对应 + 价格比 0.90–0.92 一致佐证）——29 笔订单与限购计划 29 项的 type|model 键改写为 PCO 主档键，删除 11 件重复商品条目；「永恒冒险阿罗拉A4文件夹」无目录对应保留独立。
- **参考图转存自有图床**：PCO 图片 CDN 对数据中心 IP/非浏览器指纹一律 403（volt-adc 反爬，relay/代理通道不可行），改用监控仓同款去自动化 Chromium 抓取 40 张原图字节上传 esaimg（自动转 webp，单张 180KB→35KB），40 件商品 `refImage` 重写为自有图床 URL——任何环境导出汇总表/购买清单均可内嵌，不再依赖 PCO 可达性。

### Tests
- 359 → 362 例全绿：displayName nameOrig 优先、registerProduct 建档/合并 nameOrig 落库、img.cdn1.vip 代理通道。

## v3.9.1 (2026-09-10)

> **图片内嵌 CORS 根因修复 + 活动订单补充工具**。**零 schema 改动**。

### Fixed
- **汇总表参考图内嵌 / 购买清单图片在无 CORS 图床下全部回落链接（v3.9.0 遗留）**：根因=图床与商品图源站响应无任何 CORS 头（实测 esaimg 连 301 都无 ACAO），浏览器 `fetch` 字节必败 → 全部回落「图片链接」。修复=图片拉取改为候选通道链 **直连 → `/media-proxy`（Netlify 转发）→ `/media-relay`（ECS relay /fetch）**：新增 `Aoi.exportSummary.imageCandidates`，`fetchImageBase64`/`plan-export.loadImage` 按链依次尝试；`Aoi.import.PROXY_HOSTS` 白名单追加 `www.pokemoncenter-online.com`、`esaimg.cdn1.vip`；netlify.toml 同步新增两主机的 proxy/relay 重写（白名单制防开放代理）；`relay/relay.js` `FETCH_HOSTS` 同步追加（**需 ECS 重新部署 relay 后 relay 通道生效**，Netlify proxy 通道推送即生效）。exceljs 对 `data:` 前缀 base64 的处理经本地解包验证：`xl/media/image1.png` 字节与原图一致、drawing 正确挂载，内嵌机制本身无误。

### Added
- **活动订单补充工具（`scripts/supplement-activity.mjs`）**：排谷表 App 导出的「排表详情」xlsx 与库内指定活动订单对账补充——解析复用本站 `Aoi.import.parse`（jsdom 装载，字段口径与页内链接导入一致）；键=购买人|类型|型号，**新增缺失组合 / 件数对齐排表 / 单价只补缺（不一致仅报告）/ 库内多出保留并列出**；商品主档按 type|model 只补缺；默认 dry-run，`--apply` 写回（乐观锁 + 服务端自动存档 B1 快照可恢复）；admin token 经 `AOI_ADMIN_TOKEN` 环境变量（浏览器 F12 获取），与 `restore-activity.js` 同模式。devDependencies 新增 `xlsx`（脚本解析用）。

### Tests
- 357 → 359 例全绿：新增 imageCandidates 通道顺序、直连被拒后代理取回字节 2 例。

## v3.9.0 (2026-09-10)

> **购买清单图片导出 + 汇总表参考图内嵌**（限购计划 / 活动管理导出体验升级）。**零 schema 改动**。

### Added
- **购买清单图片导出（新模块 `js/plan-export.js`）**：限购计划结果区新增「导出购买清单图（每账号一张）」——按已存购买计划逐账号生成大字简洁 PNG（文件名「活动-账号N[-购买人]-购买清单」）：账号名大标题 + 每件商品一行，版式按行高占比 参考图 75% / 商品名称字号 10% / 数量字号 5%；名称显示原语言（按商品主档 refUrl 绝对化回查 `d.pcoItems.jpName`，型号含假名视为原文），无原文回落中文型号。缺失兜底：无参考图或图片拉取失败/跨域不可绘 → 灰底「图片缺失」占位块（只绘 CORS 干净图源——fetch 转 dataURL 或 crossOrigin 直载——避免画布污染令 toDataURL 失败）。购买计划结果表账号列同时新增逐账号「导出清单图」按钮（限购页与活动管理计划弹窗共用，点击事件委托 `data-plan-export`）。
- **汇总表参考图内嵌 + 链接可点击（`js/summary-export.js`）**：exceljs 通道导出时并行拉取图床参考图转 base64 直接内嵌单元格（复刻《7.8汇总表》内嵌图意图；行高 90pt，图片浮动贴入覆盖链接文字），拉取失败/格式不支持（webp 等）自动保留「图片链接」超链接并在完成提示中报内嵌张数；SheetJS 回退通道为图片链接与商品跳转链接写入单元格 `.l` 超链接，点击直达；新增 `absUrl` 链接绝对化（`//` 协议相对、`/products/*` 回落 PCO 主站、缺协议补 https），目录推入的相对链接在两通道均可点击直达；新增 `cellAddr` / `collectImageCells` / `fetchImageBase64` 供渲染层与单测。

### Tests
- 主仓库 336+ → 357 例全绿：新增 `tests/v390-plan-export.test.js`（7 例：collect/displayName/fileBase/layout 纯函数 + renderPlan 按钮委托 + 导出兜底提示）与 `tests/v390-summary-embed.test.js`（9 例：absUrl/cellAddr/内嵌图描述符/collectImageCells/fetchImageBase64（stub fetch）/SheetJS `.l` 超链接）；`tests/helpers/aoi.js` MODULES 增补 `js/plan-export.js`（index.html script 顺序同步）。

## v3.7.0 (2026-09-10)

> **管理端第二轮迭代**（[docs/PLAN-v3.7.0.md](docs/PLAN-v3.7.0.md)，2026-09-10 批准后按 S1–S9 实施）。
> 七项实测问题：图片场景 / 活动管理四项 / 预建商品统一 / 汇总表导出 / 发货 CSV / 复盘并入总览 / F9 接口预留。
> **零 schema 改动**（全部在 `team_data.data` blob 内：`activityMeta[].products` 扩展可选字段、新增 `pcoItems: []` 预留、`d.products` 废弃保留）。

### Added
- **活动管理展开区（S2）**：点击活动名/商品按钮行内展开商品卡片区——缩略图、购买链接、聚合件数/人数、购买情况徽标（限购计划状态优先，无计划按订单到货）、单价/限购/参考图/链接行内编辑、查订单跳转；取代 v3.6.0 商品弹窗；展开区头部收拢 平台链接/快递单号/购买计划/从订单同步商品/导出汇总表 入口；活动表 14 → 11 列。
- **商品实体统一（S1/S4）**：`activityMeta[].products` 升级为唯一商品主档（`productStats` 实时聚合订单，不在商品上存数量副本）；「从订单同步商品」一键补登记；信息录入「手动录入周边（预建商品）」改为「登记活动商品」（活动可新建 + IP 联动 + 币种单价 + 限购 + 参考图统一图片弹窗 + 跳转链接）；旧 `d.products` 池停止读写、旧数据保留。
- **购买人体系（S3）**：候选仅取以往活动登记过的购买人（不再混入全部订单 CN/团员圈名）；一人一账号（账号必填、圈名/账号去重）；「购买人 ↔ 计划账号 1..N」映射提示 + 「从计划生成购买人」；限购计划/活动计划弹窗账号槽位显示对应购买人名称+账号标签。
- **汇总表导出（S5，新模块 `js/summary-export.js`）**：复刻《7.8汇总表》结构——「采购表」（A–D 标签区 + 按活动分组商品列：名称/参考图链接/日元价/人民币均价/需求总数/链接 + 购买人×商品分摊矩阵取 `limitPlans` + 购入多余部分行取 `remaining`）+ 每活动「【活动名】汇总」（标题合并/图片链接行/种类/单价/总数 + 每购买人一行数量矩阵 + A 列应付总额 0.00 格式，金额按订单逐单累计）；纯函数 `buildWorkbook` 供单测，渲染 exceljs（色块矩阵/合并/冻结窗格/超链接）优先、SheetJS 回退；入口=活动管理工具栏（全部活动）+ 活动展开区（单活动）；exceljs@4.4.0 CDN。
- **F9 接口预留（S1）**：`orders.ensure` 预留 `d.pcoItems: []`；商品主档扩展可选 `price/priceOrig/currency/limit` 字段（F9「一键推入」目标结构，向后兼容）。F9 交付版本顺延 v3.8.0。

### Changed
- **总览合并复盘（S6）**：复盘统计自独立 tab 并入总览「团期复盘」区块，进入总览即渲染；工具菜单「复盘统计」导航项移除；总览 KPI 卡跳转保留。
- **UI 流式宽度（S7）**：管理端宽视图去掉 `max-w-5xl/7xl` 上限改全宽；订单表「外币原价」与活动表「出货（模糊）」标记 `data-lowpri`，<1280px 整列隐藏（数据不丢，入口在展开区/导出）；≥1536px 表单类视图（设置/囤货地/批次/计算器）限宽 64rem。
- **合照缩略图（S8）**：发货管理「合照」列由「查看」文字链接升级为缩略图（点击原窗口打开大图）。

### Removed
- **发货管理「导出 CSV」**（S6）：按钮与 `Aoi.ship.export` 删除；「导出图片/下载表格」与 bot 排发表 xlsx 私发保留。

### Tests
- 主仓库 275 → 336+：新增 v370-product-stats / v370-buyers / v370-entry-product / v370-summary-export / v370-overview-merge / v370-photo-thumb 六个测试文件；改写 v360-products（弹窗→展开区）/ v360-layout（view-stats→ovStats）/ intl-activities / orders-entry / v360-plan-sync / v360-export-paste 相关用例；`tests/helpers/aoi.js` MODULES 增补 `js/summary-export.js`。Edge 无头浏览器 1366/1920/1150 三档宽度布局核验。

## v3.6.3 (2026-09-10)

> **F10 · QQ 机器人用户交互迭代**（[docs/PLAN-F10-BOT-INTERACTION.md](docs/PLAN-F10-BOT-INTERACTION.md)，
> 2026-09-10 批准后按 M1–M4 实施完成）。relay 侧改动在独立仓库
> [aoi-qqbot](https://github.com/zhengdaode/aoi-qqbot)（commit 69ebe1b / abde065），
> 主仓库仅 `js/member.js` 增量；**零 schema 改动**（复用 v3.5.3 的 3 个 RPC）。

### Added
- **QQ 绑定唯一性校验（F10-A，两端）**：绑定写入前经 `member_lookup_by_qq(p_qq)` 全局解析——
  目标 QQ 已被其他圈名绑定 → 拒绝并引导先解绑（固定文案不泄露他人圈名），杜绝抢绑导致的
  查单/催缴串人（解析 `limit 1` 的正确性前提）；绑回自己圈名幂等成功。
  relay 侧校验异常时暂拒（不带伤写入）；网页侧异常放行（绑定不为单点校验阻塞）。
- **bot「解绑 <团员密钥> <圈名>」（F10-B）**：与绑定同格式防冒用，群内发解绑引导私聊；
  通过后写 `memberMeta[cn].qq=''`（保留既有字段）；本就未绑定时幂等提示；密钥即用即焚沿用。
- **网页端解绑按钮 + 复制绑定指令（F10-C，`js/member.js`）**：已绑定态显示 QQ + 「解绑」
  （确认后写空，登录态即权限）；未绑定态「复制绑定指令」一键拼装 `绑定 <密钥> <圈名>`（clipboard
  + execCommand 降级），粘贴给 bot 即完成验证式绑定。
- **bot「我是谁」（F10-D）**：私聊确认当前 QQ 绑定的圈名 + 团名，未绑定回引导。
- **「查单 <活动名>」（F10-E）**：按活动名模糊包含过滤（忽略大小写），无匹配时提示可试活动名；
  裸「查单」行为不变；筛选视图不重复展示国际费小节。
- **bot「我的快递」（F10-F）**：只列已发订单的制品与快递单号（缺单号兜底文案），全部未发时提示。
- **帮助更新（F10-G）**：四条新指令入列。

### Tests
- 主仓库 275 → 286（新增 `member-qq-bind.test.js` 11 用例：双态渲染/指令拼装/冲突拒绝/本人放行/
  异常放行/debug 跳过/解绑保留字段/取消不写）；
- aoi-qqbot 54 → 68（`m8-interaction.test.js` 14 用例：解绑六态/我是谁三态/快递速查/查单筛选/帮助/唯一性三态）。
- 注：主仓库全套运行时 `catalog.test.js` 属并行 v3.7.0 流的未完成 WIP（非本版范围），其余全绿。

## v3.6.2 (2026-09-09)

### Added
- **订单管理表头排序** — 8 列可排序：活动 / 制品类型（同种类聚组）/ 型号（商品名称）/ 单价 / 数量 /
  购买者 / 到货状态（按生命周期 未到货→待发货→已发货→已收货）/ 小计；点击表头循环
  不排→升→降→不排（异列点击直接升序），排序列箭头 + 加粗高亮；中文按拼音排序
  （`Intl.Collator('zh-Hans-CN')`，仓库首例）、数值按大小、空值与「待生成」价升降序恒排最后、
  同值保持录入顺序（稳定排序）
- **移动端排序兜底** — ≤640px 卡片视图隐藏表头，筛选行内新增排序下拉（`sm:hidden` 仅窄屏显示），
  选项与表头等价（含「默认顺序」清除项），与表头共享同一状态
- **排序记忆（跨刷新）** — 排序状态存 `localStorage['aoi_orders_sort']`，刷新后自动恢复上次选择；
  非法字段 / 方向 / 损坏 JSON 一律拒绝回退默认

### Notes
- 排序只作用于渲染副本（`slice()` 后排序），`d.orders` blob 录入序永不改写，无服务端 schema 变化
- 导出图片 / 下载表格直接读渲染后 DOM，导出行序自动跟随当前排序（所见即所得，表头含排序箭头）

### Tests
- 新增 `tests/orders-sort.test.js` 15 例：比较器纯函数（拼音序 / 数值非字典序 / 生命周期阶段 /
  空值恒最后 / 稳定性 / 原数组不被污染 / 未知字段兜底）、排序状态持久化（saveSort/loadSort 往返与
  非法拒绝 / setSort 升→降→清除循环）、render 集成（表头点击行序与箭头 / 下拉同步 / d.orders 原序
  与统计不变 / 筛选+排序叠加）；全套 275 例全绿

## v3.6.1 (2026-09-09)

### Fixed
- **图片粘贴不可用（用户实测：活动管理商品参考图处无法粘贴）** — 旧实现要求键盘焦点恰好落在带
  `data-img-paste` 的输入框内，点过「上传」取消或焦点稍偏后 Ctrl+V 会被静默忽略；
  新版在「添加图片」弹窗打开期间，**页面任意位置 Ctrl+V 均可捕获图片**（不再依赖焦点），
  原「焦点在输入框内直接粘贴」快捷路径保留

### Added
- **统一「添加图片」弹窗（桌面端）** — 所有图片入口（缴费二维码 / 囤货地收款码 / 发货合照 /
  团员付款凭证 / 活动商品参考图）的「上传」标签统一替换为「图片…」按钮，打开三合一弹窗：
  ① 粘贴图片（任意位置 Ctrl+V）② 上传本地图片 ③ 粘贴图床链接；带预览与「确认填入」
  （仅 http(s) 链接可确认），确认后写回原输入框

### Tests
- 254 → 259 用例：弹窗开关与确认回填 / 非法链接禁用确认 / 弹窗打开时无焦点粘贴捕获（核心修复）/
  pickerUpload 直传路径 / 活动商品与团员凭证入口接线；全套全绿

## v3.6.0 (2026-09-09)

> 管理端体验升级：六条用户实测建议全量落地（任务分解见 `docs/PLAN-v3.6.0.md`，S1–S6 每特性独立 commit）。
> 全部为前端改动，数据仍存单 blob（新增 `d.limitPlans`、`activityMeta[].products` 两个键，无服务端 schema 变化）。

### Added
- **买家管理独立 tab（S1）** — 自活动管理页迁出为侧边栏「基础数据 → 买家管理」：买家表按状态分桶计数
  （订单数/未到货/待发货/已发待收/已完成）+ 圈名搜索；点击圈名跳转订单管理并按购买者筛选其订单；
  订单表「到货状态」列升级为四态组合徽标 `combinedStatus`（未到货灰 / 已到货·待发货琥珀 / 已发货绿 / 已收货深绿）
  ——顺带修复了该列此前把订单对象传入字符串版 `statusBadge` 的显示错误
- **活动商品管理（S2）** — 活动管理行新增「商品」按钮 → 弹窗按制品类型分组管理商品
  （`activityMeta[act].products = [{id, type, model, refImage, refUrl}]`）：增改删商品、
  参考图（URL / 上传 / Ctrl+V 粘贴）、跳转链接；**跳转链接为空时团员端默认展示活动平台链接**；
  弹窗内每商品显示「N 人购买」，点击跳订单管理按「活动 + 型号」筛选购买者（订单管理新增 `fModel` 型号筛选）；
  团员端「我的订单」新增「参考」列（参考图缩略图 + 商品链接/平台链接回落）
- **购买计划双向同步（S3）** — 「计算购买计划」结果入库 `d.limitPlans[act]`（重算保留同名 (账号,商品) 购买状态）；
  结果表升级 8 列（新增「购买状态」列：待购买/已购买/购买失败，件数可编辑自动重算金额与包邮状态）；
  活动管理行新增「计划」按钮 → 计划弹窗与限购计划页**共读共写同一份数据，双侧编辑即时互相同步**；
  确认「购买失败」→ 二次确认 + 撤销锚点 → `reallocateCore` 按**原计算器阶段一同款贪心**
  （逐件给金额最低的可收账号，受单账号限购与种类上限约束）把该商品整项重分配给其余账号，
  装不下的余量计入「剩余未分配」并告警
- **图片粘贴上传（S4）** — 焦点在带 `data-img-paste` 的输入框内 Ctrl+V 粘贴截图即自动压缩上传图床并回填 URL；
  已覆盖：缴费二维码、囤货地收款码、发货合照、团员付款凭证、活动商品参考图全部输入框
- **导出文件名带活动名（S5）** — `Aoi.exportBaseName`：导出按钮带 `data-activity-from` 时文件名变为
  「活动名-表格类型」（非法文件名字符自动替换）；已接线订单管理（`fActivity`）与限购购买计划（`limActivity`）的
  导出图片 / 下载表格共四枚按钮

### Fixed
- **复盘统计布局与其他 tab 统一（S6）** — 根因为 `view-stats` 被写在提前闭合的 `</main>` 之后
  （页面尾部多出一个 `</main>`），视图脱离 main 内容流导致无内边距、布局错位；已移回 main 内，
  并加「view-stats 必须在 main 内 + 全页仅一个 main」的 DOM 结构回归测试
- 活动管理表此前缺「商品」表头导致该列之后的表头错位，已随 S2/S3 一并补齐

### Tests
- 213 → 254 用例：`v360-layout`（2）/ `v360-export-paste`（10）/ `v360-buyers`（7）/ `v360-products`（11）/
  `v360-plan-sync`（11，含 reallocateCore 约束·余量·深拷贝与失败确认→重分配→撤销锚点端到端）；
  `limits.test.js` 结果表 7→8 列断言更新 + 相关 describe 补 `saveTeamData` stub；全套全绿

## v3.5.4 (2026-09-09)

### Added
- **限购计划结果表：每账号件数 + 外币原价合计** — 结果表由 5 列扩为 7 列（行号/账号/购买内容/件数/金额(¥)/外币原价/包邮状态）：「件数」为该账号购买件数合计；「外币原价」与商品表同源（订单 `priceOrig` 按单均价），逐件累加后按币种分组展示（如 `JP¥2,500`，混币种以 ` + ` 连接；无原价数据的商品不计入，整行无原价显示「—」）；导出图片/下载表格随表格同步带新列

### Tests
- 211 → 213 用例：`origTotals` 按币种分组求和与缺原价排除；结果表 7 列端到端（件数合计、外币原价累加、未填包邮线时包邮状态显示「—」）

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

### 部署（2026-09-09 已全部线上执行完毕，链接导入无需任何人工动作）
- qq-relay Edge Function 已部署 v5（经 Management API，verify_jwt=false 与原一致）：
  `GET /fetch` 最终采用 **Edge 直连源站**方案（实测 ~350ms 成功拉取两份真实链接；偶发网关挂起
  ~1/6 由前端每通道 20s 超时 + Edge 自动重试兜底，502 快速失败可重试）；原「透传 ECS relay」
  路线弃用——部署者本机 SSH 密钥仅授权 NapCat 所在机（106.14.28.206），relay 机（47.101.194.103）
  无法登录。POST 机器人链路零改动并回归验证（401 鉴权 ~0.5s）
- GitHub Pages 已部署含导入 UI 的新版（Actions 测试→部署），生产库 botConfig.relay 已指向本函数
  —— Pages / Netlify / 本地三通道链接导入即刻可用
- ECS relay 更新（git pull + pm2 restart qq-relay）降级为可选：仅影响 `/media-relay` 备用通道
  与 bot 链路 v4 功能，与链接导入无关


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
