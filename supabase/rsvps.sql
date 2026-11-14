-- Baby shower RSVPs: the table plus the function guests use to save a response.
--
-- Guests never touch the table directly. They call submit_rsvp, which runs as
-- the function owner, so names, emails and comments stay private. Only
-- signed-in users (the dashboard login) can read or delete rows.
--
-- One RSVP per email address (stored lowercased). RSVPing again with the same
-- email updates that row in place, so the alert webhook sees an UPDATE with
-- the old and new values.
--
-- Safe to run on a fresh project or on the earlier name-keyed table. On the
-- earlier table it DELETES rows without an email and keeps only the latest
-- row per email, since a required, unique email can't hold them.
--
-- Run in the Supabase SQL editor.

create table if not exists public.rsvps (
  id          bigint generated always as identity primary key,
  name        text        not null,
  response    text        not null check (response in ('attending', 'maybe', 'declined')),
  guest_count integer     not null check (guest_count between 1 and 20),
  comment     text,
  email       text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Upgrade the earlier name-keyed table ----------
alter table public.rsvps add column if not exists updated_at timestamptz not null default now();

delete from public.rsvps where email is null or btrim(email) = '';

update public.rsvps set email = lower(btrim(email)) where email <> lower(btrim(email));

delete from public.rsvps r
using public.rsvps newer
where newer.email = r.email
  and (newer.created_at, newer.id) > (r.created_at, r.id);

alter table public.rsvps alter column email set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rsvps_email_key') then
    alter table public.rsvps add constraint rsvps_email_key unique (email);
  end if;
end $$;

-- ---------- Access ----------
alter table public.rsvps enable row level security;

drop policy if exists "Signed-in users can read rsvps" on public.rsvps;
create policy "Signed-in users can read rsvps"
  on public.rsvps for select
  to authenticated
  using (true);

drop policy if exists "Signed-in users can delete rsvps" on public.rsvps;
create policy "Signed-in users can delete rsvps"
  on public.rsvps for delete
  to authenticated
  using (true);

-- ---------- Guest-facing function ----------
drop function if exists public.submit_rsvp(text, text, integer, text, text);

create function public.submit_rsvp(
  p_name text,
  p_response text,
  p_guest_count integer,
  p_comment text,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name    text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  clean_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  clean_email   text := lower(btrim(coalesce(p_email, '')));
begin
  if clean_name = '' or length(clean_name) > 60 then
    raise exception 'Name must be between 1 and 60 characters';
  end if;

  if p_response not in ('attending', 'maybe', 'declined') then
    raise exception 'Response must be attending, maybe or declined';
  end if;

  if p_guest_count is null or p_guest_count not between 1 and 20 then
    raise exception 'Total guests must be between 1 and 20';
  end if;

  if clean_comment is not null and length(clean_comment) > 500 then
    raise exception 'Comment must be 500 characters or fewer';
  end if;

  if length(clean_email) > 254 or clean_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email address is not valid';
  end if;

  insert into public.rsvps (name, response, guest_count, comment, email)
  values (clean_name, p_response, p_guest_count, clean_comment, clean_email)
  on conflict (email) do update
    set name        = excluded.name,
        response    = excluded.response,
        guest_count = excluded.guest_count,
        comment     = excluded.comment,
        updated_at  = now();
end;
$$;

revoke all on function public.submit_rsvp(text, text, integer, text, text) from public;
grant execute on function public.submit_rsvp(text, text, integer, text, text) to anon, authenticated;
