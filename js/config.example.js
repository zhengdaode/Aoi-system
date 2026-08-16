// Aoi-system — 全局命名空间与 Supabase 配置（模板）
// 使用：复制本文件为 js/config.js，再填入你自己的 Supabase 项目信息。
// ⚠️ 只能填 anon key（公开密钥）。禁止填 service_role（服务角色密钥会泄露全库权限）。
window.Aoi = window.Aoi || {};

Aoi.config = {
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key'
};

Aoi.db = window.supabase.createClient(Aoi.config.SUPABASE_URL, Aoi.config.SUPABASE_ANON_KEY);
