import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Link, Redirect, router } from "expo-router";
import { useSession } from "../lib/session-context";
import { supabase } from "../lib/supabase";
import { formatDuration } from "../lib/format";

type Rehearsal = {
  id: string;
  title: string | null;
  recorded_on: string;
  duration_sec: number | null;
  status: string;
};

export default function Index() {
  const { session, bandId, loading } = useSession();
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const fetchRehearsals = useCallback(async () => {
    if (!bandId) {
      return;
    }
    const { data } = await supabase
      .from("rehearsals")
      .select("id, title, recorded_on, duration_sec, status")
      .eq("band_id", bandId)
      .order("created_at", { ascending: false });
    setRehearsals(data ?? []);
    setListLoading(false);
  }, [bandId]);

  useEffect(() => {
    if (!bandId) {
      return;
    }

    fetchRehearsals();

    const channel = supabase
      .channel(`rehearsals-${bandId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rehearsals", filter: `band_id=eq.${bandId}` },
        () => fetchRehearsals()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bandId, fetchRehearsals]);

  useEffect(() => {
    if (!bandId) {
      return;
    }
    supabase
      .from("bands")
      .select("invite_code")
      .eq("id", bandId)
      .single()
      .then(({ data }) => {
        setInviteCode(data?.invite_code ?? null);
      });
  }, [bandId]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  if (!bandId) {
    return <Redirect href="/band-setup" />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Rehearsals</Text>
        <Link href="/upload" style={styles.link}>
          Upload
        </Link>
      </View>
      {inviteCode ? <Text style={styles.inviteCode}>Invite code: {inviteCode}</Text> : null}
      {listLoading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={rehearsals}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/rehearsal/${item.id}`)}>
              <Text>{item.title ?? "Untitled"}</Text>
              <Text>{item.recorded_on}</Text>
              <Text>{formatDuration(item.duration_sec)}</Text>
              <Text>{item.status}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: 20, fontWeight: "600" },
  link: { color: "#2563eb" },
  inviteCode: { color: "#666", fontSize: 12 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 2 },
});
