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

export async function splitClipAtTime(
  clipId: string,
  rehearsalId: string,
  splitAtSec: number
): Promise<void> {
  const { data: clip } = await supabase.from("clips").select("*").eq("id", clipId).single();
  if (!clip || splitAtSec <= clip.start_sec || splitAtSec >= clip.end_sec) {
    return;
  }

  const originalEnd = clip.end_sec;

  await supabase
    .from("clips")
    .update({ end_sec: splitAtSec, auto_detected: false })
    .eq("id", clipId);

  await supabase.from("clips").insert({
    rehearsal_id: rehearsalId,
    start_sec: splitAtSec,
    end_sec: originalEnd,
    kind: clip.kind,
    song_id: clip.song_id,
    auto_detected: false,
  });
}

export async function mergeClipWithNext(
  clipId: string,
  nextClipId: string,
  nextEndSec: number
): Promise<void> {
  await supabase
    .from("clips")
    .update({ end_sec: nextEndSec, auto_detected: false })
    .eq("id", clipId);
  await supabase.from("clips").delete().eq("id", nextClipId);
}

export async function deleteClip(clipId: string): Promise<void> {
  await supabase.from("clips").delete().eq("id", clipId);
}

export async function updateClipBounds(
  clipId: string,
  startSec: number,
  endSec: number
): Promise<void> {
  await supabase
    .from("clips")
    .update({ start_sec: startSec, end_sec: endSec, auto_detected: false })
    .eq("id", clipId);
}
