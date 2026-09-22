// Aoi.catalog — PCO 商品目录（v3.7.0 F9；v3.15.0 瘦身）
// 职责：粘贴解析（两步工作流——①整页复制先直接粘贴：富文本商品卡带出商品图/链接/价格/
//   限购；②ChatGPT 翻译表格后粘贴：按「日文原名」对齐合并，中文译名/类型直入草稿；
//   v3.15.0 起表格可含 商品链接/图片链接 两列，配合优化后的提示词支持一次性导入，
//   图片链接缺失时仍可用两步流程补图）→ 人工校对 → 推入活动商品主档
//   （复用 Aoi.orders.registerProduct；人民币价默认不生成，由活动管理「生成人民币价」统一计算）。
// v3.15.0（D1 已批准）：「已存目录」d.pcoItems 停写与下线——补货监控已否决，草稿不再持久化，
//   请及时「推入活动商品」；历史数据可用 scripts/archive-pco.mjs（--apply 删除 / --restore 恢复）。
window.Aoi = window.Aoi || {};
Aoi.catalog = {
  draft: [],      // 本次会话校对草稿（会话结束即清空，推入活动商品为唯一持久化路径）
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

// —— ChatGPT 翻译工作流（v3.9.4 引入；v3.15.0 S9 优化：目标一次性导入中文版）——
// 提示词：输出固定列表格（含 商品链接/图片链接 两列），命名遵循本系统「型号=简短中文名 +
// 类型独立成列」的商品命名逻辑；宝可梦物种名用常见官方译名，品类词表与
// Aoi.catalogDict.categories 同源（节选高频项）。预期管理（D3）：粘贴进 ChatGPT 输入框的
// 富文本会剥离 <img> 的 src，「图片链接」列尽力而为、常为空——缺图时仍可用两步流程补图。
Aoi.catalog.AI_PROMPT = [
  '你是宝可梦中心 online（pokemoncenter-online.com）商品目录整理助手。我下面粘贴的是 PCO 商品页面的全文，请把其中每一件商品整理成一张表格，严格遵守以下要求：',
  '',
  '一、输出格式：Markdown 表格，列的顺序固定，不要增删列、不要输出表格以外的解释文字：',
  '| 日文原名 | 中文名 | 类型 | 日元价 | 限购 | 発売日 | 商品链接 | 图片链接 |',
  '（本表格之后会按「日文原名」逐行合并进已有商品，所以日文原名列是对齐关键，必须与页面文字完全一致。商品链接/图片链接取自粘贴内容中真实出现的 URL，绝不允许编造或拼写；页面文本里看不到的地址就留空。）',
  '',
  '二、各列要求：',
  '1. 日文原名：照抄页面上的日文商品名，一字不差，不要翻译、不要改写、不要加序号（它用于与页面粘贴导入的商品行对齐合并）。',
  '2. 中文名：简体中文译名，作为我们系统的商品「型号」，遵循以下命名逻辑：',
  '   - 宝可梦物种名一律用最常见的官方中文译名，例如：ピカチュウ→皮卡丘、リザードン→喷火龙、イーブイ→伊布、カビゴン→卡比兽、ミュウツー→超梦、ゼニガメ→杰尼龟、フシギダネ→妙蛙种子。',
  '   - 地区形态加前缀：アローラ→阿罗拉、ガラル→伽勒尔、ヒスイ→洗翠、パルデア→帕底亚。',
  '   - 品类词按下表翻译（与「类型」列保持一致）：ぬいぐるみ→毛绒玩偶、ぬいぐるみバッジ→毛绒徽章、バッジ→徽章、缶バッジ→铁质徽章、アクリルスタンド→亚克力立牌、アクリルキーホルダー→亚克力挂件、マスコット→挂件、クリアファイル→文件夹、クリアカード→透卡、ステッカー/シール→贴纸、フィギュア→手办、スイーツフィギュア→甜品手办、タペストリー→挂画、ポーチ→收纳包、トートバッグ→托特包、マグカップ→马克杯、ランダム→随机、セット→套装、限定→限定、ハロウィン→万圣节、クリスマス→圣诞节。',
  '   - 中文名 = 物种/角色名 + 主题词（如万圣节、圣诞节、2025 等），品类词可以省略（品类已单独成列）；保持简短，不超过 12 个字；英文字母系列名（如 Pokémon accessory）保留原文。',
  '3. 类型：从上面品类词表中选一个最贴切的中文类型名；确实没有合适的就填「未分类」。',
  '4. 日元价：只填数字，去掉「円」和千位逗号（如 385）。',
  '5. 限购：页面标注「お一人様○個」时填数字 ○，未标注留空。',
  '6. 発売日：形如「11月8日発売」照抄，没有就留空。',
  '7. 商品链接：粘贴内容中该商品对应的 pokemoncenter-online.com 链接（/products/… 形态），原样完整照抄；一条商品一个链接，找不到就留空。',
  '8. 图片链接：仅当你确实能在粘贴内容中看到图片地址（https://… 的图片 URL）时照抄，否则一律留空。如果你具备联网浏览能力，也可以直接访问粘贴内容里的商品链接，从商品页读取图片地址填入本列；访问失败就留空。',
  '',
  '三、不要遗漏任何商品，也不要虚构页面上不存在的商品；同系列不同款式照页面逐条列出。',
  '',
  '页面全文如下：'
].join('\n');

// 提示词进剪贴板：clipboard API 优先，execCommand 兜底（非安全源/旧环境）
Aoi.catalog.copyPrompt = function () {
  var text = Aoi.catalog.AI_PROMPT;
  var done = function () { Aoi.toast('提示词已复制——连同整页复制的 PCO 内容一起发给 ChatGPT', 'success'); };
  var fail = function () { Aoi.toast('复制失败，请展开下方文本手动全选复制', 'warning'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallback(); });
  } else fallback();
  function fallback() {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) done(); else fail();
    } catch (e) { fail(); }
  }
};

// 表头关键字 → 草稿字段（parseAi 按表头识别列序，兼容 ChatGPT 对列名的轻微改写）
Aoi.catalog.AI_HEADER_KEYS = [
  ['jp', /日文原名|日文名|原名|日文|原文/],
  ['name', /中文名|中文|译名|名称|型号/],
  ['type', /类型|分类|品类|制品/],
  ['priceJpy', /日元|价格|円|价/],
  ['limit', /限购|限制/],
  ['saleDate', /発売|发售/],
  ['image', /图链|图片|缩略图/],
  ['url', /链接|URL|网址/]
];

// 解析 ChatGPT 回复的表格 → 原始行 + 表头映射（v3.18.0 自 parseAi 拆出，供无表头时的
// AI 列角色判断复用）。有表头按关键字映射列；无表头 map 为 null。
Aoi.catalog.aiRows = function (text) {
  var rows = [];
  String(text == null ? '' : text).split(/\r?\n/).forEach(function (ln) {
    var s = ln.trim();
    if (!s || /^`{3,}/.test(s)) return;                       // 跳过空行与代码围栏
    var cells;
    if (s.indexOf('|') >= 0) cells = s.replace(/^\|/, '').replace(/\|$/, '').split('|');
    else if (s.indexOf('\t') >= 0) cells = s.split('\t');
    else return;
    cells = cells.map(function (x) { return x.replace(/\*\*/g, '').trim(); }); // 去 Markdown 加粗
    if (cells.every(function (x) { return x === '' || /^:?-{2,}:?$/.test(x); })) return; // 表头分隔行
    if (cells.length >= 3) rows.push(cells);
  });
  if (!rows.length) return null;
  var map = null;
  var first = rows[0].join(' ');
  if (/原文|日文|原名/.test(first) && /中文|译名|名称/.test(first)) {
    map = {};
    rows.shift().forEach(function (h, i) {
      for (var k = 0; k < Aoi.catalog.AI_HEADER_KEYS.length; k++) {
        var f = Aoi.catalog.AI_HEADER_KEYS[k];
        if (f[1].test(h) && map[f[0]] == null) { map[f[0]] = i; return; }
      }
    });
  }
  return { rows: rows, map: map };
};

// 原始行 → 目录条目（map 为 null 时按固定顺序 [原名, 中文, 类型, 价格, 限购] 兜底）
Aoi.catalog.aiItems = function (rows, map) {
  var items = [];
  rows.forEach(function (cells) {
    var g = function (field, fallbackIdx) {
      if (map) return map[field] != null ? cells[map[field]] || '' : '';
      return fallbackIdx != null ? (cells[fallbackIdx] || '') : '';
    };
    var jpName = (g('jp', 0) || '').replace(/^\d+[.、)]\s*/, '').trim();
    if (!jpName) return;
    var pm = String(g('priceJpy', 3)).match(/[\d,]{1,9}/);
    var lm = String(g('limit', 4)).match(/\d{1,2}/);
    items.push({
      jpName: jpName,
      name: g('name', 1).trim(),
      type: g('type', 2).trim(),
      priceJpy: pm ? parseInt(pm[0].replace(/,/g, ''), 10) : null,
      limit: lm ? parseInt(lm[0], 10) : '',
      saleDate: g('saleDate', null).trim(),
      image: g('image', null).trim(),
      url: g('url', null).trim()
    });
  });
  return items.length ? items : null;
};

// 解析 ChatGPT 回复的表格（Markdown 管道表或 TSV）→ 目录条目数组。
// 有表头按关键字映射列；无表头按固定顺序兜底。
// 无法解析出任何行时返回 null（调用方回落富文本/纯文本解析）。
Aoi.catalog.parseAi = function (text) {
  var p = Aoi.catalog.aiRows(text);
  if (!p) return null;
  return Aoi.catalog.aiItems(p.rows, p.map);
};

// ChatGPT 页面上直接复制渲染表格（剪贴板带 text/html <table>）→ 还原为管道行交给 parseAi。
// 表头无 AI 关键字（如普通页面布局表格）时 parseAi 返回 null，调用方继续回落商品卡解析。
Aoi.catalog.parseAiHtml = function (html) {
  var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  var tables = doc.querySelectorAll('table');
  if (!tables.length) return null;
  var lines = [];
  tables.forEach(function (tb) {
    tb.querySelectorAll('tr').forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll('th,td').forEach(function (td) { cells.push((td.textContent || '').trim()); });
      if (cells.length >= 3) lines.push('| ' + cells.join(' | ') + ' |');
    });
  });
  return lines.length ? Aoi.catalog.parseAi(lines.join('\n')) : null;
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
    // v3.15.0 S9：AI 表格可能给出站内相对链接（/products/… 等），先补全为 PCO 绝对地址
    if (it.url && !/^https?:\/\//i.test(String(it.url))) {
      it.url = 'https://www.pokemoncenter-online.com' + (String(it.url).charAt(0) === '/' ? '' : '/') + it.url;
    }
    if (it.image && !/^https?:\/\//i.test(String(it.image))) {
      it.image = 'https://www.pokemoncenter-online.com' + (String(it.image).charAt(0) === '/' ? '' : '/') + it.image;
    }
    // v3.10.0：目录条目的链接/图片仅接受 http/https（粘贴来源不可全信）
    it.url = Aoi.safeUrl(it.url);
    it.image = Aoi.safeUrl(it.image);
    var tr = Aoi.catalog.translateName(it.jpName);
    // ChatGPT 工作流直带中文译名/类型：不再依赖词典，未识别高亮也无意义
    var hasCn = !!(it.name && String(it.name).trim());
    var hasType = !!(it.type && String(it.type).trim());
    var cn = hasCn ? String(it.name).trim() : tr.cn;
    var type = hasType
      ? (Aoi.catalog.matchTypeKey(String(it.type).trim()) || String(it.type).trim())
      : (tr.typeKey || tr.type);
    var existing = null;
    for (var i = 0; i < Aoi.catalog.draft.length; i++) {
      var x = Aoi.catalog.draft[i];
      // 对齐键（v3.9.5）：双方都有链接按链接；任一方缺链接（页面粘贴行有 url、ChatGPT 行没有，
      // 或反之）按日文原名——「先贴页面带图、后贴 AI 表格补译名」两步导入互相合并不产生重复行
      if ((it.url && x.url === it.url) || (x.jpName === it.jpName && (!it.url || !x.url))) { existing = x; break; }
    }
    if (existing) {
      updated++;
      ['priceJpy', 'limit', 'image', 'saleDate'].forEach(function (f) {
        if ((existing[f] == null || existing[f] === '') && it[f] != null && it[f] !== '') existing[f] = it[f];
      });
      if (it.url && !existing.url) existing.url = it.url;
      // AI 译名/类型覆盖词典草稿（词典结果只是建议）；清掉未识别高亮（名称已人工/AI 化）
      if (hasCn) { existing.name = cn; existing.unmatched = []; }
      else if (!existing.name && cn) existing.name = cn;
      if (hasType || !existing.type) existing.type = type;
    } else {
      var entry = {
        id: Aoi.genId(),
        url: it.url || '',
        jpName: it.jpName,
        name: cn,
        type: type,
        typeSuggest: tr.type,
        unmatched: hasCn ? [] : tr.unmatched,
        priceJpy: it.priceJpy != null ? it.priceJpy : null,
        limit: it.limit != null && it.limit !== '' ? it.limit : '',
        image: it.image || '',
        status: it.status || '未知',
        saleDate: it.saleDate || '',
        watched: true,
        select: true,
        firstSeenAt: new Date().toISOString()
      };
      // v3.18.0 T2：AI 行（或草稿里已有 AI 行时新粘的页面行）标记参与语义对齐——精确匹配
      // 没合并、日文名可能一字之差，随后异步问 AI「哪一行是同一款」；合并走既有语义、低置信人工确认
      if (it._ai) entry.aiFrom = true;
      if (it._ai || Aoi.catalog.draft.some(function (x) { return x.aiFrom; })) entry.alignPending = true;
      Aoi.catalog.draft.push(entry);
      added++;
    }
  });
  return { added: added, updated: updated };
};

// 界面输入回读草稿（推入前调用）
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

Aoi.catalog.importPaste = async function () {
  var box = document.getElementById('catPaste');
  if (!box || !box.value.trim()) { Aoi.toast('请先粘贴内容（整页复制后粘贴至此）', 'warning'); return; }
  var v = box.value;
  // v3.9.4/v3.9.5：ChatGPT 翻译表格优先（纯文本 Markdown/TSV → 渲染表格 HTML）；
  // 否则回落富文本商品卡（带出商品图/链接/价格/限购）/ 纯文本「名称+价格円」。
  // v3.18.0 T2：无表头表格先问 AI 列角色（关闭/失败/超时 → 固定列序兜底，与原行为一致；
  // 带表头路径全程无 await，与既有同步行为一致）
  var parsed = Aoi.catalog.aiRows(v);
  var ai = null;
  if (parsed && parsed.rows.length) {
    var map = parsed.map;
    if (!map) {
      var m2 = await Aoi.catalog.aiColumnMap(parsed.rows);
      if (m2 && m2.jp != null) map = m2;
    }
    ai = Aoi.catalog.aiItems(parsed.rows, map);
  }
  if (!ai && /<\s*table\b/i.test(v)) ai = Aoi.catalog.parseAiHtml(v);
  var items = ai || (/<\s*(img|a|div|span|table|li)\b/i.test(v) ? Aoi.catalog.parseHtml(v) : Aoi.catalog.parseText(v));
  if (!items.length) {
    Aoi.toast('未解析出商品（AI 翻译表格、「名称 + 价格円」行或商品卡结构均可）', 'error');
    return;
  }
  if (ai) items.forEach(function (x) { x._ai = true; });
  var r = Aoi.catalog.addToDraft(items);
  box.value = '';
  Aoi.catalog.render();
  Aoi.toast((ai ? '已按 AI 翻译表格解析 ' : '解析 ') + items.length + ' 条：新增 ' + r.added + '，合并 ' + r.updated, 'success');
  // v3.18.0：先语义对齐（可能合并删行）再出译名/类型建议——串行异步、不阻塞校对
  Aoi.catalog.aiAlign().then(function () { return Aoi.catalog.enrichDraft(); });
};

// 粘贴事件：剪贴板带 text/html 时直接采用（保真图片/链接）；纯文本走默认插入 + 解析按钮
Aoi.catalog.onPaste = function (e) {
  var html = e.clipboardData && e.clipboardData.getData('text/html');
  if (!html) return;
  e.preventDefault();
  e.target.value = html;
  Aoi.catalog.importPaste();
};

// —— 推入（v3.15.0：保存目录/小程序导出/抓取通道已随「已存目录」下线移除，见文件头注释）——

// 一键推入活动商品主档（复用 registerProduct；type+model 去重，价格/限购为可选扩展字段）。
// v3.15.0 S4：人民币价不再自动按汇率生成——仅当校对表里人工填写了价格才推入；
// 外币原价/币种/限购照常入库，价格由活动管理「生成人民币价」统一计算。
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
    var r = await Aoi.orders.registerProduct(activity, {
      type: it.type || '未分类',
      model: it.name || it.jpName,
      nameOrig: it.jpName || '',
      refImage: it.image || '',
      refUrl: it.url || '',
      price: it.priceCny != null ? it.priceCny : undefined,
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

// —— v3.18.0 TypeSafe 语义增强（docs/PLAN-TYPESAFE.md T1/T2）——
// 三段式：词典/精确匹配优先 → AI 判断增强（只对失败行，批量并发 ≤3）→ 人工校对兜底。
// AI 只产「建议 + 置信度」：译名/类型建议必须点「采纳」才生效；对齐合并高置信自动、
// 中间带标黄人工确认。关闭开关 / proxy 不可用 / 超时 → 本节全部静默跳过，回落原行为。

// 编辑距离（短串用途，O(mn) DP）
Aoi.catalog._ed = function (a, b) {
  var m = a.length, n = b.length;
  if (!m || !n) return m + n;
  var prev = [], cur = [];
  for (var j = 0; j <= n; j++) prev[j] = j;
  for (var i = 1; i <= m; i++) {
    cur[0] = i;
    for (var j2 = 1; j2 <= n; j2++) {
      cur[j2] = Math.min(prev[j2] + 1, cur[j2 - 1] + 1, prev[j2 - 1] + (a.charAt(i - 1) === b.charAt(j2 - 1) ? 0 : 1));
    }
    var t = prev; prev = cur; cur = t;
  }
  return prev[n];
};

// T1-G1：词典候选预筛（纯函数）——从词典/种名表找与未识别片段相近的词条
// （归一化互为子串，或 ≤12 字符且编辑距离 ≤2），供 AI 在小候选集里「选」而非凭空生成
Aoi.catalog.suggestCandidates = function (it) {
  Aoi.catalog.initDict();
  var frags = (it.unmatched || []).filter(Boolean);
  if (!frags.length) return [];
  var out = [], seen = {};
  Aoi.catalog.matchers.forEach(function (m) {
    if (seen[m.zh] || out.length >= 10) return;
    var hit = frags.some(function (f) {
      var a = Aoi.catalog.normalize(f), b = Aoi.catalog.normalize(m.jp);
      if (!a || !b) return false;
      if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
      return Math.max(a.length, b.length) <= 12 && Aoi.catalog._ed(a, b) <= 2;
    });
    if (hit) { seen[m.zh] = true; out.push({ zh: m.zh, jp: m.jp }); }
  });
  return out;
};

// T1：给「词典未识别 / 类型未分类」的草稿行批量生成建议（不自动落库，采纳走人工点击）。
// 定向注入 DOM（不整表重绘）——保护校对时其他行的在途编辑。
Aoi.catalog.enrichDraft = async function () {
  if (!Aoi.typesafe.available()) return;
  var d = Aoi.orders.ensure();
  var typeKeys = Object.keys(d.typeMeta || {});
  var jobs = [];
  Aoi.catalog.draft.forEach(function (it) {
    if (it.aiSuggest && (it.aiSuggest.cn || it.aiSuggest.type)) return; // 已有建议不重复计费
    var hasUn = (it.unmatched || []).length > 0;
    var needType = !it.type || it.type === '未分类';
    if (!hasUn && !needType) return;
    var q = {};
    if (hasUn) {
      var cands = Aoi.catalog.suggestCandidates(it);
      if (cands.length) {
        var criteria = { '（无匹配，保持现状）': '所有候选都不对' };
        cands.forEach(function (c) { criteria[c.zh] = '词典候选（日文：' + c.jp + '）'; });
        q.cn = { type: 'choice', instructions: '商品「' + it.jpName + '」的未识别片段为 ' + JSON.stringify(it.unmatched) + '，请从候选中选出正确的中文译名（整体或补全该片段），都不对就选无匹配。', criteria: criteria };
      }
    }
    if (needType) {
      var tc = { '（保持未分类）': '没有合适的类型' };
      typeKeys.forEach(function (t) { tc[t] = '系统已有商品类型'; });
      q.type = { type: 'choice', instructions: '商品「' + it.jpName + '」应归入哪个商品类型（品类）？', criteria: tc };
    }
    if (Object.keys(q).length) jobs.push({ it: it, state: { jpName: it.jpName, unmatched: it.unmatched || [], url: it.url || '' }, questions: q });
  });
  if (!jobs.length) return;
  var answers = await Aoi.typesafe.judgeAll(jobs);
  var shown = 0;
  answers.forEach(function (a, i) {
    if (!a) return;
    var it = jobs[i].it, sug = {};
    if (a.cn && a.cn.type === 'choice' && a.cn.choice !== '（无匹配，保持现状）' && (a.cn.confidence == null || a.cn.confidence >= Aoi.typesafe.TH.show)) {
      sug.cn = a.cn.choice; sug.cnConf = a.cn.confidence;
    }
    if (a.type && a.type.type === 'choice' && a.type.choice !== '（保持未分类）' && it.type !== a.type.choice && (a.type.confidence == null || a.type.confidence >= Aoi.typesafe.TH.show)) {
      sug.type = a.type.choice; sug.typeConf = a.type.confidence;
    }
    if (sug.cn || sug.type) { it.aiSuggest = sug; Aoi.catalog.renderSuggest(it); shown++; }
  });
  if (shown) Aoi.toast('AI 给出 ' + shown + ' 条译名/类型建议（校对表绿色行，点「采纳」生效）', 'info');
};

// 建议行内标记（render 与 renderSuggest 共用同一 HTML，保证整表重绘后建议不丢）
Aoi.catalog.aiSuggestHtml = function (it, field) {
  var sug = it.aiSuggest;
  if (!sug || !sug[field]) return '';
  var conf = Math.round(((field === 'cn' ? sug.cnConf : sug.typeConf) || 0) * 100);
  var val = field === 'cn' ? sug.cn : sug.type;
  return '<div class="cat-ai text-[11px] text-emerald-700 mt-0.5">AI 建议：' + Aoi.escapeHtml(val) + '（' + conf + '%）'
    + ' <button type="button" class="underline" onclick="Aoi.catalog.applyAiSuggest(\'' + it.id + '\',\'' + field + '\')">采纳</button></div>';
};

// 定向注入单行建议（enrichDraft 异步返回时避免整表重绘冲掉在途编辑）
Aoi.catalog.renderSuggest = function (it) {
  var tr = document.querySelector('#catDraftTbody tr[data-id="' + it.id + '"]');
  if (!tr) return;
  ['cn', 'type'].forEach(function (field) {
    var el = tr.querySelector(field === 'cn' ? '.cat-cn' : '.cat-type');
    if (!el) return;
    var cell = el.parentElement;
    var old = cell.querySelector('.cat-ai');
    if (old) old.remove();
    if (it.aiSuggest && it.aiSuggest[field]) cell.insertAdjacentHTML('beforeend', Aoi.catalog.aiSuggestHtml(it, field));
  });
};

// 采纳建议：先 collectEdits 把全部在途编辑收回草稿，再改本行、整表重绘（无编辑丢失）
Aoi.catalog.applyAiSuggest = function (id, field) {
  var it = null;
  for (var i = 0; i < Aoi.catalog.draft.length; i++) if (Aoi.catalog.draft[i].id === id) { it = Aoi.catalog.draft[i]; break; }
  if (!it || !it.aiSuggest) return;
  Aoi.catalog.collectEdits();
  if (field === 'cn' && it.aiSuggest.cn) { it.name = it.aiSuggest.cn; it.unmatched = []; it.aiSuggest.cn = null; }
  if (field === 'type' && it.aiSuggest.type) { it.type = it.aiSuggest.type; it.aiSuggest.type = null; }
  if (!it.aiSuggest.cn && !it.aiSuggest.type) delete it.aiSuggest;
  Aoi.catalog.render();
};

// T2-G3：语义对齐候选预筛（纯函数）——草稿中与该行日文名归一化后互为子串或
// 编辑距离相近（≤30 字符且 ≤min(5, 长度30%)）的其他行
Aoi.catalog.alignCandidates = function (entry, draft) {
  var a = Aoi.catalog.normalize(entry.jpName).toLowerCase();
  if (!a) return [];
  var out = [];
  (draft || []).forEach(function (x) {
    if (x.id === entry.id || x.alignPending || out.length >= 5) return;
    var b = Aoi.catalog.normalize(x.jpName).toLowerCase();
    if (!b || a === b) return; // 完全相等早在 addToDraft 精确合并（防御）
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) { out.push(x); return; }
    if (Math.max(a.length, b.length) <= 30 && Aoi.catalog._ed(a, b) <= Math.min(5, Math.floor(Math.max(a.length, b.length) * 0.3))) out.push(x);
  });
  return out;
};

// 语义合并：与 addToDraft 精确合并分支同语义——补缺失字段、AI 中文名覆盖并清未识别高亮
Aoi.catalog.mergeEntry = function (target, src) {
  ['priceJpy', 'limit', 'image', 'saleDate'].forEach(function (f) {
    if ((target[f] == null || target[f] === '') && src[f] != null && src[f] !== '') target[f] = src[f];
  });
  if (src.url && !target.url) target.url = src.url;
  if (src.name) { target.name = src.name; target.unmatched = []; }
  if (src.type || !target.type) target.type = src.type;
  return target;
};

// T2：AI 表行 ↔ 已有草稿行语义对齐（只处理精确匹配不中而标记 alignPending 的行）。
// AI 只答「哪一行是同一款」：≥TH.auto 自动合并（先 collectEdits 收回在途编辑），
// TH.show~auto 标黄人工确认，更低/失败/关闭 → 两行都保留（原行为）。
Aoi.catalog.aiAlign = async function () {
  if (!Aoi.typesafe.available()) return;
  var pend = Aoi.catalog.draft.filter(function (x) { return x.alignPending; });
  if (!pend.length) return;
  var merged = 0, suspect = 0;
  for (var i = 0; i < pend.length; i++) {
    var it = pend[i];
    var cands = Aoi.catalog.alignCandidates(it, Aoi.catalog.draft);
    delete it.alignPending;
    if (!cands.length) continue;
    var criteria = {};
    cands.forEach(function (c, k) { criteria['#' + (k + 1)] = '已有行「' + c.jpName + '」' + (c.url ? '（有链接）' : '（无链接）'); });
    criteria['都不是同一款'] = '以上都不是同一件商品';
    var answers = await Aoi.typesafe.judge({
      newRow: { jpName: it.jpName, name: it.name || '', url: it.url || '' },
      existingRows: cands.map(function (c) { return { jpName: c.jpName, name: c.name || '', url: c.url || '', priceJpy: c.priceJpy == null ? '' : c.priceJpy }; })
    }, {
      same: {
        type: 'choice',
        instructions: '新粘贴行与已有哪一行是同一件商品？日文原名可能有一字之差、全半角/空格差异或序号增减；中文名/链接/价格可作参考。没有对应行就选「都不是同一款」。',
        criteria: criteria
      }
    });
    var a = answers && answers.same;
    if (!a || a.type !== 'choice') continue;
    var conf = a.confidence == null ? 1 : a.confidence;
    var idx = /^#\d+$/.test(a.choice) ? parseInt(a.choice.slice(1), 10) - 1 : -1;
    var target = cands[idx] || null;
    if (!target) continue;
    if (conf >= Aoi.typesafe.TH.auto) {
      Aoi.catalog.collectEdits();
      Aoi.catalog.mergeEntry(target, it);
      Aoi.catalog.draft = Aoi.catalog.draft.filter(function (x) { return x.id !== it.id; });
      merged++;
    } else if (conf >= Aoi.typesafe.TH.show) {
      it.aiSuspect = { id: target.id, jpName: target.jpName };
      suspect++;
    }
  }
  if (merged || suspect) {
    Aoi.catalog.render();
    Aoi.toast('AI 对齐：自动合并 ' + merged + ' 行' + (suspect ? '，另有 ' + suspect + ' 行疑似重复待确认（表内标黄）' : ''), 'success');
  }
};

// 疑似重复的人工裁决（标黄行上的「合并 / 保留两行」）
Aoi.catalog.resolveSuspect = function (id, merge) {
  var it = null, target = null, i = 0;
  for (i = 0; i < Aoi.catalog.draft.length; i++) if (Aoi.catalog.draft[i].id === id) { it = Aoi.catalog.draft[i]; break; }
  if (!it || !it.aiSuspect) return;
  for (i = 0; i < Aoi.catalog.draft.length; i++) if (Aoi.catalog.draft[i].id === it.aiSuspect.id) { target = Aoi.catalog.draft[i]; break; }
  Aoi.catalog.collectEdits();
  if (merge && target) {
    Aoi.catalog.mergeEntry(target, it);
    Aoi.catalog.draft = Aoi.catalog.draft.filter(function (x) { return x.id !== id; });
    Aoi.toast('已合并到「' + target.jpName + '」', 'success');
  } else {
    delete it.aiSuspect;
  }
  Aoi.catalog.render();
};

// T2-G4：无表头表格列角色的 criteria 词典（choice 原语用）
Aoi.catalog.COLUMN_ROLES = {
  jp: '日文原名（对齐键，照抄页面日文商品名）', name: '中文译名', type: '类型（中文品类词）',
  priceJpy: '日元价（纯数字）', limit: '限购数量（纯数字）', saleDate: '発売日（如 11月8日発売）',
  image: '图片链接 URL', url: '商品链接 URL', ignore: '与商品无关的列'
};

// answers → 列映射（纯函数）：按置信度降序占用列防冲突；低于 TH.col / 认不出对齐键列 → null
Aoi.catalog.aiColumnMapFromAnswers = function (answers) {
  if (!answers) return null;
  var ids = Object.keys(answers).filter(function (k) { return /^c\d+$/.test(k) && answers[k] && answers[k].type === 'choice'; });
  ids.sort(function (x, y) { return (answers[y].confidence || 0) - (answers[x].confidence || 0); });
  var map = {}, usedCol = {};
  ids.forEach(function (qid) {
    var a = answers[qid], col = parseInt(qid.slice(1), 10);
    if (usedCol[col]) return;
    if (a.confidence != null && a.confidence < Aoi.typesafe.TH.col) return;
    var role = a.choice;
    if (role === 'ignore' || !Aoi.catalog.COLUMN_ROLES[role] || map[role] != null) return;
    map[role] = col;
    usedCol[col] = true;
  });
  return map.jp != null ? map : null;
};

// 无表头时问 AI 每列的角色（关闭/失败/列数异常 → null，调用方固定列序兜底）
Aoi.catalog.aiColumnMap = async function (rows) {
  if (!Aoi.typesafe.available()) return null;
  var n = (rows[0] || []).length;
  if (n < 3 || n > 12) return null;
  var criteria = {};
  Object.keys(Aoi.catalog.COLUMN_ROLES).forEach(function (k) { criteria[k] = Aoi.catalog.COLUMN_ROLES[k]; });
  var questions = {};
  for (var i = 0; i < n; i++) {
    questions['c' + i] = { type: 'choice', instructions: '这张无表头商品表格的第 ' + (i + 1) + ' 列是什么字段？按各列单元格样本内容判断。', criteria: criteria };
  }
  var answers = await Aoi.typesafe.judge({ sampleRows: rows.slice(0, 3) }, questions);
  return Aoi.catalog.aiColumnMapFromAnswers(answers);
};

// —— 渲染 ——

// 导航进入本页时的一次性全量渲染（index.html nav 项 onclick 调用）
Aoi.catalog.renderAll = function () {
  var pre = document.getElementById('catAiPrompt');
  if (pre && !pre.textContent) pre.textContent = Aoi.catalog.AI_PROMPT;
  Aoi.catalog.render();
};

Aoi.catalog.render = function () {
  var tbody = document.getElementById('catDraftTbody');
  if (!tbody) return;
  var d = Aoi.orders.ensure();
  tbody.innerHTML = Aoi.catalog.draft.map(function (it) {
    var unmatched = (it.unmatched || []).length
      ? '<div class="text-[11px] text-red-500 mt-0.5">未识别：' + Aoi.escapeHtml(it.unmatched.join(' / ')) + '</div>'
      : '';
    var suspect = it.aiSuspect
      ? '<div class="text-[11px] text-amber-600 mt-0.5">疑似与「' + Aoi.escapeHtml(it.aiSuspect.jpName) + '」同一商品（AI 对齐）'
        + ' <button type="button" class="underline" onclick="Aoi.catalog.resolveSuspect(\'' + it.id + '\',true)">合并</button>'
        + ' <button type="button" class="underline" onclick="Aoi.catalog.resolveSuspect(\'' + it.id + '\',false)">保留两行</button></div>'
      : '';
    var typeOpts = Object.keys(d.typeMeta || {}).map(function (t) {
      return '<option value="' + Aoi.escapeHtml(t) + '"' + (t === it.type ? ' selected' : '') + '>' + Aoi.escapeHtml(t) + '</option>';
    }).join('');
    return '<tr data-id="' + it.id + '" class="border-b border-gray-100">'
      + '<td class="px-2 py-1 text-center"><input type="checkbox" class="cat-sel"' + (it.select ? ' checked' : '') + '></td>'
      + '<td class="px-2 py-1">' + (Aoi.safeUrl(it.image) ? '<img src="' + Aoi.escapeHtml(Aoi.safeUrl(it.image)) + '" class="w-9 h-9 object-cover rounded" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : '—') + '</td>'
      + '<td class="px-2 py-1 max-w-[16rem]"><div class="text-sm">' + Aoi.escapeHtml(it.jpName) + '</div>' + unmatched + suspect + '</td>'
      + '<td class="px-2 py-1"><input class="cat-cn border border-gray-300 rounded px-2 py-1 text-sm w-56" value="' + Aoi.escapeHtml(it.name) + '">' + Aoi.catalog.aiSuggestHtml(it, 'cn') + '</td>'
      + '<td class="px-2 py-1"><select class="cat-type border border-gray-300 rounded px-1 py-1 text-sm">' + typeOpts + '</select>' + Aoi.catalog.aiSuggestHtml(it, 'type') + '</td>'
      + '<td class="px-2 py-1 text-right text-sm text-gray-500">' + (it.priceJpy != null ? '¥' + it.priceJpy.toLocaleString() : '—') + '</td>'
      + '<td class="px-2 py-1"><input class="cat-price border border-gray-300 rounded px-2 py-1 text-sm w-16 text-right" value="' + (it.priceCny != null ? it.priceCny : '') + '" placeholder="选填"></td>'
      + '<td class="px-2 py-1"><input class="cat-limit border border-gray-300 rounded px-2 py-1 text-sm w-12 text-right" value="' + Aoi.escapeHtml(it.limit) + '"></td>'
      + '<td class="px-2 py-1 text-sm">' + (it.saleDate ? Aoi.escapeHtml(it.saleDate) : '—') + '</td>'
      + '<td class="px-2 py-1">' + (Aoi.safeUrl(it.url) ? '<a href="' + Aoi.escapeHtml(Aoi.safeUrl(it.url)) + '" target="_blank" rel="noopener" class="text-blue-600 hover:underline text-xs">打开</a>' : '—') + '</td>'
      + '<td class="px-2 py-1 text-center"><button onclick="Aoi.catalog.removeDraft(\'' + it.id + '\')" class="text-red-500 hover:underline text-xs">删</button></td>'
      + '</tr>';
  }).join('') || '<tr><td colspan="11" class="px-3 py-6 text-center text-sm text-gray-400">暂无草稿——先在上方粘贴解析</td></tr>';
  var sel2 = document.getElementById('catPushActivity');
  if (sel2 && !sel2.options.length) {
    sel2.innerHTML = '<option value="">— 选择已有活动 —</option>' + (d.activities || []).slice().sort().map(function (a) {
      return '<option value="' + Aoi.escapeHtml(a) + '">' + Aoi.escapeHtml(a) + '</option>';
    }).join('');
  }
};

Aoi.catalog.removeDraft = function (id) {
  Aoi.catalog.draft = Aoi.catalog.draft.filter(function (x) { return x.id !== id; });
  Aoi.catalog.render();
};
