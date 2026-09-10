// Aoi-system — 购买清单图片导出（v3.9.0）
// 限购计划页「导出购买清单图」：按已存购买计划（d.limitPlans）逐账号生成一张
// 简洁大字图片（PNG 下载），内容 = 账号名 + 每件所需商品的参考图与数量。
// 版式（每商品行高 H 的占比，尽可能简洁字大）：参考图 75% / 商品名称字号 10% / 数量字号 5%。
// 名称显示原语言（PCO 目录按 refUrl/名称回查 jpName；型号本身含假名视为原文）；无原文回落中文型号。
// 缺失兜底：无参考图 / 图片拉取失败或跨域不可绘 → 灰底「图片缺失」占位块。
// 纯函数（collect / displayName / fileBase / layout）供单测；canvas 绘制与下载仅在浏览器执行。
window.Aoi = window.Aoi || {};
Aoi.planExport = {};

// 版式占比：行高 H 内 —— 参考图 75% / 名称字号 10% / 数量字号 5%（余 10% 为行内留白）
Aoi.planExport.layout = function (h) {
  return { img: Math.round(h * 0.75), name: Math.round(h * 0.10), qty: Math.round(h * 0.05) };
};

// 绘制参数
Aoi.planExport.OPTS = { width: 760, headerH: 110, rowH: 300, pad: 40, titleFont: 44 };

// 原语言名称解析：商品主档 nameOrig（原名元数据，v3.9.2）优先 → PCO 目录按 refUrl/
// 名称互查 jpName → 型号本身含假名视为原文；都没有 → 型号（中文译名）兜底
Aoi.planExport.displayName = function (d, p) {
  var model = (p && p.model) || '';
  if (p && p.nameOrig) return p.nameOrig;
  var refUrl = Aoi.exportSummary.absUrl(p && p.refUrl);
  var items = (d && d.pcoItems) || [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    if (!it || !it.jpName) continue;
    var sameUrl = refUrl && it.url && Aoi.exportSummary.absUrl(it.url) === refUrl;
    var sameName = it.jpName === model || (it.name && it.name === model);
    if (sameUrl || sameName) return it.jpName;
  }
  return model;
};

// 生成某活动购买计划的逐账号卡片数据（纯数据，供绘制与单测）
Aoi.planExport.collect = function (d, activity) {
  var plan = d && d.limitPlans && d.limitPlans[activity];
  if (!plan || !plan.items) return [];
  var pmeta = {};
  (((d.activityMeta || {})[activity] || {}).products || []).forEach(function (p) {
    if (p) pmeta[p.type + '|' + p.model] = p;
  });
  return (plan.items || []).filter(function (a) { return a.items && a.items.length; })
    .map(function (a) {
      return {
        index: a.index,
        title: Aoi.limits.purchaserLabel(activity, a.index) || ('账号 ' + a.index),
        items: a.items.map(function (it) {
          var p = pmeta[it.type + '|' + it.model] || {};
          return {
            key: it.type + '|' + it.model,
            name: Aoi.planExport.displayName(d, p),
            qty: it.qty || 0,
            image: Aoi.exportSummary.absUrl(p.refImage || '')
          };
        })
      };
    });
};

// 导出文件基础名：活动名-账号N[-购买人]-购买清单（非法文件名字符 → -）
Aoi.planExport.fileBase = function (activity, card) {
  var raw = activity + '-账号' + card.index + '-购买清单';
  if (card.title && card.title !== '账号 ' + card.index) raw = activity + '-账号' + card.index + '-' + card.title + '-购买清单';
  return raw.replace(/[\\/:*?"<>|]/g, '-');
};

// —— 绘制 ——

// 名称自动换行（逐字测量，最多 maxLines 行，超出省略号收尾），整体垂直居中于 y
function wrapText(ctx, text, x, y, maxW, lineH, maxLines) {
  var chars = String(text || '').split('');
  var lines = [], line = '';
  chars.forEach(function (ch) {
    if (line && ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
    else line += ch;
  });
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '…'; }
  var y0 = y - ((lines.length - 1) * lineH) / 2;
  lines.forEach(function (ln, i) { ctx.fillText(ln, x, y0 + i * lineH); });
}

// 把卡片画到 canvas：images 为 { 商品key: HTMLImageElement|null }（null/缺 → 图片缺失占位）
Aoi.planExport.drawCard = function (canvas, card, images) {
  var o = Aoi.planExport.OPTS;
  var L = Aoi.planExport.layout(o.rowH);
  canvas.width = o.width;
  canvas.height = o.headerH + card.items.length * o.rowH + 20;
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 canvas 绘制');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = 'middle';
  // 账号名（主要信息，放大）
  ctx.fillStyle = '#111111';
  ctx.font = 'bold ' + o.titleFont + 'px sans-serif';
  ctx.fillText(card.title, o.pad, Math.round(o.headerH / 2));
  card.items.forEach(function (it, i) {
    var top = o.headerH + i * o.rowH;
    ctx.strokeStyle = '#e5e7eb';
    ctx.beginPath(); ctx.moveTo(o.pad, top + 0.5); ctx.lineTo(o.width - o.pad, top + 0.5); ctx.stroke();
    // 参考图（75% 行高，等比 contain 居中；缺图占位）
    var box = L.img, ix = o.pad, iy = top + Math.round((o.rowH - box) / 2);
    var img = images && images[it.key];
    if (img && img.width && img.height) {
      var scale = Math.min(box / img.width, box / img.height);
      var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      ctx.drawImage(img, ix + Math.round((box - w) / 2), iy + Math.round((box - h) / 2), w, h);
    } else {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(ix, iy, box, box);
      ctx.fillStyle = '#9ca3af';
      ctx.font = Math.round(box * 0.11) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('图片缺失', ix + box / 2, iy + box / 2);
      ctx.textAlign = 'left';
    }
    // 商品名称（原语言；无原文时 collect 已回落中文）—— 10% 行高字号，最多两行
    var nameX = ix + box + 28;
    var nameW = o.width - o.pad - nameX - 130;
    ctx.fillStyle = '#111111';
    ctx.font = 'bold ' + L.name + 'px sans-serif';
    wrapText(ctx, it.name, nameX, top + Math.round(o.rowH / 2), nameW, Math.round(L.name * 1.4), 2);
    // 数量 —— 5% 行高字号，右对齐
    ctx.fillStyle = '#374151';
    ctx.font = 'bold ' + Math.max(L.qty, 13) + 'px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('×' + it.qty, o.width - o.pad, top + Math.round(o.rowH / 2));
    ctx.textAlign = 'left';
  });
  return canvas;
};

// —— 图片装载：只往画布画「干净」图源（否则 toDataURL 会因画布污染抛错）——
// http(s)：按候选通道依次 fetch 转 dataURL（直连 → /media-proxy → /media-relay，
// 白名单见 Aoi.import.PROXY_HOSTS，覆盖无 CORS 头的图床）；全失败回退 crossOrigin 直载；
// 仍失败 → null（绘制占位块）。data: 直载。
Aoi.planExport.loadImage = function (url) {
  var s = String(url || '');
  if (!s) return Promise.resolve(null);
  var loadSrc = function (src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  };
  if (/^data:image\//i.test(s)) return loadSrc(s);
  var candidates = Aoi.exportSummary.imageCandidates(s);
  var attempt = function (i) {
    if (i >= candidates.length) return Promise.resolve(null);
    return fetch(candidates[i], { redirect: 'follow' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result)); };
        fr.onerror = function () { reject(new Error('读取失败')); };
        fr.readAsDataURL(blob);
      });
    }).then(loadSrc).then(function (img) {
      return img || attempt(i + 1);
    }).catch(function () {
      return attempt(i + 1);
    });
  };
  return attempt(0).then(function (img) {
    if (img) return img;
    // 全通道失败 → crossOrigin 直载兜底（源站带 ACAO 但 fetch 受限的场景）
    var img2 = new Image();
    img2.crossOrigin = 'anonymous';
    return new Promise(function (resolve) {
      img2.onload = function () { resolve(img2); };
      img2.onerror = function () { resolve(null); };
      img2.src = s;
    });
  });
};

// 单账号导出：装载图片 → 绘制 → PNG 下载。返回文件名（失败返回 false）
Aoi.planExport.renderCard = async function (activity, card) {
  var imgs = {};
  for (var i = 0; i < card.items.length; i++) {
    imgs[card.items[i].key] = await Aoi.planExport.loadImage(card.items[i].image);
  }
  var canvas = document.createElement('canvas');
  Aoi.planExport.drawCard(canvas, card, imgs);
  var name = Aoi.planExport.fileBase(activity, card);
  var a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = name + '.png';
  a.click();
  return name;
};

Aoi.planExport.exportAccount = async function (activity, index) {
  var d = Aoi.orders.ensure();
  var cards = Aoi.planExport.collect(d, activity);
  var card = null;
  cards.forEach(function (c) { if (c.index === index) card = c; });
  if (!card) { Aoi.toast('未找到该账号的购买计划', 'warning'); return false; }
  try {
    return await Aoi.planExport.renderCard(activity, card);
  } catch (e) {
    Aoi.toast('导出失败：' + (e && e.message ? e.message : e), 'error');
    return false;
  }
};

// 全部账号导出（每账号一张 PNG，间隔触发避免浏览器拦截多文件下载）
Aoi.planExport.exportAll = async function (activity) {
  activity = (activity || '').trim();
  if (!activity) { Aoi.toast('请先选择活动', 'warning'); return; }
  var cards = Aoi.planExport.collect(Aoi.orders.ensure(), activity);
  if (!cards.length) { Aoi.toast('该活动还没有购买计划——请先「计算购买计划」', 'warning'); return; }
  Aoi.showLoading('正在生成 ' + cards.length + ' 张购买清单图…');
  var ok = 0;
  for (var i = 0; i < cards.length; i++) {
    try { if (await Aoi.planExport.renderCard(activity, cards[i])) ok++; }
    catch (e) { /* 单卡失败不中断 */ }
    await new Promise(function (r) { setTimeout(r, 350); });
  }
  Aoi.hideLoading();
  Aoi.toast('已导出 ' + ok + '/' + cards.length + ' 张购买清单图片', ok ? 'success' : 'error');
};
