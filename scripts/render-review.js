#!/usr/bin/env node
// 审阅材料渲染：docs/PLAN-F5-QQBOT-BIDIRECTIONAL.md → demo/review/f5-plan.html（手机可读）
// 文档更新后重跑：node scripts/render-review.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'PLAN-F5-QQBOT-BIDIRECTIONAL.md');
const OUT_DIR = path.join(ROOT, 'demo', 'review');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function inline(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre><code>' + esc(buf.join('\n')) + '</code></pre>');
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push('<blockquote>' + buf.map(inline).join('<br>') + '</blockquote>');
      continue;
    }
    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const parse = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
      const head = parse(rows[0]);
      const body = rows.slice(2).map(parse);
      out.push('<div class="tablewrap"><table><thead><tr>'
        + head.map((c) => '<th>' + inline(c) + '</th>').join('')
        + '</tr></thead><tbody>'
        + body.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.、]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+[.、]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+[.、])\s+/, ''));
        i++;
      }
      out.push('<ul>' + items.map((it) => '<li>' + inline(it) + '</li>').join('') + '</ul>');
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|>|\||```|\s*[-*]\s|\s*\d+[.、]\s|-{3,})/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push('<p>' + inline(buf.join(' ')) + '</p>');
  }
  return out.join('\n');
}

const CSS = `:root{--ink:#111827;--sub:#6b7280;--line:#e5e7eb}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:ui-sans-serif,system-ui,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--ink);background:#f9fafb;padding:24px;line-height:1.75}
.wrap{max-width:820px;margin:0 auto}
h1{font-size:1.4rem;font-weight:800;margin:20px 0 12px;line-height:1.4}
h2{font-size:1.1rem;font-weight:800;margin:28px 0 10px;padding-top:14px;border-top:1px solid var(--line)}
h3,h4{font-size:1rem;font-weight:700;margin:18px 0 8px}
p,ul,blockquote,pre{margin:0 0 12px}
li{margin:4px 0 4px 20px}
blockquote{border-left:3px solid #f59e0b;background:#fffbeb;padding:10px 14px;border-radius:0 8px 8px 0;color:#78350f;font-size:.9rem}
pre{background:#111827;color:#e5e7eb;border-radius:10px;padding:14px;overflow-x:auto;-webkit-overflow-scrolling:touch}
pre code{font-family:ui-monospace,Consolas,monospace;font-size:.78rem;line-height:1.6}
code{font-family:ui-monospace,Consolas,monospace;font-size:.85em;background:#f3f4f6;border-radius:4px;padding:1px 5px}
pre code{background:none;padding:0}
.tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 14px}
table{width:100%;border-collapse:collapse;font-size:.82rem;background:#fff}
.tablewrap table{min-width:560px}
th{text-align:left;color:var(--sub);font-weight:600;padding:8px 10px;background:#f3f4f6;white-space:nowrap}
td{padding:8px 10px;border-bottom:1px dotted var(--line);vertical-align:top}
tr:nth-child(even) td{background:#fafafa}
hr{border:none;border-top:1px solid var(--line);margin:20px 0}
.topbar{position:sticky;top:0;background:rgba(249,250,251,.92);backdrop-filter:blur(6px);padding:10px 0;border-bottom:1px solid var(--line);margin-bottom:8px}
.topbar a{font-size:.85rem;color:#2563eb;text-decoration:none}
@media (max-width:820px){body{padding:14px 12px}h1{font-size:1.2rem}}`;

const PAGE = (title, badge, body) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="topbar"><a href="index.html">← 审阅目录</a></div>
  <p><span style="font-size:.75rem;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:999px;padding:2px 10px">${badge}</span></p>
  ${body}
</div>
</body>
</html>`;

const md = fs.readFileSync(SRC, 'utf8');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'f5-plan.html'),
  PAGE('F5 · QQ 机器人双向 · 设计审阅', '待用户审核 · 可直接批注或回复', mdToHtml(md)));

const HUB_CSS = CSS + `
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:16px;display:block;text-decoration:none;color:var(--ink)}
.card:hover{border-color:#93c5fd}
.card h2{border:none;padding:0;margin:0 0 6px}
.card p{margin:0;color:var(--sub);font-size:.85rem}`;
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>审阅目录 · F5 计划 / F6 Demo</title><style>${HUB_CSS}</style></head>
<body><div class="wrap">
<h1 style="font-size:1.3rem;font-weight:800;margin:20px 0 4px">审阅目录</h1>
<p style="color:var(--sub);font-size:.85rem;margin-bottom:20px">v3.4.0 待审核材料 · 2026-09-08</p>
<a class="card" href="f5-plan.html"><h2>F5 · QQ 机器人双向 · 详细功能设计</h2><p>独立项目提案（新仓库 aoi-qqbot）：群内查单 / 私聊进度 / 自助绑定 / 帮助，含架构与分步实现计划。</p></a>
<a class="card" href="../stats-demo/index.html"><h2>F6 · 团期复盘统计 · Demo</h2><p>独立演示页（内置合成数据）：KPI 卡 / 按活动聚合 / IP 排行 / 交费状态分布，已适配手机浏览。</p></a>
<p style="color:#9ca3af;font-size:.75rem;line-height:1.7;margin-top:24px">F5 页面由 scripts/render-review.js 从 docs/PLAN-F5-QQBOT-BIDIRECTIONAL.md 自动生成，文档更新后重跑即可。</p>
</div></body></html>`);

console.log('OK: demo/review/index.html + demo/review/f5-plan.html');

// —— 单文件合并版（F5 计划 + F6 demo），供直接发送到手机离线打开 ——
const demoPath = path.join(ROOT, 'demo', 'stats-demo', 'index.html');
const demoHtml = fs.readFileSync(demoPath, 'utf8');
const demoStyle = (demoHtml.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
const demoBody = (demoHtml.match(/<body>([\s\S]*?)<script>/) || [])[1] || '';
const demoScript = (demoHtml.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

fs.writeFileSync(path.join(OUT_DIR, 'Aoi-F5F6-review.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aoi v3.4.0 审阅 · F5 计划 + F6 Demo（离线单文件）</title>
<style>${CSS}</style>
<style>${demoStyle}</style>
</head>
<body>
<div class="wrap">
  <p><span style="font-size:.75rem;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:999px;padding:2px 10px">待用户审核 · 全部数据为合成示例，非真实订单</span></p>
  ${mdToHtml(md)}
</div>
<hr>
<div id="f6">
${demoBody}
</div>
<script>${demoScript}</script>
</body>
</html>`);

console.log('OK: demo/review/Aoi-F5F6-review.html（单文件离线版）');
