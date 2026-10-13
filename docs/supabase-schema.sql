-- ============================================================
-- 十一愿俱乐部 · Supabase 数据库一键初始化
-- 用法：Supabase 控制台 → SQL Editor → New query
--       → 粘贴本文件全部内容 → 点 Run
--       （可重复执行，不会报错）
-- ============================================================

-- 1. 数据表：单行存放全部数据（员工 + 订单）
create table if not exists club_state (
  id text primary key,
  staff jsonb not null default '[]'::jsonb,
  orders jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. 初始化唯一数据行
insert into club_state (id) values ('main') on conflict (id) do nothing;

-- 3. 行级安全策略：允许匿名读写（个人/小团体工具）
alter table club_state enable row level security;

drop policy if exists "public read" on club_state;
create policy "public read" on club_state
  for select using (true);

drop policy if exists "public write" on club_state;
create policy "public write" on club_state
  for all using (true) with check (true);

-- 4. 更新时自动刷新 updated_at（多设备同步的时间戳以服务端为准）
create or replace function touch_club_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists club_state_touch on club_state;
create trigger club_state_touch
  before update on club_state
  for each row execute function touch_club_updated_at();

-- 5. 开启实时订阅（Realtime）：一端写入，其他设备秒级收到
do $$
begin
  alter publication supabase_realtime add table club_state;
exception
  when others then null;
end $$;
