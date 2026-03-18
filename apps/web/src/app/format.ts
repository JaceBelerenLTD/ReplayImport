export function fmtDuration(sec?: number | null) {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtDate(ts: number) {
  return new Date(ts).toLocaleString();
}
