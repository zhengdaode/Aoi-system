// Aoi-system — 主页面（v3.30.0）：代替总览成为打开网站的默认界面。
// ① 启动动画：黑屏白字「你好」停留 1.5s → 缩放为黑色呼吸透明边框启动按钮、背景渐白，
//   再 1.5s 后主页 UI 先中间后四周显现；点击任意处跳过。每次启动（页面加载）只播一次。
// ② 中心信息区：待办任务 + 临近出荷；正中「你好」按钮（悬浮渐变为「开始工作」）进工作台。
// ③ 自定义功能快捷跳转：14 格环绕，功能标题居中放大、底色取所在自定义分类的颜色（v3.31.0）；
//   未编辑为浅色边框空格 + 悬浮加号；右下角齿轮进入编辑。
// ④ 功能面板（view-launcher，图2 临时界面）：左上返回、按类型彩色分组的全部功能，
//   既可作空格选功能的选择器，也可独立跳转。
window.Aoi = window.Aoi || {};

Aoi.home = (function () {
  var SLOTS = 14;
  var LS_SHORTCUTS = 'aoi_home_shortcuts';
  var bootPlayed = false;
  var editMode = false;
  var pickerSlot = null; // 功能面板处于「为第 N 格挑选功能」模式时为格号，否则 null
  var bootTimers = [];

  function el(id) { return document.getElementById(id); }

  // —— 快捷跳转存储（localStorage，设备级 UI 偏好，不入 blob）——
  function loadShortcuts() {
    try {
      var arr = JSON.parse(localStorage.getItem(LS_SHORTCUTS) || 'null');
      if (Array.isArray(arr)) {
        var out = [];
        for (var i = 0; i < SLOTS; i++) out.push(typeof arr[i] === 'string' ? arr[i] : null);
        return out;
      }
    } catch (e) { /* 损坏则重置 */ }
    var empty = [];
    for (var j = 0; j < SLOTS; j++) empty.push(null);
    return empty;
  }
  function saveShortcuts(arr) { localStorage.setItem(LS_SHORTCUTS, JSON.stringify(arr)); }

  function featById(id) { return Aoi.workbench ? Aoi.workbench.featById(id) : null; }
  // 14 格位置：r1 四格；r2–r4 两侧各一格（中央面板跨 2–4 行 × 2–3 列）；r5 四格
  function tilePos(i) {
    if (i < 4) return { col: i + 1, row: 1 };
    if (i < 10) return { col: (i % 2 === 0) ? 1 : 4, row: 2 + Math.floor((i - 4) / 2) };
    return { col: i - 9, row: 5 };
  }
  function tileDelay(i) {
    if (i < 4) return 200;
    if (i < 6) return 150;
    if (i < 10) return 300;
    return 400;
  }

  // —— 外壳模式：classic（原侧栏）/ home（主页全屏，隐藏侧栏与头部）/ workbench（工作台侧栏）——
  Aoi.shell = Aoi.shell || 'classic';
  Aoi.setShell = function (mode) {
    Aoi.shell = mode;
    var sb = el('sidebar');
    var wb = el('wbSidebar');
    var header = document.querySelector('#screen-app > main > header');
    var main = document.querySelector('#screen-app > main');
    var backdrop = el('sidebarBackdrop');
    var home = mode === 'home';
    var wbm = mode === 'workbench';
    if (sb) {
      sb.classList.toggle('hidden', home || wbm);
      if (home || wbm) sb.classList.add('-translate-x-full');
    }
    if (wb) {
      wb.classList.toggle('hidden', !wbm);
      // 离开工作台外壳时把手机抽屉复位到收起位（桌面端 md:translate-x-0 覆盖，不影响常驻布局）
      if (!wbm) wb.classList.add('-translate-x-full');
    }
    if (header) header.classList.toggle('hidden', home);
    if (main) main.classList.toggle('p-0', home);
    if (backdrop && (home || wbm)) backdrop.classList.add('hidden');
  };
  // 导航挂钩：只有回主页强制 home 外壳；其余视图沿用当前外壳（工作台内导航保持工作台）
  Aoi.applyShellForView = function (viewId) {
    if (viewId === 'view-home') Aoi.setShell('home');
  };

  // —— 进入主页面（登录后 withAnim=true 播启动动画；此后再回主页不重播）——
  function enter(withAnim) {
    Aoi.setShell('home');
    Aoi.nav('view-home');
    if (withAnim && !bootPlayed) playBoot();
    else finishBoot();
  }

  // —— 启动动画 ——
  function clearBootTimers() {
    bootTimers.forEach(function (t) { clearTimeout(t); });
    bootTimers = [];
  }
  function playBoot() {
    bootPlayed = true;
    var ov = el('bootAnim');
    var view = el('view-home');
    if (!ov || !view) return;
    clearBootTimers();
    ov.classList.remove('hidden', 'boot-fade', 'stage2');
    view.classList.add('pre-reveal');
    void ov.offsetWidth; // 强制回流，保证入场类生效
    bootTimers.push(setTimeout(function () { ov.classList.add('stage2'); }, 1500));
    bootTimers.push(setTimeout(function () { finishBoot(); }, 3000));
  }
  function finishBoot() {
    clearBootTimers();
    var ov = el('bootAnim');
    var view = el('view-home');
    if (ov) {
      ov.classList.add('boot-fade');
      bootTimers.push(setTimeout(function () {
        ov.classList.add('hidden');
        ov.classList.remove('boot-fade', 'stage2');
      }, 350));
    }
    if (view) view.classList.remove('pre-reveal');
  }
  function skipBoot() { finishBoot(); }

  // —— 主页面渲染 ——
  // 注意：先重建格子与中央面板 DOM，再填 KPI/临近出荷——否则值会被 innerHTML 重建冲掉
  function render() {
    renderTiles();
    var d = Aoi.state.data || {};
    var orders = d.orders || [];
    var payments = d.payments || [];
    var set = function (id, n) { var x = el(id); if (x) x.textContent = n; };
    set('homeTodoPending', payments.filter(function (p) { return p.status === '待审核'; }).length);
    var unpaid = 0;
    (d.batches || []).forEach(function (b) {
      (Aoi.approval.buyerSummary(b.id) || []).forEach(function (r) {
        if (r.status === '待交' || r.status === '已驳回') unpaid++;
      });
    });
    set('homeTodoUnpaid', unpaid);
    set('homeTodoShip', orders.filter(function (o) { return o.status === '已到货' && (o.shipped || '未发') === '未发'; }).length);
    set('homeTodoArrive', orders.filter(function (o) { return (o.status || '未到货') === '未到货'; }).length);

    // 临近出荷：已到货未发订单按到货批次聚合，按日期取最近 3 个
    var shipBox = el('homeShipList');
    if (shipBox) {
      var byBatch = {};
      orders.forEach(function (o) {
        if (o.status === '已到货' && (o.shipped || '未发') === '未发') {
          var k = o.batch || '';
          byBatch[k] = (byBatch[k] || 0) + (o.count || 1);
        }
      });
      var rows = (d.batches || []).filter(function (b) { return byBatch[b.id]; })
        .slice().sort(function (a, b) { return (a.date || '') < (b.date || '') ? -1 : 1; })
        .slice(0, 3);
      shipBox.innerHTML = rows.length ? rows.map(function (b) {
        return '<button onclick="Aoi.home.jump(\'view-ship\')" class="home-ship-row">'
          + '<span class="truncate">' + Aoi.escapeHtml(Aoi.orders.batchLabel(b)) + '</span>'
          + '<span class="text-xs text-gray-400 shrink-0">' + Aoi.escapeHtml(b.date || '') + ' · ' + byBatch[b.id] + ' 件待发</span></button>';
      }).join('') : '<p class="text-xs text-gray-500">暂无临近出荷的批次</p>';
    }

    fillAvatar();
    var gear = el('homeGear');
    if (gear) gear.classList.toggle('home-gear-active', editMode);
  }

  function renderTiles() {
    var grid = el('homeGrid');
    if (!grid) return;
    var shorts = loadShortcuts();
    var html = '';
    for (var i = 0; i < SLOTS; i++) {
      var pos = tilePos(i);
      var style = 'grid-column:' + pos.col + ';grid-row:' + pos.row + ';--rd:' + tileDelay(i) + 'ms';
      var vid = shorts[i];
      var f = vid ? featById(vid) : null;
      if (f) {
        // v3.31.0：功能标题居中放大；底色 = 所在自定义分类的颜色（无分类回落默认奶油底）
        var col = (Aoi.workbench && Aoi.workbench.collectionColorOf) ? (Aoi.workbench.collectionColorOf(vid) || '') : '';
        var colBg = (col && Aoi.workbench.tint) ? ';background:' + Aoi.workbench.tint(col, '3d') : '';
        html += '<button data-hslot="' + i + '" class="hq home-tile home-tile-filled" style="' + style + colBg + '" title="' + Aoi.escapeHtml(f.label) + '">'
          + '<span class="home-tile-label">' + Aoi.escapeHtml(f.label) + '</span>'
          + (editMode ? '<span class="home-tile-x" data-hclear="' + i + '" title="清除此快捷跳转">×</span>' : '')
          + '</button>';
      } else {
        html += '<button data-hslot="' + i + '" class="hq home-tile home-tile-empty" style="' + style + '" title="点击选择要快捷跳转的功能">'
          + '<span class="home-tile-plus">＋</span></button>';
      }
    }
    // 中央面板：待办 + 你好 + 临近出荷（先中间后四周：--rd 0）
    html += '<div class="hq home-center" style="grid-column:2/4;grid-row:2/5;--rd:0ms">'
      + '<div class="home-center-info">'
      + '<p class="home-center-title">待办任务</p>'
      + '<div class="flex flex-wrap gap-2">'
      + '<button onclick="Aoi.home.jump(\'view-approval\')" class="home-todo-chip">待审核 <b id="homeTodoPending">0</b></button>'
      + '<button onclick="Aoi.home.jump(\'view-approval\')" class="home-todo-chip">待催缴 <b id="homeTodoUnpaid">0</b></button>'
      + '<button onclick="Aoi.home.jump(\'view-ship\')" class="home-todo-chip">待发货 <b id="homeTodoShip">0</b></button>'
      + '<button onclick="Aoi.home.jump(\'view-orders\')" class="home-todo-chip">未到货 <b id="homeTodoArrive">0</b></button>'
      + '</div></div>'
      + '<div class="home-hello-wrap">'
      + '<button id="homeHello" onclick="Aoi.workbench.enter()" class="home-hello" title="进入工作台">'
      + '<span class="home-hello-text"><span class="ht-a">你好</span><span class="ht-b">开始工作</span></span>'
      + '</button></div>'
      + '<div class="home-center-info">'
      + '<p class="home-center-title">临近出荷</p>'
      + '<div id="homeShipList" class="space-y-1"></div>'
      + '</div></div>';
    grid.innerHTML = html;
  }

  function fillAvatar() {
    var initial = 'A';
    if (Aoi.state.user && Aoi.state.user.username) initial = Aoi.state.user.username.slice(0, 1).toUpperCase();
    ['homeAvatar', 'hdrAvatar'].forEach(function (id) {
      var x = el(id);
      if (x) x.textContent = initial;
    });
  }

  // —— 快捷跳转交互 ——
  function jump(viewId) {
    Aoi.setShell('classic');
    Aoi.nav(viewId);
  }
  function toggleEdit() {
    editMode = !editMode;
    render();
    Aoi.toast(editMode ? '快捷跳转编辑中：点空格挑选功能，点已设格可重选，点 × 清除' : '已退出编辑', 'info');
  }
  function clearShortcut(i) {
    var shorts = loadShortcuts();
    shorts[i] = null;
    saveShortcuts(shorts);
    render();
  }
  function setShortcut(i, viewId) {
    var shorts = loadShortcuts();
    shorts[i] = viewId;
    saveShortcuts(shorts);
  }
  function openLauncher(slot) {
    pickerSlot = (typeof slot === 'number') ? slot : null;
    Aoi.nav('view-launcher');
  }
  function assignFromLauncher(viewId) {
    if (pickerSlot != null) {
      setShortcut(pickerSlot, viewId);
      pickerSlot = null;
      Aoi.nav('view-home'); // 回主页继续编辑态（不重播动画）
    } else {
      jump(viewId);
    }
  }
  function launcherBack() {
    pickerSlot = null;
    if (Aoi.navHistory.length) Aoi.navBack();
    else Aoi.nav('view-home');
  }

  // —— 功能面板（图2）：按类型彩色分组展示全部功能 ——
  function renderLauncher() {
    var body = el('launcherBody');
    if (!body) return;
    var head = pickerSlot != null
      ? '<p class="text-sm text-gray-500 mb-4">正在为快捷跳转第 ' + (pickerSlot + 1) + ' 格挑选功能——点击下方功能卡完成设置，或点「返回」取消</p>'
      : '<p class="text-sm text-gray-500 mb-4">全部功能一览，点击卡片直达（不同颜色代表不同类型）</p>';
    var cls = { '业务': 'lt-biz', '基础数据': 'lt-data', '工具': 'lt-tool' };
    var headCls = { '业务': 'lh-biz', '基础数据': 'lh-data', '工具': 'lh-tool' };
    var html = head;
    Aoi.workbench.GROUP_ORDER.forEach(function (g) {
      var feats = Aoi.workbench.FEATURES.filter(function (f) { return f.group === g; });
      if (!feats.length) return;
      html += '<div class="mb-8"><p class="launcher-head ' + headCls[g] + '">' + g + '</p>'
        + '<div class="launcher-grid">'
        + feats.map(function (f) {
          return '<button data-lview="' + f.id + '" class="launcher-tile ' + cls[g] + '">' + Aoi.escapeHtml(f.label) + '</button>';
        }).join('')
        + '</div></div>';
    });
    body.innerHTML = html;
  }

  // —— 顶栏占位端口（暂不填充内容）——
  function langPlaceholder() { Aoi.toast('切换语言：端口预留，多语言支持敬请期待', 'info'); }
  function avatarPlaceholder() { Aoi.toast('用户中心：端口预留，敬请期待', 'info'); }

  // 事件委托：主页格子 / 功能面板卡片 / 启动动画跳过
  document.addEventListener('click', function (e) {
    var ov = el('bootAnim');
    if (ov && !ov.classList.contains('hidden') && ov.contains(e.target)) { skipBoot(); return; }
    var xc = e.target.closest('[data-hclear]');
    if (xc) { e.stopPropagation(); clearShortcut(parseInt(xc.getAttribute('data-hclear'), 10)); return; }
    var tile = e.target.closest('.home-tile');
    if (tile) {
      var i = parseInt(tile.getAttribute('data-hslot'), 10);
      if (tile.classList.contains('home-tile-empty')) { openLauncher(i); return; }
      var shorts = loadShortcuts();
      if (editMode) { openLauncher(i); return; }
      var vid = shorts[i];
      if (vid) jump(vid);
      return;
    }
    var lv = e.target.closest('[data-lview]');
    if (lv) { assignFromLauncher(lv.getAttribute('data-lview')); return; }
  });

  // 主页 / 功能面板 / 自定义排序视图进入时的渲染钩子（由 core.js renderView 调用）
  Aoi.applyShellForView = Aoi.applyShellForView; // 占位保持单一出口

  return {
    SLOTS: SLOTS,
    enter: enter,
    playBoot: playBoot,
    skipBoot: skipBoot,
    finishBoot: finishBoot,
    render: render,
    renderTiles: renderTiles,
    renderLauncher: renderLauncher,
    jump: jump,
    toggleEdit: toggleEdit,
    setShortcut: setShortcut,
    clearShortcut: clearShortcut,
    openLauncher: openLauncher,
    assignFromLauncher: assignFromLauncher,
    launcherBack: launcherBack,
    langPlaceholder: langPlaceholder,
    avatarPlaceholder: avatarPlaceholder,
    loadShortcuts: loadShortcuts,
    fillAvatar: fillAvatar,
    get pickerSlot() { return pickerSlot; },
    get editMode() { return editMode; },
    get bootPlayed() { return bootPlayed; }
  };
})();
