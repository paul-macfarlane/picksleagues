export function generateUsername(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const cleaned = localPart.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = Math.floor(1000 + Math.random() * 9000).toString();

  const maxBaseLength = 50 - suffix.length;
  const base = cleaned.slice(0, maxBaseLength);

  if (base.length === 0) {
    return `user${suffix}`;
  }

  return `${base}${suffix}`;
}
