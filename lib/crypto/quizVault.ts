/**
 * Cryptographic vault for QuizGate offline PWA packs, result QR codes, and answer verification.
 * Uses Web Crypto API (AES-256-GCM + PBKDF2 + SHA-256) so encryption & decryption run identically
 * in browser Service Worker/PWA offline mode and on Vercel Node.js serverless functions.
 * Keys are read from environment variables (.env / Vercel Environment Variables).
 */

function getVaultKeyBase(): string {
  return (
    process.env.NEXT_PUBLIC_QUIZGATE_VAULT_KEY ||
    process.env.QUIZGATE_VAULT_KEY ||
    "quizgate-local-vault-namespace"
  );
}

function getQrSigningKeyBase(): string {
  return (
    process.env.NEXT_PUBLIC_QUIZGATE_QR_KEY ||
    process.env.QUIZGATE_QR_KEY ||
    "quizgate-local-qr-namespace"
  );
}

export interface VaultQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  points: number;
  topicCode?: string;
  explanation?: string;
  feedbackSalt: string;
  correctHash: string;
}

export interface QuizPackPlainPayload {
  id: string;
  title: string;
  subject: string;
  description: string;
  durationMinutes: number;
  instantFeedback: boolean;
  allowRetry: boolean;
  createdBy: string;
  createdAt: string;
  questions: VaultQuestion[];
}

export interface EncryptedQuizPack {
  v: 2;
  kind: "QGATE_PACK";
  id: string;
  title: string;
  subject: string;
  description: string;
  durationMinutes: number;
  instantFeedback: boolean;
  allowRetry: boolean;
  questionCount: number;
  lockedWithPasscode: boolean;
  createdBy: string;
  createdAt: string;
  salt: string;
  iv: string;
  ciphertext: string;
  sig: string;
}

export interface StudentSubmissionAnswer {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  answeredAt: string;
  lateSync: boolean;
}

export interface OfflineResultPlainPayload {
  id: string;
  packId: string;
  packTitle: string;
  studentId: string;
  studentName: string;
  studentNo: string;
  classCode?: string;
  score: number;
  maxScore: number;
  lateCount: number;
  submittedAt: string;
  answers: StudentSubmissionAnswer[];
}

export interface EncryptedResultPacket {
  v: 2;
  kind: "QGATE_RESULT";
  id: string;
  packId: string;
  packTitle: string;
  studentName: string;
  studentNo: string;
  score: number;
  maxScore: number;
  lateCount: number;
  submittedAt: string;
  salt: string;
  iv: string;
  ciphertext: string;
  sig: string;
}

export interface VerifiedResultQr {
  valid: boolean;
  format: "offline_qr" | "supabase_qr" | "unknown";
  reason?: string;
  packOrAttemptId?: string;
  studentNo?: string;
  studentName?: string;
  score?: number;
  maxScore?: number;
  lateCount?: number;
  epoch?: number;
  recordedAt?: string;
  signature?: string;
  verifiedVia?: "serverless" | "offline" | "supabase";
}

function getWebCrypto(): Crypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto API is unavailable in this environment.");
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === "function") return btoa(bin);
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function encodeUtf8Base64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeUtf8Base64Url(b64url: string): string {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const bytes = fromBase64(padded);
  return new TextDecoder().decode(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const cryptoApi = getWebCrypto();
  const data = new TextEncoder().encode(input);
  const digest = await cryptoApi.subtle.digest("SHA-256", toArrayBuffer(data));
  return toHex(new Uint8Array(digest));
}

/** Fast synchronous salted 32-bit FNV-1a hash for offline answer checking & numeric problems */
export function syncSaltedHash(value: string | number, salt = "G10_Q2_2026"): string {
  let h = 2166136261;
  const s = `${salt}:${String(value)}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const cryptoApi = getWebCrypto();
  const keyMaterial = await cryptoApi.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(`${getVaultKeyBase()}:${passphrase}`)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return cryptoApi.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: 60000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptQuizPack(
  payload: QuizPackPlainPayload,
  passcode?: string
): Promise<EncryptedQuizPack> {
  const cryptoApi = getWebCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const cleanPass = (passcode || "").trim();
  const aesKey = await deriveAesKey(cleanPass || "pack", salt);

  const jsonPlain = JSON.stringify(payload);
  let plaintextBytes: Uint8Array = new TextEncoder().encode(jsonPlain);
  if (typeof CompressionStream !== "undefined") {
    try {
      const stream = new Blob([toArrayBuffer(plaintextBytes)])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));
      const compBytes = new Uint8Array(await new Response(stream).arrayBuffer());
      if (compBytes.byteLength + 4 < plaintextBytes.byteLength) {
        const tagged = new Uint8Array(4 + compBytes.byteLength);
        tagged.set([0x44, 0x5a, 0x31, 0x3a], 0); // "DZ1:"
        tagged.set(compBytes, 4);
        plaintextBytes = tagged;
      }
    } catch {
      // Keep uncompressed UTF-8 JSON if compression is unsupported
    }
  }
  const encryptedBuf = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(plaintextBytes)
  );
  const ciphertext = toBase64(new Uint8Array(encryptedBuf));
  const saltHex = toHex(salt);
  const ivHex = toHex(iv);
  const sig = (await sha256Hex(`${payload.id}:${saltHex}:${ivHex}:${ciphertext}:${getQrSigningKeyBase()}`)).slice(0, 16);

  return {
    v: 2,
    kind: "QGATE_PACK",
    id: payload.id,
    title: payload.title,
    subject: payload.subject,
    description: payload.description,
    durationMinutes: payload.durationMinutes,
    instantFeedback: payload.instantFeedback,
    allowRetry: payload.allowRetry,
    questionCount: payload.questions.length,
    lockedWithPasscode: Boolean(cleanPass),
    createdBy: payload.createdBy,
    createdAt: payload.createdAt,
    salt: saltHex,
    iv: ivHex,
    ciphertext,
    sig,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function decryptQuizPack(
  pack: EncryptedQuizPack,
  passcode?: string
): Promise<QuizPackPlainPayload> {
  if (!pack || pack.kind !== "QGATE_PACK" || !pack.ciphertext) {
    throw new Error("Invalid QuizGate encrypted pack format.");
  }

  const expectedSig = (
    await sha256Hex(`${pack.id}:${pack.salt}:${pack.iv}:${pack.ciphertext}:${getQrSigningKeyBase()}`)
  ).slice(0, 16);
  if (expectedSig !== pack.sig) {
    throw new Error("Pack integrity check failed. File may be corrupted or modified.");
  }

  const cryptoApi = getWebCrypto();
  const cleanPass = (passcode || "").trim();
  const aesKey = await deriveAesKey(cleanPass || "pack", hexToBytes(pack.salt));

  try {
    const decryptedBuf = await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(hexToBytes(pack.iv)) },
      aesKey,
      toArrayBuffer(fromBase64(pack.ciphertext))
    );
    const decBytes = new Uint8Array(decryptedBuf);
    if (
      decBytes.byteLength >= 4 &&
      decBytes[0] === 0x44 &&
      decBytes[1] === 0x5a &&
      decBytes[2] === 0x31 &&
      decBytes[3] === 0x3a
    ) {
      if (typeof DecompressionStream === "undefined") {
        throw new Error("Compressed quiz pack requires a modern browser.");
      }
      const rawDeflated = decBytes.slice(4);
      const stream = new Blob([toArrayBuffer(rawDeflated)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      const json = await new Response(stream).text();
      return JSON.parse(json) as QuizPackPlainPayload;
    }
    const json = new TextDecoder().decode(decBytes);
    return JSON.parse(json) as QuizPackPlainPayload;
  } catch {
    throw new Error(
      pack.lockedWithPasscode
        ? "Incorrect quiz passcode or corrupted encrypted quiz file."
        : "Failed to decrypt quiz pack."
    );
  }
}

export async function encryptResultPacket(
  payload: OfflineResultPlainPayload
): Promise<EncryptedResultPacket> {
  const cryptoApi = getWebCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey("result", salt);

  const encryptedBuf = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(new TextEncoder().encode(JSON.stringify(payload)))
  );
  const ciphertext = toBase64(new Uint8Array(encryptedBuf));
  const saltHex = toHex(salt);
  const ivHex = toHex(iv);
  const sig = (
    await sha256Hex(
      `${payload.id}:${payload.packId}:${payload.studentNo}:${payload.score}:${saltHex}:${ivHex}:${ciphertext}:${getQrSigningKeyBase()}`
    )
  ).slice(0, 16);

  return {
    v: 2,
    kind: "QGATE_RESULT",
    id: payload.id,
    packId: payload.packId,
    packTitle: payload.packTitle,
    studentName: payload.studentName,
    studentNo: payload.studentNo,
    score: payload.score,
    maxScore: payload.maxScore,
    lateCount: payload.lateCount,
    submittedAt: payload.submittedAt,
    salt: saltHex,
    iv: ivHex,
    ciphertext,
    sig,
  };
}

export async function decryptResultPacket(
  packet: EncryptedResultPacket
): Promise<OfflineResultPlainPayload> {
  if (!packet || packet.kind !== "QGATE_RESULT" || !packet.ciphertext) {
    throw new Error("Invalid encrypted submission file.");
  }

  const expectedSig = (
    await sha256Hex(
      `${packet.id}:${packet.packId}:${packet.studentNo}:${packet.score}:${packet.salt}:${packet.iv}:${packet.ciphertext}:${getQrSigningKeyBase()}`
    )
  ).slice(0, 16);
  if (expectedSig !== packet.sig) {
    throw new Error("Submission signature check failed. Result file was modified.");
  }

  const cryptoApi = getWebCrypto();
  const aesKey = await deriveAesKey("result", hexToBytes(packet.salt));
  const decryptedBuf = await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(hexToBytes(packet.iv)) },
    aesKey,
    toArrayBuffer(fromBase64(packet.ciphertext))
  );
  return JSON.parse(new TextDecoder().decode(new Uint8Array(decryptedBuf))) as OfflineResultPlainPayload;
}

/** Build an offline/standalone signed Result QR string: QG1O.<packId>.<studentNo>.<nameB64>.<score>.<max>.<lateCount>.<epoch>.<sig> */
export async function buildOfflineResultQr(params: {
  packId: string;
  studentNo: string;
  studentName: string;
  score: number;
  maxScore: number;
  lateCount?: number;
  epochSec?: number;
}): Promise<string> {
  const cleanPack = params.packId.replace(/\./g, "_").slice(0, 24);
  const cleanNo = params.studentNo.replace(/\./g, "_").trim().slice(0, 20) || "UNREG";
  const nameB64 = encodeUtf8Base64Url(params.studentName.trim().slice(0, 40) || "Student");
  const late = params.lateCount ?? 0;
  const epoch = params.epochSec ?? Math.floor(Date.now() / 1000);
  const body = `QG1O.${cleanPack}.${cleanNo}.${nameB64}.${params.score}.${params.maxScore}.${late}.${epoch}`;
  const sig = (await sha256Hex(`${body}:${getQrSigningKeyBase()}`)).slice(0, 12).toUpperCase();
  return `${body}.${sig}`;
}

export async function verifyOfflineOrFormatQr(qrCode: string): Promise<VerifiedResultQr> {
  const code = qrCode.trim();
  if (!code) {
    return { valid: false, format: "unknown", reason: "Empty QR payload." };
  }

  if (code.startsWith("QG1O.")) {
    const parts = code.split(".");
    if (parts.length !== 9) {
      return { valid: false, format: "offline_qr", reason: "Malformed QG1O result QR segments." };
    }
    const body = parts.slice(0, 8).join(".");
    const providedSig = parts[8].toUpperCase();
    const expectedSig = (await sha256Hex(`${body}:${getQrSigningKeyBase()}`)).slice(0, 12).toUpperCase();

    if (providedSig !== expectedSig) {
      return {
        valid: false,
        format: "offline_qr",
        reason: "Signature mismatch: this QR code was forged or altered.",
        signature: providedSig,
      };
    }

    let studentName = "Student";
    try {
      studentName = decodeUtf8Base64Url(parts[3]);
    } catch {
      studentName = parts[3];
    }

    const epoch = Number.parseInt(parts[7], 10);
    return {
      valid: true,
      format: "offline_qr",
      packOrAttemptId: parts[1],
      studentNo: parts[2],
      studentName,
      score: Number.parseInt(parts[4], 10),
      maxScore: Number.parseInt(parts[5], 10),
      lateCount: Number.parseInt(parts[6], 10),
      epoch,
      recordedAt: Number.isNaN(epoch) ? undefined : new Date(epoch * 1000).toISOString(),
      signature: providedSig,
    };
  }

  if (code.startsWith("QG1R.")) {
    const parts = code.split(".");
    if (parts.length !== 6) {
      return { valid: false, format: "supabase_qr", reason: "Malformed QG1R result QR segments." };
    }
    const epoch = Number.parseInt(parts[4], 10);
    return {
      valid: false,
      format: "supabase_qr",
      packOrAttemptId: parts[1],
      score: Number.parseInt(parts[2], 10),
      maxScore: Number.parseInt(parts[3], 10),
      epoch,
      recordedAt: Number.isNaN(epoch) ? undefined : new Date(epoch * 1000).toISOString(),
      signature: parts[5],
      reason: "Supabase-signed QR (QG1R) requires online verification against your teacher Supabase account.",
    };
  }

  return {
    valid: false,
    format: "unknown",
    reason: "Unrecognized QR format. Expected QuizGate result code (QG1O.* or QG1R.*).",
  };
}

/** Generate student identity QR string for offline self-registration cards */
export async function buildOfflineStudentIdQr(
  studentId: string,
  studentNo: string,
  name: string,
  classCode: string
): Promise<string> {
  const nameB64 = encodeUtf8Base64Url(name.trim().slice(0, 40));
  const cleanNo = studentNo.replace(/\./g, "_").trim().slice(0, 24);
  const cleanClass = (classCode || "SELF").replace(/\./g, "_").trim().toUpperCase().slice(0, 12);
  const body = `QG1L.${studentId}.${cleanNo}.${nameB64}.${cleanClass}`;
  const sig = (await sha256Hex(`${body}:${getQrSigningKeyBase()}`)).slice(0, 10).toUpperCase();
  return `${body}.${sig}`;
}

export async function parseStudentIdQr(qr: string): Promise<{
  kind: "supabase_qr" | "offline_id_qr";
  studentId: string;
  studentNo?: string;
  studentName?: string;
  classCode?: string;
  valid: boolean;
  reason?: string;
}> {
  const clean = qr.trim();
  if (clean.startsWith("QG1.")) {
    const parts = clean.split(".");
    if (parts.length === 3 && parts[1] && parts[2]) {
      return { kind: "supabase_qr", studentId: parts[1], valid: true };
    }
    return { kind: "supabase_qr", studentId: "", valid: false, reason: "Invalid QG1 student QR." };
  }

  if (clean.startsWith("QG1L.")) {
    const parts = clean.split(".");
    if (parts.length !== 6) {
      return { kind: "offline_id_qr", studentId: "", valid: false, reason: "Invalid QG1L student ID card." };
    }
    const body = parts.slice(0, 5).join(".");
    const expected = (await sha256Hex(`${body}:${getQrSigningKeyBase()}`)).slice(0, 10).toUpperCase();
    if (parts[5].toUpperCase() !== expected) {
      return { kind: "offline_id_qr", studentId: "", valid: false, reason: "Student ID QR checksum mismatch." };
    }
    return {
      kind: "offline_id_qr",
      studentId: parts[1],
      studentNo: parts[2],
      studentName: decodeUtf8Base64Url(parts[3]),
      classCode: parts[4],
      valid: true,
    };
  }

  return { kind: "offline_id_qr", studentId: "", valid: false, reason: "Unrecognized student QR card format." };
}

/**
 * Compresses an EncryptedQuizPack into a compact scannable QR string (`QPK1.<deflated_b64url>`)
 * when browser/Node CompressionStream is available, otherwise `QPK0.<b64url>`.
 */
export async function encodeCompactQuizQr(pack: EncryptedQuizPack): Promise<string> {
  const json = JSON.stringify(pack);
  if (typeof CompressionStream !== "undefined") {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const buf = await new Response(stream).arrayBuffer();
      const b64 = toBase64(new Uint8Array(buf))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
      return `QPK1.${b64}`;
    } catch {
      // Fall back to uncompressed base64url
    }
  }
  return `QPK0.${encodeUtf8Base64Url(json)}`;
}

/** Decodes a QR string (`QPK1.*` or `QPK0.*`), share URL (`?pack=...`), or raw `.qpack.json` text into an EncryptedQuizPack. */
export async function importAnyQuizInput(rawInput: string): Promise<EncryptedQuizPack> {
  const clean = rawInput.trim();
  if (!clean) throw new Error("Empty quiz payload.");

  let parsed: EncryptedQuizPack;

  if (clean.startsWith("QPK1.")) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Compressed Quiz QR is not supported by this browser; import .qpack.json instead.");
    }
    const b64url = clean.slice(5);
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
    const bytes = fromBase64(padded);
    const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(
      new DecompressionStream("deflate-raw")
    );
    const text = await new Response(stream).text();
    parsed = JSON.parse(text) as EncryptedQuizPack;
  } else if (clean.startsWith("QPK0.")) {
    parsed = JSON.parse(decodeUtf8Base64Url(clean.slice(5))) as EncryptedQuizPack;
  } else if (clean.startsWith("http://") || clean.startsWith("https://") || clean.includes("pack=")) {
    const queryPart = clean.includes("?") ? clean.split("?")[1] : clean;
    const token = new URLSearchParams(queryPart).get("pack");
    if (!token) throw new Error("URL does not contain an encrypted ?pack= payload.");
    parsed = JSON.parse(decodeUtf8Base64Url(token)) as EncryptedQuizPack;
  } else {
    parsed = JSON.parse(clean) as EncryptedQuizPack;
  }

  if (!parsed || parsed.kind !== "QGATE_PACK") {
    throw new Error("Invalid encrypted QuizGate pack format.");
  }
  return parsed;
}
