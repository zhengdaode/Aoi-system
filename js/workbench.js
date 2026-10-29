// Aoi-system — 工作台（v3.30.0）：小红书创作平台式侧栏外壳。
// 首页=总览 / 账号与设置沿用原视图；基础功能列表（原 Builder hub）= 静态全量目录
//（业务→基础数据→工具全部功能，不受自定义排序影响，v3.31.0）；
// 「自定义排序」分组展示设置页的个性化成果（自建分类 + 顺序 + 分类色底色，展示勾选只作用于此）；
// 娱乐活动工具 / 创意工坊 为端口预留；「敬请期待」为不可点击文字。
window.Aoi = window.Aoi || {};

Aoi.workbench = (function () {
  // 功能注册表：工作台基础功能列表、主页快捷跳转、功能面板、自定义排序共用的单一数据源
  var FEATURES = [
    { id: 'view-entry', label: '信息录入', group: '业务' },
    { id: 'view-orders', label: '订单管理', group: '业务' },
    { id: 'view-paigu', label: '排谷表', group: '业务' },
    { id: 'view-batches', label: '国际批次', group: '业务' },
    { id: 'view-intl', label: '国际计算', group: '业务' },
    { id: 'view-approval', label: '事务审批', group: '业务' },
    { id: 'view-ship', label: '发货管理', group: '业务' },
    { id: 'view-notify', label: '通知公告', group: '业务' },
    { id: 'view-tickets', label: 'QQ 工单', group: '业务' },
    { id: 'view-activities', label: '活动管理', group: '基础数据' },
    { id: 'view-buyers', label: '买家管理', group: '基础数据' },
    { id: 'view-types', label: '类型管理', group: '基础数据' },
    { id: 'view-warehouse', label: '囤货地管理', group: '基础数据' },
    { id: 'view-calc', label: '计算器', group: '工具' },
    { id: 'view-limits', label: '限购计划', group: '工具' },
    { id: 'view-reservoir', label: '蓄水池', group: '工具' },
    { id: 'view-catalog', label: 'PCO 目录导入', group: '工具' }
  ];
  var GROUP_ORDER = ['业务', '基础数据', '工具'];
  var LS_LAYOUT = 'aoi_wb_layout';
  // 自定义分类色板（v3.31.0）：分类色作为该分类内功能的 UI 底色
  //（侧栏「自定义排序」行 + 主页快捷格）；tint 取淡底保证任意色上文字可读
  var COLORS = ['#f97362', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
  function tint(hex, alphaHex) { return hex ? hex + (alphaHex || '2b') : ''; }
  var newCollColor = '';   // 「新建分类」当前选中的颜色（页面临时态，不入布局）
  var openColorFor = '';   // 左列正在展开调色板的分类名（'' = 无）

  function el(id) { return document.getElementById(id); }

  function loadLayout() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_LAYOUT) || 'null');
      if (o && Array.isArray(o.hidden) && Array.isArray(o.collections)) return o;
    } catch (e) { /* 损坏则重置 */ }
    return { hidden: [], collections: [] };
  }
  function saveLayout(l) { localStorage.setItem(LS_LAYOUT, JSON.stringify(l)); }

  function featById(id) {
    for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].id === id) return FEATURES[i];
    return null;
  }
  function isHidden(id) { return loadLayout().hidden.indexOf(id) >= 0; }
  function toggleHidden(id) {
    var l = loadLayout();
    var i = l.hidden.indexOf(id);
    if (i >= 0) l.hidden.splice(i, 1); else l.hidden.push(id);
    saveLayout(l);
    renderCustomNav(); renderSort();
  }
  function collectionOf(id) {
    var l = loadLayout();
    for (var i = 0; i < l.collections.length; i++) {
      if (l.collections[i].views.indexOf(id) >= 0) return l.collections[i].name;
    }
    return '';
  }
  function assign(id, coll) {
    var l = loadLayout();
    l.collections.forEach(function (c) {
      var i = c.views.indexOf(id);
      if (i >= 0) c.views.splice(i, 1);
    });
    if (coll) {
      for (var j = 0; j < l.collections.length; j++) {
        if (l.collections[j].name === coll) { l.collections[j].views.push(id); break; }
      }
    }
    saveLayout(l);
    renderCustomNav(); renderSort();
  }
  function addCollection(name, color) {
    name = String(name || '').trim();
    if (!name) return false;
    var l = loadLayout();
    for (var i = 0; i < l.collections.length; i++) if (l.collections[i].name === name) return false;
    l.collections.push({ name: name, color: String(color || ''), views: [] });
    saveLayout(l);
    renderCustomNav(); renderSort();
    return true;
  }
  function removeCollection(name) {
    var l = loadLayout();
    l.collections = l.collections.filter(function (c) { return c.name !== name; });
    saveLayout(l);
    renderCustomNav(); renderSort();
  }
  // 设置/清除分类颜色（v3.31.0）：颜色作为该分类内功能的 UI 底色
  function setCollectionColor(name, color) {
    var l = loadLayout();
    for (var i = 0; i < l.collections.length; i++) {
      if (l.collections[i].name === name) { l.collections[i].color = String(color || ''); break; }
    }
    saveLayout(l);
    renderCustomNav(); renderSort();
  }
  // 功能 id → 所在分类的颜色（不在任何分类或分类无色返回 ''）
  function collectionColorOf(id) {
    var l = loadLayout();
    for (var i = 0; i < l.collections.length; i++) {
      if (l.collections[i].views.indexOf(id) >= 0) return l.collections[i].color || '';
    }
    return '';
  }
  // 同一分类内上移/下移（delta -1/+1）：顺序即侧栏「自定义排序」分组内的展示顺序
  function moveInView(id, delta) {
    var l = loadLayout();
    for (var i = 0; i < l.collections.length; i++) {
      var views = l.collections[i].views;
      var p = views.indexOf(id);
      if (p < 0) continue;
      var q = p + delta;
      if (q < 0 || q >= views.length) return;
      var t = views[p]; views[p] = views[q]; views[q] = t;
      saveLayout(l);
      renderCustomNav(); renderSort();
      return;
    }
  }
  // 展示中的功能 = 未被隐藏的注册功能（隐藏只影响导航展示，功能本身与数据记录不受影响）
  function visibleFeatures() { return FEATURES.filter(function (f) { return !isHidden(f.id); }); }

  // 基础功能列表展开区：静态全量目录——注册表三分组（业务→基础数据→工具）全部功能。
  // 不受「设置自定义排序」的分类/顺序/展示勾选影响（那套个性化成果挂在侧栏「自定义排序」分组）。
  function buildNav() {
    var box = el('wbBuilderItems');
    if (!box) return;
    var html = '';
    GROUP_ORDER.forEach(function (g) {
      html += '<p class="text-[11px] font-mono uppercase tracking-widest text-gray-400 mt-3 mb-1 px-2">' + Aoi.escapeHtml(g) + '</p>';
      html += FEATURES.filter(function (f) { return f.group === g; }).map(navRow).join('');
    });
    box.innerHTML = html;
  }
  function navRow(f) {
    var extra = f.id === 'view-catalog' ? ';Aoi.catalog.renderAll()' : '';
    return '<a data-nav="' + f.id + '" onclick="Aoi.nav(\'' + f.id + '\')' + extra + '"'
      + ' class="block px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100">'
      + Aoi.escapeHtml(f.label) + '</a>';
  }

  // 侧栏「自定义排序」分组（v3.31.0）：设置页的成果在此展示——自建分类按创建/排序顺序展开，
  // 分类色作该分类功能的底色；取消「展示」勾选的功能不在此出现（基础功能列表恒为全量）。
  // 末尾常驻「设置自定义排序」入口；完全未自定义时给引导文案。
  function renderCustomNav() {
    var box = el('wbDataItems');
    if (!box) return;
    var l = loadLayout();
    var html = '';
    var any = false;
    l.collections.forEach(function (c) {
      var rows = (c.views || []).filter(function (id) { return featById(id) && !isHidden(id); });
      if (!rows.length) return;
      any = true;
      html += '<p class="text-[11px] font-mono uppercase tracking-widest text-gray-400 mt-3 mb-1 px-2 flex items-center gap-1.5">'
        + (c.color ? '<span class="inline-block w-2 h-2 rounded-full shrink-0" style="background:' + c.color + '"></span>' : '')
        + Aoi.escapeHtml(c.name) + '</p>';
      html += rows.map(function (id) { return customNavRow(featById(id), c.color); }).join('');
    });
    if (!any) html += '<p class="text-xs text-gray-400 px-2 py-2">尚未自定义——在「设置自定义排序」新建分类、归入功能后，即在此按你的顺序展示</p>';
    html += '<a data-nav="view-wbsort" onclick="Aoi.nav(\'view-wbsort\')" class="block px-3 py-1.5 rounded-md text-sm font-medium text-gray-500 cursor-pointer hover:bg-gray-100">⚙ 设置自定义排序</a>';
    box.innerHTML = html;
  }
  function customNavRow(f, color) {
    var extra = f.id === 'view-catalog' ? ';Aoi.catalog.renderAll()' : '';
    return '<a data-nav="' + f.id + '" onclick="Aoi.nav(\'' + f.id + '\')' + extra + '"'
      + (color ? ' style="background:' + tint(color) + '"' : '')
      + ' class="block px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 cursor-pointer' + (color ? '' : ' hover:bg-gray-100') + '">'
      + Aoi.escapeHtml(f.label) + '</a>';
  }

  // 进入工作台：外壳切到 workbench，默认落在「首页」（= 原总览仪表盘）
  function enter() {
    Aoi.setShell('workbench');
    buildNav();
    renderCustomNav();
    Aoi.nav('view-overview');
  }

  // 调色板行（v3.31.0）：色板 + 「无颜色」；当前色加 ring
  function paletteRow(attrPrefix, name, cur) {
    var dots = '<button ' + attrPrefix + '="' + Aoi.escapeHtml(name) + '|"'
      + ' class="w-4 h-4 rounded-full border border-dashed border-gray-300 bg-white' + (!cur ? ' ring-2 ring-offset-1 ring-gray-400' : '') + '" title="无颜色"></button>';
    COLORS.forEach(function (col) {
      dots += '<button ' + attrPrefix + '="' + Aoi.escapeHtml(name) + '|' + col + '"'
        + ' class="w-4 h-4 rounded-full' + (cur === col ? ' ring-2 ring-offset-1 ring-gray-400' : '') + '" style="background:' + col + '" title="' + col + '"></button>';
    });
    return dots;
  }

  // —— 自定义排序 → 设置自定义排序（Steam 库式分类面板）——
  function renderSort() {
    var list = el('wbFeatList');
    var collBox = el('wbCollList');
    if (!list) return;
    var l = loadLayout();
    // 新建分类区：颜色选择（与名称一起提交；选中态存页面临时态 newCollColor）
    var newBox = el('wbNewCollColors');
    if (newBox) {
      newBox.innerHTML = '<span class="text-xs text-gray-400">分类颜色</span>'
        + '<button data-wbnewcol="" class="w-4 h-4 rounded-full border border-dashed border-gray-300 bg-white' + (newCollColor === '' ? ' ring-2 ring-offset-1 ring-gray-400' : '') + '" title="无颜色"></button>'
        + COLORS.map(function (col) {
          return '<button data-wbnewcol="' + col + '" class="w-4 h-4 rounded-full' + (newCollColor === col ? ' ring-2 ring-offset-1 ring-gray-400' : '') + '" style="background:' + col + '" title="' + col + '"></button>';
        }).join('');
    }
    // 左列：分类列表（颜色 / 删除；点色块展开调色板改色）
    if (collBox) {
      var h = '<p class="text-xs font-bold text-gray-500 mb-2">分类</p>';
      l.collections.forEach(function (c) {
        h += '<div class="py-1">'
          + '<div class="flex items-center justify-between gap-1">'
          + '<span class="text-sm truncate min-w-0" title="' + Aoi.escapeHtml(c.name) + '">'
          + '<button data-wbcolcolor="' + Aoi.escapeHtml(c.name) + '" title="设置分类颜色（作该分类功能的底色）"'
          + ' class="inline-block w-3.5 h-3.5 rounded-full align-middle mr-1.5 border ' + (c.color ? '' : 'border-dashed border-gray-300') + '"'
          + (c.color ? ' style="background:' + c.color + '"' : '') + '></button>'
          + Aoi.escapeHtml(c.name)
          + ' <span class="text-xs text-gray-400">' + c.views.length + '</span></span>'
          + '<button data-wbcoldel="' + Aoi.escapeHtml(c.name) + '" class="text-xs text-red-400 hover:text-red-600 shrink-0" title="删除该分类（功能回落未分类）">删</button>'
          + '</div>'
          + (openColorFor === c.name
            ? '<div class="flex items-center gap-1.5 mt-1.5">' + paletteRow('data-wbcolset', c.name, c.color || '') + '</div>'
            : '')
          + '</div>';
      });
      if (!l.collections.length) h += '<p class="text-xs text-gray-400">暂无分类</p>';
      collBox.innerHTML = h;
    }
    // 右列：全部功能，按分类分组，每行可改归属 / 切换展示
    var sections = l.collections.map(function (c) { return c.name; }).concat(['未分类']);
    var html = '';
    sections.forEach(function (sec) {
      var rows = FEATURES.filter(function (f) {
        return sec === '未分类' ? !collectionOf(f.id) : collectionOf(f.id) === sec;
      });
      if (!rows.length) return;
      html += '<p class="text-xs font-bold text-gray-500 mt-4 mb-1.5 first:mt-0">' + Aoi.escapeHtml(sec) + '</p>';
      rows.forEach(function (f) {
        var hidden = isHidden(f.id);
        var col = collectionColorOf(f.id);
        var inColl = sec !== '未分类';
        var moves = inColl
          ? '<button data-wbmove="' + f.id + '|-1" class="text-xs text-gray-300 hover:text-gray-600 shrink-0 px-0.5" title="上移（「自定义排序」分组内的展示顺序）">↑</button>'
            + '<button data-wbmove="' + f.id + '|1" class="text-xs text-gray-300 hover:text-gray-600 shrink-0 px-0.5" title="下移（「自定义排序」分组内的展示顺序）">↓</button>'
          : '';
        var opts = '<option value="">未分类</option>' + l.collections.map(function (c) {
          return '<option value="' + Aoi.escapeHtml(c.name) + '"' + (collectionOf(f.id) === c.name ? ' selected' : '') + '>'
            + Aoi.escapeHtml(c.name) + '</option>';
        }).join('');
        html += '<div class="flex items-center gap-2 py-1.5 border-b border-gray-50 text-sm rounded"'
          + (col ? ' style="background:' + tint(col, '1f') + '"' : '') + '>'
          + '<span class="w-24 shrink-0 text-xs text-gray-400">' + Aoi.escapeHtml(f.group) + '</span>'
          + '<span class="flex-1 min-w-0 truncate ' + (hidden ? 'text-gray-300 line-through' : '') + '">' + Aoi.escapeHtml(f.label) + '</span>'
          + moves
          + '<select data-wbassign="' + f.id + '" class="border border-gray-200 rounded px-1.5 py-1 text-xs">' + opts + '</select>'
          + '<label class="flex items-center gap-1 text-xs text-gray-500 shrink-0"><input type="checkbox" data-wbshow="' + f.id + '"' + (hidden ? '' : ' checked') + '>展示</label>'
          + '</div>';
      });
    });
    list.innerHTML = html || '<p class="text-sm text-gray-400">暂无功能</p>';
  }
  function addCollectionFromInput() {
    var inp = el('wbNewColl');
    if (!inp) return;
    if (!addCollection(inp.value, newCollColor)) { Aoi.toast('分类名不能为空或与已有分类重复', 'warning'); return; }
    inp.value = '';
    newCollColor = '';
    renderSort();
    Aoi.toast('已新建分类', 'success');
  }

  // 侧栏分组展开/收起（基础功能列表 / 自定义排序，同小红书案例的展开属性）
  function toggleBuilder() {
    var box = el('wbBuilderItems');
    var chev = el('wbBuilderChevron');
    if (!box) return;
    var hidden = box.classList.toggle('hidden');
    if (chev) chev.textContent = hidden ? '▾' : '▴';
    if (!hidden) buildNav();
  }
  function toggleData() {
    var box = el('wbDataItems');
    var chev = el('wbDataChevron');
    if (!box) return;
    var hidden = box.classList.toggle('hidden');
    if (chev) chev.textContent = hidden ? '▾' : '▴';
    if (!hidden) renderCustomNav();
  }

  // 占位页（娱乐活动工具 / 创意工坊）：端口预留，暂不填充内容
  function renderPlaceholder() { /* 静态 HTML，预留钩子 */ }

  // 面板内事件委托（分类删除 / 分类颜色 / 新建区颜色 / 分类内排序 / 归属调整 / 展示切换）
  document.addEventListener('click', function (e) {
    var del = e.target.closest('button[data-wbcoldel]');
    if (del) { removeCollection(del.getAttribute('data-wbcoldel')); return; }
    var colbtn = e.target.closest('button[data-wbcolcolor]');
    if (colbtn) {
      var n = colbtn.getAttribute('data-wbcolcolor');
      openColorFor = (openColorFor === n) ? '' : n;
      renderSort();
      return;
    }
    var colset = e.target.closest('button[data-wbcolset]');
    if (colset) {
      var parts = colset.getAttribute('data-wbcolset').split('|');
      openColorFor = '';
      setCollectionColor(parts[0], parts[1] || '');
      return;
    }
    var newcol = e.target.closest('button[data-wbnewcol]');
    if (newcol) { newCollColor = newcol.getAttribute('data-wbnewcol') || ''; renderSort(); return; }
    var mv = e.target.closest('button[data-wbmove]');
    if (mv) {
      var mp = mv.getAttribute('data-wbmove').split('|');
      moveInView(mp[0], parseInt(mp[1], 10) || 0);
      return;
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-wbassign')) { assign(t.getAttribute('data-wbassign'), t.value || ''); return; }
    if (t.hasAttribute && t.hasAttribute('data-wbshow')) {
      var id = t.getAttribute('data-wbshow');
      var willHide = !t.checked;
      var cur = isHidden(id);
      if (willHide !== cur) toggleHidden(id);
    }
  });

  return {
    FEATURES: FEATURES,
    GROUP_ORDER: GROUP_ORDER,
    COLORS: COLORS,
    tint: tint,
    enter: enter,
    buildNav: buildNav,
    renderCustomNav: renderCustomNav,
    toggleBuilder: toggleBuilder,
    toggleData: toggleData,
    renderSort: renderSort,
    renderPlaceholder: renderPlaceholder,
    addCollectionFromInput: addCollectionFromInput,
    addCollection: addCollection,
    removeCollection: removeCollection,
    setCollectionColor: setCollectionColor,
    collectionColorOf: collectionColorOf,
    moveInView: moveInView,
    assign: assign,
    toggleHidden: toggleHidden,
    isHidden: isHidden,
    collectionOf: collectionOf,
    visibleFeatures: visibleFeatures,
    featById: featById,
    loadLayout: loadLayout
  };
})();
