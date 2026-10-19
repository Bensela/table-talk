import { useEffect, useState } from 'react';

/**
 * Presentational-only countdown for a startup stage's existing 20s timeout.
 *
 * This component owns nothing: it reads the SAME absolute deadline the
 * stage's own setTimeout already arms and ticks a local display state from
 * it. It never starts, stops, extends, or redirects on its own — the real
 * timeout/redirect logic stays exactly where it already lived. Passing a new
 * `deadlineMs` (e.g. because the owning effect legitimately re-armed after a
 * failed create-session attempt) simply makes the display follow the new
 * deadline; this component never invents one itself.
 */
export default function StageCountdown({ deadlineMs, totalMs, warnAtSeconds = 5 }) {
  const [remainingMs, setRemainingMs] = useState(() => (
    deadlineMs ? Math.max(0, deadlineMs - Date.now()) : null
  ));

  useEffect(() => {
    if (!deadlineMs) {
      setRemainingMs(null);
      return undefined;
    }
    const tick = () => setRemainingMs(Math.max(0, deadlineMs - Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineMs]);

  if (!deadlineMs || remainingMs === null) return null;

  const secondsLeft = Math.ceil(remainingMs / 1000);
  const progress = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0;
  const isWarning = secondsLeft <= warnAtSeconds;

  return (
    <div className="w-full max-w-md mx-auto" aria-live="polite">
      <div
        className="h-1 w-full rounded-full bg-[#35332E]/10 overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label="Time remaining on this step"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-200 ease-linear ${
            isWarning ? 'bg-[#926B1A]' : 'bg-[#35332E]/35'
          }`}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      {isWarning && (
        <p className="mt-2 text-xs font-medium text-[#926B1A]" role="status">
          Still there? This screen resets in {secondsLeft}s.
        </p>
      )}
    </div>
  );
}
