"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Lightbulb,
  Lock,
  Sparkles,
} from "lucide-react";
import { syncSaltedHash } from "@/lib/crypto/quizVault";
import type { MathTopicModule } from "@/lib/data/grade10Math";
import type { StudyProgressRecord } from "@/lib/offline/storage";
import { MathText } from "./MathText";

interface Grade10ModuleDrawerProps {
  module: MathTopicModule;
  progress: StudyProgressRecord;
  unlocked: boolean;
  onUpdateProgress: (next: StudyProgressRecord) => Promise<void>;
  onClose: () => void;
}

type ModuleStage = "learn" | "match" | "practice" | "scenario" | "reflect";

function shuffle<T>(list: readonly T[]): T[] {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function Grade10ModuleDrawer({
  module,
  progress,
  unlocked,
  onUpdateProgress,
  onClose,
}: Grade10ModuleDrawerProps) {
  const prefix = `w${module.weekNumber}`;
  const isDone = (stage: ModuleStage) => {
    if (stage === "practice") {
      return Boolean(
        progress.completedSteps[`${prefix}-s0`] && progress.completedSteps[`${prefix}-s1`]
      );
    }
    return Boolean(progress.completedSteps[`${prefix}-${stage}`]);
  };

  const isStageUnlocked = (stage: ModuleStage) => {
    if (!unlocked) return false;
    if (stage === "learn") return true;
    if (stage === "match") return isDone("learn");
    if (stage === "practice") return isDone("match");
    if (stage === "scenario") return isDone("practice");
    return isDone("scenario");
  };

  const [stage, setStage] = useState<ModuleStage>(() => {
    const order: ModuleStage[] = ["learn", "match", "practice", "scenario", "reflect"];
    return order.find((s) => isStageUnlocked(s) && !isDone(s)) || "learn";
  });

  // Matching state
  const leftPairs = useMemo(
    () => shuffle(module.matchingPairs.map((p, idx) => ({ idx, text: p.left }))),
    [module]
  );
  const rightPairs = useMemo(
    () => shuffle(module.matchingPairs.map((p, idx) => ({ idx, text: p.right }))),
    [module]
  );
  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [matchedIdx, setMatchedIdx] = useState<Set<number>>(new Set());
  const [matchError, setMatchError] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState(0);

  // Practice problem state
  const [practiceInputs, setPracticeInputs] = useState<string[]>(["", ""]);
  const [practiceTries, setPracticeTries] = useState<number[]>([0, 0]);
  const [practiceMsg, setPracticeMsg] = useState<(string | null)[]>([null, null]);

  // Scenario MCQ state
  const [mcqIdx, setMcqIdx] = useState(0);
  const [mcqSelectedOpt, setMcqSelectedOpt] = useState<(number | null)[]>([null, null]);
  const [mcqMsg, setMcqMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mcqDone, setMcqDone] = useState<boolean[]>([false, false]);

  // Reflection state
  const [reflectionText, setReflectionText] = useState(
    progress.reflections[module.id] || ""
  );
  const [reflectionErr, setReflectionErr] = useState<string | null>(null);

  useEffect(() => {
    setMatchedIdx(new Set());
    setSelectedLeft(null);
    setMatchError(null);
    setMistakes(0);
    setPracticeInputs(["", ""]);
    setPracticeTries([0, 0]);
    setPracticeMsg([null, null]);
    setMcqIdx(0);
    setMcqSelectedOpt([null, null]);
    setMcqMsg(null);
    setMcqDone([false, false]);
    setReflectionText(progress.reflections[module.id] || "");
    setReflectionErr(null);
  }, [module.id, progress.reflections]);

  const awardStep = async (key: string, pts: number) => {
    if (progress.completedSteps[key]) return;
    await onUpdateProgress({
      ...progress,
      points: progress.points + pts,
      completedSteps: { ...progress.completedSteps, [key]: true },
    });
  };

  if (!unlocked) {
    return (
      <div className="qg-card p-6 text-center space-y-3">
        <Lock className="w-8 h-8 text-[var(--ink-muted)] mx-auto" />
        <h3 className="text-lg font-bold">Week {module.weekNumber} Locked</h3>
        <p className="text-sm text-[var(--ink-muted)]">
          Complete the previous week&apos;s reflection to unlock Week {module.weekNumber}:{" "}
          {module.title}.
        </p>
        <button type="button" onClick={onClose} className="qg-btn qg-btn-secondary">
          Back to Modules
        </button>
      </div>
    );
  }

  const stageMeta: [ModuleStage, string][] = [
    ["learn", "Concept"],
    ["match", "Match"],
    ["practice", "Solve"],
    ["scenario", "Problem"],
    ["reflect", "Reflect"],
  ];

  const handleCheckPractice = async (idx: number) => {
    const item = module.practiceItems[idx];
    const clean = practiceInputs[idx].replace(/[−–]/g, "-").replace(/\s/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(clean)) {
      const next = practiceMsg.slice();
      next[idx] = "Enter a valid number (for example: 9 or -7).";
      setPracticeMsg(next);
      return;
    }
    const numVal = Number(clean);
    const valid = syncSaltedHash(numVal, item.id) === item.expectedHash;

    if (valid) {
      const stepKey = `${prefix}-s${idx}`;
      await awardStep(stepKey, 5);
      const nextMsg = practiceMsg.slice();
      nextMsg[idx] = "Correct (+5 pts).";
      setPracticeMsg(nextMsg);
    } else {
      const nextTries = practiceTries.slice();
      nextTries[idx]++;
      setPracticeTries(nextTries);
      const nextMsg = practiceMsg.slice();
      nextMsg[idx] =
        nextTries[idx] >= 2
          ? "Check the worked steps below, then submit the verified value."
          : "Not quite — verify signs, exponents, and arithmetic.";
      setPracticeMsg(nextMsg);
    }
  };

  const currentMcq = module.scenarioQuestions[mcqIdx];

  const handlePickMcq = async (optIdx: number) => {
    if (!currentMcq) return;
    const nextSel = mcqSelectedOpt.slice();
    nextSel[mcqIdx] = optIdx;
    setMcqSelectedOpt(nextSel);

    const isCorrect =
      syncSaltedHash(optIdx, currentMcq.salt) === currentMcq.correctHash;

    if (isCorrect) {
      await awardStep(`${prefix}-q${mcqIdx}`, 10);
      const nextDone = mcqDone.slice();
      nextDone[mcqIdx] = true;
      setMcqDone(nextDone);
      setMcqMsg({ ok: true, text: `Correct (+10 pts). ${currentMcq.explanation}` });
      if (nextDone.every(Boolean)) {
        await awardStep(`${prefix}-scenario`, 0);
      }
    } else {
      setMcqMsg({
        ok: false,
        text: "Recheck the given values in the problem scenario and try another option.",
      });
    }
  };

  const handleSaveReflection = async () => {
    const clean = reflectionText.trim();
    if (clean.length < 25) {
      setReflectionErr("Please write at least two complete sentences (minimum 25 characters).");
      return;
    }
    setReflectionErr(null);
    const key = `${prefix}-reflect`;
    const alreadyDone = Boolean(progress.completedSteps[key]);
    await onUpdateProgress({
      ...progress,
      points: progress.points + (alreadyDone ? 0 : 5),
      completedSteps: { ...progress.completedSteps, [key]: true },
      reflections: { ...progress.reflections, [module.id]: clean },
    });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--primary)] min-h-[40px]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>All Topics</span>
        </button>
        <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-full bg-[var(--primary-soft)] text-[var(--primary)]">
          Topic {module.topicCode} · Week {module.weekNumber}
        </span>
      </div>

      <div className="qg-card p-5 space-y-2">
        <h2 className="text-xl font-bold">{module.title}</h2>
        <p className="text-sm text-[var(--ink-muted)]">{module.competency}</p>
      </div>

      {/* Responsive Stepper */}
      <div className="grid grid-cols-5 gap-1.5">
        {stageMeta.map(([k, label]) => {
          const active = stage === k;
          const open = isStageUnlocked(k);
          const done = isDone(k);
          return (
            <button
              key={k}
              type="button"
              disabled={!open}
              onClick={() => open && setStage(k)}
              className={`min-h-[44px] px-1 py-2 rounded-xl text-xs font-semibold border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                active
                  ? "bg-[var(--primary)] text-white border-transparent"
                  : done
                    ? "bg-[var(--success-soft)] text-[var(--success)] border-emerald-500/30"
                    : open
                      ? "bg-[var(--surface)] text-[var(--ink)] border-[var(--border)]"
                      : "bg-[var(--surface-subtle)] text-[var(--ink-muted)] border-[var(--border)] opacity-55"
              }`}
            >
              <span>{done && !active ? "✓" : open ? "" : "🔒"} {label}</span>
            </button>
          );
        })}
      </div>

      {/* Stage Content */}
      {stage === "learn" && (
        <div className="space-y-4">
          <div className="qg-card p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--primary)] flex items-center gap-1.5 mb-2">
                <BookOpen className="w-4 h-4" />
                <span>Core Ideas</span>
              </h3>
              <ul className="space-y-2 text-sm">
                {module.principles.map((p, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="text-[var(--primary)] font-bold">•</span>
                    <MathText text={p} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-3 border-t border-[var(--border)]">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)] mb-2">
                Step-by-Step Method
              </h3>
              <ol className="space-y-1.5 text-sm list-decimal list-inside">
                {module.steps.map((s, idx) => (
                  <li key={idx}>
                    <MathText text={s} />
                  </li>
                ))}
              </ol>
            </div>

            <div className="pt-3 border-t border-[var(--border)] space-y-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                Worked Examples
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {module.examples.map((ex, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] text-sm"
                  >
                    <div className="text-xs font-semibold text-[var(--primary)] mb-1">
                      {ex.label}
                    </div>
                    <MathText text={ex.steps} className="font-mono text-[13px]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--warning-soft)] border border-amber-500/30 text-sm flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[var(--warning)] shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Watch Out: </span>
                <MathText text={module.caution} />
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[var(--primary-soft)] text-sm flex gap-2.5">
              <Lightbulb className="w-4 h-4 text-[var(--primary)] shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Applied Connection: </span>
                <MathText text={module.application} />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => {
              await awardStep(`${prefix}-learn`, 0);
              setStage("match");
            }}
            className="qg-btn qg-btn-primary w-full"
          >
            <span>Continue to Matching Activity</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {stage === "match" && (
        <div className="qg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-base">Match Equivalent Expressions</h3>
              <p className="text-xs text-[var(--ink-muted)]">
                Tap one item on the left, then tap its simplified match on the right.
              </p>
            </div>
            <span className="text-xs font-mono font-bold">
              {matchedIdx.size}/{module.matchingPairs.length}
            </span>
          </div>

          {matchError && (
            <div className="p-2.5 rounded-xl bg-[var(--danger-soft)] text-[var(--danger)] text-xs font-semibold">
              {matchError}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2.5">
              {leftPairs.map((item) => {
                const isOk = matchedIdx.has(item.idx);
                const isSel = selectedLeft === item.idx;
                return (
                  <button
                    key={item.idx}
                    type="button"
                    disabled={isOk}
                    onClick={() => {
                      setMatchError(null);
                      setSelectedLeft(item.idx);
                    }}
                    className={`w-full min-h-[56px] p-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                      isOk
                        ? "bg-[var(--success-soft)] text-[var(--success)] border-emerald-500/40"
                        : isSel
                          ? "bg-[var(--primary-soft)] border-[var(--primary)] ring-2 ring-[var(--primary)]"
                          : "bg-[var(--surface-subtle)] border-[var(--border)] hover:border-[var(--primary)]"
                    }`}
                  >
                    <MathText text={item.text} />
                  </button>
                );
              })}
            </div>

            <div className="space-y-2.5">
              {rightPairs.map((item) => {
                const isOk = matchedIdx.has(item.idx);
                return (
                  <button
                    key={item.idx}
                    type="button"
                    disabled={isOk || selectedLeft === null}
                    onClick={async () => {
                      if (selectedLeft === null) return;
                      if (selectedLeft === item.idx) {
                        const next = new Set(matchedIdx);
                        next.add(item.idx);
                        setMatchedIdx(next);
                        setSelectedLeft(null);
                        setMatchError(null);
                        if (next.size === module.matchingPairs.length) {
                          const pts = Math.max(4, 10 - mistakes * 2);
                          await awardStep(`${prefix}-match`, pts);
                        }
                      } else {
                        setMistakes((m) => m + 1);
                        setSelectedLeft(null);
                        setMatchError("Not equivalent — check exponents, signs, or factors.");
                      }
                    }}
                    className={`w-full min-h-[56px] p-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                      isOk
                        ? "bg-[var(--success-soft)] text-[var(--success)] border-emerald-500/40"
                        : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--primary)]"
                    }`}
                  >
                    <MathText text={item.text} />
                  </button>
                );
              })}
            </div>
          </div>

          {isDone("match") && (
            <button
              type="button"
              onClick={() => setStage("practice")}
              className="qg-btn qg-btn-primary w-full"
            >
              <span>Proceed to Quantitative Practice</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {stage === "practice" && (
        <div className="space-y-4">
          {module.practiceItems.map((item, idx) => {
            const solved = Boolean(progress.completedSteps[`${prefix}-s${idx}`]);
            const showHint = practiceTries[idx] >= 2 && !solved;
            return (
              <div key={item.id} className="qg-card p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold">
                    <span className="text-[var(--primary)] mr-1.5">#{idx + 1}</span>
                    <MathText text={item.prompt} />
                  </div>
                  {solved && (
                    <CheckCircle2 className="w-5 h-5 text-[var(--success)] shrink-0" />
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    className="qg-input font-mono"
                    inputMode="decimal"
                    disabled={solved}
                    placeholder="Numeric answer"
                    value={practiceInputs[idx]}
                    onChange={(e) => {
                      const next = practiceInputs.slice();
                      next[idx] = e.target.value;
                      setPracticeInputs(next);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCheckPractice(idx);
                    }}
                  />
                  <button
                    type="button"
                    disabled={solved}
                    onClick={() => handleCheckPractice(idx)}
                    className="qg-btn qg-btn-primary shrink-0"
                  >
                    {solved ? "Done" : "Check"}
                  </button>
                </div>

                {practiceMsg[idx] && (
                  <p
                    className={`text-xs font-semibold ${
                      solved ? "text-[var(--success)]" : "text-[var(--danger)]"
                    }`}
                  >
                    {practiceMsg[idx]}
                  </p>
                )}

                {showHint && (
                  <div className="p-3 rounded-xl bg-[var(--warning-soft)] text-xs space-y-1">
                    <div className="font-bold">Guided Steps:</div>
                    {item.solutionSteps.map((st, sIdx) => (
                      <div key={sIdx}>
                        • <MathText text={st} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {isDone("practice") && (
            <button
              type="button"
              onClick={() => setStage("scenario")}
              className="qg-btn qg-btn-primary w-full"
            >
              <span>Proceed to Word Problem</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {stage === "scenario" && currentMcq && (
        <div className="qg-card p-5 space-y-4">
          <div className="p-3.5 rounded-xl bg-[var(--surface-subtle)] border border-[var(--border)] text-sm">
            <div className="text-xs font-bold uppercase tracking-wide text-[var(--primary)] mb-1">
              Applied Scenario
            </div>
            <MathText text={module.scenarioContext} />
          </div>

          <div className="space-y-2.5">
            <div className="flex justify-between text-xs font-semibold text-[var(--ink-muted)]">
              <span>
                Question {mcqIdx + 1} of {module.scenarioQuestions.length}
              </span>
              <span className="tabular-nums">
                {mcqDone.filter(Boolean).length}/{module.scenarioQuestions.length} solved
              </span>
            </div>
            <p className="font-semibold text-base">
              <MathText text={currentMcq.prompt} />
            </p>

            <div className="space-y-2">
              {currentMcq.options.map((opt, idx) => {
                const chosen = mcqSelectedOpt[mcqIdx] === idx;
                const solved = mcqDone[mcqIdx];
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handlePickMcq(idx)}
                    className={`w-full min-h-[50px] text-left px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                      chosen && solved
                        ? "bg-[var(--success-soft)] border-emerald-500 text-[var(--success)]"
                        : chosen
                          ? "bg-[var(--danger-soft)] border-[var(--danger)]"
                          : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)]"
                    }`}
                  >
                    <MathText text={opt} />
                  </button>
                );
              })}
            </div>

            {mcqMsg && (
              <div
                className={`p-3 rounded-xl text-sm font-medium ${
                  mcqMsg.ok
                    ? "bg-[var(--success-soft)] text-[var(--success)]"
                    : "bg-[var(--danger-soft)] text-[var(--danger)]"
                }`}
              >
                <MathText text={mcqMsg.text} />
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                type="button"
                disabled={mcqIdx === 0}
                onClick={() => {
                  setMcqIdx(0);
                  setMcqMsg(null);
                }}
                className="qg-btn qg-btn-secondary text-xs"
              >
                Previous
              </button>
              {mcqIdx + 1 < module.scenarioQuestions.length ? (
                <button
                  type="button"
                  onClick={() => {
                    setMcqIdx(mcqIdx + 1);
                    setMcqMsg(null);
                  }}
                  className="qg-btn qg-btn-secondary text-xs"
                >
                  Next Question
                </button>
              ) : (
                isDone("scenario") && (
                  <button
                    type="button"
                    onClick={() => setStage("reflect")}
                    className="qg-btn qg-btn-primary text-xs"
                  >
                    Continue to Reflection →
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {stage === "reflect" && (
        <div className="qg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--primary)]" />
            <h3 className="font-bold text-base">Reflection Checkpoint</h3>
          </div>
          <p className="text-sm text-[var(--ink-muted)]">{module.reflectionPrompt}</p>
          <textarea
            className="qg-input min-h-[120px] py-3"
            placeholder="Write at least two clear sentences..."
            value={reflectionText}
            onChange={(e) => setReflectionText(e.target.value)}
          />
          {reflectionErr && (
            <p className="text-xs font-semibold text-[var(--danger)]">{reflectionErr}</p>
          )}
          <button
            type="button"
            onClick={handleSaveReflection}
            className="qg-btn qg-btn-primary w-full"
          >
            Save Reflection &amp; Unlock Next Week (+5 pts)
          </button>
        </div>
      )}
    </div>
  );
}
