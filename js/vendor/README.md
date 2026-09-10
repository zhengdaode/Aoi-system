# js/vendor — 第三方组件库本地自托管（v3.9.3）

> 背景：这四个库此前经 `cdn.jsdelivr.net` 加载，而 jsDelivr 自 2022 年起在大陆被间歇性
> DNS 污染 / SNI 阻断（实测本机网络对该域名返回伪造证书），导致「导出图片没反应」、
> Excel 回退到无图片能力的 SheetJS 通道、甚至登录不可用。自托管后随站点（GitHub Pages /
> Netlify 双通道）同源加载，不再依赖任何第三方 CDN。

| 文件 | 包名@版本 | 来源 | 许可证 |
|------|-----------|------|--------|
| `supabase.js` | @supabase/supabase-js@2.116.0 | npm tarball `dist/umd/supabase.js` | MIT |
| `xlsx.full.min.js` | xlsx@0.18.5 | npm tarball `dist/xlsx.full.min.js` | Apache-2.0 |
| `exceljs.min.js` | exceljs@4.4.0 | npm tarball `dist/exceljs.min.js` | MIT |
| `html2canvas.min.js` | html2canvas@1.4.1 | npm tarball `dist/html2canvas.min.js` | MIT |

## 升级方法

```bash
cd /tmp && npm pack @supabase/supabase-js@2 xlsx@<ver> exceljs@<ver> html2canvas@<ver>
tar xzf *.tgz
cp package/dist/umd/supabase.js <repo>/js/vendor/
cp package/dist/xlsx.full.min.js <repo>/js/vendor/
cp package/dist/exceljs.min.js <repo>/js/vendor/
cp package/dist/html2canvas.min.js <repo>/js/vendor/
```

（不走 jsdelivr 下载，避免被污染的解析结果混入非官方文件。）

Tailwind 仍走 `cdn.tailwindcss.com`（Cloudflare 网络，大陆可达性尚可，且为运行时 JIT 无法简单自托管）。
