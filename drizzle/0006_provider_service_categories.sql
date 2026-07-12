alter table providers
add column if not exists service_categories text;

update providers p
set service_categories = c.name
from categories c
where p.category_id = c.id
  and (p.service_categories is null or btrim(p.service_categories) = '');
