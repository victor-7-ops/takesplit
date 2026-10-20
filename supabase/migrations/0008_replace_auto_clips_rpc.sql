-- Closes the partial-read window logged 2026-10-08: jobs.run_process previously
-- deleted old auto_detected clips and inserted new ones as separate REST calls,
-- so a client reading `clips` directly during reprocessing (ignoring
-- `rehearsals.status`) could observe a partial list. Doing both in one
-- plpgsql function makes the delete+insert a single transaction.
--
-- p_segments is a JSON array of {id, start_sec, end_sec, kind}; the caller
-- generates each clip's id up front so it can build the confidence map
-- without needing anything echoed back from this function.

create or replace function replace_auto_clips(p_rehearsal_id uuid, p_segments jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from clips where rehearsal_id = p_rehearsal_id and auto_detected = true;

  insert into clips (id, rehearsal_id, start_sec, end_sec, kind, auto_detected)
  select
    (seg->>'id')::uuid,
    p_rehearsal_id,
    (seg->>'start_sec')::numeric,
    (seg->>'end_sec')::numeric,
    seg->>'kind',
    true
  from jsonb_array_elements(p_segments) as seg;
end;
$$;

grant execute on function replace_auto_clips(uuid, jsonb) to service_role;
