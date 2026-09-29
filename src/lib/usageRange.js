// Ronde-35 — validasi rentang hari kustom untuk page usage.
// Dipakai bersama oleh /api/usage/stats dan /api/usage/chart supaya aturan
// (format, urutan, panjang maksimal) tidak duplikatif di dua route.

export const MAX_CUSTOM_RANGE_DAYS = 731;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {URLSearchParams} searchParams
 * @returns {{period: string, ok: true, from: ?string, to: ?string, days: number}
 *          |{period: string, ok: false, error: string}}
 */
export function parseCustomRange(searchParams) {
  const period = searchParams.get("period") || "7d";
  if (period !== "custom") {
    return { period, ok: true, from: null, to: null, days: 0 };
  }

  const from = (searchParams.get("from") || "").trim();
  const to = (searchParams.get("to") || "").trim();

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return { period, ok: false, error: "custom period needs from & to as YYYY-MM-DD" };
  }

  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return { period, ok: false, error: "from / to is not a real date" };
  }

  // Ronde-36: Date() ME-ROLL tanggal tak valid (2026-02-30 → 2026-03-02,
  // 2026-13-01 → bulan depan) sehingga lolos cek isNaN di atas. Cocokkan
  // ulang komponen lokal-nya supaya tanggal bodong tidak diterima diam-diam.
  const localIso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (localIso(a) !== from || localIso(b) !== to) {
    return { period, ok: false, error: "from / to is not a real date" };
  }

  if (from > to) {
    return { period, ok: false, error: "from must not be after to" };
  }

  const days = Math.round((b - a) / 86400000) + 1;
  if (days > MAX_CUSTOM_RANGE_DAYS) {
    return { period, ok: false, error: `range too large (max ${MAX_CUSTOM_RANGE_DAYS} days)` };
  }
  return { period, ok: true, from, to, days };
}
