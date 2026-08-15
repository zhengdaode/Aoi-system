// Aoi-system — 全局命名空间与 Supabase 配置
// 部署前填入你自己的 Supabase 项目信息（沿用当前项目）
window.Aoi = window.Aoi || {};

Aoi.config = {
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_KEY: 'your-anon-key'
};

Aoi.db = window.supabase.createClient(Aoi.config.SUPABASE_URL, Aoi.config.SUPABASE_KEY);
