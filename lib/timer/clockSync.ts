export function calculateClockOffsetMs(
  serverNowMs: number,
  requestStartMs: number,
  requestEndMs: number
): number {
  const clientMid = Math.round((requestStartMs + requestEndMs) / 2);
  return serverNowMs - clientMid;
}

export function calculateRemainingSeconds(
  endsAtIso: string,
  offsetMs = 0,
  nowMs = Date.now()
): number {
  const endMs = new Date(endsAtIso).getTime();
  if (Number.isNaN(endMs)) return 0;
  const correctedNow = nowMs + offsetMs;
  return Math.max(0, Math.floor((endMs - correctedNow) / 1000));
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export async function synchronizeServerClock(): Promise<{
  offsetMs: number;
  synced: boolean;
}> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { offsetMs: 0, synced: false };
  }
  const t0 = Date.now();
  try {
    const res = await fetch("/api/time", { cache: "no-store" });
    const t1 = Date.now();
    if (!res.ok) return { offsetMs: 0, synced: false };
    const data = (await res.json()) as { server_time?: number };
    if (typeof data.server_time !== "number") return { offsetMs: 0, synced: false };
    return {
      offsetMs: calculateClockOffsetMs(data.server_time, t0, t1),
      synced: true,
    };
  } catch {
    return { offsetMs: 0, synced: false };
  }
}
