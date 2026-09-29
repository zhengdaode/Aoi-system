// F12 演示单文件版打包：把 demo/shop-demo/ 的 CSS/JS 内联进一个 HTML，
// 产出 demo/谷谷商城-F12演示-单文件版.html——单文件即可在任意设备浏览器打开（QQ/微信直接发送）。
// 用法：node scripts/build-shop-demo.mjs（demo 改动后重新执行）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'demo', 'shop-demo');

const html = readFileSync(join(dir, 'index.html'), 'utf8');
const css = readFileSync(join(dir, 'css', 'shop.css'), 'utf8');
const js = readFileSync(join(dir, 'js', 'app.js'), 'utf8');

if (js.includes('</script>')) throw new Error('app.js 含 </script>，直接内联不安全');

// 注意：replacement 必须用函数形式——字符串形式里 JS 源码的 '$' 会被当作
// 特殊替换模式（如 $' = 匹配点之后的内容）展开，直接撑爆内联脚本。
let out = html
  .replace('<link rel="stylesheet" href="css/shop.css">', function () { return '<style>\n' + css + '\n</style>'; })
  .replace('<script src="js/app.js"></script>', function () { return '<script>\n' + js + '\n</script>'; });

if (out.includes('css/shop.css') || out.includes('js/app.js')) {
  throw new Error('内联替换未完全命中：index.html 中的资源引用标记已变，请同步修改本脚本');
}

out = out.replace('谷谷商城 · C 端购物演示（F12）', '谷谷商城 · C 端购物演示（F12 · 单文件版）');

const dest = join(root, 'demo', '谷谷商城-F12演示-单文件版.html');
writeFileSync(dest, out);
console.log('OK 已生成 ' + dest);
