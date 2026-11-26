/**
 * Cryptographic helpers for QuizGate's link-based offline-first quiz flow (/q/[runId]#...).
 * Uses Web Crypto AES-256-GCM + SHA-256 with per-run random secrets so questions, answers,
 * and instant-feedback salts stay encrypted until start, and leaked keys cannot forge other runs.
 */

import {
  decodeUtf8Base64Url,
  encodeUtf8Base64Url,
  sha256Hex,
  syncSaltedHash,
  type StudentSubmissionAnswer,
} from "./quizVault";

const BASE32_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 32 chars (no 0/O, 1/I)
const STEP_BITS = 22n; // up to ~48.5 days at 1-second resolution
const SIG_BITS = 28n;  // 2^28 HMAC verification tag -> 50 bits = 10 Base32 chars

function getGlobalVaultNamespace(): string {
  return (
    process.env.NEXT_PUBLIC_QUIZGATE_VAULT_KEY ||
    process.env.QUIZGATE_VAULT_KEY ||
    "quizgate-local-vault-namespace"
  );
}

function getGlobalQrNamespace(): string {
  return (
    process.env.NEXT_PUBLIC_QUIZGATE_QR_KEY ||
    process.env.QUIZGATE_QR_KEY ||
    "quizgate-local-qr-namespace"
  );
}

function getCrypto(): Crypto {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  throw new Error("Web Crypto API is unavailable.");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  if (typeof atob === "function") {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function compressUtf8(text: string): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(text);
  if (typeof CompressionStream !== "undefined") {
    try {
      const stream = new Blob([toArrayBuffer(raw)]).stream().pipeThrough(
        new CompressionStream("deflate-raw")
      );
      const comp = new Uint8Array(await new Response(stream).arrayBuffer());
      if (comp.byteLength + 4 < raw.byteLength) {
        const out = new Uint8Array(4 + comp.byteLength);
        out.set([0x44, 0x5a, 0x31, 0x3a], 0); // "DZ1:"
        out.set(comp, 4);
        return out;
      }
    } catch {
      // Ignore compression error and use uncompressed bytes
    }
  }
  return raw;
}

async function decompressUtf8(bytes: Uint8Array): Promise<string> {
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x44 &&
    bytes[1] === 0x5a &&
    bytes[2] === 0x31 &&
    bytes[3] === 0x3a
  ) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser cannot open compressed quiz bundles.");
    }
    const stream = new Blob([toArrayBuffer(bytes.slice(4))]).stream().pipeThrough(
      new DecompressionStream("deflate-raw")
    );
    return new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const cryptoApi = getCrypto();
  const mat = await cryptoApi.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(`${getGlobalVaultNamespace()}:${passphrase}`)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return cryptoApi.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: 30000, hash: "SHA-256" },
    mat,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface LinkQuizQuestionInput {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  points: number;
  explanation?: string;
}

export interface LinkQuizUnlockedQuestion extends LinkQuizQuestionInput {
  feedbackSalt: string;
  correctHash: string;
}

export interface LinkQuizSecretPayload {
  questions: LinkQuizUnlockedQuestion[];
  resultSecret: string; // per-run signing key embedded inside ciphertext (Loophole #11)
}

export interface LinkRunEnvelope {
  v: 3;
  runId: string;
  versionHash: string;
  classId: string;
  className: string;
  sections: string[];
  quizId: string;
  title: string;
  durationMinutes: number;
  instantFeedback: boolean;
  allowRetry: boolean;
  questionCount: number;
  createdAtSec: number;
  verifyKey: string; // per-run key used to verify Start Code HMAC cleanly offline
  salt: string;
  iv: string;
  ciphertext: string; // AES-256-GCM encrypted LinkQuizSecretPayload
  bundleSig: string;
}

export interface LinkResultPlainPayload {
  v: 3;
  runId: string;
  versionHash: string;
  quizId: string;
  quizTitle: string;
  classId: string;
  className: string;
  attemptId: string;
  deviceId: string;
  studentName: string;
  section: string;
  score: number;
  maxScore: number;
  answeredCount: number;
  totalQuestions: number;
  startedAt: string;
  endsAt: string;
  submittedAt: string;
  submittedOffline: boolean;
  clockTampered: boolean;
  lateAfterEnd: boolean;
  answers: StudentSubmissionAnswer[];
  perRunSig: string;
}

export interface EncryptedLinkResultPacket {
  v: 3;
  kind: "QGATE_LINK_RESULT";
  runId: string;
  versionHash: string;
  attemptId: string;
  deviceId: string;
  studentName: string;
  section: string;
  score: number;
  maxScore: number;
  submittedAt: string;
  clockTampered: boolean;
  lateAfterEnd: boolean;
  submittedOffline: boolean;
  salt: string;
  iv: string;
  ciphertext: string;
  sig: string;
}

/** Deterministic content hash for detecting stale or edited quiz links cleanly (Loophole #6). */
export async function computeQuizVersionHash(input: {
  quizId: string;
  title: string;
  durationMinutes: number;
  instantFeedback: boolean;
  allowRetry: boolean;
  questions: LinkQuizQuestionInput[];
}): Promise<string> {
  const canonical = JSON.stringify({
    id: input.quizId,
    title: input.title.trim(),
    durationMinutes: input.durationMinutes,
    instantFeedback: input.instantFeedback,
    allowRetry: input.allowRetry,
    questions: input.questions.map((q) => ({
      id: q.id,
      p: q.prompt,
      o: q.options,
      c: q.correctIndex,
      pts: q.points,
    })),
  });
  return (await sha256Hex(canonical)).slice(0, 12);
}

/** Creates a complete encrypted quiz run bundle + URL hash payload for `/q/<runId>#<hash>`. */
export async function createLinkQuizBundle(params: {
  classId: string;
  className: string;
  sections?: string[];
  quizId: string;
  title: string;
  durationMinutes: number;
  instantFeedback: boolean;
  allowRetry: boolean;
  questions: LinkQuizQuestionInput[];
  runId?: string;
}): Promise<{
  runId: string;
  versionHash: string;
  createdAtSec: number;
  verifyKey: string;
  resultSecret: string;
  envelope: LinkRunEnvelope;
  hashFragment: string;
}> {
  const cryptoApi = getCrypto();
  const runId = params.runId || `r${toHex(cryptoApi.getRandomValues(new Uint8Array(4)))}`;
  const verifyKey = toHex(cryptoApi.getRandomValues(new Uint8Array(16)));
  const resultSecret = toHex(cryptoApi.getRandomValues(new Uint8Array(24)));
  const createdAtSec = Math.floor(Date.now() / 1000);
  const versionHash = await computeQuizVersionHash(params);

  const unlockedQuestions: LinkQuizUnlockedQuestion[] = params.questions.map((q) => {
    const feedbackSalt = toHex(cryptoApi.getRandomValues(new Uint8Array(6)));
    return {
      ...q,
      feedbackSalt,
      correctHash: syncSaltedHash(q.correctIndex, `${q.id}:${feedbackSalt}`),
    };
  });

  const secretPayload: LinkQuizSecretPayload = {
    questions: unlockedQuestions,
    resultSecret,
  };

  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(`link:${runId}:${versionHash}:${verifyKey}`, salt);
  const plainBytes = await compressUtf8(JSON.stringify(secretPayload));
  const encryptedBuf = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(plainBytes)
  );

  const ciphertext = toBase64Url(new Uint8Array(encryptedBuf));
  const saltHex = toHex(salt);
  const ivHex = toHex(iv);
  const bundleSig = (
    await sha256Hex(`${runId}:${versionHash}:${createdAtSec}:${saltHex}:${ivHex}:${ciphertext}:${verifyKey}`)
  ).slice(0, 16);

  const envelope: LinkRunEnvelope = {
    v: 3,
    runId,
    versionHash,
    classId: params.classId,
    className: params.className,
    sections: (params.sections || []).map((s) => s.trim()).filter(Boolean),
    quizId: params.quizId,
    title: params.title,
    durationMinutes: params.durationMinutes,
    instantFeedback: params.instantFeedback,
    allowRetry: params.allowRetry,
    questionCount: params.questions.length,
    createdAtSec,
    verifyKey,
    salt: saltHex,
    iv: ivHex,
    ciphertext,
    bundleSig,
  };

  const compactJsonBytes = await compressUtf8(JSON.stringify(envelope));
  const hashFragment = `L3.${toBase64Url(compactJsonBytes)}`;

  return { runId, versionHash, createdAtSec, verifyKey, resultSecret, envelope, hashFragment };
}

export async function decodeLinkHashFragment(rawHash: string): Promise<LinkRunEnvelope> {
  const clean = rawHash.replace(/^#/, "").trim();
  if (!clean) throw new Error("Missing encrypted quiz bundle in link.");

  let envelope: LinkRunEnvelope;
  if (clean.startsWith("L3.")) {
    const json = await decompressUtf8(fromBase64Url(clean.slice(3)));
    envelope = JSON.parse(json) as LinkRunEnvelope;
  } else {
    envelope = JSON.parse(decodeUtf8Base64Url(clean)) as LinkRunEnvelope;
  }

  if (!envelope || envelope.v !== 3 || !envelope.runId || !envelope.ciphertext) {
    throw new Error("Invalid QuizGate link bundle.");
  }

  const expectedSig = (
    await sha256Hex(
      `${envelope.runId}:${envelope.versionHash}:${envelope.createdAtSec}:${envelope.salt}:${envelope.iv}:${envelope.ciphertext}:${envelope.verifyKey}`
    )
  ).slice(0, 16);

  if (expectedSig !== envelope.bundleSig) {
    throw new Error("Link integrity check failed. URL may have been truncated or altered.");
  }

  return envelope;
}

/** Unlocks questions, answer feedback hashes, and per-run signing secret ONLY after run start is verified. */
export async function unlockLinkQuizBundle(envelope: LinkRunEnvelope): Promise<LinkQuizSecretPayload> {
  const aesKey = await deriveAesKey(
    `link:${envelope.runId}:${envelope.versionHash}:${envelope.verifyKey}`,
    hexToBytes(envelope.salt)
  );
  const cryptoApi = getCrypto();
  try {
    const buf = await cryptoApi.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(hexToBytes(envelope.iv)) },
      aesKey,
      toArrayBuffer(fromBase64Url(envelope.ciphertext))
    );
    const json = await decompressUtf8(new Uint8Array(buf));
    return JSON.parse(json) as LinkQuizSecretPayload;
  } catch {
    throw new Error("Failed to decrypt quiz questions.");
  }
}

async function computeStartTag28(verifyKey: string, runId: string, startEpochSec: number): Promise<bigint> {
  const digest = await sha256Hex(`${verifyKey}:${runId}:${startEpochSec}:START`);
  const top32 = Number.parseInt(digest.slice(0, 8), 16);
  return BigInt(top32 >>> 4) & ((1n << SIG_BITS) - 1n);
}

/**
 * Generates a short 10-character Base32 START CODE (e.g. `4K8M2-P9QWR`) plus QR string (`QGSTART.*`),
 * cryptographically binding `runId` + `startEpochSec` via per-run `verifyKey`.
 */
export async function generateSignedStartCode(params: {
  runId: string;
  startEpochSec: number;
  createdAtSec: number;
  verifyKey: string;
}): Promise<{ startCode: string; formattedCode: string; startQr: string }> {
  const deltaSec = Math.max(0, Math.min(4_194_303, Math.floor(params.startEpochSec - params.createdAtSec)));
  const canonicalStartEpoch = params.createdAtSec + deltaSec;
  const sig28 = await computeStartTag28(params.verifyKey, params.runId, canonicalStartEpoch);
  const packed50 = (BigInt(deltaSec) << SIG_BITS) | sig28;

  let code = "";
  for (let shift = 45n; shift >= 0n; shift -= 5n) {
    const idx = Number((packed50 >> shift) & 31n);
    code += BASE32_ALPHABET[idx];
  }
  const formattedCode = `${code.slice(0, 5)}-${code.slice(5)}`;
  const startQr = `QGSTART.${params.runId}.${canonicalStartEpoch}.${code}`;
  return { startCode: code, formattedCode, startQr };
}

export async function verifySignedStartCode(
  rawInput: string,
  envelope: Pick<LinkRunEnvelope, "runId" | "createdAtSec" | "verifyKey">
): Promise<{ valid: boolean; startEpochSec?: number; reason?: string }> {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, reason: "Enter the Start Code from your teacher." };
  }

  let candidateCode = trimmed;
  if (trimmed.startsWith("QGSTART.")) {
    const parts = trimmed.split(".");
    if (parts.length !== 4 || parts[1] !== envelope.runId) {
      return { valid: false, reason: "This Start QR belongs to a different quiz." };
    }
    candidateCode = parts[3];
  }

  const normalized = candidateCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length !== 10) {
    return { valid: false, reason: "Start Code must be 10 characters (e.g. 4K8M2-P9QWR)." };
  }

  let packed50 = 0n;
  for (const ch of normalized) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      return { valid: false, reason: "Invalid characters in Start Code." };
    }
    packed50 = (packed50 << 5n) | BigInt(idx);
  }

  const deltaSec = Number(packed50 >> SIG_BITS);
  const providedSig28 = packed50 & ((1n << SIG_BITS) - 1n);
  const startEpochSec = envelope.createdAtSec + deltaSec;

  const expectedSig28 = await computeStartTag28(envelope.verifyKey, envelope.runId, startEpochSec);
  if (providedSig28 !== expectedSig28) {
    return { valid: false, reason: "Wrong or tampered Start Code for this quiz." };
  }

  return { valid: true, startEpochSec };
}

async function computePerRunResultSig(
  plain: Omit<LinkResultPlainPayload, "perRunSig">,
  perRunResultSecret: string
): Promise<string> {
  const body = [
    plain.runId,
    plain.versionHash,
    plain.attemptId,
    plain.deviceId,
    plain.studentName.trim().toLowerCase(),
    plain.section.trim().toLowerCase(),
    plain.score,
    plain.maxScore,
    plain.submittedAt,
    plain.answers.map((a) => `${a.questionId}:${a.selectedIndex}`).join(","),
  ].join("|");
  return (await sha256Hex(`${body}:${perRunResultSecret}`)).slice(0, 24);
}

/** Encrypts a student's `.qres.json` submission sealed with both AES-GCM integrity AND per-run HMAC secret. */
export async function encryptLinkResultPacket(
  plainNoSig: Omit<LinkResultPlainPayload, "perRunSig">,
  perRunResultSecret: string
): Promise<{ packet: EncryptedLinkResultPacket; plain: LinkResultPlainPayload; resultQr: string }> {
  const perRunSig = await computePerRunResultSig(plainNoSig, perRunResultSecret);
  const plain: LinkResultPlainPayload = { ...plainNoSig, perRunSig };

  const cryptoApi = getCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(16));
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(`result:${plain.runId}:${plain.versionHash}`, salt);
  const bytes = await compressUtf8(JSON.stringify(plain));

  const encBuf = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(bytes)
  );
  const ciphertext = toBase64Url(new Uint8Array(encBuf));
  const saltHex = toHex(salt);
  const ivHex = toHex(iv);
  const sig = (
    await sha256Hex(
      `${plain.runId}:${plain.attemptId}:${plain.score}:${saltHex}:${ivHex}:${ciphertext}:${getGlobalQrNamespace()}`
    )
  ).slice(0, 16);

  const packet: EncryptedLinkResultPacket = {
    v: 3,
    kind: "QGATE_LINK_RESULT",
    runId: plain.runId,
    versionHash: plain.versionHash,
    attemptId: plain.attemptId,
    deviceId: plain.deviceId,
    studentName: plain.studentName,
    section: plain.section,
    score: plain.score,
    maxScore: plain.maxScore,
    submittedAt: plain.submittedAt,
    clockTampered: plain.clockTampered,
    lateAfterEnd: plain.lateAfterEnd,
    submittedOffline: plain.submittedOffline,
    salt: saltHex,
    iv: ivHex,
    ciphertext,
    sig,
  };

  // Result QR encodes compact verified receipt using per-run secret + version
  const epoch = Math.floor(new Date(plain.submittedAt).getTime() / 1000) || Math.floor(Date.now() / 1000);
  const nameB64 = encodeUtf8Base64Url(`${plain.studentName} (${plain.section})`.slice(0, 40));
  const qrBody = `QG3R.${plain.runId}.${plain.attemptId.slice(0, 12)}.${nameB64}.${plain.score}.${plain.maxScore}.${epoch}`;
  const qrSig = (await sha256Hex(`${qrBody}:${perRunResultSecret}`)).slice(0, 12).toUpperCase();
  const resultQr = `${qrBody}.${qrSig}`;

  return { packet, plain, resultQr };
}

export async function decryptLinkResultPacket(
  packet: EncryptedLinkResultPacket,
  expectedRun: { runId: string; versionHash: string; resultSecret: string }
): Promise<{
  ok: boolean;
  reason?: "invalid" | "tampered" | "wrong_run" | "wrong_version";
  message?: string;
  plain?: LinkResultPlainPayload;
}> {
  if (!packet || packet.kind !== "QGATE_LINK_RESULT" || packet.v !== 3 || !packet.ciphertext) {
    return { ok: false, reason: "invalid", message: "Not a valid v3 QuizGate .qres.json submission." };
  }
  if (packet.runId !== expectedRun.runId) {
    return {
      ok: false,
      reason: "wrong_run",
      message: `Wrong quiz run (file is for run ${packet.runId}, current run is ${expectedRun.runId}).`,
    };
  }
  if (packet.versionHash !== expectedRun.versionHash) {
    return {
      ok: false,
      reason: "wrong_version",
      message: `Stale quiz version (file version ${packet.versionHash} != active ${expectedRun.versionHash}).`,
    };
  }

  const expectedPacketSig = (
    await sha256Hex(
      `${packet.runId}:${packet.attemptId}:${packet.score}:${packet.salt}:${packet.iv}:${packet.ciphertext}:${getGlobalQrNamespace()}`
    )
  ).slice(0, 16);

  if (expectedPacketSig !== packet.sig) {
    return { ok: false, reason: "tampered", message: "Integrity seal mismatch — file was edited or corrupted." };
  }

  try {
    const aesKey = await deriveAesKey(
      `result:${expectedRun.runId}:${expectedRun.versionHash}`,
      hexToBytes(packet.salt)
    );
    const buf = await getCrypto().subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(hexToBytes(packet.iv)) },
      aesKey,
      toArrayBuffer(fromBase64Url(packet.ciphertext))
    );
    const plain = JSON.parse(await decompressUtf8(new Uint8Array(buf))) as LinkResultPlainPayload;

    const { perRunSig, ...rest } = plain;
    const expectedRunSig = await computePerRunResultSig(rest, expectedRun.resultSecret);
    if (perRunSig !== expectedRunSig) {
      return {
        ok: false,
        reason: "tampered",
        message: "Per-run cryptographic signature mismatch — forged or wrong signing secret.",
      };
    }

    return { ok: true, plain };
  } catch {
    return { ok: false, reason: "tampered", message: "Decryption failed — corrupted or tampered file." };
  }
}

export async function verifyLinkResultQr(
  qrCode: string,
  expectedRun: { runId: string; resultSecret: string }
): Promise<{
  valid: boolean;
  reason?: string;
  attemptPrefix?: string;
  displayName?: string;
  score?: number;
  maxScore?: number;
  submittedEpoch?: number;
}> {
  const clean = qrCode.trim();
  const parts = clean.split(".");
  if (parts.length !== 8 || parts[0] !== "QG3R") {
    return { valid: false, reason: "Expected QG3R.* result QR format." };
  }
  if (parts[1] !== expectedRun.runId) {
    return { valid: false, reason: `Result QR is for a different run (${parts[1]}).` };
  }
  const body = parts.slice(0, 7).join(".");
  const expectedSig = (await sha256Hex(`${body}:${expectedRun.resultSecret}`)).slice(0, 12).toUpperCase();
  if (parts[7].toUpperCase() !== expectedSig) {
    return { valid: false, reason: "Per-run QR signature mismatch (forged or modified)." };
  }
  return {
    valid: true,
    attemptPrefix: parts[2],
    displayName: decodeUtf8Base64Url(parts[3]),
    score: Number.parseInt(parts[4], 10),
    maxScore: Number.parseInt(parts[5], 10),
    submittedEpoch: Number.parseInt(parts[6], 10),
  };
}
