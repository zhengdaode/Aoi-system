// Aoi-system — 图床上传：本地压缩 → 上传可配置图床 → 返回 URL（沿用原免费图床方案）
window.Aoi = window.Aoi || {};
Aoi.img = {};

// 默认免费图床（沿用原方案，可在设置页更换）
Aoi.img.DEFAULT_API = 'https://esaimg.cdn1.vip/api/v1.php';

Aoi.img.ensure = function () {
  var d = Aoi.orders.ensure();
  if (!d.imgHost) d.imgHost = {};
  return d;
};

Aoi.img.config = function () {
  var c = Aoi.img.ensure().imgHost || {};
  return {
    api: c.api || Aoi.img.DEFAULT_API,
    field: c.field || 'image',
    token: c.token || '',
    tokenIn: c.tokenIn || 'url',
    respPath: c.respPath || ''
  };
};

// dataURL → File
Aoi.img.dataURLtoFile = function (dataurl, filename) {
  var arr = dataurl.split(',');
  var mime = arr[0].match(/:(.*?);/)[1];
  var bstr = atob(arr[1]);
  var n = bstr.length;
  var u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new File([u8], filename, { type: mime });
};

// 压缩到最大边长，返回 JPEG base64
Aoi.img.compress = function (file, maxSize, quality) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = function (e) {
      var img = new Image();
      img.src = e.target.result;
      img.onload = function () {
        var w = img.width, h = img.height;
        if (w > h && w > maxSize) { h *= maxSize / w; w = maxSize; }
        else if (h > maxSize) { w *= maxSize / h; h = maxSize; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { reject(new Error('图片读取失败')); };
    };
    reader.onerror = function () { reject(new Error('文件读取失败')); };
  });
};

// 从图床响应提取 URL：respPath → Chevereto → Lsky Pro → 顶层 url → 兜底遍历
Aoi.img.extractUrl = function (result, cfg) {
  if (!result || typeof result !== 'object') return null;
  var url = null;
  if (cfg.respPath) {
    try { url = cfg.respPath.split('.').reduce(function (o, k) { return o[k]; }, result); } catch (e) {}
  }
  if (!url && result.data && result.data.url) url = result.data.url;
  if (!url && result.data && result.data.links && result.data.links.url) url = result.data.links.url;
  if (!url && result.url) url = result.url;
  if (!url) {
    var find = function (obj, depth) {
      if (depth > 3 || !obj) return null;
      for (var k in obj) {
        if (typeof obj[k] === 'string' && obj[k].indexOf('http') === 0) return obj[k];
        if (typeof obj[k] === 'object' && obj[k]) { var r = find(obj[k], depth + 1); if (r) return r; }
      }
      return null;
    };
    url = find(result, 0);
  }
  return url;
};

// 上传 base64 到图床
Aoi.img.uploadBase64 = async function (base64) {
  var cfg = Aoi.img.config();
  var file = Aoi.img.dataURLtoFile(base64, 'img_' + Date.now() + '.jpg');
  var fd = new FormData();
  fd.append(cfg.field, file);
  var apiUrl = cfg.api;
  if (cfg.token && cfg.tokenIn === 'url') {
    apiUrl += (apiUrl.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(cfg.token);
  }
  var headers = {};
  if (cfg.token && cfg.tokenIn === 'header') headers['Authorization'] = 'Bearer ' + cfg.token;

  var resp;
  try {
    resp = await fetch(apiUrl, { method: 'POST', body: fd, headers: headers });
  } catch (e) {
    throw new Error('无法连接图床，请检查 API 地址或网络');
  }
  var text = await resp.text();
  var result;
  try { result = JSON.parse(text); } catch (e) { throw new Error('图床返回非 JSON，请检查 API 地址'); }
  var url = Aoi.img.extractUrl(result, cfg);
  if (!url) {
    var msg = (result && result.message) ? result.message : '响应中未找到图片 URL';
    throw new Error(msg);
  }
  return url;
};

// 上传本地文件（压缩后上传），返回 URL
Aoi.img.upload = async function (file) {
  var base64 = await Aoi.img.compress(file, 800, 0.85);
  return await Aoi.img.uploadBase64(base64);
};

// 上传并把 URL 填到目标输入框（供 onchange 调用）
Aoi.img.fill = async function (inputEl, targetId) {
  var file = inputEl.files[0];
  if (!file) return;
  Aoi.showLoading('正在压缩并上传到图床...');
  try {
    var url = await Aoi.img.upload(file);
    var target = document.getElementById(targetId);
    if (url && target) { target.value = url; Aoi.toast('上传成功，点击保存生效', 'success'); }
    else Aoi.toast('图片上传失败，请重试', 'error');
  } catch (e) {
    Aoi.toast('上传失败：' + (e.message || '未知错误'), 'error');
  }
  Aoi.hideLoading();
  inputEl.value = '';
};

// 渲染设置页图床配置
Aoi.img.renderSettings = function () {
  var c = Aoi.img.config();
  var set = function (id, v) { var el = document.getElementById(id); if (el) el.value = v; };
  set('imgApi', c.api);
  set('imgField', c.field);
  set('imgToken', c.token);
  set('imgTokenIn', c.tokenIn);
  set('imgRespPath', c.respPath);
};

// 保存设置页图床配置
Aoi.img.saveSettings = async function () {
  var d = Aoi.img.ensure();
  var get = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  d.imgHost = {
    api: get('imgApi') || Aoi.img.DEFAULT_API,
    field: get('imgField') || 'image',
    token: get('imgToken'),
    tokenIn: get('imgTokenIn') || 'url',
    respPath: get('imgRespPath')
  };
  await Aoi.saveTeamData(d);
  Aoi.toast('图床设置已保存', 'success');
};
