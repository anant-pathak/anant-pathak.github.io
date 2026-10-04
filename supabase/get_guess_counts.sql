-- Returns boy/girl totals for the guest page's "you're with X% of guests" card.
-- Runs as the function owner so guests can see the counts without being able
-- to read the guesses table (names stay private).
--
-- Counts one guess per person (latest wins, names matched case- and
-- whitespace-insensitively), matching the dashboard's "Unique only" filter.
--
-- Run once in the Supabase SQL editor.

create or replace function public.get_guess_counts()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')))
      guess
    from public.guesses
    order by lower(regexp_replace(btrim(name), '\s+', ' ', 'g')), created_at desc
  )
  select json_build_object(
    'boy',  count(*) filter (where guess = 'boy'),
    'girl', count(*) filter (where guess = 'girl')
  )
  from latest;
$$;

revoke all on function public.get_guess_counts() from public;
grant execute on function public.get_guess_counts() to anon, authenticated;
