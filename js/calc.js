// Aoi-system — 个性化计算器：中日韩货币加价换算（0.5 圆整）
window.Aoi = window.Aoi || {};
Aoi.calc = {};

// 默认汇率/加价（日韩各一套；人民币无需换算）。公式待定，此处为占位
Aoi.calc.defaults = function () {
  return {
    jpy: { rate: 0.048, markup: 0.005 },
    krw: { rate: 0.0052, markup: 0.0001 }
  };
};

// 读取汇率配置（合并默认值），存于 Aoi.state.data.calc
Aoi.calc.get = function () {
  var def = Aoi.calc.defaults();
  var c = (Aoi.state.data && Aoi.state.data.calc) || {};
  var pick = function (key, dflt) { return (c[key] != null && !isNaN(c[key])) ? c[key] : dflt; };
  return {
    jpy: { rate: pick('jpyRate', def.jpy.rate), markup: pick('jpyMarkup', def.jpy.markup) },
    krw: { rate: pick('krwRate', def.krw.rate), markup: pick('krwMarkup', def.krw.markup) }
  };
};

// 保存汇率配置
Aoi.calc.save = async function () {
  var d = Aoi.state.data || {};
  d.calc = {
    jpyRate: parseFloat(document.getElementById('jpyRate').value),
    jpyMarkup: parseFloat(document.getElementById('jpyMarkup').value),
    krwRate: parseFloat(document.getElementById('krwRate').value),
    krwMarkup: parseFloat(document.getElementById('krwMarkup').value)
  };
  await Aoi.saveTeamData(d);
  Aoi.toast('计算器设置已保存', 'success');
};

// 0.5 圆整：小数部分 ≤0.3 → 0；0.4~0.6 → 0.5；≥0.7 → 1
Aoi.calc.roundHalf = function (n) {
  // 先归一到两位小数，避免浮点误差（如 1.3 - 1 === 0.30000000000000004）
  var cents = Math.round(n * 100) / 100;
  var whole = Math.floor(cents);
  var frac = Math.round((cents - whole) * 100) / 100;
  if (frac <= 0.3) return whole;
  if (frac >= 0.7) return whole + 1;
  return whole + 0.5;
};

// 单笔换算：外币 × (汇率 + 加价)，圆整到 0.5
Aoi.calc.convert = function (foreign, rate, markup) {
  return Aoi.calc.roundHalf(foreign * (rate + markup));
};

// 外币 → 人民币（人民币原样返回；日/韩走各自公式）
Aoi.calc.toRmb = function (price, currency) {
  if (!currency || currency === 'cny') return price;
  var cfg = Aoi.calc.get();
  var c = cfg[currency];
  if (!c) return price;
  return Aoi.calc.convert(price, c.rate, c.markup);
};

// 单笔换算结果渲染（计算器页）
Aoi.calc.render = function () {
  var foreign = parseFloat(document.getElementById('cForeign').value);
  var currency = document.getElementById('cCurrency').value;
  var cfg = Aoi.calc.get()[currency];
  var out = document.getElementById('cResult');
  if (isNaN(foreign) || !cfg) { out.textContent = '—'; return; }
  var rmb = Aoi.calc.convert(foreign, cfg.rate, cfg.markup);
  out.textContent = rmb.toFixed(2) + ' 元（拼团汇率 ' + (cfg.rate + cfg.markup).toFixed(4) + '）';
};

// 批量换算：每行一个值，逗号/换行分隔
Aoi.calc.batch = function () {
  var text = document.getElementById('cBatchIn').value;
  var currency = document.getElementById('cCurrency').value;
  var cfg = Aoi.calc.get()[currency];
  if (!cfg) { Aoi.toast('请先保存汇率设置', 'warning'); return; }
  var vals = text.split(/[\n,，]+/).map(function (s) { return parseFloat(s.trim()); }).filter(function (n) { return !isNaN(n); });
  document.getElementById('cBatchOut').textContent = vals.map(function (v) {
    return v + ' → ' + Aoi.calc.convert(v, cfg.rate, cfg.markup).toFixed(2);
  }).join('\n');
};

// 回填计算器页的汇率输入框
Aoi.calc.fillForm = function () {
  var cfg = Aoi.calc.get();
  document.getElementById('jpyRate').value = cfg.jpy.rate;
  document.getElementById('jpyMarkup').value = cfg.jpy.markup;
  document.getElementById('krwRate').value = cfg.krw.rate;
  document.getElementById('krwMarkup').value = cfg.krw.markup;
};
