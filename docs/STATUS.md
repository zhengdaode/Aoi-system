# Aoi System · 当前状态

> 更新日期：2026-08-15 · 版本 v0.3.0（阶段 0–3 完成）

## 项目定位

谷圈团购管理系统。以全新代码重写原开源项目（原作者秋洛，CC BY-NC-SA 4.0），摆脱「非商业 + 相同方式共享」两项限制。版权保护代码本身、不保护功能与想法，因此**业务概念、公式、术语可复用，代码与数据模型一律重写**。

纯 HTML/CSS/原生 JS，无框架、无构建步骤。Tailwind CSS / Supabase / SheetJS 走 CDN。

## 已完成（阶段 0–3）

### 阶段 0 · 骨架
- 单页应用外壳：`screen-app` + sidebar 导航（`Aoi.nav()` 切换 `[data-view]`）。
- 全局命名空间 `window.Aoi`，核心工具 `Aoi.core`（`genId`/`showScreen`/`nav`/`escapeHtml`/`toast`/`showLoading`/`confirm`）。
- 调试账户：`debug@aoi.local` / `debug123`，绕过 Supabase，数据走 `localStorage`（`aoi_debug_*`）。

### 阶段 1 · 认证 + 多管理员
- Supabase 邮箱注册/登录/找回/改密/退出（`js/auth.js`）。
- 团队模型：团长建团 → 邀请码 → 管理员加入（`js/team.js` + `supabase-schema.sql` 的 `teams`/`team_members`/`team_data` 表与 RPC）。
- 角色：`owner`（团长）/ `admin`（管理员），`enterApp()` 统一进入。

### 阶段 2 · 信息录入
- **Excel 导入**（`js/import.js`）：识别排谷表 / 拼谷表 / 闲鱼三种矩阵结构（汇总型 / 明细型），自动识别活动名与 IP，弹窗确认后入库。
- **手动录入**：订单（IP/活动/类型/型号/币种/价格/数量/购买者）+ 周边（预建商品）。
- **个性化计算器**（`js/calc.js`）：中日韩货币加价换算（`外币×(汇率+加价)`，0.5 圆整），非人民币价自动转人民币保存。

### 阶段 3 · 核心流程
- **国际批次**（`js/orders.js` 批次部分）：到货批次按日期划分，同日期合并；新建/删除批次，订单「标记到货」归入批次，按批次筛选。
- **国际计算**（`js/intl.js`）：按重量分摊国际运费 —— `单位国际费 = 总额/总重 × 单位重`（公式复用自 `intl-freight-calc`，原创代码）。目标总额 + 单位重量可配，支持手动覆盖单位费，输出每人应付国际费。
- **事务审批**（`js/approval.js`）：按批次逐人核实国际费交费，标记已交/驳回，一键生成催缴名单（含金额，可复制）。
- **发货管理**（`js/shipping.js`）：按批次录快递单号、批量设合照 URL、批量设发货状态（已发/未发）。

## 数据模型（团队数据 blob，`Aoi.state.data`）

```
{
  orders:    [{ id, ip, activity, type, model, price, count, buyer,
                status, batchId, paid, shipped, tracking, photo }],
  products:  [{ id, ip, type, model, price }],
  activities:[string],  ips:[string],
  batches:   [{ id, date, targetAmount?, weights?, manualFees? }],
  payments:  [{ id, batchId, buyer, status }],
  calc:      { jpyRate, jpyMarkup, krwRate, krwMarkup }
}
```

- `orders.status`：到货状态（未到货 / 已到货）；`orders.batchId`：所属到货批次。
- `orders.shipped`：发货状态（未发 / 已发）；`orders.tracking` / `orders.photo`：快递单号 / 合照 URL。
- `payments.status`：交费状态（待交 / 已交 / 已驳回），按「批次 × 购买者」唯一。
- 命名约定：`type`（制品类型）+ `model`（型号）在订单、周边、Excel 导入三处统一。

## 调试账户

登录页输入 `debug@aoi.local` / `debug123`，数据存在浏览器 localStorage，无需 Supabase。适合本地解压即用 / 试用。

## 部署（正式云同步）

1. 在 Supabase 建项目，跑 `supabase-schema.sql`。
2. 填 `js/config.js` 的 `SUPABASE_URL` / `SUPABASE_KEY`（本项目不内置真实密钥）。
3. 打开 `index.html` 即可（可托管到任意静态站，如 Netlify）。

## 复用说明

- `intl-freight-calc/` 的国际运费**按重量分摊公式**为本人原创，已在 `js/intl.js` 中移植复用（新命名、新结构）。
- 业务术语（交肾、排发、囤货地、团期、CN）与货币换算思路不受版权保护，直接沿用。

## 待完成（后续阶段）

| 项 | 所属 | 说明 |
|---|---|---|
| 通知与公告 | 阶段 4 | 手动发布 + 自动提醒 + QQ 机器人（催缴依赖，优先级高） |
| 团员端 | 阶段 4+ | 免登录密钥+CN 查询、上传付款凭证、申请换囤货地 |
| 活动管理 | — | 购买时间/出货日期/平台链接/进度状态 |
| 囤货地管理 | — | 站点与收款码；事务审批里的「转移囤货地申请」依赖此项 |
| 图床配置 | 阶段 5 | 真实图片上传（当前合照为 URL 粘贴） |
| 打磨 | 阶段 5 | 黑夜模式、撤销、两步确认、导出、教程站 |

## 已知限制

- 合照为 **URL 粘贴**，真实图床上传待阶段 5。
- 付款凭证（截图）展示依赖团员端上传，当前管理员线下核对后手动标记。
- 催缴/驳回的**通知**依赖阶段 4 的 QQ 机器人，当前仅生成可复制的名单。
- `Aoi.confirm` 暂用原生 `confirm`，待前端设计统一替换。
