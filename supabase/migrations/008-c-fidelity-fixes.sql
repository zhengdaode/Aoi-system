-- 008-c-fidelity-fixes.sql — 方案 C P3 对拍发现的保真修正（真实数据怪味字段原样保真）
-- ① aoi_orders.ai_aligned：blob 里是字符串（某次写入存了商品名），非布尔——改 jsonb 原样保真
alter table aoi_orders alter column ai_aligned drop default;
alter table aoi_orders alter column ai_aligned type jsonb using to_jsonb(ai_aligned);
-- ② aoi_pco_items.unmatched：blob 里是字符串数组（未匹配候选词），非布尔——改 jsonb
alter table aoi_pco_items alter column unmatched drop default;
alter table aoi_pco_items alter column unmatched type jsonb using to_jsonb(unmatched);
