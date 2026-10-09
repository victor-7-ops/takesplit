import { useEffect, useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { supabase } from "../../lib/supabase";
import { formatDuration } from "../../lib/format";

type Clip = {
  id: string;
  start_sec: number;
  end_sec: number;
  kind: string;
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
        .select("id, start_sec, end_sec, kind")
        .eq("rehearsal_id", id)
        .order("start_sec", { ascending: true });
      setClips(clipRows ?? []);
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
    <View style={styles.container}>
      <Text style={styles.heading}>Clips</Text>
      {clips.map((clip) => (
        <ClipRow key={clip.id} clip={clip} audioUrl={signedUrl} />
      ))}
    </View>
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
      <Text>
        {formatDuration(clip.start_sec)} - {formatDuration(clip.end_sec)} ({clip.kind})
      </Text>
      <Button title="Play" onPress={handlePlay} disabled={!audioUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
});
