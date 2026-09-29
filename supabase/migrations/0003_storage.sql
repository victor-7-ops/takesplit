insert into storage.buckets (id, name, public)
values ('rehearsals', 'rehearsals', false)
on conflict (id) do nothing;

create policy rehearsals_storage_select on storage.objects
  for select using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[2])::uuid)
  );

create policy rehearsals_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[2])::uuid)
  );

create policy rehearsals_storage_update on storage.objects
  for update using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[2])::uuid)
  );

create policy rehearsals_storage_delete on storage.objects
  for delete using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[2])::uuid)
  );
