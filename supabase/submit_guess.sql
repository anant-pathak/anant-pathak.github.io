-- Saves a guest's guess. One guess per person: if the same name has guessed
-- before (matched case- and whitespace-insensitively), their old guess is
-- replaced by the new one.
--
-- Runs as the function owner so guests can save without direct access to the
-- guesses table.
--
-- Run once in the Supabase SQL editor. It replaces the existing submit_guess.

drop function if exists public.submit_guess(text, text);

create function public.submit_guess(p_name text, p_guess text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if clean_name = '' or length(clean_name) > 40 then
    raise exception 'Name must be between 1 and 40 characters';
  end if;

  if p_guess not in ('boy', 'girl') then
    raise exception 'Guess must be boy or girl';
  end if;

  -- Serialize submissions for the same name so two taps can't both insert.
  perform pg_advisory_xact_lock(hashtext(lower(clean_name)));

  -- Remove this person's earlier guess(es), then save the new one.
  delete from public.guesses
  where lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = lower(clean_name);

  insert into public.guesses (name, guess)
  values (clean_name, p_guess);
end;
$$;

revoke all on function public.submit_guess(text, text) from public;
grant execute on function public.submit_guess(text, text) to anon, authenticated;
