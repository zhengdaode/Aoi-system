# 谷圈限购计算器 — 小红书小工具

从 Aoi-system 主系统「工具 → 限购计算器」（`js/limits.js`）单独拆出的离线小工具，
发布到小红书小工具（创服平台）供谷圈团长在手机上直接分单。

## 功能

- 方案设置：方案名称 / 每单包邮线 / 可用账号数 / 每账号最多买几种
- 商品清单：商品名 × 数量 × 单价 × 单账号限购（留空不限）
- 「计算购买计划」：两阶段分配（阶段一全量均衡分配 → 阶段二包邮调剂），
  逐账号输出购买内容、金额、包邮状态；受限购/种类上限装不下的计入剩余未分配并预警
- 算法核心 `core.js` 与主系统 `Aoi.limits.planCore` 逐行一致（纯函数）
- 数据自动保存到小红书本地缓存（`window.xhs.miniTool.setStorage/getStorage`，容器注入，
  客户端 ≥9.46）；按容器规范**不回退 localStorage**，存储不可用时工具照常运行、仅不保存

## 目录

```
minitools/limitcalc/
├── src/               # 源码（经典脚本，ES2017/Chrome 61 基线，无构建链）
│   ├── index.html     # 入口（zip 根目录）
│   └── assets/{style.css, core.js, app.js}
├── build.mjs          # 打包：src → dist/ → dist/limitcalc.zip（自有 ZIP 写入器，零依赖）
├── brand.mjs          # 生成 brand/icon.png（512×512 1:1）+ brand/cover.png（750×1000 3:4）
├── brand/             # 生成的上传素材（入库）
└── dist/              # 构建产物（gitignore）
```

## 命令

```bash
node minitools/limitcalc/build.mjs     # 打包 zip
node minitools/limitcalc/brand.mjs     # 重新生成图标/封面
npm test                               # tests/limitcalc-minitool.test.js 覆盖算法/合规/冒烟
```

## 容器合规要点（见 minitool-zip-builder skill）

- 脚本全部外置经典脚本（禁内联/行内事件/module/eval），事件 addEventListener
- 页面零联网：无 fetch/XHR/外部资源，全部资源打包在 zip 内
- 不用 Worker / 剪贴板 / window.open / a[download] / iframe / form 提交跳转
- CSS Chrome 61 基线（无 Flex gap/aspect-ratio/clamp），安全区 `var(--safe-area-inset-*, env(...))`
- 结果文字可长按选中复制（剪贴板 API 在容器中禁用，展示可选中文本是官方替代方案）

## 上传流程（redapp-cli）

```bash
redapp config  --source thirdAgent --agent                      # 类目：query_tool（实用工具）
redapp upload  --file dist/limitcalc.zip --type pkg --agent --dry-run   # → confirm <planHash>
redapp preview --source thirdAgent --file preview.json --agent --dry-run # → confirm，产出扫码二维码
redapp submit  --source thirdAgent --file submit.json --agent --dry-run  # → confirm（须先扫码预览通过）
```

提审材料：名称「谷圈限购计算器」/ 简介「多账号购买计划自动分配」/ 类目 `query_tool` /
权限：无（`authorizations: []`）/ 版本 1.0.0。素材如需更换，替换 brand/ 下两张图重新上传即可。
