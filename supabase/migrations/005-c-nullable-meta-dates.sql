-- 005-c-nullable-meta-dates.sql — 方案 C P3：活动 createdAt/updatedAt 为前端可选字段
-- （旧 blob 多数活动没有这两个键），改 text 后需放开 NOT NULL（P2 空表时未暴露）。
alter table aoi_activities alter column created_at drop not null;
alter table aoi_activities alter column updated_at drop not null;
