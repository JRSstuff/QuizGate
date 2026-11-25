export async function clientSha256(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return "";
}

export async function verifyOptionClientSide(
  questionId: string,
  optionId: string,
  salt: string,
  expectedHash: string
): Promise<boolean> {
  const computed = await clientSha256(`${questionId}:${optionId}:${salt}`);
  return computed === expectedHash;
}
