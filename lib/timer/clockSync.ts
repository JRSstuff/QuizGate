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

export interface MonotonicTickInput {
  startedAtMs: number;
  endsAtMs: number;
  prevWallMs: number;
  prevAccumElapsedMs: number;
  nowWallMs: number;
  tabPerfDeltaMs: number; // elapsed perf.now() delta since last tick in current page session (>= 0)
  alreadyTampered?: boolean;
}

export interface MonotonicTickResult {
  nextWallMs: number;
  nextAccumElapsedMs: number;
  effectiveNowMs: number;
  remainingSeconds: number;
  clockTampered: boolean;
  expired: boolean;
}

/**
 * Combines wall clock (`Date.now()`) and monotonic elapsed (`performance.now()`) tracking.
 * Flags `clockTampered = true` and uses the larger elapsed duration if the device clock
 * jumps backward or drifts ahead/behind `performance.now()` by > 4 seconds.
 */
export function evaluateMonotonicClockTick(input: MonotonicTickInput): MonotonicTickResult {
  const {
    startedAtMs,
    endsAtMs,
    prevWallMs,
    prevAccumElapsedMs,
    nowWallMs,
    tabPerfDeltaMs,
    alreadyTampered = false,
  } = input;

  const safePerfDelta = Math.max(0, Number.isFinite(tabPerfDeltaMs) ? tabPerfDeltaMs : 0);
  const wallDelta = nowWallMs - prevWallMs;

  let clockTampered = alreadyTampered;
  // Detect backward jump (> 3s) across ticks/reloads or sudden wall/monotonic divergence (> 4s in-tab)
  if (wallDelta < -3000) {
    clockTampered = true;
  } else if (safePerfDelta > 0 && Math.abs(wallDelta - safePerfDelta) > 4000 && Math.abs(wallDelta) > 4000) {
    clockTampered = true;
  }

  const chosenStepDelta = Math.max(0, wallDelta, safePerfDelta);
  const nextAccumElapsedMs = Math.max(
    prevAccumElapsedMs + chosenStepDelta,
    Math.max(0, nowWallMs - startedAtMs)
  );
  const nextWallMs = Math.max(prevWallMs, nowWallMs);

  const effectiveNowMs = Math.max(nowWallMs, startedAtMs + nextAccumElapsedMs);
  const remainingMs = Math.max(0, endsAtMs - effectiveNowMs);
  const remainingSeconds = Math.floor(remainingMs / 1000);

  return {
    nextWallMs,
    nextAccumElapsedMs,
    effectiveNowMs,
    remainingSeconds,
    clockTampered,
    expired: effectiveNowMs >= endsAtMs,
  };
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
