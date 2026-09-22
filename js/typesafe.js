// Aoi.typesafe — TypeSafe（Jev/System One）语义判断客户端（v3.18.0，docs/PLAN-TYPESAFE.md）
// 定位：把「词典/精确匹配失败」的少数语义缺口交给服务端 AI 判断原语（Choice/Noul），
//   每个接入点都是三段式：确定性精确匹配优先 → 本模块增强 → 人工兜底。
//   任何故障（开关关闭 / 未登录 / debug 账号 / 超时 / 非 2xx / 网络异常）一律静默返回 null，
//   调用方回落现状行为——现有功能永不因本模块而变差。
// 密钥与调用链：前端零密钥；POST <SUPABASE_URL>/functions/v1/typesafe-proxy，
//   Authorization: Bearer <Aoi 管理员 token>（Edge 侧 admin_verify_session 校验后转发 TypeSafe API）。
window.Aoi = window.Aoi || {};
Aoi.typesafe = {
  KEY: 'aoi_typesafe',           // localStorage 开关（'off' 关闭；缺省开）
  MODEL: 'jev-latest',
  // 置信度阈值：auto=自动应用（对齐合并），show=展示译名建议，typeShow=展示类型建议（类型错选
  // 比不选更烦，门槛更高），col=列映射采纳。上线前在真实目录基准集上校准（PLAN-TYPESAFE §5）。
  TH: { auto: 0.85, show: 0.5, typeShow: 0.7, col: 0.6 },
  _cache: new Map(),             // 会话级缓存：JSON(model+state+questions) → answers

  enabled: function () {
    try { return localStorage.getItem(Aoi.typesafe.KEY) !== 'off'; } catch (e) { return true; }
  },
  url: function () {
    var u = (Aoi.config && Aoi.config.SUPABASE_URL) || '';
    return u ? u.replace(/\/+$/, '') + '/functions/v1/typesafe-proxy' : '';
  },
  available: function () {
    return !!(Aoi.typesafe.enabled() && Aoi.typesafe.url());
  },

  // 单次判断：answers | null。同入参命中缓存不重复计费；opts.fresh 跳过缓存。
  judge: async function (state, questions, opts) {
    opts = opts || {};
    var key = JSON.stringify([Aoi.typesafe.MODEL, state, questions]);
    if (!opts.fresh && Aoi.typesafe._cache.has(key)) return Aoi.typesafe._cache.get(key);
    if (!Aoi.typesafe.available()) return null;
    try {
      var s = Aoi.adminLoadSession ? Aoi.adminLoadSession() : null;
      if (!s || !s.token) return null;
      if (Aoi.state.user && Aoi.state.user.isDebug) return null; // debug 账号无管理员会话
      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 15000);
      var r, text;
      try {
        r = await fetch(Aoi.typesafe.url(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.token },
          body: JSON.stringify({ state: state, questions: questions, model: Aoi.typesafe.MODEL }),
          signal: ctrl.signal
        });
        text = await r.text();
      } finally { clearTimeout(timer); }
      if (!r.ok) return null;
      var j = JSON.parse(text);
      var answers = j && j.answers ? j.answers : null;
      if (answers) Aoi.typesafe._cache.set(key, answers);
      return answers;
    } catch (e) { return null; }
  },

  // 并发受控批量判断（默认 3 并发；返回顺序与入参一致，失败位为 null）
  judgeAll: async function (jobs, opts) {
    opts = opts || {};
    var conc = opts.concurrency || 3;
    var out = new Array(jobs.length).fill(null);
    var i = 0;
    async function worker() {
      while (i < jobs.length) {
        var cur = i++;
        out[cur] = await Aoi.typesafe.judge(jobs[cur].state, jobs[cur].questions, opts);
      }
    }
    var ws = [];
    for (var k = 0; k < Math.min(conc, jobs.length); k++) ws.push(worker());
    await Promise.all(ws);
    return out;
  },

  // 通用「行 → 候选」批量归属判断（v3.20.0 T6 快递归属 / T7 到货清单共用）：
  //   lines = [{text, context?}]（粘贴文本按行拆分），candidates = [{label, ...}]（≤12，label 为
  //   criteria 描述文本）。opts = { what, instructions, noneChoice }。
  //   返回 [{ idx, conf }]（idx=-1 表示「匹配不到」或解析失败）；是否采纳由调用方按阈值决定。
  matchToCandidates: async function (lines, candidates, opts) {
    opts = opts || {};
    var noneChoice = opts.noneChoice || '匹配不到';
    var empty = (lines || []).map(function () { return { idx: -1, conf: 0 }; });
    if (!candidates || !candidates.length || !lines || !lines.length) return empty;
    var criteria = {};
    candidates.forEach(function (c, i) { criteria['#' + (i + 1)] = c.label; });
    criteria[noneChoice] = '候选里没有对应的条目';
    var instructions = opts.instructions || ('这一行对应哪个' + (opts.what || '条目') + '？匹配不到就选「' + noneChoice + '」。');
    var jobs = lines.map(function (ln) {
      var text = typeof ln === 'string' ? ln : (ln.text || '');
      return {
        state: { line: text, context: (typeof ln === 'object' && ln.context) || '' },
        questions: { target: { type: 'choice', instructions: instructions, criteria: criteria } }
      };
    });
    var answers = await Aoi.typesafe.judgeAll(jobs);
    return answers.map(function (a) {
      var ans = a && a.target;
      if (!ans || ans.type !== 'choice') return { idx: -1, conf: 0 };
      var m2 = /^#(\d+)$/.exec(ans.choice);
      var conf = ans.confidence == null ? 1 : ans.confidence;
      return m2 ? { idx: parseInt(m2[1], 10) - 1, conf: conf } : { idx: -1, conf: conf };
    });
  },

  // —— 设置页开关 ——
  renderSettings: function () {
    var el = document.getElementById('tsEnabled');
    if (el) el.checked = Aoi.typesafe.enabled();
  },
  saveSettings: function () {
    var el = document.getElementById('tsEnabled');
    var on = !!(el && el.checked);
    try { localStorage.setItem(Aoi.typesafe.KEY, on ? 'on' : 'off'); } catch (e) { /* 隐私模式等忽略 */ }
    Aoi.typesafe._cache.clear();
    Aoi.toast(on ? 'AI 语义判断已开启（服务不可用时自动回落现状行为）' : 'AI 语义判断已关闭', 'success');
  }
};
