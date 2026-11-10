-- 006-c-nullable-boolean-flags.sql — 方案 C P3：可选布尔字段放开 NOT NULL
-- 形状纪律「false ≡ 缺省」：组装剥 falsy 布尔、迁移存 null——表列不得强非空。
alter table aoi_products      alter column listed    drop not null;
alter table aoi_notifications alter column sent      drop not null;
alter table aoi_pco_items     alter column selected  drop not null;
alter table aoi_pco_items     alter column watched   drop not null;
alter table aoi_pco_items     alter column unmatched drop not null;
alter table aoi_orders        alter column ai_aligned drop not null;
