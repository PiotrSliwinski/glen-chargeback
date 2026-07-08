/**
 * Structured timing/trace layer for finding where a request spends its time.
 *
 * The real per-request cost in this app lives at a few boundaries — warehouse
 * round trips (dal/client.ts), server-action mutations (actions/run.ts), and
 * the refresh warm pass (dal/warm.ts). This module gives each of them a
 * uniform, low-overhead way to emit a single timed line so a slow request can
 * be read off the log stream.
 *
 * Control (APP_LOG): `off` | `slow` | `all`.
 *  - unset  → verbose in dev (`all`), silent in prod (`off`).
 *  - `slow` → only ops at/over APP_LOG_SLOW_MS (default 200ms) plus errors.
 *  - `all`  → every instrumented op.
 * Opt in on a prod box with `APP_LOG=all` (or `slow`) to trace a live issue.
 *
 * Self-contained on purpose: reads process.env directly and imports nothing,
 * so it is safe to use from the Edge proxy (proxy.ts) as well as the Node DAL,
 * and can't pull server-only config (env.ts) into the Edge bundle.
 *
 * Dev caveat this layer is built around: Next 16 in dev *replays* console
 * output captured inside a `"use cache"` body on every cache HIT (with a
 * reverse-video `Cache` badge), so a replayed line looks like a fresh
 * execution. Every line here carries a monotonic `#seq`; a repeated `#seq` is
 * a replay, a new one is a real execution. In prod there is no replay.
 */

export type LogCategory = "dal" | "action" | "warm" | "req" | "boot";
type Level = "off" | "slow" | "all";

const LEVEL: Level = ((): Level => {
  const raw = process.env.APP_LOG?.toLowerCase();
  if (raw === "off" || raw === "slow" || raw === "all") return raw;
  return process.env.NODE_ENV === "production" ? "off" : "all";
})();

/** Ops at/over this many ms are treated as slow: shown in `slow` mode, warned in `all`. */
const SLOW_MS = Number(process.env.APP_LOG_SLOW_MS) || 200;

const ON = LEVEL !== "off";

let seq = 0;

export function logLevel(): Level {
  return LEVEL;
}

export function slowThresholdMs(): number {
  return SLOW_MS;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function fields(f?: Record<string, unknown>): string {
  if (!f) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  }
  return parts.length ? " " + parts.join(" ") : "";
}

/**
 * Core sink. `ms === undefined` is an untimed event. `force` bypasses the
 * `slow`-level filter (errors and boundary markers we always want to see when
 * logging is on at all).
 */
function emit(
  cat: LogCategory,
  msg: string,
  ms: number | undefined,
  f: Record<string, unknown> | undefined,
  opts?: { warn?: boolean; force?: boolean },
): void {
  if (!ON) return;
  const slow = ms !== undefined && ms >= SLOW_MS;
  if (LEVEL === "slow" && !slow && !opts?.force && !opts?.warn) return;
  const n = ++seq;
  const dur = ms === undefined ? "" : ` (${Math.round(ms)}ms${slow ? " ⋯SLOW" : ""})`;
  const line = `[${cat}] #${n} ${msg}${fields(f)}${dur}`;
  if (opts?.warn || slow) console.warn(line);
  else console.log(line);
}

/** An untimed structured event, always shown when logging is on (`slow` too). */
export function logEvent(
  cat: LogCategory,
  msg: string,
  f?: Record<string, unknown>,
): void {
  emit(cat, msg, undefined, f, { force: true });
}

/**
 * A high-frequency breadcrumb (request markers, retries) — shown only at
 * `all`, suppressed in `slow` so it can't drown out the timed lines.
 */
export function logTrace(
  cat: LogCategory,
  msg: string,
  f?: Record<string, unknown>,
): void {
  emit(cat, msg, undefined, f);
}

/** Record an already-measured op (success path; never warns on its own). */
export function logDuration(
  cat: LogCategory,
  label: string,
  ms: number,
  f?: Record<string, unknown>,
): void {
  emit(cat, label, ms, f);
}

/** A failure, always surfaced when logging is on. */
export function logError(
  cat: LogCategory,
  msg: string,
  e: unknown,
  f?: Record<string, unknown>,
): void {
  emit(cat, `${msg}: ${errMsg(e)}`, undefined, f, { warn: true, force: true });
}

/**
 * Time an async op, emitting one line with its duration. `f` may be a function
 * of the result so callers can report e.g. row counts without threading state.
 * A throw is logged (with duration) and rethrown. Near-zero overhead when
 * logging is off — the fn is awaited directly with no timer.
 */
export async function time<T>(
  cat: LogCategory,
  label: string,
  fn: () => Promise<T>,
  f?: Record<string, unknown> | ((result: T) => Record<string, unknown>),
): Promise<T> {
  if (!ON) return fn();
  const t0 = performance.now();
  try {
    const result = await fn();
    emit(cat, label, performance.now() - t0, typeof f === "function" ? f(result) : f);
    return result;
  } catch (e) {
    emit(cat, `${label} FAILED: ${errMsg(e)}`, performance.now() - t0, undefined, {
      warn: true,
    });
    throw e;
  }
}
