import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSession } from "../lib/session-context";

export default function Index() {
  const { session, bandId, loading } = useSession();

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
      <Text>TakeSplit</Text>
      <Text>Signed in. Band ID: {bandId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
});
