import { supabase } from "./supabase";

export async function assignSongToClip(
  clipId: string,
  rehearsalId: string,
  songId: string
): Promise<number> {
  const { data: siblings } = await supabase
    .from("clips")
    .select("id")
    .eq("rehearsal_id", rehearsalId)
    .eq("song_id", songId)
    .neq("id", clipId);

  const takeNumber = (siblings?.length ?? 0) + 1;

  await supabase.from("clips").update({ song_id: songId, take_number: takeNumber }).eq("id", clipId);

  return takeNumber;
}
