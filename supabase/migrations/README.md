# supabase/migrations — 增量迁移目录（v3.12.0 B5）

全量基线是仓库根目录的 `supabase-schema.sql`（保持可独立重复执行）；本目录只放**增量**变更。

## 纪律（2026-09-10 固化的流程，见 docs/STATUS.md「下一步目标」）

1. 改 schema 时：更新全量基线 **并** 在本目录新增 `NNN-描述.sql`（三位序号，文件名即版本号）。
2. 随提交立即应用线上，不再积压：
   - 全量重跑：`node scripts/sb.js -f supabase-schema.sql`
   - 增量应用：`node scripts/sb.js --migrate`（按文件名序执行 `schema_migrations` 表中未登记的脚本并登记）
3. 每个 RPC 变更的**每个执行分支**都要有线上探针（scripts/sb.js 可直查/直调）。
4. 高风险变更前先建快照表（先例：`team_data_bak_20260912` 等）。

当前目录暂无增量脚本——v3.12.0 及之前的全部结构已包含在全量基线中。
