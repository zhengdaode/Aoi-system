// Aoi-system — 核心工具：状态、屏幕路由、通知、转义
window.Aoi = window.Aoi || {};

// 全局状态
Aoi.state = {
  user: null,    // Supabase 登录用户
  team: null,    // 当前团队 { id, name, member_key, ... }（v3.10.0：invite_code 随 v2 邀请码方案归档移除）
  role: null,    // 当前用户角色 owner / admin
  data: {}       // 团队业务数据（订单/周边/活动等，登录后填充）
};

// 生成唯一 ID
Aoi.genId = function () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
};

// —— v3.15.0 S8：数据信号与版本（审批汇总/复盘统计记忆化的失效依据）——
// dataVersion 在每次 saveTeamData 成功后自增；dataSig 再叠加数据对象代数（引用变化即换代，
// 覆盖测试直接替换 aoi.state.data 的场景）与关键集合行数。版本号自增不存在的场景（如行内
// 原地改动）由 buyerSummary 记忆化的「同 tick 自动过期」兜底，不会跨交互读到旧值。
Aoi.dataVersion = 0;

Aoi.bumpDataVersion = function () {
  Aoi.dataVersion++;
  if (Aoi.approval && Aoi.approval.clearSummaryCache) Aoi.approval.clearSummaryCache();
};

Aoi.dataSig = function (d) {
  d = d || Aoi.state.data || {};
  var gen = '';
  if (typeof WeakMap !== 'undefined') {
    Aoi._dataIds = Aoi._dataIds || new WeakMap();
    Aoi._dataSeq = Aoi._dataSeq || 0;
    if (!Aoi._dataIds.has(d)) Aoi._dataIds.set(d, ++Aoi._dataSeq);
    gen = Aoi._dataIds.get(d);
  }
  return [Aoi.dataVersion, gen,
    d.orders ? d.orders.length : 0,
    d.payments ? d.payments.length : 0,
    d.batches ? d.batches.length : 0].join('|');
};

// 屏幕路由：只显示目标 screen，隐藏其余
Aoi.showScreen = function (screenId) {
  document.querySelectorAll('[data-screen]').forEach(function (el) {
    el.classList.add('hidden');
  });
  var target = document.getElementById(screenId);
  if (target) target.classList.remove('hidden');
};

// 应用内视图切换（sidebar 导航）：只显示目标 view，高亮对应导航项。
// v3.28.0：切换时把来源视图压入导航历史（上限 20），供头部「返回」回退；
// opts.back=true 表示本次切换本身来自返回，不再入栈。
Aoi.navHistory = [];

Aoi.nav = function (viewId, opts) {
  var cur = document.querySelector('[data-view]:not(.hidden)');
  var curId = cur ? cur.getAttribute('id') : null;
  if (curId && curId !== viewId && !(opts && opts.back)) {
    Aoi.navHistory.push(curId);
    if (Aoi.navHistory.length > 20) Aoi.navHistory.shift();
  }
  document.querySelectorAll('[data-view]').forEach(function (el) {
    el.classList.add('hidden');
  });
  var target = document.getElementById(viewId);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('[data-nav]').forEach(function (el) {
    el.classList.toggle('nav-active', el.getAttribute('data-nav') === viewId);
  });
  Aoi.closeDrawers(); // 移动端切视图后收起全部抽屉（经典侧栏 / 工作台侧栏）
  // v3.30.0：外壳模式挂钩（回主页强制 home 全屏外壳；其余视图沿用当前外壳）
  if (Aoi.applyShellForView) Aoi.applyShellForView(viewId);
  Aoi.renderView(viewId);
};

// 分视图渲染注册表（v3.30.2）：每个视图在「导航进入 / 头部刷新 / 撤销恢复」时如何重渲染。
// 此前只有部分视图在此有分支（历史逐版本增量补的），订单 / 国际计算 / 审批 / 发货等核心
// 业务页缺席——它们只在登录时渲染一次，跨页改动不可见、「↻ 刷新」在那些页是空操作。
// 现全部视图统一登记，nav / 刷新 / 撤销三处同源；登录首次渲染仍走 enterApp 不变。
// 各渲染函数均为「读静态 HTML 上的选中态 → 重建 tbody」式重画，批次下拉经
// orders.refillBatchSelect 自带选中保持，重渲染不丢用户的筛选 / 选中状态。
Aoi.VIEW_RENDERERS = {
  // —— 业务 ——
  'view-orders': function () { if (!Aoi.orders) return; Aoi.orders.render(); Aoi.orders.refillDatalists(); Aoi.orders.refillBatches(); },
  'view-intl': function () { if (!Aoi.intl) return; Aoi.intl.refillBatches(); Aoi.intl.render(); },
  'view-approval': function () { if (!Aoi.approval) return; Aoi.approval.refillBatches(); Aoi.approval.render(); if (Aoi.orders) Aoi.orders.renderCnChanges(); },
  'view-ship': function () { if (!Aoi.ship) return; Aoi.ship.refillBatches(); Aoi.ship.render(); },
  'view-activities': function () { if (Aoi.orders) Aoi.orders.renderActivities(); },
  'view-batches': function () { if (Aoi.orders) Aoi.orders.renderBatches(); },
  'view-types': function () { if (Aoi.orders) Aoi.orders.renderTypes(); },
  // —— 基础数据 ——
  'view-entry': function () { if (Aoi.orders) Aoi.orders.refillDatalists(); },
  'view-limits': function () { if (Aoi.limits) Aoi.limits.render(); },
  'view-buyers': function () { if (Aoi.orders) Aoi.orders.renderBuyers(); },
  'view-warehouse': function () { if (!Aoi.warehouse) return; Aoi.warehouse.render(); Aoi.warehouse.renderTransfers(); },
  'view-calc': function () { if (Aoi.calc) Aoi.calc.fillForm(); },
  // —— 工具 ——
  'view-catalog': function () { if (Aoi.catalog) Aoi.catalog.render(); },
  'view-notify': function () { if (!Aoi.notify) return; Aoi.notify.refillBatches(); Aoi.notify.render(); },
  'view-overview': function () { if (Aoi.overview) Aoi.overview.render(); if (Aoi.stats) Aoi.stats.render(); },
  'view-reservoir': function () { if (Aoi.reservoir) Aoi.reservoir.renderAll(); },
  'view-paigu': function () { if (Aoi.paigu) Aoi.paigu.renderAll(); },
  // —— 外壳 / 设置 ——
  'view-settings': function () { if (Aoi.about) Aoi.about.render(); },
  'view-home': function () { if (Aoi.home) Aoi.home.render(); },
  'view-launcher': function () { if (Aoi.home) Aoi.home.renderLauncher(); },
  'view-wbsort': function () { if (Aoi.workbench) Aoi.workbench.renderSort(); },
  'view-fun': function () { if (Aoi.workbench) Aoi.workbench.renderPlaceholder(); },
  'view-idea': function () { if (Aoi.workbench) Aoi.workbench.renderPlaceholder(); },
  // 工单页是异步 relay 拉取，撤销恢复等纯本地场景不应触发网络（见 refreshViews 的排除）
  'view-tickets': function () { if (Aoi.tickets) Aoi.tickets.load(); }
};

// 分视图刷新逻辑（nav 进入 / 头部「刷新」/ 撤销恢复共用；数据可能在其他视图被修改，
// 进入任何视图都按注册表重画一遍）。返回是否确有渲染器执行（无注册项返回 false）。
Aoi.renderView = function (viewId) {
  var fn = Aoi.VIEW_RENDERERS[viewId];
  if (!fn) return false;
  fn();
  return true;
};

// v3.28.0：返回上一步视图（历史栈空则提示；回退本身不入栈）
Aoi.navBack = function () {
  var prev = Aoi.navHistory.pop();
  if (!prev) { Aoi.toast('没有更早的页面了', 'info'); return; }
  Aoi.nav(prev, { back: true });
};

// v3.28.0：刷新当前视图（v3.30.2 起走统一注册表，全部视图均有效；仅确有重渲染时提示成功）
Aoi.navRefresh = function () {
  var cur = document.querySelector('[data-view]:not(.hidden)');
  if (!cur) return;
  var done = Aoi.renderView(cur.getAttribute('id'));
  Aoi.toast(done ? '已刷新当前页面' : '当前页面暂无可刷新内容', done ? 'success' : 'info');
};

// —— 关于本项目（v3.24.0）：账户与设置「关于」选项卡的数据源，发版时随 CHANGELOG 同步更新 ——
Aoi.ABOUT = {
  version: 'v3.32.5',
  buildDate: '2026-10-31',
  repo: 'https://github.com/zhengdaode/Aoi-system',
  site: 'https://zhengdaode.github.io/Aoi-system/',
  changelog: 'https://github.com/zhengdaode/Aoi-system/blob/main/CHANGELOG.md',
  originalAuthor: '秋洛 (QiuLuo)',
  originalRepo: 'https://github.com/mossasari/Group-Buy-Management-System',
  maintainer: '郑 (zhengdaode)',
  log: [
    'v3.32.5（2026-10-31）：宣传图商品图加边框——暖灰 #e5e7eb 细线（设计系统 border-gray-200 同款）区隔商品图与背景，占位框同款描边；头部封面保持通栏不加框',
    'v3.32.4（2026-10-31）：宣传图 contain 留边颜色改海报背景同色（#faf7f2），替代黑边',
    'v3.32.3（2026-10-31）：宣传图图片绘制改 contain 式——比例不合适的图片整图等比放入框内居中、短边方向留黑边（fitBox 纯函数 + drawContain），替代原 cover 式居中裁剪；商品图与头部封面同规则',
    'v3.32.2（2026-10-31）：宣传图图片失败诊断——导出后 toast 直接列出未能加载的图片域名（stage=fetch=代理/直连通道全败多为非白名单主机 / decode=取回但解码失败），控制台 warn 完整失败清单；fetchImg 返回结构化 {ok,url,stage,img}',
    'v3.32.1（2026-10-31）：两处实测修复——①桌面端汉堡改流内折叠：点击在原位展开/收起侧栏，内容自适应让位（md:hidden 显隐），不再以全屏遮罩盖住右侧内容，nav 切视图不强制收起；手机端抽屉行为不变；②修复导出宣传图商品图全部缺失：fetchImageBase64 返回 {dataUrl,ext} 对象被误整体传给 img.src，改为取 .dataUrl（webp 已重编码 jpeg）',
    'v3.32.0（2026-10-31）：活动管理改版 + 侧栏汉堡化 + 宣传图导出 + 国际计算导出修复——①活动管理删常驻「新建活动」表单（改「+ 新增活动」弹窗）+ 订单管理同款过滤行（关键词/状态/排序：创建顺序·倒序·最近修改·名称拼音）+ 展示方式下拉（文段/中图标一行3/大图标一行2）；②左侧 IP 分区栏（修改IP栏顺序[本机] + 全部/各 IP 点击筛选）；③画报模式卡片（主视图图 + 标题 + 种类数/参与人数/截止日期/状态/价格范围/所属IP，封面回落第一张商品参考图，展开区可传主视图与截止日期）；④导出宣传图长海报（每商品图/名称/单价/已排·余量/总量）；⑤桌面端经典侧栏改汉堡抽屉（与手机端一致）；⑥修复导出图片/表格读不到 input 值（国内额外金额等列空白）',
    'v3.31.1（2026-10-30）：手机端适配补齐——工作台侧栏改抽屉（手机端默认收起、头部汉堡按外壳分发开合、复用遮罩、切视图/换外壳自动收起复位），主页 14 格窄屏改 2 列紧凑网格（中央面板置顶跨双列，替代 14 行纵向长列表）',
    'v3.31.0（2026-10-30）：工作台分组行为重构 + 分类颜色——①「设置自定义排序」的分类/顺序/展示成果改挂侧栏「自定义排序」分组展示，「基础功能列表」回归静态全量目录（业务→基础数据→工具，不受自定义影响）；②分类支持颜色（新建选色+左列随时改色+分类内上移/下移），分类色作该分类功能的 UI 底色（侧栏行+主页快捷格）；③主页快捷格功能标题居中放大、底色取分类色',
    'v3.30.3（2026-10-29）：工作台侧栏分组改名——「Builder hub」→「基础功能列表」、「数据看板」→「自定义排序」（元素 id/注册表/布局数据不变，纯显示层）',
    'v3.30.2（2026-10-29）：修复「↻ 刷新」在订单/国际计算/审批/发货等页点击无效与跨页数据不同步——分视图渲染注册表 VIEW_RENDERERS 统一全部 24 视图（导航/刷新/撤销三处同源），进页即重渲染（批次下拉带选中保持、工单页撤销不触发网络），navRefresh 仅确有重渲染时提示成功',
    'v3.30.1（2026-10-26）：主页「开始工作」悬浮文字居中修复；「尽情期待」改「敬请期待」',
    'v3.30.0（2026-10-26）：主页面 + 工作台——主页面代替总览成为默认界面（启动动画：黑屏「你好」→ 呼吸边框启动按钮 → UI 先中间后四周显现，点击跳过）；中心待办与临近出荷 + 「你好/开始工作」进工作台；14 格自定义快捷跳转 + 功能面板；工作台侧栏（创建拼团/首页=总览/账号与设置/Builder hub/数据看板自定义排序/娱乐活动工具/创意工坊端口）',
    'v3.29.2（2026-10-25）：排谷表件数对账——打开排谷表自动把已入排订单的排位数对齐订单件数（修复旧数据「买 2 件只占 1 格」，第 1、2 行均显示买家）；订单编辑改件数即时补足/裁剪排位',
    'v3.29.1（2026-10-25）：排谷表入排粒度修复——按购买件数拆位，count=N 的订单占 N 个连续排位（此前一笔只占一格）；订单编辑同步跟随该订单全部排位',
    'v3.29.0（2026-10-24）：排谷表交互升级——「已排/库存」行、悬浮位次名词（买家-状态-共排N位-第M名）、同列拖动换位（鼠标拖拽+触屏长按）与右键编辑位次（上移/下移x位/顶部/底部+列聚焦动画）、每页 20 行翻页',
    'v3.28.1（2026-10-24）：排谷表重复购买口径修订——同一商品的同一购买者不合并不标数量，多排位逐位分开显示（页面与导出均取消 ×N 标注）',
    'v3.28.0（2026-10-24）：全局返回上一步/页面刷新；商品库存数量同步排谷表；商品改类型/型号与订单编辑自动同步排谷表；修复同买家重复排位无数量标注（×N）与商品改类型后旧 sheet 残留',
    'v3.27.0（2026-10-23）：排谷表——按活动排队表格，商品按类型分 sheet、位次×买家矩阵、五状态色标、点按/右键改状态与插排撤排、超排检测删除、排谷日志、xlsx 导出（每类型一 Sheet+日志）',
    'v3.26.0（2026-10-14）：蓄水池「未转化订单就地补价」——警告标签/行内标记点一下按参考汇率预填转化，支持保存并下一笔',
    'v3.25.2（2026-10-14）：修复蓄水池弹窗按钮点击无反应（容器 stopPropagation 拦截 document 委托点击）',
    'v3.25.1（2026-10-14）：修复跨币种单侧缺数据被按 0 抵扣——单侧币种不宣称欠款方向，总欠款以参考净额为准',
    'v3.25.0（2026-10-14）：蓄水池 · 互购净额台账——订单勾选计入 A/B 两侧、按币种净额 + 参考净额折算、结算即标记已结算、手工账同步新建订单',
    'v3.24.1（2026-10-07）：修复活动商品卡型号名错位（类型改为输入框后与型号并排溢出卡片）',
    'v3.24.0（2026-10-07）：账户与设置新增「关于」选项卡（作者 / 项目地址 / 版本与更新日志）',
    'v3.23.0（2026-10-07）：QQ 工单快捷导航 / 购买计划批量状态+恢复默认 / 活动商品随订单删改自动同步 / 商品卡制品类型可改 / UI polish',
    'v3.22.0（2026-09-30）：C 端商城 V1 上线——邮箱验证码登录 → 橱窗选购 → 购物车下单 → 唯一尾数支付 → 订单跟踪',
    'v3.21.1（2026-09-26）：QQ 工单独立视图 + relay 根路由 ticketOp 协议（/onebot/* 透传实测不可用的修订）'
  ]
};

// 「关于」选项卡：toggle 展开/收起卡片体，render 填充版本/日志/链接（进入设置页时由 Aoi.nav 调用）
Aoi.about = {
  render: function () {
    var a = Aoi.ABOUT;
    var ver = document.getElementById('aboutVersion');
    if (ver) ver.textContent = a.version + '（' + a.buildDate + '）';
    var log = document.getElementById('aboutLog');
    if (log) log.innerHTML = a.log.map(function (line) {
      return '<li class="mb-1">' + Aoi.escapeHtml(line) + '</li>';
    }).join('');
    var set = function (id, url) {
      var el = document.getElementById(id);
      if (el) { el.href = url; el.textContent = url.replace(/^https?:\/\//, ''); }
    };
    set('aboutRepoLink', a.repo);
    set('aboutSiteLink', a.site);
    set('aboutChangelogLink', a.changelog);
    set('aboutOrigLink', a.originalRepo);
  },
  toggle: function () {
    var body = document.getElementById('aboutBody');
    if (!body) return;
    var hidden = body.classList.toggle('hidden');
    var chev = document.getElementById('aboutChevron');
    if (chev) chev.style.transform = hidden ? '' : 'rotate(180deg)';
    var btn = document.getElementById('aboutToggleBtn');
    if (btn) btn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
  }
};

// 侧边栏开关（v3.32.0 按视口分支）：
// 手机端 = 抽屉滑入 + 遮罩（translate 位移，v3.31.1 行为不变）；
// 桌面端 = 流内折叠——点击汉堡在原位展开/收起（md:hidden 显隐），内容自适应让位，
// 不再以全屏遮罩盖住右侧内容。无参切换，true 展开 / false 收起
Aoi.toggleSidebar = function (open) {
  var sb = document.getElementById('sidebar');
  var bd = document.getElementById('sidebarBackdrop');
  if (!sb) return;
  var mobile = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  if (mobile) {
    if (open === undefined) open = sb.classList.contains('-translate-x-full');
    sb.classList.toggle('-translate-x-full', !open);
    if (bd) bd.classList.toggle('hidden', !open);
    return;
  }
  if (open === undefined) open = sb.classList.contains('md:hidden');
  sb.classList.toggle('md:hidden', !open);
  if (bd) bd.classList.add('hidden');
};

// 工作台侧栏抽屉（v3.31.1）：手机端 wbSidebar 为 fixed 覆盖层，开合与经典侧栏同款
//（translate 滑入滑出 + 复用遮罩）；桌面端 md:translate-x-0 覆盖位移保持常驻布局。
Aoi.toggleWorkbenchSidebar = function (open) {
  var wb = document.getElementById('wbSidebar');
  if (!wb) return;
  if (open === undefined) open = wb.classList.contains('-translate-x-full');
  wb.classList.toggle('-translate-x-full', !open);
  var bd = document.getElementById('sidebarBackdrop');
  if (bd) bd.classList.toggle('hidden', !open);
};

// 头部汉堡按钮（v3.31.1）：按当前外壳分发——workbench 外壳开合工作台侧栏，其余开合经典侧栏
Aoi.toggleNavDrawer = function () {
  if (Aoi.shell === 'workbench') Aoi.toggleWorkbenchSidebar();
  else Aoi.toggleSidebar();
};

// 一次性收起全部抽屉（nav 切视图 / 遮罩点击共用）：
// 经典侧栏仅手机端收（桌面端是流内折叠面板，nav 切视图保持用户开合状态不强制收起）
Aoi.closeDrawers = function () {
  var mobile = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
  if (mobile) Aoi.toggleSidebar(false);
  Aoi.toggleWorkbenchSidebar(false);
};

// XSS 防护：转义后再插入 DOM。引号也转义——value="…"/href="…"/title="…" 等
// 属性插值点曾可被含 " 的输入突破属性边界注入事件（v3.10.0 修复）
Aoi.escapeHtml = function (str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// URL 协议白名单（v3.10.0）：仅放行 http/https（含 // 协议相对与站内相对路径）。
// 团员凭证、商品参考图/跳转链接、收款码等外部输入的 URL 一律先经此清洗，
// javascript:/data: 等危险协议返回空串（写入侧拦截 + 渲染侧兜底旧数据）。
Aoi.safeUrl = function (url) {
  var s = String(url == null ? '' : url).trim();
  if (!s) return '';
  try {
    var u = new URL(s, 'https://aoi.invalid');
    if (u.protocol === 'http:' || u.protocol === 'https:') return s;
  } catch (e) { /* 解析失败按不合法处理 */ }
  return '';
};

// Toast 通知（右上角，3 秒自动消失）
Aoi.toast = function (msg, type) {
  type = type || 'info';
  var palette = {
    success: { bg: '#5db872', icon: '✅' },
    error:   { bg: '#c64545', icon: '❌' },
    warning: { bg: '#d4a017', icon: '⚠️' },
    info:    { bg: '#3d3d3a', icon: 'ℹ️' }
  };
  var p = palette[type] || palette.info;
  var el = document.createElement('div');
  el.textContent = p.icon + ' ' + msg;
  el.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:9999;max-width:20rem;'
    + 'background:' + p.bg + ';color:#fff;padding:0.75rem 1rem;border-radius:0.5rem;'
    + 'font-size:0.875rem;box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:opacity 0.3s;';
  document.body.appendChild(el);
  setTimeout(function () {
    el.style.opacity = '0';
    setTimeout(function () { el.remove(); }, 300);
  }, 3000);
};

// 全屏 loading 遮罩
Aoi.showLoading = function (text) {
  var el = document.getElementById('globalLoading');
  var txt = document.getElementById('loadingText');
  if (txt) txt.textContent = text || '处理中...';
  if (el) el.classList.remove('hidden');
};
Aoi.hideLoading = function () {
  var el = document.getElementById('globalLoading');
  if (el) el.classList.add('hidden');
};

// 自定义确认弹窗（替换原生 confirm；opts 支持 { title, okText, danger }）
Aoi.confirm = function (msg, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var modal = document.getElementById('confirmModal');
    var title = document.getElementById('confirmTitle');
    var body = document.getElementById('confirmBody');
    var okBtn = document.getElementById('confirmOk');
    var cancelBtn = document.getElementById('confirmCancel');
    if (!modal || !okBtn || !cancelBtn) { resolve(window.confirm(msg)); return; }
    if (title) title.textContent = opts.title || '确认操作';
    if (body) body.textContent = msg;
    okBtn.textContent = opts.okText || '确定';
    okBtn.className = 'px-4 py-2 rounded font-bold text-white '
      + (opts.danger ? 'bg-red-600 hover:bg-red-700' : 'btn-primary');
    modal.classList.remove('hidden');
    var done = false;
    function onOk() { close(true); }
    function onCancel() { close(false); }
    function close(val) {
      if (done) return;
      done = true;
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(val);
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
};

// 复制文本到剪贴板（含降级）
Aoi.copyText = function (text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise(function (resolve) {
    var ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta); resolve();
  });
};

// 币种符号（订单外币原价 / 限购商品原价显示共用）
Aoi.currencySymbol = function (code) {
  return code === 'jpy' ? 'JP¥' : (code === 'krw' ? '₩' : '¥');
};

// 下载 CSV 文本（自动加 BOM，保证 Excel 打开中文不乱码）
Aoi.downloadCsv = function (csvText, filename) {
  var blob = new Blob(['\ufeff' + csvText], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

// 表内被勾选行的 data-id 集合（.row-check / .ship-check 等，供行选择导出）
Aoi.exportSelectedIds = function (table) {
  var ids = [];
  table.querySelectorAll('input[type="checkbox"][data-id]').forEach(function (cb) {
    if (cb.checked) ids.push(cb.getAttribute('data-id'));
  });
  return ids;
};

// 克隆表仅保留选中行（表头完整保留）；ids 为空时原样返回
Aoi.exportFilterRows = function (clone, ids) {
  if (!ids || !ids.length) return clone;
  var set = {};
  ids.forEach(function (id) { set[id] = 1; });
  clone.querySelectorAll('tbody tr').forEach(function (tr) {
    var cb = tr.querySelector('input[type="checkbox"][data-id]');
    if (cb && !set[cb.getAttribute('data-id')]) tr.remove();
  });
  return clone;
};

// 克隆表导出前展平表单控件（v3.32.0）：input/textarea 的值只存在于 .value，html2canvas
// 不渲染、table_to_book/innerText 读不到——导出后列空白（国际计算「国内额外金额」实测）。
// 将 input/textarea 替换为等宽 span（textContent = value），select 替换为所选 option 文本，
// hidden input 直接删除；checkbox（勾选行）等非值控件原样保留
Aoi.exportFlattenInputs = function (clone) {
  clone.querySelectorAll('input, select, textarea').forEach(function (el) {
    if (el.type === 'hidden') { el.remove(); return; }
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return;
    var text = el.tagName === 'SELECT'
      ? ((el.selectedOptions && el.selectedOptions[0] && el.selectedOptions[0].textContent) || '')
      : (el.value || '');
    var span = document.createElement('span');
    span.textContent = text;
    span.className = el.className;
    el.replaceWith(span);
  });
  return clone;
};

// 导出文件基础名（v3.6.0 S5）：data-name = 表格类型；按钮可带 data-activity-from="<下拉id>"，
// 该下拉当前选中活动非空时文件名变为「活动名-表格类型」（非法文件名字符替换为 -，空则维持原名）；
// v3.17.0：另支持 data-batch-from="<批次下拉id>"——按批次 ID 取批次显示名（name 优先回落日期）
// 作前缀（国际计算各表按当前批次导出），活动前缀优先、两者皆空维持原名
Aoi.exportBaseName = function (btn) {
  var name = btn.getAttribute('data-name') || '表格';
  var prefix = '';
  var fromId = btn.getAttribute('data-activity-from');
  if (fromId) {
    var el = document.getElementById(fromId);
    prefix = el ? (el.value || '').trim() : '';
  }
  if (!prefix) {
    var batchFrom = btn.getAttribute('data-batch-from');
    if (batchFrom) {
      var sel = document.getElementById(batchFrom);
      var batchId = sel ? (sel.value || '').trim() : '';
      var batch = (batchId && Aoi.intl && Aoi.intl.getBatch) ? Aoi.intl.getBatch(batchId) : null;
      if (batch) prefix = (Aoi.orders.batchLabel(batch) || '').trim();
    }
  }
  if (!prefix) return name;
  return prefix.replace(/[\\/:*?"<>|]/g, '-') + '-' + name;
};

// Promise 超时包装（v3.9.3）：p 在 ms 内未落定则 reject——html2canvas 遇到挂起的
// 外部图片会无限 pending（观感"点了没反应"），此处兜底转为显式错误
Aoi.promiseTimeout = function (p, ms, msg) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      reject(new Error(msg || '操作超时'));
    }, ms);
    p.then(function (v) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }, function (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
  });
};

// 导出表格为 PNG 图片（html2canvas）。按钮需带 data-table（表 id）+ data-name（文件名），
// 可选 data-activity-from（活动下拉 id，文件名自动加活动名前缀）
// 表内有勾选行时询问：仅导出选中行（确定）/ 导出整表（取消）
Aoi.exportImage = function (btn) {
  var id = btn.getAttribute('data-table');
  var name = Aoi.exportBaseName(btn);
  var table = document.getElementById(id);
  if (!table) return;
  if (typeof html2canvas !== 'function') { Aoi.toast('图片导出组件未加载', 'error'); return; }
  var selected = Aoi.exportSelectedIds(table);
  var onlySelected = selected.length > 0 &&
    window.confirm('已勾选 ' + selected.length + ' 行。\n确定 = 仅导出选中的行；取消 = 导出整表。');
  // 克隆到离屏白色容器再截图，避免受滚动/隐藏容器影响，并留出边距
  var holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:-9999px;top:0;background:#fff;padding:16px;';
  holder.appendChild(Aoi.exportFlattenInputs(Aoi.exportFilterRows(table.cloneNode(true), onlySelected ? selected : [])));
  document.body.appendChild(holder);
  var label = onlySelected ? name + '（选中 ' + selected.length + ' 行）' : name;
  Aoi.showLoading('正在生成「' + label + '」图片…');
  Aoi.promiseTimeout(
    html2canvas(holder, { backgroundColor: '#ffffff', scale: 2 }),
    30000,
    '图片生成超时——表格内可能有加载缓慢或不可达的外部图片，请稍后重试或勾选更少行'
  ).then(function (canvas) {
    Aoi.hideLoading();
    document.body.removeChild(holder);
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = label + '.png';
    a.click();
    Aoi.toast('已导出「' + label + '」图片', 'success');
  }).catch(function (e) {
    Aoi.hideLoading();
    document.body.removeChild(holder);
    Aoi.toast('导出图片失败：' + (e && e.message ? e.message : '未知错误'), 'error');
  });
};

// 导出表格为文件（v2.0.0）：优先 SheetJS .xlsx，CDN 未加载时回退 CSV。
// 按钮属性与 exportImage 一致：data-table（表 id）+ data-name（文件名）
// + 可选 data-activity-from（活动下拉 id，v3.6.0 文件名加活动名前缀）
Aoi.tableExport = function (btn) {
  var id = btn.getAttribute('data-table');
  var name = Aoi.exportBaseName(btn);
  var table = document.getElementById(id);
  if (!table) return;
  var clone = Aoi.exportFlattenInputs(table.cloneNode(true));
  if (typeof XLSX === 'object' && XLSX.utils) {
    try {
      var wb = XLSX.utils.table_to_book(clone, { sheet: 'Sheet1' });
      XLSX.writeFile(wb, name + '.xlsx');
      Aoi.toast('已下载「' + name + '」.xlsx', 'success');
      return;
    } catch (e) { /* 回退 CSV */ }
  }
  var rows = [];
  clone.querySelectorAll('tr').forEach(function (tr) {
    var cells = [];
    tr.querySelectorAll('th,td').forEach(function (c) {
      cells.push('"' + (c.innerText || '').replace(/"/g, '""') + '"');
    });
    rows.push(cells.join(','));
  });
  Aoi.downloadCsv(rows.join('\n'), name + '.csv');
  Aoi.toast('已下载「' + name + '」.csv', 'success');
};

// —— 撤销机制：删除前快照，30 秒内可恢复 ——

Aoi.undo = { snapshot: null, label: '', timer: null };

Aoi.undo.arm = function (label, d) {
  var u = Aoi.undo;
  if (u.timer) clearTimeout(u.timer);
  u.snapshot = JSON.parse(JSON.stringify(d));
  u.label = label;
  u.timer = setTimeout(Aoi.undo.clear, 30000);
  var bar = document.getElementById('undoBar');
  var txt = document.getElementById('undoLabel');
  if (txt) txt.textContent = label;
  if (bar) bar.classList.remove('hidden');
};

Aoi.undo.restore = async function () {
  var u = Aoi.undo;
  if (!u.snapshot) return;
  var snap = u.snapshot, label = u.label;
  Aoi.undo.clear();
  await Aoi.saveTeamData(snap);
  Aoi.state.data = snap;
  Aoi.refreshViews();
  Aoi.toast('已撤销「' + label + '」', 'success');
};

Aoi.undo.clear = function () {
  var u = Aoi.undo;
  if (u.timer) clearTimeout(u.timer);
  u.snapshot = null; u.label = ''; u.timer = null;
  var bar = document.getElementById('undoBar');
  if (bar) bar.classList.add('hidden');
};

// 刷新所有视图（撤销恢复后调用）：与导航 / 头部「刷新」共用 VIEW_RENDERERS 注册表全量重画。
// view-tickets 除外——工单页是异步 relay 拉取，撤销是纯本地数据恢复，不应触发网络请求。
Aoi.refreshViews = function () {
  Object.keys(Aoi.VIEW_RENDERERS).forEach(function (id) {
    if (id === 'view-tickets') return;
    Aoi.VIEW_RENDERERS[id]();
  });
};

// 总览首页：登录后待办统计（待审核 / 待催缴 / 待发货 / 未到货）+ 开设 IP 一览
Aoi.overview = {
  render: function () {
    var d = Aoi.state.data || {};
    var orders = d.orders || [];
    var payments = d.payments || [];
    var set = function (id, n) {
      var el = document.getElementById(id);
      if (el) el.textContent = n;
    };
    set('ovPending', payments.filter(function (p) { return p.status === '待审核'; }).length);
    // 待催缴：按「批次 × 买家」从 buyerSummary 汇总，避免遗漏无 payments 记录的买家
    var unpaid = 0;
    (d.batches || []).forEach(function (b) {
      Aoi.approval.buyerSummary(b.id).forEach(function (r) {
        if (r.status === '待交' || r.status === '已驳回') unpaid++;
      });
    });
    set('ovUnpaid', unpaid);
    set('ovToShip', orders.filter(function (o) { return o.status === '已到货' && (o.shipped || '未发') === '未发'; }).length);
    set('ovToArrive', orders.filter(function (o) { return (o.status || '未到货') === '未到货'; }).length);

    // 开设 IP 一览
    var ipBox = document.getElementById('ovIpList');
    if (ipBox) {
      var ips = Aoi.orders.collectIps(d);
      ipBox.innerHTML = ips.length ? ips.map(function (ip) {
        var count = Aoi.orders.activitiesByIp(ip).length;
        return '<button data-ovip="' + Aoi.escapeHtml(ip) + '" class="px-3 py-1.5 bg-gray-100 hover:bg-blue-100 rounded text-sm text-left">'
          + Aoi.escapeHtml(ip) + ' <span class="text-xs text-gray-400">' + count + '</span></button>';
      }).join('') : '<span class="text-sm text-gray-400">暂无 IP</span>';
    }
  },
  showIp: function (ip) {
    var d = Aoi.state.data || {};
    var acts = Aoi.orders.activitiesByIp(ip);
    var box = document.getElementById('ovIpActivities');
    if (!box) return;
    var head = '<div class="flex items-center justify-between mb-2">'
      + '<h4 class="text-sm font-semibold">' + Aoi.escapeHtml(ip) + ' 的活动</h4>'
      + '<button data-ovdel-ip="' + Aoi.escapeHtml(ip) + '" class="text-xs text-red-500 hover:underline">删除该 IP</button></div>';
    box.innerHTML = head
      + (acts.length ? acts.map(function (a) {
          var m = (d.activityMeta && d.activityMeta[a]) || {};
          return '<div class="flex items-center gap-2 py-1 border-b border-gray-100 text-sm">'
            + '<button data-ovjump="' + Aoi.escapeHtml(a) + '" class="font-medium text-blue-600 hover:underline text-left">' + Aoi.escapeHtml(a) + '</button>'
            + '<span class="text-xs text-gray-400">' + Aoi.escapeHtml(m.status || '未开始') + '</span></div>';
        }).join('') : '<span class="text-sm text-gray-400">该 IP 下暂无活动</span>');
  }
};

// 总览 IP 一览：点击 IP 查看其活动（事件委托；IP 经 data 属性传递，避免内联 onclick 注入）
document.addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-ovip]');
  if (btn) { Aoi.overview.showIp(btn.getAttribute('data-ovip')); return; }
  var jump = e.target.closest('button[data-ovjump]');
  if (jump) { Aoi.orders.jumpToActivity(jump.getAttribute('data-ovjump')); return; }
  var del = e.target.closest('button[data-ovdel-ip]');
  if (del) Aoi.orders.removeIp(del.getAttribute('data-ovdel-ip'));
});
