// Aoi-system — 核心工具：状态、屏幕路由、通知、转义
window.Aoi = window.Aoi || {};

// 调试账户（免 Supabase，纯 localStorage 本地测试）
Aoi.DEBUG_EMAIL = 'debug@aoi.local';
Aoi.DEBUG_PWD = 'debug123';

// 全局状态
Aoi.state = {
  user: null,    // Supabase 登录用户
  team: null,    // 当前团队 { id, name, invite_code, ... }
  role: null,    // 当前用户角色 owner / admin
  members: [],   // 团队成员列表
  data: {}       // 团队业务数据（订单/周边/活动等，loadTeam 后填充）
};

// 生成唯一 ID
Aoi.genId = function () {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
};

// 屏幕路由：只显示目标 screen，隐藏其余
Aoi.showScreen = function (screenId) {
  document.querySelectorAll('[data-screen]').forEach(function (el) {
    el.classList.add('hidden');
  });
  var target = document.getElementById(screenId);
  if (target) target.classList.remove('hidden');
};

// 应用内视图切换（sidebar 导航）：只显示目标 view，高亮对应导航项
Aoi.nav = function (viewId) {
  document.querySelectorAll('[data-view]').forEach(function (el) {
    el.classList.add('hidden');
  });
  var target = document.getElementById(viewId);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('[data-nav]').forEach(function (el) {
    el.classList.toggle('bg-blue-600', el.getAttribute('data-nav') === viewId);
    el.classList.toggle('text-white', el.getAttribute('data-nav') === viewId);
  });
};

// XSS 防护：转义后再插入 DOM
Aoi.escapeHtml = function (str) {
  if (str == null) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
};

// Toast 通知（右上角，3 秒自动消失）
Aoi.toast = function (msg, type) {
  type = type || 'info';
  var palette = {
    success: { bg: '#16a34a', icon: '✅' },
    error:   { bg: '#dc2626', icon: '❌' },
    warning: { bg: '#ca8a04', icon: '⚠️' },
    info:    { bg: '#2563eb', icon: 'ℹ️' }
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

// 确认对话框（占位：先复用原生 confirm，后续由前端设计统一替换）
Aoi.confirm = function (msg) {
  return Promise.resolve(window.confirm(msg));
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
