// wC3ReplayParser/domain/manual/debug.ts
//
// Centralized debug + perf helpers for client-side replay diagnostics.

export const ENABLE_CLIENT_DIAGNOSTICS = true;

// Flip to false to silence console spam
export const ENABLE_REPLAY_DEBUG_LOGGING = true;

export const DEBUG_BLOCK_EVERY = 25;
export const YIELD_EVERY_BLOCKS = 25;

// Increase if you want more headroom on slow devices
export const DECOMPRESS_TIMEOUT_MS = 30_000;

export const log = (...a: any[]) => ENABLE_REPLAY_DEBUG_LOGGING && console.log("[replay-diagnostics]", ...a);
export const warn = (...a: any[]) => ENABLE_REPLAY_DEBUG_LOGGING && console.warn("[replay-diagnostics]", ...a);

// Aliases used by some modules
export const dlog = log;
export const dwarn = warn;

export const time = (label: string) => ENABLE_REPLAY_DEBUG_LOGGING && console.time(`[replay-diagnostics] ${label}`);
export const timeEnd = (label: string) => ENABLE_REPLAY_DEBUG_LOGGING && console.timeEnd(`[replay-diagnostics] ${label}`);

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}
