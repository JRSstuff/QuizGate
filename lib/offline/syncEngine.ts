import { offlineDb } from "./storage";

export interface SyncFlushResult {
  syncedQuestions: number;
  finalizedAttempts: number;
  revoked: boolean;
}

/**
 * Flushes all pending remote student answers and offline-finished remote attempts to Vercel/Supabase.
 * Deduplicates queued answers per (runId, questionId), keeping the most recent selection cleanly.
 */
export async function flushStudentSyncQueue(onlyPackOrRunId?: string): Promise<SyncFlushResult> {
  if (typeof window === "undefined" || !offlineDb || !navigator.onLine) {
    return { syncedQuestions: 0, finalizedAttempts: 0, revoked: false };
  }

  const sess = await offlineDb.session.get("active");
  if (!sess || sess.role !== "student" || !sess.sessionToken || sess.sessionToken.startsWith("offline_")) {
    return { syncedQuestions: 0, finalizedAttempts: 0, revoked: false };
  }

  const pendingAll = await offlineDb.answerQueue.where("syncStatus").equals("pending").toArray();
  const scoped = onlyPackOrRunId
    ? pendingAll.filter((item) => item.packOrRunId === onlyPackOrRunId)
    : pendingAll;

  let syncedQuestions = 0;
  let finalizedAttempts = 0;
  let revoked = false;

  // Group queued answers by runId & deduplicate per questionId keeping latest answeredAt
  const byRun = new Map<string, { recordIds: number[]; latestByQuestion: Map<string, { question_id: string; selected_index: number; answered_at: string }> }>();

  for (const row of scoped) {
    let bucket = byRun.get(row.packOrRunId);
    if (!bucket) {
      bucket = { recordIds: [], latestByQuestion: new Map() };
      byRun.set(row.packOrRunId, bucket);
    }
    if (row.id !== undefined) bucket.recordIds.push(row.id);

    const prev = bucket.latestByQuestion.get(row.questionId);
    if (!prev || row.answeredAt >= prev.answered_at) {
      bucket.latestByQuestion.set(row.questionId, {
        question_id: row.questionId,
        selected_index: row.selectedIndex,
        answered_at: row.answeredAt,
      });
    }
  }

  for (const [runId, bucket] of byRun.entries()) {
    const payload = Array.from(bucket.latestByQuestion.values());
    if (payload.length === 0) continue;

    try {
      const res = await fetch("/api/student/quiz-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sess.sessionToken}`,
        },
        body: JSON.stringify({ runId, answers: payload }),
      });

      if (res.status === 401) {
        revoked = true;
        break;
      }

      if (res.ok) {
        for (const id of bucket.recordIds) {
          await offlineDb.answerQueue.update(id, { syncStatus: "synced" });
        }
        syncedQuestions += payload.length;
      }
    } catch {
      // Leave pending for retry when network recovers
    }
  }

  // Finalize any offline-submitted attempts belonging to remote runs
  if (!revoked) {
    const pendingFinishes = await offlineDb.attempts
      .where("syncStatus")
      .equals("pending_sync")
      .toArray();

    for (const att of pendingFinishes) {
      if (onlyPackOrRunId && att.packOrRunId !== onlyPackOrRunId) continue;
      try {
        const finRes = await fetch("/api/student/quiz-finish", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sess.sessionToken}`,
          },
          body: JSON.stringify({ runId: att.packOrRunId }),
        });

        if (finRes.status === 401) {
          revoked = true;
          break;
        }

        if (finRes.ok) {
          const finData = await finRes.json();
          if (finData.result_code) {
            await offlineDb.attempts.update(att.id, {
              score: finData.score ?? att.score,
              maxScore: finData.max_score ?? att.maxScore,
              submittedAt: finData.submitted_at || att.submittedAt,
              resultQr: finData.result_code,
              syncStatus: "synced",
            });
            finalizedAttempts += 1;
          }
        }
      } catch {
        // Leave pending_sync for retry
      }
    }
  }

  return { syncedQuestions, finalizedAttempts, revoked };
}
