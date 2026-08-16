// 部署时从环境变量生成 js/config.js（密钥不进仓库）。
// 供 Netlify 构建命令调用：node scripts/build-config.js
const fs = require('fs');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('缺少 SUPABASE_URL / SUPABASE_ANON_KEY 环境变量');
  process.exit(1);
}
fs.writeFileSync(
  'js/config.js',
  'window.Aoi = window.Aoi || {};\n' +
    'Aoi.config = {\n' +
    `  SUPABASE_URL: '${url}',\n` +
    `  SUPABASE_ANON_KEY: '${key}'\n` +
    '};\n' +
    'Aoi.db = window.supabase.createClient(Aoi.config.SUPABASE_URL, Aoi.config.SUPABASE_ANON_KEY);\n'
);
console.log('已生成 js/config.js');
