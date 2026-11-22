// 谷圈限购计算器 — 上传素材生成：icon.png（512×512 1:1）+ cover.png（750×1000 3:4）
// 用法：node brand.mjs
// 纯 Node 标准库像素绘制（无 canvas / 无外部依赖），2× 超采样后盒式降采样抗锯齿。
// 产出 brand/icon.png（JPG/PNG、≤5MiB、1:1）与 brand/cover.png（JPG/PNG、≤10MiB、3:4）。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAND = join(HERE, 'brand');

// —— PNG 编码（RGB 8bit）——
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

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function pngEncode(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor RGB
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// —— 光栅画布（浮点坐标，RGB 不透明绘制）——
class Raster {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 3);
  }

  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }

  fillRect(x0, y0, x1, y1, color) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        this.set(x, y, color);
      }
    }
  }

  // 垂直线性渐变（全画布）
  vGradient(c0, c1) {
    for (let y = 0; y < this.h; y++) {
      const t = y / Math.max(1, this.h - 1);
      const c = [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t)
      ];
      for (let x = 0; x < this.w; x++) this.set(x, y, c);
    }
  }

  // 圆角矩形（SDF 判定：dist = length(max(q,0)) + min(max(qx,qy),0) - r）
  fillRoundRect(x0, y0, x1, y1, r, color) {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const hw = (x1 - x0) / 2;
    const hh = (y1 - y0) / 2;
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        const dx = Math.abs(x + 0.5 - cx) - (hw - r);
        const dy = Math.abs(y + 0.5 - cy) - (hh - r);
        const mx = Math.max(dx, 0);
        const my = Math.max(dy, 0);
        const dist = Math.sqrt(mx * mx + my * my) + Math.min(Math.max(dx, dy), 0) - r;
        if (dist <= 0) this.set(x, y, color);
      }
    }
  }

  fillCircle(cx, cy, r, color) {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h, Math.ceil(cy + r));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.set(x, y, color);
      }
    }
  }
}

// 盒式降采样（factor 倍超采样 → 目标尺寸）
function downsample(src, factor) {
  const w = src.w / factor;
  const h = src.h / factor;
  const out = new Raster(w, h);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * src.w + (x * factor + dx)) * 3;
          r += src.px[i];
          g += src.px[i + 1];
          b += src.px[i + 2];
        }
      }
      out.set(x, y, [Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
    }
  }
  return out;
}

// —— 调色板（与 Aoi-system 珊瑚 #cc785c 同源）——
const CORAL = [204, 120, 92];
const CORAL_DEEP = [169, 92, 64];
const CORAL_LIGHT_TOP = [214, 135, 103];
const CORAL_LIGHT_BOTTOM = [192, 106, 78];
const CORAL_SOFT = [246, 231, 224];
const CREAM = [250, 247, 242];
const WHITE = [255, 255, 255];
const BAR = [233, 225, 217];
const AMBER = [224, 160, 60];

// —— 图标 512×512：珊瑚渐变底 + 白色计算器（显示屏 + 按键阵）——
// 所有设计坐标均在最终输出空间（512），绘制时乘以超采样系数 F
function drawIcon() {
  const F = 2;
  const c = new Raster(512 * F, 512 * F);
  c.vGradient(CORAL_LIGHT_TOP, CORAL_LIGHT_BOTTOM);
  const s = F;

  // 计算器机身（白）
  c.fillRoundRect(146 * s, 126 * s, 366 * s, 396 * s, 36 * s, WHITE);
  // 显示屏（浅珊瑚底）
  c.fillRoundRect(168 * s, 154 * s, 344 * s, 204 * s, 12 * s, CORAL_SOFT);
  // 屏上数字条（珊瑚，右对齐）
  c.fillRoundRect(250 * s, 170 * s, 328 * s, 188 * s, 9 * s, CORAL);
  // 按键阵 3×3（末位深色点缀）
  const cell = 44, gap = 12, x0 = 178;
  const rows = [224, 280, 336];
  for (let ry = 0; ry < 3; ry++) {
    for (let rx = 0; rx < 3; rx++) {
      const x = x0 + rx * (cell + gap);
      const y = rows[ry];
      const color = (ry === 2 && rx === 2) ? CORAL_DEEP : CORAL;
      c.fillRoundRect(x * s, y * s, (x + cell) * s, (y + cell) * s, 11 * s, color);
    }
  }
  return downsample(c, F);
}

// —— 封面 750×1000（3:4）：奶油底 + 珊瑚渐变圆角主卡（计算器）+ 三行账号卡 ——
// 渐变圆角卡实现：先铺矩形渐变，再用 SDF 判定把圆角外四角涂回背景色
function drawCover() {
  const F = 2;
  const c = new Raster(750 * F, 1000 * F);
  c.vGradient(CREAM, CREAM);
  const s = F;

  // 主卡区域渐变（矩形铺色）+ 擦掉圆角外四角
  const top = [214, 135, 103];
  const bottom = [192, 106, 78];
  const y0 = 80, y1 = 440, x0 = 75, x1 = 675, r = 40;
  for (let y = y0 * s; y < y1 * s; y++) {
    const t = (y - y0 * s) / ((y1 - y0) * s);
    const col = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t)
    ];
    for (let x = x0 * s; x < x1 * s; x++) c.set(x, y, col);
  }
  // 擦角：几何统一换算到超采样空间（循环坐标是 ×s 的），SDF 与 fillRoundRect 同式
  const ecx = ((x0 + x1) / 2) * s, ecy = ((y0 + y1) / 2) * s;
  const ehw = ((x1 - x0) / 2) * s, ehh = ((y1 - y0) / 2) * s, er = r * s;
  for (let y = y0 * s; y < y1 * s; y++) {
    for (let x = x0 * s; x < x1 * s; x++) {
      const dx = Math.abs(x + 0.5 - ecx) - (ehw - er);
      const dy = Math.abs(y + 0.5 - ecy) - (ehh - er);
      const mx = Math.max(dx, 0);
      const my = Math.max(dy, 0);
      const dist = Math.sqrt(mx * mx + my * my) + Math.min(Math.max(dx, dy), 0) - er;
      if (dist > 0) c.set(x, y, CREAM);
    }
  }

  // 计算器机身（白）
  c.fillRoundRect(175 * s, 125 * s, 575 * s, 395 * s, 32 * s, WHITE);
  // 显示屏
  c.fillRoundRect(200 * s, 150 * s, 550 * s, 205 * s, 12 * s, CORAL_SOFT);
  // 数字条
  c.fillRoundRect(350 * s, 167 * s, 520 * s, 187 * s, 10 * s, CORAL);
  // 按键 3×2
  const cell = 60, gap = 16, bx = 269;
  const btnRows = [230, 306];
  for (let ry = 0; ry < 2; ry++) {
    for (let rx = 0; rx < 3; rx++) {
      const x = bx + rx * (cell + gap);
      const y = btnRows[ry];
      const color = (ry === 1 && rx === 2) ? CORAL_DEEP : CORAL;
      c.fillRoundRect(x * s, y * s, (x + cell) * s, (y + cell) * s, 13 * s, color);
    }
  }

  // 三行账号卡：浅色描边底 + 白 + 圆点 + 信息条 + 金额胶囊
  const rowsY = [475, 545, 615];
  const rowH = 50;
  rowsY.forEach(function (ry, i) {
    // 描边（略大的浅色圆角矩形垫底）
    c.fillRoundRect(73 * s, (ry - 2) * s, 677 * s, (ry + rowH + 2) * s, 27 * s, BAR);
    c.fillRoundRect(75 * s, ry * s, 675 * s, (ry + rowH) * s, 25 * s, WHITE);
    // 账号圆点
    c.fillCircle(120 * s, (ry + rowH / 2) * s, 15 * s, CORAL);
    // 信息条
    const barW = i === 2 ? 240 : 280;
    c.fillRoundRect(155 * s, (ry + 19) * s, (155 + barW) * s, (ry + 31) * s, 6 * s, BAR);
    // 金额胶囊：前两行珊瑚（达标），末行琥珀（差额）
    const pillColor = i === 2 ? AMBER : CORAL;
    c.fillRoundRect(575 * s, (ry + 14) * s, 645 * s, (ry + 36) * s, 11 * s, pillColor);
  });

  // 底部装饰胶囊（暗示主按钮）
  c.fillRoundRect(280 * s, 720 * s, 470 * s, 760 * s, 20 * s, CORAL);

  return downsample(c, F);
}

// —— 主流程 ——
mkdirSync(BRAND, { recursive: true });

const icon = drawIcon();
writeFileSync(join(BRAND, 'icon.png'), pngEncode(icon.w, icon.h, icon.px));
console.log('brand/icon.png  ' + icon.w + 'x' + icon.h);

const cover = drawCover();
writeFileSync(join(BRAND, 'cover.png'), pngEncode(cover.w, cover.h, cover.px));
console.log('brand/cover.png  ' + cover.w + 'x' + cover.h + ' (3:4)');
