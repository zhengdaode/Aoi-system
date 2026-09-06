# PR: 模块化重构 + 安全加固 + 国际运费计算器 + 多项 UX 改进

zhengdaode/main → mossasari/main

---

## 🏗️ 架构重构

| 项目 | 说明 |
|------|------|
| 模块化拆分 | ~2900 行单文件 index.html → 11 个独立 JS 模块 (core / data / auth / dashboard / buyer-portal / admin-payment / admin-shipping / shipping-export / order-manage / image-upload / swipe) |

## ✨ 新功能

| 功能 | 说明 |
|------|------|
| 🌐 国际运费加权计算器 | 嵌入为独立 screen，按重量比例分摊运费。从团购系统选择团次导入商品，实时计算面板（去皮总重/目标金额/差额/均价），可编辑表格支持手动覆盖，排发表导出图片、数据备份。独立仓库 zhengdaode/intl-freight-calc |
| 🌙 P6 黑夜模式 | 全局切换按钮（右上角固定），57 条 CSS 覆盖规则，prefers-color-scheme 自动检测 |
| 🔘 P12 功能开关 | 云端配置功能开关，默认开启，通过 applyFeatureToggles 统一控制 |
| 🎨 P15 自定义背景 | 支持纯色 / 图片背景 + 自动遮罩层 |
| ✂️ 图片裁切 | 集成 Cropper.js CDN，image-crop.js 弹窗式裁切 UI |
| 🧪 本地调试账户 | test@test.com / test123 绕过 Supabase 认证，纯 localStorage 模式 |
| 🧭 P1 首次引导 | 纯客户端实现（localStorage 标记），首次访问自动弹出覆盖层，逐一说明 6 个功能入口，支持"下次不再显示"复选框 |

## 🔒 P0 数据安全加固

| 项目 | 说明 |
|------|------|
| 自定义确认弹窗 | 替换所有 confirm() 为 showConfirmModal()，统一设计风格，支持暗色模式 |
| 30 秒撤销机制 | 柄图删除和订单删除后显示撤销 Toast，可一键恢复 |
| 交肾两步确认 | 提交付款截图前弹出摘要确认卡（团期、金额、商品数），防止误操作 |
| 行内表单验证 | 快捷录入表单支持 blur 实时校验，空字段红框提示 |
| XSS 防护 | 63 处 innerHTML 站点全部包裹 escapeHtml() |
| 移除重复代码 | 删除 exportCSV 函数重复定义 |

## 🔧 修复

- CSP 阻止外部图床问题
- initCloudData 竞态条件
- XLSX 矩阵导入行偏移（fake header 导致数据下移一行）
- 图床上传 API 灵活适配（支持不同图床的 token/header 配置）
- saveQueryKey 模块拆分丢失
- P2 云端设置信息过载（6 区块 → 3 分组）
- P3 gray-on-color 对比度修复（11 处）
- P3 主题切换按钮触控目标 36→44px（WCAG 最低标准）
- Debug 模式刷新改为页面重载

## 🔐 安全

- 移除硬编码 Supabase URL/Key → 占位符，用户按 README 自行填入
- 移除硬编码图床 API 默认值

## 📝 文档

- CHANGELOG.md (v1.3.0 ~ v1.4.0)
- IMPROVEMENT_PLAN.md (P0-P24)
- CONTRIBUTING.md
- DESIGN.md, PRODUCT.md
