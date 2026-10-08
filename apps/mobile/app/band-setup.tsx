import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { generateInviteCode } from "../lib/invite-code";

export default function BandSetup() {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [bandName, setBandName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Not signed in.");
      return;
    }

    const { data: band, error: bandError } = await supabase
      .from("bands")
      .insert({ name: bandName, invite_code: generateInviteCode(), created_by: userId })
      .select()
      .single();
    if (bandError || !band) {
      setError(bandError?.message ?? "Could not create band.");
      return;
    }

    const { error: memberError } = await supabase
      .from("band_members")
      .insert({ band_id: band.id, user_id: userId, display_name: displayName, role: "owner" });
    if (memberError) {
      setError(memberError.message);
      return;
    }

    router.replace("/");
  }

  async function handleJoin() {
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Not signed in.");
      return;
    }

    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("id")
      .eq("invite_code", inviteCode)
      .single();
    if (bandError || !band) {
      setError("Invite code not found.");
      return;
    }

    const { error: memberError } = await supabase
      .from("band_members")
      .insert({ band_id: band.id, user_id: userId, display_name: displayName, role: "member" });
    if (memberError) {
      setError(memberError.message);
      return;
    }

    router.replace("/");
  }

  return (
    <View style={styles.container}>
      <Text>Set up your band</Text>
      <View style={styles.row}>
        <Button title="Create" onPress={() => setMode("create")} />
        <Button title="Join" onPress={() => setMode("join")} />
      </View>
      <TextInput style={styles.input} placeholder="Your name" value={displayName} onChangeText={setDisplayName} />
      {mode === "create" ? (
        <TextInput style={styles.input} placeholder="Band name" value={bandName} onChangeText={setBandName} />
      ) : (
        <TextInput
          style={styles.input}
          placeholder="Invite code"
          autoCapitalize="characters"
          value={inviteCode}
          onChangeText={setInviteCode}
        />
      )}
      <Button
        title={mode === "create" ? "Create band" : "Join band"}
        onPress={mode === "create" ? handleCreate : handleJoin}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  row: { flexDirection: "row", gap: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, width: "100%" },
  error: { color: "red" },
});
