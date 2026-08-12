# 参与贡献 (Contributing)

> **原作者：秋洛 (QiuLuo)** · **当前维护者：郑 (zhengdaode)**
> 仓库：[zhengdaode/Aoi-system](https://github.com/zhengdaode/Aoi-system)

## 项目方向

Aoi-system 聚焦**团长管理端**，团员端代码保留但不再主动推进。详见 [改进计划](./docs/IMPROVEMENT_PLAN.md)。

## 项目结构

```
├── index.html              # 主页面（HTML 骨架）
├── css/styles.css          # 自定义样式 + 黑夜模式
├── js/                     # JavaScript 模块（按功能拆分）
│   ├── core.js             # 基础工具函数 + escapeHtml() + showToast()
│   ├── data.js             # 数据层 / 云端同步 / localStorage
│   ├── auth.js             # 认证（登录/注册/重置，含调试账户）
│   ├── image-upload.js     # 图片上传 + 图片裁切
│   ├── order-manage.js     # 订单管理
│   ├── swipe.js            # 滑动多选
│   ├── dashboard.js        # 团长管理端
│   ├── buyer-portal.js     # 团员自助端（保留，不再主动推进）
│   ├── admin-payment.js    # 交肾审核
│   ├── shipping-export.js  # 排发导出
│   └── admin-shipping.js   # 排发审核 / 云端设置 / 功能开关
├── docs/
│   └── IMPROVEMENT_PLAN.md # 改进计划
├── README.md
├── CHANGELOG.md
├── LICENSE                 # CC BY-NC-SA 4.0
└── netlify.toml            # 部署配置
```

## 如何贡献

1. **Fork** 本仓库
2. 创建 Feature 分支 (`git checkout -b feature/AmazingFeature`)
3. 修改对应的 JS/CSS/HTML 文件
4. 提交修改 (`git commit -m 'feat: Add some AmazingFeature'`)
5. 推送到分支 (`git push origin feature/AmazingFeature`)
6. 开启 **Pull Request**

## 代码风格

- 全局函数挂在 `window` 上（保持跨模块兼容）
- `const`/`let`（ES6），不引入构建步骤
- 渲染用户/云端数据时使用 `escapeHtml()` 防 XSS
- 新增功能尽量在对应的 JS 模块中添加，避免修改 index.html

## 安全注意事项

- 绝不硬编码 API Key / URL / Token
- 渲染任何外部数据前调用 `escapeHtml()`
- 修改 RLS 策略前先在 Supabase 控制台验证
- 收款码等敏感图片不上传第三方图床

## 联系

发现 Bug 或有功能建议？提交 [GitHub Issue](https://github.com/zhengdaode/Aoi-system/issues)。
