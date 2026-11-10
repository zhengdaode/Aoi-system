# 展开动画方案对比 演示（demo）

对应需求 2（2026-11-10 用户反馈）：展开的 popup 菜单（如选择批次、功能列中的基础功能列表等）
要有展开动画，展开方式经联网检索取当前前端最佳实践，不同方案做成 demo 对比供拍板。

**打开方式**：双击 `index.html`（纯静态零依赖，离线可开）。

**✅ 用户已拍板（2026-11-11 终版）：手风琴 = A4（grid 0fr→1fr + 内容微动），弹层 = B3（浮现感+逐条错峰）**——v3.34.0 已按此实装进主应用。
（2026-11-10 曾初拍 A3+B2，同日修复 B2/B3 因 `.dd` 基类 `visibility:hidden` 未被 `.show` 覆盖而「打开但不可见」的问题。）

## 页面内容

1. **侧栏分组手风琴**（复刻「基础功能列表」场景）五方案并列：
   - A1 直接显隐（现状对照）
   - A2 `max-height` 过渡（legacy，时长失真，不推荐）
   - A3 `grid-template-rows: 0fr→1fr`（推荐基线：高度自适应、无魔法数字）
   - A4 A3 + 内容淡入下落微动（**最精致，建议采用**）
   - A5 `interpolate-size: allow-keywords`（Chromium 129+ 前瞻增强，@supports 内优雅退化）
2. **下拉选择弹层**（复刻「选择批次」场景）三方案并列：
   - B1 直接显隐（现状对照）
   - B2 opacity + scale(0.95)、transform-origin 锚定触发点（**推荐全站统一**）
   - B3 B2 + 模糊浮现 + 菜单项逐条 stagger（进阶，重要弹窗可局部用）
3. **调参面板**：进场/出场时长与缓动曲线实时可调，选定后把数值告诉我即可照此合并；
4. **落地建议**：时长/曲线收敛为 4 个 CSS 变量全站生效；`prefers-reduced-motion` 时动画归零。

## 调研依据（2026-11-10 检索）

- CSS-Tricks《CSS Grid can do auto height transitions》——grid 0fr→1fr 基线
- Chrome Developers《Animate to height: auto》+ MDN `interpolate-size`——height:auto 直通过渡
- Material 3 Easing & Duration / NN/g《Animation Duration》——弹层 150–250ms、进场减速出场加速
- Emil Kowalski《7 Practical Animation Tips》——scale≥0.95、origin 锚定触发点、opacity 搭配
