-- 007-c-paigu-meta.sql — 方案 C P3 摸底补遗：paigu[act].updatedAt 是前端审计字段
-- （排谷表每次操作写 ISO 时间戳，只写不读），需要原样保真。
create table if not exists aoi_paigu_meta (
  team_id     uuid not null references teams(id),
  activity_name text not null,
  updated_at  text,
  primary key (team_id, activity_name)
);
alter table aoi_paigu_meta drop constraint if exists aoi_paigu_meta_activity_fk;
alter table aoi_paigu_meta
  add constraint aoi_paigu_meta_activity_fk
  foreign key (team_id, activity_name) references aoi_activities (team_id, name) on delete cascade;
