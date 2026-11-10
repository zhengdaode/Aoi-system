-- 003-c-schema-fixes.sql — 方案 C P3 修正（docs/PLAN-C-SCHEMA-SPLIT.md）
-- ① aoi_activities.created_at/updated_at 改 text：blob 里它们是前端写的 ISO 字符串
--    （活动「最近修改」排序按字符串比较），timestamptz 组装会改写格式导致 diff 永远抖动——
--    这两列必须原样保真，由 sync 直接存前端字符串（表当前为空，直接改型别）；
-- ② 全部「数组集合表」补 sort 列：blob 数组序 = 渲染序，组装须按 sort 还原；
-- ③ paigu_slots.type/model 补 not null default ''（slots 键 'type|model' 拆列后空段语义）；
-- ④ 子表 → 父表 FK ON DELETE CASCADE（products/buyers/trackings/paigu/limits → activities；
--    entries/settlements → reservoirs）：删活动自动级联子行，与前端三端同步语义一致。

alter table aoi_activities
  alter column created_at drop default,
  alter column created_at type text using created_at::text,
  alter column updated_at drop default,
  alter column updated_at type text using updated_at::text;

alter table aoi_products              add column if not exists sort int not null default 0;
alter table aoi_payments              add column if not exists sort int not null default 0;
alter table aoi_batches               add column if not exists sort int not null default 0;
alter table aoi_notifications         add column if not exists sort int not null default 0;
alter table aoi_announcements         add column if not exists sort int not null default 0;
alter table aoi_cn_changes            add column if not exists sort int not null default 0;
alter table aoi_pco_items             add column if not exists sort int not null default 0;
alter table aoi_reservoir_entries     add column if not exists sort int not null default 0;
alter table aoi_reservoir_settlements add column if not exists sort int not null default 0;

alter table aoi_paigu_slots
  alter column type  set default '',
  alter column model set default '',
  alter column type  set not null,
  alter column model set not null;
update aoi_paigu_slots set type = '' where type is null;
update aoi_paigu_slots set model = '' where model is null;
alter table aoi_paigu_slots alter column type drop not null; -- 保持 nullable 兼容历史空段（组装侧用 coalesce）

-- —— FK 级联（活动子表）——
alter table aoi_products drop constraint if exists aoi_products_activity_fk;
alter table aoi_products
  add constraint aoi_products_activity_fk
  foreign key (team_id, activity_name) references aoi_activities (team_id, name) on delete cascade;

alter table aoi_activity_buyers drop constraint if exists aoi_activity_buyers_activity_fk;
alter table aoi_activity_buyers
  add constraint aoi_activity_buyers_activity_fk
  foreign key (team_id, activity_name) references aoi_activities (team_id, name) on delete cascade;

alter table aoi_activity_trackings drop constraint if exists aoi_activity_trackings_activity_fk;
alter table aoi_activity_trackings
  add constraint aoi_activity_trackings_activity_fk
  foreign key (team_id, activity_name) references aoi_activities (team_id, name) on delete cascade;

alter table aoi_paigu_slots drop constraint if exists aoi_paigu_slots_activity_fk;
alter table aoi_paigu_slots
  add constraint aoi_paigu_slots_activity_fk
  foreign key (team_id, activity_name) references aoi_activities (team_id, name) on delete cascade;

alter table aoi_paigu_logs drop constraint if exists aoi_paigu_logs_activity_fk;
alter table aoi_paigu_logs
  add constraint aoi_paigu_logs_activity_fk
  foreign key (team_id, activity_name) references aoi_activities (team_id, name) on delete cascade;

alter table aoi_limit_plans drop constraint if exists aoi_limit_plans_activity_fk;
alter table aoi_limit_plans
  add constraint aoi_limit_plans_activity_fk
  foreign key (team_id, activity_name) references aoi_activities (team_id, name) on delete cascade;

-- —— FK 级联（蓄水池子表）——
alter table aoi_reservoir_entries drop constraint if exists aoi_res_entries_res_fk;
alter table aoi_reservoir_entries
  add constraint aoi_res_entries_res_fk
  foreign key (team_id, reservoir_id) references aoi_reservoirs (team_id, id) on delete cascade;

alter table aoi_reservoir_settlements drop constraint if exists aoi_res_settle_res_fk;
alter table aoi_reservoir_settlements
  add constraint aoi_res_settle_res_fk
  foreign key (team_id, reservoir_id) references aoi_reservoirs (team_id, id) on delete cascade;

-- —— 按真实前端结构修正（P3 摸底）——
-- entries/settlements 的 id 是前端 genId() 短 id（settlements.entryIds 引用 entries.id），
-- 必须保真为 text；settlements 行真实字段 = {id, direction, currency, amount, date, note, entryIds}
alter table aoi_reservoir_entries drop column id;
alter table aoi_reservoir_entries add column id text not null primary key;
alter table aoi_reservoir_settlements drop column id;
alter table aoi_reservoir_settlements add column id text not null primary key;
alter table aoi_reservoir_settlements drop column if exists marked_order_ids;
alter table aoi_reservoir_settlements add column if not exists entry_ids jsonb;
alter table aoi_reservoir_settlements add column if not exists date text;

-- —— P3 补充：蓄水池池序 + trackings 序（RPC 组装按数组序还原）——
alter table aoi_reservoirs add column if not exists sort int not null default 0;
