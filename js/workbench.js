// Aoi-system — 工作台（v3.30.0）：小红书创作平台式侧栏外壳。
// 首页=总览 / 账号与设置沿用原视图；基础功能列表（原 Builder hub）= 业务+基础数据+工具合集；
// 自定义排序展开【设置自定义排序】（Steam 库式分类，隐藏仅影响展示、不影响数据记录）；
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
    buildNav(); renderSort();
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
    buildNav(); renderSort();
  }
  function addCollection(name) {
    name = String(name || '').trim();
    if (!name) return false;
    var l = loadLayout();
    for (var i = 0; i < l.collections.length; i++) if (l.collections[i].name === name) return false;
    l.collections.push({ name: name, views: [] });
    saveLayout(l);
    buildNav(); renderSort();
    return true;
  }
  function removeCollection(name) {
    var l = loadLayout();
    l.collections = l.collections.filter(function (c) { return c.name !== name; });
    saveLayout(l);
    buildNav(); renderSort();
  }
  // 展示中的功能 = 未被隐藏的注册功能（隐藏只影响导航展示，功能本身与数据记录不受影响）
  function visibleFeatures() { return FEATURES.filter(function (f) { return !isHidden(f.id); }); }

  // 基础功能列表展开区：先用户自建分类（按创建顺序），再「未分类」按 业务→基础数据→工具 排列
  function buildNav() {
    var box = el('wbBuilderItems');
    if (!box) return;
    var l = loadLayout();
    var html = '';
    l.collections.forEach(function (c) {
      var rows = c.views.filter(function (id) { return featById(id) && !isHidden(id); });
      if (!rows.length) return;
      html += '<p class="text-[11px] font-mono uppercase tracking-widest text-gray-400 mt-3 mb-1 px-2">' + Aoi.escapeHtml(c.name) + '</p>';
      html += rows.map(navRow).join('');
    });
    var loose = [];
    GROUP_ORDER.forEach(function (g) {
      FEATURES.forEach(function (f) {
        if (f.group === g && !isHidden(f.id) && !collectionOf(f.id)) loose.push(f);
      });
    });
    if (loose.length) {
      html += '<p class="text-[11px] font-mono uppercase tracking-widest text-gray-400 mt-3 mb-1 px-2">未分类</p>';
      html += loose.map(navRow).join('');
    }
    box.innerHTML = html || '<p class="text-xs text-gray-400 px-2 py-2">功能已全部隐藏——可在工作台「自定义排序」恢复展示</p>';
  }
  function navRow(f) {
    var extra = f.id === 'view-catalog' ? ';Aoi.catalog.renderAll()' : '';
    return '<a data-nav="' + f.id + '" onclick="Aoi.nav(\'' + f.id + '\')' + extra + '"'
      + ' class="block px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-100">'
      + Aoi.escapeHtml(f.label) + '</a>';
  }

  // 进入工作台：外壳切到 workbench，默认落在「首页」（= 原总览仪表盘）
  function enter() {
    Aoi.setShell('workbench');
    buildNav();
    Aoi.nav('view-overview');
  }

  // —— 自定义排序 → 设置自定义排序（Steam 库式分类面板）——
  function renderSort() {
    var list = el('wbFeatList');
    var collBox = el('wbCollList');
    if (!list) return;
    var l = loadLayout();
    // 左列：分类列表（新建/删除）
    if (collBox) {
      var h = '<p class="text-xs font-bold text-gray-500 mb-2">分类</p>';
      l.collections.forEach(function (c) {
        h += '<div class="flex items-center justify-between gap-1 py-1">'
          + '<span class="text-sm truncate" title="' + Aoi.escapeHtml(c.name) + '">' + Aoi.escapeHtml(c.name)
          + ' <span class="text-xs text-gray-400">' + c.views.length + '</span></span>'
          + '<button data-wbcoldel="' + Aoi.escapeHtml(c.name) + '" class="text-xs text-red-400 hover:text-red-600 shrink-0" title="删除该分类（功能回落未分类）">删</button></div>';
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
        var opts = '<option value="">未分类</option>' + l.collections.map(function (c) {
          return '<option value="' + Aoi.escapeHtml(c.name) + '"' + (collectionOf(f.id) === c.name ? ' selected' : '') + '>'
            + Aoi.escapeHtml(c.name) + '</option>';
        }).join('');
        html += '<div class="flex items-center gap-2 py-1.5 border-b border-gray-50 text-sm">'
          + '<span class="w-24 shrink-0 text-xs text-gray-400">' + Aoi.escapeHtml(f.group) + '</span>'
          + '<span class="flex-1 min-w-0 truncate ' + (hidden ? 'text-gray-300 line-through' : '') + '">' + Aoi.escapeHtml(f.label) + '</span>'
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
    if (!addCollection(inp.value)) { Aoi.toast('分类名不能为空或与已有分类重复', 'warning'); return; }
    inp.value = '';
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
  }

  // 占位页（娱乐活动工具 / 创意工坊）：端口预留，暂不填充内容
  function renderPlaceholder() { /* 静态 HTML，预留钩子 */ }

  // 面板内事件委托（分类删除 / 归属调整 / 展示切换）
  document.addEventListener('click', function (e) {
    var del = e.target.closest('button[data-wbcoldel]');
    if (del) { removeCollection(del.getAttribute('data-wbcoldel')); return; }
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
    enter: enter,
    buildNav: buildNav,
    toggleBuilder: toggleBuilder,
    toggleData: toggleData,
    renderSort: renderSort,
    renderPlaceholder: renderPlaceholder,
    addCollectionFromInput: addCollectionFromInput,
    addCollection: addCollection,
    removeCollection: removeCollection,
    assign: assign,
    toggleHidden: toggleHidden,
    isHidden: isHidden,
    collectionOf: collectionOf,
    visibleFeatures: visibleFeatures,
    featById: featById,
    loadLayout: loadLayout
  };
})();
