/**
 * The server clock.
 *
 * All competitive timing is server-authoritative. A client timestamp is stored
 * for diagnostics only and is never used for ranking or deadline enforcement.
 * The UI reads `serverNow()` and corrects its countdown against it continuously
 * rather than counting down from its own clock.
 */
let offsetMs = 0;

export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** Test and demo hook. Simulates a skewed or advanced server clock. */
export function setServerOffset(ms: number): void {
  offsetMs = ms;
}

export function advanceServerClock(ms: number): void {
  offsetMs += ms;
}

export function resetServerClock(): void {
  offsetMs = 0;
}

/** Client-supplied time, kept for diagnostics. Never returned as authority. */
export function clientNow(): number {
  return Date.now();
}

export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '0:00';
  const total = Math.floor(msRemaining / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}
