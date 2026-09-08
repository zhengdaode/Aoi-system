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

// v3.6.1：统一「添加图片」弹窗——粘贴图片 / 上传图片 / 粘贴图床链接 三合一，
// 确认后写回调用方的目标输入框（桌面端推荐入口，修复旧直粘路径焦点依赖的"无法粘贴"）
Aoi.img.pickerTarget = null;

Aoi.img.openPicker = function (targetId) {
  var target = document.getElementById(targetId);
  if (!target) { Aoi.toast('未找到目标输入框', 'error'); return; }
  Aoi.img.pickerTarget = targetId;
  var t = document.getElementById('imgPickerTitle');
  if (t) t.textContent = '填入：' + (target.placeholder || targetId);
  var urlInput = document.getElementById('imgUrlInput');
  if (urlInput) urlInput.value = '';
  Aoi.img.pickerStatus('截图后直接按 Ctrl+V 即可（无需点击任何输入框）');
  Aoi.img.applyPickedUrl('');
  document.getElementById('imgPickerModal').classList.remove('hidden');
};

Aoi.img.closePicker = function () {
  document.getElementById('imgPickerModal').classList.add('hidden');
  Aoi.img.pickerTarget = null;
};

Aoi.img.pickerStatus = function (text) {
  var el = document.getElementById('imgPickerStatus');
  if (el) el.textContent = text || '';
};

// 点击粘贴区 = 聚焦链接输入框（图片粘贴本就不依赖焦点，此处便于继续手打链接）
Aoi.img.focusPickerUrl = function () {
  var el = document.getElementById('imgUrlInput');
  if (el) el.focus();
};

// 填入候选 URL：校验 + 预览 + 确认按钮状态；仅 http(s) 链接可确认
Aoi.img.applyPickedUrl = function (url) {
  url = (url || '').trim();
  var urlInput = document.getElementById('imgUrlInput');
  if (urlInput && urlInput.value !== url) urlInput.value = url;
  var ok = /^https?:\/\/\S+/.test(url);
  var box = document.getElementById('imgPickerPreview');
  var img = document.getElementById('imgPickerPreviewImg');
  var label = document.getElementById('imgPickerPreviewUrl');
  if (box) box.classList.toggle('hidden', !url);
  if (img && url) img.src = url;
  if (label) label.textContent = url;
  var btn = document.getElementById('imgPickerConfirm');
  if (btn) btn.disabled = !ok;
  return ok;
};

Aoi.img.confirmPicker = function () {
  var url = ((document.getElementById('imgUrlInput') || {}).value || '').trim();
  if (!/^https?:\/\/\S+/.test(url)) { Aoi.toast('请先粘贴图片 / 上传图片，或填写 http(s) 图床链接', 'warning'); return; }
  var target = document.getElementById(Aoi.img.pickerTarget);
  Aoi.img.closePicker();
  if (target) {
    target.value = url;
    Aoi.toast('图片链接已填入，保存后生效', 'success');
  }
};

// 弹窗内上传（文件选择 / 粘贴图片共用）
Aoi.img.pickerUpload = function (file) {
  if (!file) return;
  Aoi.img.pickerStatus('正在压缩并上传图片…');
  Aoi.img.upload(file).then(function (url) {
    Aoi.img.applyPickedUrl(url);
    Aoi.img.pickerStatus('上传成功，点「确认填入」写入目标输入框');
  }, function (err) {
    Aoi.img.pickerStatus('上传失败：' + (err && err.message ? err.message : '未知错误'));
    Aoi.toast('图片上传失败：' + (err && err.message ? err.message : '未知错误'), 'error');
  });
};

Aoi.img.pickerFileInput = function (inputEl) {
  var file = inputEl && inputEl.files && inputEl.files[0];
  if (file) Aoi.img.pickerUpload(file);
  if (inputEl) inputEl.value = '';
};

// paste 全局监听（v3.6.1 修复）：「添加图片」弹窗打开时，页面任意位置 Ctrl+V 均可捕获图片——
// 不再要求焦点恰好落在输入框（旧实现焦点稍偏即"无法粘贴"）；弹窗未开时保留原快捷路径：
// 焦点在 data-img-paste 输入框内粘贴图片 → 直接上传回填
Aoi.img.bindPaste = function () {
  document.addEventListener('paste', function (e) {
    var cd = e.clipboardData;
    if (!cd || !cd.items) return;
    var file = null;
    for (var i = 0; i < cd.items.length; i++) {
      if (cd.items[i].type && cd.items[i].type.indexOf('image/') === 0) { file = cd.items[i].getAsFile(); break; }
    }
    if (!file) return;
    var modal = document.getElementById('imgPickerModal');
    var pickerOpen = !!(Aoi.img.pickerTarget && modal && !modal.classList.contains('hidden'));
    var t = e.target;
    var inMarked = !!(t && t.hasAttribute && t.hasAttribute('data-img-paste'));
    if (!pickerOpen && !inMarked) return;
    e.preventDefault();
    if (pickerOpen) {
      Aoi.img.pickerUpload(file);
      return;
    }
    Aoi.showLoading('正在压缩并上传粘贴的图片...');
    Aoi.img.upload(file).then(function (url) {
      Aoi.hideLoading();
      t.value = url;
      Aoi.toast('粘贴的图片已上传，保存后生效', 'success');
    }, function (err) {
      Aoi.hideLoading();
      Aoi.toast('粘贴上传失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    });
  });
};
Aoi.img.bindPaste();

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
