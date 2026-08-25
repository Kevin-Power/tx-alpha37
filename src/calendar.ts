const DOW = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function weekdayUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekdayLabel(iso: string): string {
  return `週${DOW[weekdayUtc(iso)]}`;
}

/** 台指期月結算：每月第三個星期三（遇假日實務上順延，這裡用日曆第三週三）。 */
export function thirdWednesday(year: number, month: number): string {
  const dow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const firstWed = 1 + ((3 - dow + 7) % 7);
  const day = firstWed + 14;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isSettlement(iso: string): boolean {
  const [y, m] = iso.split("-").map(Number);
  return iso === thirdWednesday(y, m);
}

export function nextSettlement(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const thisMonth = thirdWednesday(y, m);
  if (iso < thisMonth) return thisMonth;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return thirdWednesday(ny, nm);
}

export function prevSettlement(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const thisMonth = thirdWednesday(y, m);
  if (iso >= thisMonth) return thisMonth;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return thirdWednesday(py, pm);
}

/** 距離下次月結算的日曆天。結算當天為 0。 */
export function daysToSettlement(iso: string): number {
  if (isSettlement(iso)) return 0;
  const next = nextSettlement(iso);
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${next}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5] as const;

export const OOS_SPLIT = "2025-08-25";
