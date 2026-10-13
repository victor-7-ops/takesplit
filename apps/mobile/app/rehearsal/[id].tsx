import { useEffect, useState } from "react";
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { supabase } from "../../lib/supabase";
import { formatDuration } from "../../lib/format";

type Clip = {
  id: string;
  start_sec: number;
  end_sec: number;
  kind: string;
  rating: number | null;
  song_title: string | null;
};

export default function RehearsalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [clips, setClips] = useState<Clip[]>([]);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      return;
    }

    (async () => {
      const { data: rehearsal } = await supabase
        .from("rehearsals")
        .select("storage_path")
        .eq("id", id)
        .single();

      if (rehearsal) {
        const { data: signed } = await supabase.storage
          .from("rehearsals")
          .createSignedUrl(rehearsal.storage_path, 3600);
        setSignedUrl(signed?.signedUrl ?? null);
      }

      const { data: clipRows } = await supabase
        .from("clips")
        .select("id, start_sec, end_sec, kind, rating, songs(title)")
        .eq("rehearsal_id", id)
        .order("start_sec", { ascending: true });

      const normalized: Clip[] = (clipRows ?? []).map((row) => {
        const song = Array.isArray(row.songs) ? row.songs[0] : row.songs;
        return {
          id: row.id,
          start_sec: row.start_sec,
          end_sec: row.end_sec,
          kind: row.kind,
          rating: row.rating,
          song_title: song?.title ?? null,
        };
      });

      setClips(normalized);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Clips</Text>
      {clips.map((clip) => (
        <ClipRow key={clip.id} clip={clip} audioUrl={signedUrl} />
      ))}
    </ScrollView>
  );
}

function ClipRow({ clip, audioUrl }: { clip: Clip; audioUrl: string | null }) {
  const player = useAudioPlayer(audioUrl ?? undefined);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (status.playing && status.currentTime >= clip.end_sec) {
      player.pause();
    }
  }, [status.currentTime, status.playing, clip.end_sec, player]);

  async function handlePlay() {
    if (!audioUrl) {
      return;
    }
    await player.seekTo(clip.start_sec);
    player.play();
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text>
          {formatDuration(clip.start_sec)} - {formatDuration(clip.end_sec)} ({clip.kind})
        </Text>
        <Text style={styles.meta}>
          {clip.song_title ?? "No song"}
          {clip.rating ? ` - ${"*".repeat(clip.rating)}` : ""}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Button title="Play" onPress={handlePlay} disabled={!audioUrl} />
        <Button title="Tag" onPress={() => router.push(`/clip/${clip.id}`)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  rowInfo: { gap: 2 },
  meta: { color: "#666", fontSize: 12 },
  rowActions: { flexDirection: "row", gap: 8 },
});
