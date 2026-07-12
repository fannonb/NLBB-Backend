alter table notifications
add column if not exists action_type varchar(64);

alter table notifications
add column if not exists action_id varchar(255);
