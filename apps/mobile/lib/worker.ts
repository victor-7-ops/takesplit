export async function triggerProcess(rehearsalId: string): Promise<void> {
  const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL;
  const workerKey = process.env.EXPO_PUBLIC_WORKER_KEY;
  if (!workerUrl || !workerKey) {
    throw new Error("Missing EXPO_PUBLIC_WORKER_URL or EXPO_PUBLIC_WORKER_KEY");
  }

  const response = await fetch(`${workerUrl}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Worker-Key": workerKey },
    body: JSON.stringify({ rehearsal_id: rehearsalId }),
  });

  if (!response.ok) {
    throw new Error(`Worker /process failed with status ${response.status}`);
  }
}
