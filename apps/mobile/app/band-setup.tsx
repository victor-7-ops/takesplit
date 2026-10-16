import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session-context";

export default function BandSetup() {
  const { refreshBandId } = useSession();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [bandName, setBandName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const { data: newBandId, error: createError } = await supabase.rpc("create_band", {
      p_name: bandName,
      p_display_name: displayName,
    });
    if (createError || !newBandId) {
      setError(createError?.message ?? "Could not create band.");
      return;
    }

    await refreshBandId();
    router.replace("/");
  }

  async function handleJoin() {
    setError(null);
    const { error: joinError } = await supabase.rpc("join_band", {
      p_invite_code: inviteCode,
      p_display_name: displayName,
    });
    if (joinError) {
      setError(joinError.message);
      return;
    }

    await refreshBandId();
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
