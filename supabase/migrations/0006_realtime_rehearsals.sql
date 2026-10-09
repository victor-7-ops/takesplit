do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'rehearsals'
  ) then
    alter publication supabase_realtime add table rehearsals;
  end if;
end $$;
