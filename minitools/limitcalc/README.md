# 拼好邮（满赠/包邮计算器）— 小红书小工具

从 Aoi-system 主系统「工具 → 限购计算器」（`js/limits.js`）单独拆出的离线小工具，
发布到小红书小工具（创服平台）。小工具名「**拼好邮**」，页面标题「**满赠/包邮计算器**」：
把商品清单拆成若干订单，让尽可能多的订单达到**不叠加**的满赠/包邮线，并可导出采购计划图。

> 界面口径（2026-11-24 用户改名时定）：一个「订单」= 算法里的一个账号槽位（`core.js` 的
> `accounts`，与主系统 `planCore` 同源，标识符不动）；用户可见文案一律写「订单」，
> 「包邮线」写作「满赠/包邮线」，达标状态写作「已达满赠/包邮」。

**UI 设计**：采用 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui)
（MIT）的岛屿设计语言——薄荷青 `#19c8b9` 主色 + 暖棕文字 + 奶油羊皮纸底 +
药丸形输入/按钮 + 主按钮 3D 底影（`0 5px 0 0 #bdaea0`）+ 缎带标题 + 波点壁纸，
token 取自其 `docs/design-system/css-variables.md`；字体 Nunito + Noto Sans SC
简中子集（500/700）取自该包随包分发的 woff2（共 ~2.3MB 离线打包）。

## 功能

- 方案设置：方案名称 / 每个订单满赠/包邮线（¥/JP¥/₩ 三种币种）/ 订单数 / 每单最多买几种
- 汇率设置：日元/韩元各带汇率+加价（默认与主系统计算器一致，可改）；
  外币单价 ×（汇率+加价）折人民币参与分配与满赠/包邮判断，0.5 圆整
- 商品清单：商品名 × 数量 × 单价（¥/JP¥/₩）× 每单限购（留空不限）+ 商品图片 + 整行复制
- 「计算购买计划」：两阶段分配（阶段一全量均衡分配 → 阶段二满赠/包邮调剂），
  逐订单输出购买内容、人民币金额、原币单价与外币合计、达标状态；
  受限购/种类上限装不下的计入剩余未分配并预警
- 「保存结果图片到相册」：结果经 Canvas 绘制成图（抬头与落款为页面标题），走 `writeTempFile` →
  `saveImageToPhotosAlbum`（需 **photos** 授权）；容器禁用文件下载，
  无 xlsx/文件导出通道，图片是官方允许的唯一导出方式
- 算法核心 `core.js` 与主系统 `Aoi.limits.planCore` / `Aoi.calc` 同口径移植（纯函数）
- 数据自动保存到小红书本地缓存（`window.xhs.miniTool.setStorage/getStorage`，容器注入，
  客户端 ≥9.46）；按容器规范**不回退 localStorage**，存储不可用时工具照常运行、仅不保存

## 目录

```
minitools/limitcalc/
├── src/               # 源码（经典脚本，ES2017/Chrome 61 基线，无构建链）
│   ├── index.html     # 入口（zip 根目录）
│   └── assets/{style.css, core.js, app.js}
├── build.mjs          # 打包：src → dist/ → dist/limitcalc.zip（自有 ZIP 写入器，零依赖）
├── brand.py           # 生成 brand/icon.png（512×512 1:1）+ brand/cover.png（750×1000 3:4），需 Pillow
├── brand/             # 上传素材（入库）：icon-src.png 图标原图 + icon.png + cover.png
└── dist/              # 构建产物（gitignore）
```

## 命令

```bash
node minitools/limitcalc/build.mjs     # 打包 zip
python minitools/limitcalc/brand.py    # 重新生成图标/封面（图标由 brand/icon-src.png 缩放而来）
npm test                               # tests/limitcalc-minitool.test.js 覆盖算法/合规/冒烟/素材尺寸
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

提审材料（2026-11-24 改名后）：名称「拼好邮」/ 简介（**上限 14 字符**，CLI dry-run 不拦但后端会拒）/
类目 `query_tool` / 权限 `photos`（保存结果图到相册）/ 图标 `brand/icon.png`（用户提供的 emoji 原图）/
封面 `brand/cover.png`。素材如需更换：替换 `brand/icon-src.png` 后重跑 `brand.py`，再重新上传。
首版 v1.0.0 以旧名「谷圈限购计算器」送审（appId `6b031535fae1a5001523f734`），改名与文案修订走新版本送审。
