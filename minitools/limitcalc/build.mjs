// 谷圈限购计算器 — 打包脚本：src → dist/ → dist/limitcalc.zip
// 用法：node build.mjs
// 产出 ZIP 满足小红书小工具规范：index.html 在根目录、仅允许的文件类型、无多余目录层。
import { rmSync, mkdirSync, cpSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');
const DIST = join(HERE, 'dist');
const ZIP_PATH = join(DIST, 'limitcalc.zip');

// —— 最小 ZIP 写入器（deflate；Node 标准库实现，免外部依赖）——
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function zipSync(entries, mtime) {
  const { time, date } = dosDateTime(mtime);
  const local = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const comp = deflateRawSync(e.data, { level: 9 });
    const method = comp.length < e.data.length ? 8 : 0;
    const body = method === 8 ? comp : e.data;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(0x0800, 6);        // flags: UTF-8 name
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...local.map(b => b), cd, eocd]);
}

// —— 收集 dist 文件（index.html 必须在根）——
function listFiles(dir, base) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFiles(full, base));
    else out.push({ rel: relative(base, full).split('\\').join('/'), full });
  }
  return out;
}

// —— 主流程 ——
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(SRC, DIST, { recursive: true });

const files = listFiles(DIST, DIST);
if (!files.some(f => f.rel === 'index.html')) {
  throw new Error('构建产物缺少根目录 index.html');
}
const banned = files.filter(f => /\.(map|md)$/.test(f.rel) || /node_modules|\.git/.test(f.rel));
if (banned.length) {
  throw new Error('构建产物含不允许的文件: ' + banned.map(f => f.rel).join(', '));
}

const mtime = new Date();
const entries = files.map(f => ({ name: f.rel, data: readFileSync(f.full) }));
const zip = zipSync(entries, mtime);
writeFileSync(ZIP_PATH, zip);

console.log('构建完成：');
files.forEach(f => console.log('  dist/' + f.rel + '  ' + statSync(f.full).size + ' B'));
console.log('ZIP: ' + ZIP_PATH + '  ' + zip.length + ' B (' + (zip.length / 1024).toFixed(1) + ' KiB)');
