export function generateInviteCode(): string {
  return crypto.randomUUID().slice(0, 8).toUpperCase();
}
