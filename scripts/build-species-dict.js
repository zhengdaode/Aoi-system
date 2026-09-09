#!/usr/bin/env node
// 生成宝可梦种名官方中文词典 js/species-zh.js（v3.7.0 F9-S2）
// 数据源：PokeAPI（免费无 key，zh-hans 为官方译名）。一次性生成入仓，运行时零外部依赖。
// 用法：node scripts/build-species-dict.js   （约 1025 个物种，并发 8，需 1~3 分钟）
'use strict';
const fs = require('fs');
const path = require('path');

const API = 'https://pokeapi.co/api/v2/pokemon-species';
const OUT = path.join(__dirname, '..', 'js', 'species-zh.js');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'aoi-system-species-dict-builder' } });
  if (!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
  return res.json();
}

async function pool(items, n, fn) {
  const ret = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      ret[idx] = await fn(items[idx], idx).catch((e) => {
        process.stderr.write('skip ' + items[idx] + ': ' + e.message + '\n');
        return null;
      });
    }
  }));
  return ret;
}

(async () => {
  const list = await getJson(API + '/?limit=10000');
  const urls = list.results.map((r) => r.url);
  process.stderr.write('species total: ' + urls.length + '\n');
  const species = await pool(urls, 8, async (url) => {
    const s = await getJson(url);
    const ja = s.names.find((n) => n.language.name === 'ja');
    // PokeAPI 语言代码实际为全小写 zh-hans（2026-09-10 实测），大小写不敏感匹配以防疫方调整
    const zh = s.names.find((n) => /^zh-hans$/i.test(n.language.name));
    if (!ja || !zh || !ja.name || !zh.name) return null;
    return { id: s.id, ja: ja.name, zh: zh.name };
  });
  const map = {};
  let dup = 0;
  species.filter(Boolean).forEach((s) => {
    if (map[s.ja] && map[s.ja] !== s.zh) { dup++; process.stderr.write('ja name clash: ' + s.ja + ' -> ' + map[s.ja] + ' / ' + s.zh + '\n'); return; }
    map[s.ja] = s.zh;
  });
  const count = Object.keys(map).length;
  const body = '// 自动生成：宝可梦种名 官方中文对照（ja -> zh-Hans），数据源 PokeAPI。\n'
    + '// 由 scripts/build-species-dict.js 生成（' + new Date().toISOString().slice(0, 10) + '，' + count + ' 条），请勿手改；重生成后同步更新 tests。\n'
    + 'window.AOI_SPECIES = ' + JSON.stringify(map, null, 0) + ';\n';
  fs.writeFileSync(OUT, body, 'utf8');
  process.stderr.write('written ' + OUT + ' entries=' + count + ' clashes=' + dup + '\n');
})();
