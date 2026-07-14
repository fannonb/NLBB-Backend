alter table categories
add column if not exists icon varchar(64) not null default 'star-four-points-outline';

update categories
set icon = case slug
  when 'barber' then 'mustache'
  when 'hair' then 'scissors-cutting'
  when 'nails' then 'hand-back-right-outline'
  when 'massage' then 'hand-heart'
  when 'facial' then 'face-woman-shimmer'
  when 'tattoo' then 'brush'
  when 'salon' then 'hair-dryer'
  when 'spa' then 'spa'
  when 'makeup' then 'lipstick'
  when 'waxing' then 'flower-outline'
  when 'lashes' then 'eye-outline'
  when 'piercing' then 'needle'
  else coalesce(nullif(icon, ''), 'star-four-points-outline')
end;
