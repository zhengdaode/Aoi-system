// Aoi.catalog — PCO 商品目录（v3.7.0 F9）
// 职责：粘贴解析（富文本/纯文本双入口）→ 词典翻译出草稿（无 LLM）→ 人工校对 →
//   ① 推入活动商品主档（复用 Aoi.orders.registerProduct，price/priceOrig/currency/limit 同构扩展字段）
//   ② 按小程序模板导出 xlsx（说明 6 行 + 表头行 + 数据，模板结构见 docs/PLAN-F9-CATALOG-IMPORT.md §2）
//   ③ 保存到 d.pcoItems 目录（aoi-pco-monitor 与本模块共读写的同一结构）
// 链接抓取通道（aoi-pco-monitor 按需抓取）为预留入口：d.catalogConfig.dispatchUrl 配置后点亮。
window.Aoi = window.Aoi || {};
Aoi.catalog = {
  draft: [],      // 本次会话校对草稿（保存后并入 d.pcoItems）
  matchers: null, // 词典+种名合并匹配表（jp 长度降序）
  phrases: null   // 短语替换表（长度降序）
};

// —— 词典装配 ——

Aoi.catalog.initDict = function () {
  if (Aoi.catalog.matchers) return;
  var dict = Aoi.catalogDict || { categories: [], misc: [], phrases: [] };
  var species = (typeof window !== 'undefined' && window.AOI_SPECIES) || {};
  var matchers = [];
  dict.categories.forEach(function (e) { matchers.push({ jp: e[0], zh: e[1], cat: true }); });
  dict.misc.forEach(function (e) { matchers.push({ jp: e[0], zh: e[1], cat: false }); });
  Object.keys(species).forEach(function (jp) { matchers.push({ jp: jp, zh: species[jp], cat: false }); });
  matchers.sort(function (a, b) { return b.jp.length - a.jp.length; });
  Aoi.catalog.matchers = matchers;
  Aoi.catalog.phrases = dict.phrases.slice().sort(function (a, b) { return b[0].length - a[0].length; });
};

Aoi.catalog.normalize = function (s) {
  return String(s == null ? '' : s).replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').trim();
};

// 翻译单个商品名：返回 { cn, type, typeKey, unmatched[] }
// 规则：短语整段替换 → 按空白分词 → ASCII 词原样保留（系列英文名）→ 其余最长匹配词典；
// 未识别片段保留原文（人工校对时可见），并收集进 unmatched。
// 地区形态前缀（アローラライチュウ 等：前缀 + 种名，种名词典只含本体名）
Aoi.catalog.FORM_PREFIX = { 'アローラ': '阿罗拉', 'ガラル': '伽勒尔', 'ヒスイ': '洗翠', 'パルデア': '帕底亚' };

Aoi.catalog.translateName = function (jpName) {
  Aoi.catalog.initDict();
  var s = Aoi.catalog.normalize(jpName);
  Aoi.catalog.phrases.forEach(function (p) { s = s.split(p[0]).join(p[1]); });
  var tokens = s.split(/\s+/).filter(Boolean);
  var parts = [], unmatched = [], best = null;
  tokens.forEach(function (tok) {
    if (/^[\x00-\x7F\u00C0-\u024F]+$/.test(tok)) { parts.push(tok); return; } // 拉丁词（含 é 等）原样保留
    // 地区形态：前缀 + 种名（词典只收本体名）
    for (var fp in Aoi.catalog.FORM_PREFIX) {
      if (tok.startsWith(fp) && tok.length > fp.length && Aoi.catalog.lookupSpecies(tok.slice(fp.length))) {
        parts.push(Aoi.catalog.FORM_PREFIX[fp] + Aoi.catalog.lookupSpecies(tok.slice(fp.length)));
        return;
      }
    }
    var i = 0, out = '', run = '';
    while (i < tok.length) {
      var hit = null;
      for (var k = 0; k < Aoi.catalog.matchers.length; k++) {
        var m = Aoi.catalog.matchers[k];
        if (tok.startsWith(m.jp, i)) { hit = m; break; }
      }
      if (hit) {
        if (run) { unmatched.push(run); out += run; run = ''; }
        out += hit.zh;
        if (hit.cat && (!best || hit.jp.length > best.jp.length)) best = hit;
        i += hit.jp.length;
      } else {
        run += tok[i]; i++;
      }
    }
    if (run) { unmatched.push(run); out += run; }
    if (out) parts.push(out);
  });
  var type = best ? best.zh : '';
  return { cn: parts.join(' '), type: type, typeKey: Aoi.catalog.matchTypeKey(type), unmatched: unmatched };
};

Aoi.catalog.lookupSpecies = function (jp) {
  return (typeof window !== 'undefined' && window.AOI_SPECIES && window.AOI_SPECIES[jp]) || null;
};

// 品类建议 ↔ d.typeMeta 已有类型：精确 → 互相包含，未命中返回 ''
Aoi.catalog.matchTypeKey = function (zhType) {
  if (!zhType) return '';
  var tm = (Aoi.state.data && Aoi.state.data.typeMeta) || {};
  if (tm[zhType]) return zhType;
  var keys = Object.keys(tm);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].indexOf(zhType) >= 0 || zhType.indexOf(keys[i]) >= 0) return keys[i];
  }
  return '';
};

// —— 解析 ——

// 纯文本：逐行「名称　X,XXX円」（全选复制情报页/详情页文本的形态）
Aoi.catalog.parseText = function (text) {
  var items = [];
  String(text == null ? '' : text).split(/\r?\n/).forEach(function (raw) {
    var line = raw.replace(/^[\s　·•・\-–—*>#]+/, '').trim();
    if (!line) return;
    var m = line.match(/^(.{2,100}?)[\s　]*([\d,]{1,9})\s*円/);
    if (!m) return;
    var name = m[1].trim();
    if (!name) return;
    items.push({ jpName: name, priceJpy: parseInt(m[2].replace(/,/g, ''), 10) });
  });
  Aoi.catalog.attachSaleDate(items, text);
  return items;
};

// 富文本（浏览器整页复制携带 text/html）：三种策略依次回落
// A. 商品卡（SFCC 类列表结构：/products/ 链接所在卡片，含价格/限购/图）
// B. 情报页詳細表（加粗名称 + 同行价格）
// C. 整页纯文本 → parseText
Aoi.catalog.parseHtml = function (html) {
  var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  var items = [];
  var seen = {};
  var push = function (it) {
    if (!it || !it.jpName) return;
    var key = it.url || it.jpName;
    if (seen[key]) {
      ['priceJpy', 'limit', 'image'].forEach(function (f) {
        if (seen[key][f] == null && it[f] != null) seen[key][f] = it[f];
      });
      return;
    }
    seen[key] = it;
    items.push(it);
  };
  // A1：PCO 真实结构（2026-09-10 实测）——li.product[data-pid]，链接为 JAN.html，
  // 价格「385<small>円</small>」textContent 连写无空格，名称在 .txt a / 图 alt
  doc.querySelectorAll('li[data-pid]').forEach(function (li) {
    var text = li.textContent || '';
    var a = li.querySelector('a[href]');
    var nameEl = li.querySelector('.txt a');
    var img = li.querySelector('.pho img') || li.querySelector('img');
    var priceEl = li.querySelector('.price');
    var pm = (priceEl ? priceEl.textContent : text).match(/([\d,]{1,9})\s*円/);
    var lm = text.match(/お一人様[^0-9]{0,6}(\d{1,2})\s*(?:個|点)/);
    var name = ((nameEl && nameEl.textContent) || (img && img.getAttribute('alt')) || '').trim();
    push({
      jpName: name,
      priceJpy: pm ? parseInt(pm[1].replace(/,/g, ''), 10) : null,
      limit: lm ? parseInt(lm[1], 10) : null,
      image: (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || '',
      url: (a && a.getAttribute('href')) || ''
    });
  });
  // A2：通用商品卡兜底（/products/ 链接形态的其他结构）
  doc.querySelectorAll('a[href*="/products/"]').forEach(function (a) {
    var card = a.closest('li') || a.closest('[class*="tile"]') || a.closest('[class*="product"]') || a.parentElement;
    var text = card ? card.textContent : (a.textContent || '');
    var img = card && card.querySelector('img');
    var pm = text.match(/([\d,]{1,9})\s*円/);
    var lm = text.match(/お一人様[^0-9]{0,6}(\d{1,2})\s*(?:個|点)/);
    var name = (img && img.getAttribute('alt')) || a.getAttribute('title') || (a.textContent || '').trim();
    push({
      jpName: (name || '').trim(),
      priceJpy: pm ? parseInt(pm[1].replace(/,/g, ''), 10) : null,
      limit: lm ? parseInt(lm[1], 10) : null,
      image: (img && (img.getAttribute('src') || img.getAttribute('data-src'))) || '',
      url: a.getAttribute('href') || ''
    });
  });
  if (!items.length) {
    doc.querySelectorAll('span[class*="text-bold"], b, strong').forEach(function (sp) {
      var line = (sp.textContent || '').trim();
      var t = (sp.nextSibling && sp.nextSibling.textContent) || '';
      var pm = t.match(/[\s　]*([\d,]{1,9})\s*円/);
      if (line && pm) push({ jpName: line, priceJpy: parseInt(pm[1].replace(/,/g, ''), 10) });
    });
  }
  if (!items.length && doc.body) {
    // 策略 C：整页无结构文本 —— br/块级标签还原为换行后再走逐行解析
    var tmp = doc.createElement('div');
    tmp.innerHTML = doc.body.innerHTML
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
    items = Aoi.catalog.parseText(tmp.textContent);
  }
  Aoi.catalog.attachSaleDate(items, doc.body ? doc.body.textContent : '');
  return items;
};

Aoi.catalog.attachSaleDate = function (items, text) {
  var m = String(text == null ? '' : text).match(/(\d{1,2})月(\d{1,2})日[^\n]{0,10}?発売/);
  if (m) items.forEach(function (it) { if (!it.saleDate) it.saleDate = m[0]; });
};

// —— 草稿 ——

Aoi.catalog.addToDraft = function (items) {
  var added = 0, updated = 0;
  (items || []).forEach(function (it) {
    if (!it.jpName) return;
    var tr = Aoi.catalog.translateName(it.jpName);
    var existing = null;
    for (var i = 0; i < Aoi.catalog.draft.length; i++) {
      var x = Aoi.catalog.draft[i];
      if ((it.url && x.url === it.url) || (!it.url && x.jpName === it.jpName)) { existing = x; break; }
    }
    if (existing) {
      updated++;
      ['priceJpy', 'limit', 'image', 'saleDate'].forEach(function (f) {
        if ((existing[f] == null || existing[f] === '') && it[f] != null && it[f] !== '') existing[f] = it[f];
      });
      if (it.url && !existing.url) existing.url = it.url;
      if (!existing.name && tr.cn) existing.name = tr.cn;
      if (!existing.type && tr.typeKey) existing.type = tr.typeKey;
    } else {
      Aoi.catalog.draft.push({
        id: Aoi.genId(),
        url: it.url || '',
        jpName: it.jpName,
        name: tr.cn,
        type: tr.typeKey || tr.type,
        typeSuggest: tr.type,
        unmatched: tr.unmatched,
        priceJpy: it.priceJpy != null ? it.priceJpy : null,
        limit: it.limit != null ? it.limit : '',
        image: it.image || '',
        status: it.status || '未知',
        saleDate: it.saleDate || '',
        watched: true,
        select: true,
        firstSeenAt: new Date().toISOString()
      });
      added++;
    }
  });
  return { added: added, updated: updated };
};

Aoi.catalog.priceCnyOf = function (it) {
  if (it.priceCny != null) return it.priceCny;
  if (it.priceJpy == null) return null;
  return (Aoi.calc && Aoi.calc.toRmb) ? Aoi.calc.toRmb(it.priceJpy, 'jpy') : null;
};

// 界面输入回读草稿（保存/推入/导出前调用）
Aoi.catalog.collectEdits = function () {
  var tbody = document.getElementById('catDraftTbody');
  if (!tbody) return;
  tbody.querySelectorAll('tr[data-id]').forEach(function (tr) {
    var it = Aoi.catalog.draft.find(function (x) { return x.id === tr.getAttribute('data-id'); });
    if (!it) return;
    it.select = tr.querySelector('.cat-sel') ? tr.querySelector('.cat-sel').checked : it.select;
    var g = function (cls) { var el = tr.querySelector(cls); return el ? el.value.trim() : null; };
    var cn = g('.cat-cn'); if (cn != null) it.name = cn;
    var ty = g('.cat-type'); if (ty != null) it.type = ty;
    var pr = g('.cat-price'); if (pr != null) it.priceCny = pr === '' ? null : parseFloat(pr);
    var lm = g('.cat-limit'); if (lm != null) it.limit = lm === '' ? '' : parseInt(lm, 10);
  });
};

Aoi.catalog.importPaste = function () {
  var box = document.getElementById('catPaste');
  if (!box || !box.value.trim()) { Aoi.toast('请先粘贴内容（整页复制后粘贴至此）', 'warning'); return; }
  var v = box.value;
  var items = /<\s*(img|a|div|span|table|li)\b/i.test(v) ? Aoi.catalog.parseHtml(v) : Aoi.catalog.parseText(v);
  if (!items.length) { Aoi.toast('未解析出商品（需「名称 + 价格円」行或商品卡结构）', 'error'); return; }
  var r = Aoi.catalog.addToDraft(items);
  box.value = '';
  Aoi.catalog.render();
  Aoi.toast('解析 ' + items.length + ' 条：新增 ' + r.added + '，合并 ' + r.updated, 'success');
};

// 粘贴事件：剪贴板带 text/html 时直接采用（保真图片/链接）；纯文本走默认插入 + 解析按钮
Aoi.catalog.onPaste = function (e) {
  var html = e.clipboardData && e.clipboardData.getData('text/html');
  if (!html) return;
  e.preventDefault();
  e.target.value = html;
  Aoi.catalog.importPaste();
};

// —— 保存 / 推入 / 导出 ——

Aoi.catalog.save = async function () {
  Aoi.catalog.collectEdits();
  var d = Aoi.orders.ensure();
  if (!Array.isArray(d.pcoItems)) d.pcoItems = [];
  Aoi.catalog.draft.forEach(function (it) {
    var cur = d.pcoItems.find(function (x) { return x.id === it.id || (it.url && x.url === it.url) || x.jpName === it.jpName; });
    if (cur) {
      ['url', 'jpName', 'name', 'type', 'priceJpy', 'priceCny', 'limit', 'image', 'status', 'saleDate', 'watched'].forEach(function (f) {
        if (it[f] != null) cur[f] = it[f];
      });
    } else {
      d.pcoItems.push(Object.assign({}, it));
    }
  });
  await Aoi.saveTeamData(d);
  Aoi.toast('目录已保存（' + d.pcoItems.length + ' 件）', 'success');
  Aoi.catalog.renderCatalogList();
};

// 一键推入活动商品主档（复用 registerProduct；type+model 去重，价格/限购为可选扩展字段）
Aoi.catalog.pushSelected = async function () {
  Aoi.catalog.collectEdits();
  var sel = Aoi.catalog.draft.filter(function (x) { return x.select; });
  var selEl = document.getElementById('catPushActivity');
  var newEl = document.getElementById('catNewActivity');
  var activity = (newEl && newEl.value.trim()) || (selEl && selEl.value) || '';
  if (!activity) { Aoi.toast('请先选择或输入目标活动', 'warning'); return; }
  if (!sel.length) { Aoi.toast('请勾选要推入的商品', 'warning'); return; }
  // 新活动名直接建档（否则 activityMeta 成孤儿，活动管理里看不到）
  var dPre = Aoi.orders.ensure();
  if (dPre.activities.indexOf(activity) < 0) dPre.activities.push(activity);
  var ok = 0;
  for (var i = 0; i < sel.length; i++) {
    var it = sel[i];
    var cny = Aoi.catalog.priceCnyOf(it);
    var r = await Aoi.orders.registerProduct(activity, {
      type: it.type || '未分类',
      model: it.name || it.jpName,
      refImage: it.image || '',
      refUrl: it.url || '',
      price: cny != null ? cny : undefined,
      priceOrig: it.priceJpy != null ? it.priceJpy : undefined,
      currency: it.priceJpy != null ? 'jpy' : undefined,
      limit: (it.limit !== '' && it.limit != null) ? parseInt(it.limit, 10) : undefined
    });
    if (r) ok++;
  }
  if (ok) {
    if (newEl) newEl.value = '';
    var sel2 = document.getElementById('catPushActivity');
    if (sel2) sel2.innerHTML = '';
    Aoi.catalog.render(); // 重填活动下拉（含新活动）
  }
  Aoi.toast('已推入 ' + ok + '/' + sel.length + ' 件到「' + activity + '」（重复型号自动补全缺失信息）', ok ? 'success' : 'warning');
  if (ok && Aoi.orders.render) Aoi.orders.render();
};

// 小程序导入模板导出：说明 6 行（模板注明勿删）+ 表头行 + 数据（自带示例行绝不带入）
Aoi.catalog.TEMPLATE_NOTES = [
  ['【使用说明】请在电脑或者手机上使用Excel软件编辑，并按照数据格式要求导入谷子商品。'],
  ['【注意事项】本模版的使用说明部分的文字请勿删除。'],
  ['【谷子分类】[选填] 谷子分类，不填则分类为：默认分类'],
  ['【谷子价格】[必填] 谷子的价格，最多只支持2位小数点'],
  ['【谷子库存】[选填] 不填表示不限库存 '],
  ['【是否冻结】[选填] 默认为否，冻结的话表示该谷子暂不可购买']
];
Aoi.catalog.TEMPLATE_HEADER = ['谷子分类（选填）', '谷子名称（必填）', '价格（必填）', '库存（选填）', '冻结（选填：是或否）', '采购状态（选填）'];

Aoi.catalog.exportTemplate = function (btn) {
  var X = window.XLSX;
  if (!X || !X.utils) { Aoi.toast('表格组件（XLSX）未加载', 'error'); return; }
  Aoi.catalog.collectEdits();
  var sel = Aoi.catalog.draft.filter(function (x) { return x.select && (x.name || x.jpName); });
  if (!sel.length) { Aoi.toast('请勾选要导出的商品', 'warning'); return; }
  var aoa = Aoi.catalog.TEMPLATE_NOTES.slice();
  aoa.push(Aoi.catalog.TEMPLATE_HEADER);
  sel.forEach(function (it) {
    var cny = Aoi.catalog.priceCnyOf(it);
    aoa.push([it.type || '', it.name || it.jpName, cny != null ? cny : '', '', '', '备货中']);
  });
  var ws = X.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 46 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 12 }];
  var wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Sheet1');
  var name = (Aoi.exportBaseName && Aoi.exportBaseName(btn)) || 'PCO目录';
  X.writeFile(wb, name + '.xlsx');
};

// —— 链接抓取通道（aoi-pco-monitor 按需抓取；未配置 dispatch 地址时引导粘贴导入） ——

Aoi.catalog.grab = async function () {
  var input = document.getElementById('catGrabUrl');
  var url = input ? input.value.trim() : '';
  if (!url) { Aoi.toast('请粘贴 PCO 活动链接', 'warning'); return; }
  var d = Aoi.orders.ensure();
  var cfg = d.catalogConfig || {};
  if (!cfg.dispatchUrl) {
    Aoi.toast('抓取通道未就绪（需 aoi-pco-monitor 部署并配置 dispatch 地址）——请使用下方「解析粘贴内容」', 'warning');
    return;
  }
  try {
    var res = await fetch(cfg.dispatchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [url] })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    Aoi.toast('已提交抓取，约 1–2 分钟后刷新本页查看', 'success');
    input.value = '';
  } catch (e) {
    Aoi.toast('抓取通道异常：' + e.message + '（可改用粘贴导入）', 'error');
  }
};

Aoi.catalog.saveDispatch = async function () {
  var input = document.getElementById('catDispatch');
  var d = Aoi.orders.ensure();
  d.catalogConfig = d.catalogConfig || {};
  d.catalogConfig.dispatchUrl = input ? input.value.trim() : '';
  await Aoi.saveTeamData(d);
  Aoi.toast('抓取通道配置已保存', 'success');
};

// —— 渲染 ——

// 导航进入本页时的一次性全量渲染（index.html nav 项 onclick 调用）
Aoi.catalog.renderAll = function () {
  Aoi.catalog.render();
  Aoi.catalog.renderCatalogList();
};

Aoi.catalog.render = function () {
  var tbody = document.getElementById('catDraftTbody');
  if (!tbody) return;
  var d = Aoi.orders.ensure();
  tbody.innerHTML = Aoi.catalog.draft.map(function (it) {
    var unmatched = (it.unmatched || []).length
      ? '<div class="text-[11px] text-red-500 mt-0.5">未识别：' + Aoi.escapeHtml(it.unmatched.join(' / ')) + '</div>'
      : '';
    var typeOpts = Object.keys(d.typeMeta || {}).map(function (t) {
      return '<option value="' + Aoi.escapeHtml(t) + '"' + (t === it.type ? ' selected' : '') + '>' + Aoi.escapeHtml(t) + '</option>';
    }).join('');
    return '<tr data-id="' + it.id + '" class="border-b border-gray-100">'
      + '<td class="px-2 py-1 text-center"><input type="checkbox" class="cat-sel"' + (it.select ? ' checked' : '') + '></td>'
      + '<td class="px-2 py-1">' + (it.image ? '<img src="' + Aoi.escapeHtml(it.image) + '" class="w-9 h-9 object-cover rounded" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '—') + '</td>'
      + '<td class="px-2 py-1 max-w-[16rem]"><div class="text-sm">' + Aoi.escapeHtml(it.jpName) + '</div>' + unmatched + '</td>'
      + '<td class="px-2 py-1"><input class="cat-cn border border-gray-300 rounded px-2 py-1 text-sm w-56" value="' + Aoi.escapeHtml(it.name) + '"></td>'
      + '<td class="px-2 py-1"><select class="cat-type border border-gray-300 rounded px-1 py-1 text-sm">' + typeOpts + '</select></td>'
      + '<td class="px-2 py-1 text-right text-sm text-gray-500">' + (it.priceJpy != null ? '¥' + it.priceJpy.toLocaleString() : '—') + '</td>'
      + '<td class="px-2 py-1"><input class="cat-price border border-gray-300 rounded px-2 py-1 text-sm w-16 text-right" value="' + (it.priceCny != null ? it.priceCny : '') + '" placeholder="自动"></td>'
      + '<td class="px-2 py-1"><input class="cat-limit border border-gray-300 rounded px-2 py-1 text-sm w-12 text-right" value="' + Aoi.escapeHtml(it.limit) + '"></td>'
      + '<td class="px-2 py-1 text-sm">' + (it.saleDate ? Aoi.escapeHtml(it.saleDate) : '—') + '</td>'
      + '<td class="px-2 py-1">' + (it.url ? '<a href="' + Aoi.escapeHtml(it.url) + '" target="_blank" rel="noopener" class="text-blue-600 hover:underline text-xs">打开</a>' : '—') + '</td>'
      + '<td class="px-2 py-1 text-center"><button onclick="Aoi.catalog.removeDraft(\'' + it.id + '\')" class="text-red-500 hover:underline text-xs">删</button></td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="11" class="px-3 py-6 text-center text-sm text-gray-400">暂无草稿——先在上方粘贴解析，或等抓取通道就绪</td></tr>';
  var sel2 = document.getElementById('catPushActivity');
  if (sel2 && !sel2.options.length) {
    sel2.innerHTML = '<option value="">— 选择已有活动 —</option>' + (d.activities || []).slice().sort().map(function (a) {
      return '<option value="' + Aoi.escapeHtml(a) + '">' + Aoi.escapeHtml(a) + '</option>';
    }).join('');
  }
  var dis = document.getElementById('catDispatch');
  if (dis && document.activeElement !== dis) dis.value = (d.catalogConfig && d.catalogConfig.dispatchUrl) || '';
};

Aoi.catalog.removeDraft = function (id) {
  Aoi.catalog.draft = Aoi.catalog.draft.filter(function (x) { return x.id !== id; });
  Aoi.catalog.render();
};

Aoi.catalog.renderCatalogList = function () {
  var tbody = document.getElementById('catTableTbody');
  if (!tbody) return;
  var d = Aoi.orders.ensure();
  var items = d.pcoItems || [];
  tbody.innerHTML = items.map(function (it) {
    return '<tr class="border-b border-gray-100">'
      + '<td class="px-2 py-1">' + (it.image ? '<img src="' + Aoi.escapeHtml(it.image) + '" class="w-9 h-9 object-cover rounded" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '—') + '</td>'
      + '<td class="px-2 py-1 text-sm">' + Aoi.escapeHtml(it.name || it.jpName) + '<div class="text-[11px] text-gray-400">' + Aoi.escapeHtml(it.jpName) + '</div></td>'
      + '<td class="px-2 py-1 text-sm">' + Aoi.escapeHtml(it.type || '—') + '</td>'
      + '<td class="px-2 py-1 text-right text-sm">' + (it.priceCny != null ? '¥' + it.priceCny : (it.priceJpy != null ? '¥' + it.priceJpy.toLocaleString() + '（日元）' : '—')) + '</td>'
      + '<td class="px-2 py-1 text-center text-sm">' + (it.limit != null && it.limit !== '' ? it.limit : '—') + '</td>'
      + '<td class="px-2 py-1 text-sm">' + Aoi.escapeHtml(it.status || '未知') + '</td>'
      + '<td class="px-2 py-1 text-sm">' + (it.saleDate ? Aoi.escapeHtml(it.saleDate) : '—') + '</td>'
      + '<td class="px-2 py-1 text-center"><input type="checkbox"' + (it.watched ? ' checked' : '') + ' onchange="Aoi.catalog.toggleWatch(\'' + it.id + '\')"></td>'
      + '<td class="px-2 py-1 text-center"><button onclick="Aoi.catalog.removeSaved(\'' + it.id + '\')" class="text-red-500 hover:underline text-xs">删</button></td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="9" class="px-3 py-6 text-center text-sm text-gray-400">目录为空——保存草稿或由 aoi-pco-monitor 同步后显示</td></tr>';
};

Aoi.catalog.toggleWatch = async function (id) {
  var d = Aoi.orders.ensure();
  var it = (d.pcoItems || []).find(function (x) { return x.id === id; });
  if (!it) return;
  it.watched = !it.watched;
  await Aoi.saveTeamData(d);
};

Aoi.catalog.removeSaved = async function (id) {
  if (!confirm('从目录删除该商品？（不影响已推入活动的商品）')) return;
  var d = Aoi.orders.ensure();
  d.pcoItems = (d.pcoItems || []).filter(function (x) { return x.id !== id; });
  await Aoi.saveTeamData(d);
  Aoi.catalog.renderCatalogList();
};
