// Aoi-system — v3.32.0 活动宣传图（长海报 PNG）导出
// 数据：纯函数 buildData（可测）；渲染：canvas 组合长图，图片经 imageCandidates 候选链
// 取 base64（复用 summary-export 的拉取通道，避免画布污染），全失败画「图片缺失」占位。
window.Aoi = window.Aoi || {};
Aoi.poster = {};

// 商品行数据（纯函数）：名称=中文型号（原名副行）、单价=主档人民币价（缺则外币原价）、
// 已排=排谷表该商品键的排位数、总量=库存 stock 优先回落购买计划 limits，余量=总量-已排
Aoi.poster.buildData = function (d, activity) {
  var m = (d.activityMeta && d.activityMeta[activity]) || {};
  var plan = (d.limitPlans && d.limitPlans[activity]) || null;
  var paigu = (d.paigu && d.paigu[activity]) || null;
  var slots = (paigu && paigu.slots) || {};
  var placedTotal = 0;
  var products = (m.products || []).map(function (p) {
    var key = (p.type || '') + '|' + (p.model || '');
    var placed = (slots[key] || []).length;
    placedTotal += placed;
    var total = null;
    if (p.stock != null && p.stock !== '') total = Number(p.stock);
    else if (plan && plan.limits && plan.limits[key] != null) total = Number(plan.limits[key]);
    return {
      key: key,
      model: p.model || '',
      nameOrig: p.nameOrig || '',
      img: p.refImage || '',
      price: p.price != null && p.price !== '' ? Number(p.price) : null,
      priceOrig: p.priceOrig != null && p.priceOrig !== '' ? Number(p.priceOrig) : null,
      currency: p.currency || '',
      placed: placed,
      total: total,
      remain: total != null ? Math.max(total - placed, 0) : null
    };
  });
  return {
    name: activity,
    ip: m.ip || '',
    status: m.status || '未开始',
    deadline: m.deadline || '',
    cover: Aoi.orders.activityCover ? Aoi.orders.activityCover(d, activity) : (m.cover || ''),
    placedTotal: placedTotal,
    products: products
  };
};

// —— canvas 工具 ——

Aoi.poster.W = 760; // 海报宽度固定，高度随内容增长

// 简易富文本：多行截断（maxLines 行，末行加 …）
Aoi.poster.wrapText = function (ctx, text, maxWidth, maxLines) {
  var lines = [];
  var cur = '';
  for (var i = 0; i < text.length; i++) {
    var next = cur + text[i];
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = text[i];
      if (lines.length === maxLines) { lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; return lines; }
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
};

// cover 式裁剪绘制（源图按比例铺满目标框后居中裁剪）
Aoi.poster.drawCover = function (ctx, img, x, y, w, h) {
  var iw = img.width || img.naturalWidth;
  var ih = img.height || img.naturalHeight;
  if (!iw || !ih) return;
  var scale = Math.max(w / iw, h / ih);
  var sw = w / scale, sh = h / scale;
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
};

Aoi.poster.loadImage = function (dataUrl) {
  return new Promise(function (resolve) {
    var img = new Image();
    img.onload = function () { resolve(img); };
    img.onerror = function () { resolve(null); };
    img.src = dataUrl;
  });
};

// 拉取一张商品图：fetchImageBase64（直连→代理候选链，webp 经 canvas 重编码 jpeg）→ Image；
// 注意其返回值为 {dataUrl, ext} 对象——取 .dataUrl 喂 Image（v3.32.1 修复：误传整个对象致全图失败）。
// v3.32.2：返回结构化结果 {ok, url, stage, img}——stage=fetch(候选链全败，多为非白名单主机无
// 代理通道)/decode(字节取回但解码失败)，供 compose 汇总诊断（Aoi.poster.lastFailures）
Aoi.poster.fetchImg = function (url) {
  if (!url) return Promise.resolve({ ok: false, url: url, stage: 'empty', img: null });
  var fetchBase64 = (Aoi.exportSummary && Aoi.exportSummary.fetchImageBase64) || null;
  return Promise.resolve()
    .then(function () { return fetchBase64 ? fetchBase64(url) : null; })
    .then(function (r) {
      if (!r || !r.dataUrl) return { ok: false, url: url, stage: 'fetch', img: null };
      return Aoi.poster.loadImage(r.dataUrl).then(function (img) {
        return img ? { ok: true, url: url, stage: '', img: img } : { ok: false, url: url, stage: 'decode', img: null };
      });
    })
    .catch(function () { return { ok: false, url: url, stage: 'fetch', img: null }; });
};

// 占位框
Aoi.poster.drawPlaceholder = function (ctx, x, y, w, h) {
  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#d1d5db';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('图片缺失', x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
};

// 商品行高：图高 + 文字区（名称两行 + 价格 + 已排行 + 边距）
Aoi.poster.CELL = { w: 344, imgH: 240, textH: 118, gap: 16 };

Aoi.poster.drawProduct = function (ctx, p, x, y, img) {
  var C = Aoi.poster.CELL;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, C.w, C.imgH + C.textH);
  if (img) Aoi.poster.drawCover(ctx, img, x, y, C.w, C.imgH);
  else Aoi.poster.drawPlaceholder(ctx, x, y, C.w, C.imgH);
  var ty = y + C.imgH + 34;
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 20px sans-serif';
  Aoi.poster.wrapText(ctx, p.model || '（未命名商品）', C.w - 28, 2).forEach(function (line, i) {
    ctx.fillText(line, x + 14, ty + i * 26);
  });
  ty += (p.nameOrig ? 52 : 26) + 6;
  ctx.fillStyle = '#e2543e';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(p.price != null ? '¥' + p.price : (p.priceOrig != null ? p.currency + ' ' + p.priceOrig : '价格未登记'), x + 14, ty);
  ctx.fillStyle = '#6b7280';
  ctx.font = '17px sans-serif';
  var placedLine = '已排 ' + p.placed;
  if (p.total != null) placedLine += ' · 余量 ' + p.remain + ' / 总量 ' + p.total;
  ctx.fillText(placedLine, x + 14, ty + 28);
};

// 长海报：头部封面 + 标题统计 → 商品两列网格 → 落款
// 失败诊断：Aoi.poster.lastFailures = [{url, stage}]（不含空链接），exportFor 据此提示
Aoi.poster.lastFailures = [];

Aoi.poster.compose = async function (data) {
  var W = Aoi.poster.W;
  var pad = 24;
  var results = await Promise.all(data.products.map(function (p) { return Aoi.poster.fetchImg(p.img); }));
  var imgs = results.map(function (r) { return r.ok ? r.img : null; });
  Aoi.poster.lastFailures = results
    .filter(function (r) { return !r.ok && r.stage !== 'empty'; })
    .map(function (r) { return { url: r.url, stage: r.stage }; });
  var coverImg = null;
  if (data.cover) {
    var coverRes = await Aoi.poster.fetchImg(data.cover);
    if (coverRes.ok) coverImg = coverRes.img;
  }

  // 预算高度：头部（封面 320 或 90）+ 标题块 110 + 每行商品高 + 落款 70
  var C = Aoi.poster.CELL;
  var cols = 2;
  var rows = Math.ceil(data.products.length / cols) || 1;
  var headerH = coverImg ? 320 : 96;
  var titleH = 116;
  var bodyH = rows * (C.imgH + C.textH + C.gap) + pad;
  var H = Math.ceil(headerH + titleH + bodyH + 70);

  var canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  var ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持 canvas 绘制');

  // 背景
  ctx.fillStyle = '#faf7f2';
  ctx.fillRect(0, 0, W, H);

  // 头部封面（有图 cover 裁剪铺满，无图珊瑚色渐变带 + 活动名直接作标题）
  var ty0 = 0;
  if (coverImg) {
    Aoi.poster.drawCover(ctx, coverImg, 0, 0, W, headerH);
    ty0 = headerH + 28;
  } else {
    var grad = ctx.createLinearGradient(0, 0, W, headerH);
    grad.addColorStop(0, '#e2543e');
    grad.addColorStop(1, '#ef8a5f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, headerH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 30px sans-serif';
    Aoi.poster.wrapText(ctx, data.name, W - pad * 2, 2).forEach(function (line, i) {
      ctx.fillText(line, pad, 52 + i * 38);
    });
    ty0 = headerH + 20;
  }

  // 标题块
  if (coverImg) {
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 34px sans-serif';
    Aoi.poster.wrapText(ctx, data.name, W - pad * 2, 2).forEach(function (line, i) {
      ctx.fillText(line, pad, ty0 + i * 42);
    });
    ty0 += data.name.length > 18 ? 84 : 46;
  }
  var stats = ['周边 ' + data.products.length + ' 种', '已排 ' + data.placedTotal + ' 件'];
  if (data.ip) stats.push('IP ' + data.ip);
  if (data.deadline) stats.push('预计 ' + data.deadline + ' 截团');
  stats.push(data.status);
  ctx.fillStyle = '#6b7280';
  ctx.font = '20px sans-serif';
  ctx.fillText(stats.join('　·　'), pad, ty0 + 22);
  ty0 += titleH - (coverImg ? 46 : 40);

  // 商品网格（两列）
  data.products.forEach(function (p, i) {
    var col = i % cols, row = Math.floor(i / cols);
    Aoi.poster.drawProduct(ctx, p, pad + col * (C.w + C.gap), ty0 + row * (C.imgH + C.textH + C.gap), imgs[i]);
  });

  // 落款
  ctx.fillStyle = '#9ca3af';
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Aoi System · ' + data.name + ' · 生成于 ' + new Date().toISOString().slice(0, 10), W / 2, H - 26);
  ctx.textAlign = 'left';
  return canvas;
};

Aoi.poster.exportFor = async function (activity) {
  var d = Aoi.orders.ensure();
  if (!(d.activityMeta && d.activityMeta[activity])) { Aoi.toast('未找到该活动', 'warning'); return; }
  if (!d.activityMeta[activity].products || !d.activityMeta[activity].products.length) {
    Aoi.toast('该活动还没有登记商品，请先在展开区添加或从订单同步', 'warning');
    return;
  }
  var data = Aoi.poster.buildData(d, activity);
  Aoi.showLoading('正在生成「' + activity + '」宣传图…');
  try {
    var canvas = await Aoi.promiseTimeout(Aoi.poster.compose(data), 60000, '宣传图生成超时——活动内有加载缓慢的参考图，请稍后重试');
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = activity.replace(/[\\/:*?"<>|]/g, '-') + '-宣传图.png';
    a.click();
    var fails = Aoi.poster.lastFailures || [];
    if (fails.length) {
      var hosts = {};
      fails.forEach(function (f) {
        var m = String(f.url).match(/^https?:\/\/([^\/?#]+)/);
        hosts[m ? m[1] : '（其他）'] = 1;
      });
      console.warn('[宣传图] 有 ' + fails.length + ' 张图片未能加载（stage=fetch=代理/直连通道全败，decode=取回但解码失败）：', fails);
      Aoi.toast('海报已导出，但有 ' + fails.length + ' 张商品图未能加载——失败图片域名：' + Object.keys(hosts).join('、') + '（详见控制台），对应位置为「图片缺失」占位', 'warning');
    } else {
      Aoi.toast('已导出「' + activity + '」宣传图', 'success');
    }
  } catch (e) {
    Aoi.toast('导出宣传图失败：' + (e && e.message ? e.message : '未知错误'), 'error');
  } finally {
    Aoi.hideLoading();
  }
};
