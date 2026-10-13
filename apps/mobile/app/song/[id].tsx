import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { formatDuration } from "../../lib/format";

type TakeRow = {
  id: string;
  take_number: number | null;
  rating: number | null;
  start_sec: number;
  end_sec: number;
  rehearsal_id: string;
  recorded_on: string;
};

export default function SongView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState("");
  const [takes, setTakes] = useState<TakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      return;
    }

    (async () => {
      const { data: song } = await supabase.from("songs").select("title").eq("id", id).single();
      setTitle(song?.title ?? "");

      const { data: clipRows } = await supabase
        .from("clips")
        .select("id, take_number, rating, start_sec, end_sec, rehearsal_id, rehearsals(recorded_on)")
        .eq("song_id", id);

      const normalized: TakeRow[] = (clipRows ?? []).map((row) => {
        const rehearsal = Array.isArray(row.rehearsals) ? row.rehearsals[0] : row.rehearsals;
        return {
          id: row.id,
          take_number: row.take_number,
          rating: row.rating,
          start_sec: row.start_sec,
          end_sec: row.end_sec,
          rehearsal_id: row.rehearsal_id,
          recorded_on: rehearsal?.recorded_on ?? "",
        };
      });
      normalized.sort((a, b) => b.recorded_on.localeCompare(a.recorded_on));

      setTakes(normalized);
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
      <Text style={styles.heading}>{title}</Text>
      {takes.map((take) => (
        <View key={take.id} style={styles.row}>
          <Text>{take.recorded_on}</Text>
          <Text>Take {take.take_number ?? "-"}</Text>
          <Text>
            {formatDuration(take.start_sec)} - {formatDuration(take.end_sec)}
          </Text>
          <Text>{take.rating ? "*".repeat(take.rating) : "unrated"}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee" },
});
