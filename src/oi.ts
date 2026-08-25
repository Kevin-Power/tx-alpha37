import type { Side } from "./types";

export type OiBar = {
  d: string;
  foreign: number;
  sitc: number;
  dealer: number;
};

/**
 * 聚財網／期交所口徑：外資、投信、自營商台指期淨未平倉（口）。
 * 2026-06-12 至 2026-08-24。存量是避險帳，策略只用「昨日流量」。
 */
export const OI: OiBar[] = [
  { d: "2026-06-12", foreign: -65039, sitc: 57111, dealer: 3568 },
  { d: "2026-06-15", foreign: -66734, sitc: 57702, dealer: 2618 },
  { d: "2026-06-16", foreign: -69847, sitc: 56894, dealer: 2219 },
  { d: "2026-06-17", foreign: -67394, sitc: 57083, dealer: 72 },
  { d: "2026-06-18", foreign: -68337, sitc: 58597, dealer: 63 },
  { d: "2026-06-22", foreign: -70290, sitc: 61196, dealer: -563 },
  { d: "2026-06-23", foreign: -76502, sitc: 60180, dealer: 930 },
  { d: "2026-06-24", foreign: -83605, sitc: 60757, dealer: 3277 },
  { d: "2026-06-25", foreign: -81051, sitc: 60921, dealer: 3003 },
  { d: "2026-06-26", foreign: -76391, sitc: 61247, dealer: 4641 },
  { d: "2026-06-29", foreign: -76627, sitc: 62962, dealer: 2415 },
  { d: "2026-06-30", foreign: -83063, sitc: 66623, dealer: 1571 },
  { d: "2026-07-01", foreign: -84168, sitc: 67194, dealer: 1592 },
  { d: "2026-07-02", foreign: -84487, sitc: 66410, dealer: 3683 },
  { d: "2026-07-03", foreign: -81052, sitc: 67213, dealer: 3071 },
  { d: "2026-07-06", foreign: -80087, sitc: 67254, dealer: 2670 },
  { d: "2026-07-07", foreign: -80042, sitc: 68187, dealer: 3793 },
  { d: "2026-07-08", foreign: -81268, sitc: 69987, dealer: 3311 },
  { d: "2026-07-09", foreign: -80730, sitc: 71689, dealer: 2243 },
  { d: "2026-07-13", foreign: -81066, sitc: 71794, dealer: 1270 },
  { d: "2026-07-14", foreign: -83390, sitc: 73873, dealer: 2352 },
  { d: "2026-07-15", foreign: -79557, sitc: 75646, dealer: -664 },
  { d: "2026-07-16", foreign: -84453, sitc: 76264, dealer: 657 },
  { d: "2026-07-17", foreign: -86189, sitc: 75215, dealer: 4666 },
  { d: "2026-07-20", foreign: -78337, sitc: 72446, dealer: 2974 },
  { d: "2026-07-21", foreign: -78490, sitc: 75570, dealer: 1203 },
  { d: "2026-07-22", foreign: -76595, sitc: 75623, dealer: 1139 },
  { d: "2026-07-23", foreign: -75198, sitc: 75492, dealer: 739 },
  { d: "2026-07-24", foreign: -76260, sitc: 73838, dealer: 2258 },
  { d: "2026-07-27", foreign: -78699, sitc: 74111, dealer: 1891 },
  { d: "2026-07-28", foreign: -82255, sitc: 74886, dealer: 2588 },
  { d: "2026-07-29", foreign: -82785, sitc: 74742, dealer: 2552 },
  { d: "2026-07-30", foreign: -81017, sitc: 75857, dealer: 1996 },
  { d: "2026-07-31", foreign: -82515, sitc: 85325, dealer: -2377 },
  { d: "2026-08-03", foreign: -90038, sitc: 83900, dealer: 718 },
  { d: "2026-08-04", foreign: -87858, sitc: 82548, dealer: 2356 },
  { d: "2026-08-05", foreign: -87199, sitc: 84575, dealer: 1311 },
  { d: "2026-08-06", foreign: -89383, sitc: 84163, dealer: 2602 },
  { d: "2026-08-07", foreign: -87911, sitc: 83077, dealer: 2512 },
  { d: "2026-08-10", foreign: -89201, sitc: 83751, dealer: 1679 },
  { d: "2026-08-11", foreign: -88924, sitc: 83418, dealer: 1899 },
  { d: "2026-08-12", foreign: -86633, sitc: 82383, dealer: 1239 },
  { d: "2026-08-13", foreign: -86249, sitc: 82327, dealer: 472 },
  { d: "2026-08-14", foreign: -85179, sitc: 80335, dealer: 1464 },
  { d: "2026-08-17", foreign: -83474, sitc: 78013, dealer: 1021 },
  { d: "2026-08-18", foreign: -83078, sitc: 76112, dealer: 2566 },
  { d: "2026-08-19", foreign: -81501, sitc: 74789, dealer: 2562 },
  { d: "2026-08-20", foreign: -82423, sitc: 75825, dealer: 2019 },
  { d: "2026-08-21", foreign: -82594, sitc: 76316, dealer: 1699 },
  { d: "2026-08-24", foreign: -82529, sitc: 75808, dealer: 2315 },
];

const byDate = new Map(OI.map((r) => [r.d, r]));

export function oiOnOrBefore(iso: string): OiBar | null {
  let hit: OiBar | null = null;
  for (const row of OI) {
    if (row.d <= iso) hit = row;
    else break;
  }
  return hit;
}

export function oiDeltaEnding(iso: string): {
  last: OiBar;
  prev: OiBar | null;
  delta: number | null;
} | null {
  const last = oiOnOrBefore(iso);
  if (!last) return null;
  const idx = OI.findIndex((r) => r.d === last.d);
  const prev = idx > 0 ? OI[idx - 1] : null;
  return {
    last,
    prev,
    delta: prev ? last.foreign - prev.foreign : null,
  };
}

/** 用「上一筆已公布的外資流量」過濾當日方向。盤中看的是昨收資料。 */
export function foreignBias(tradeDate: string): {
  last: OiBar | null;
  delta: number | null;
  bias: Side | null;
} {
  const snap = oiDeltaEnding(tradeDate);
  if (!snap) return { last: null, delta: null, bias: null };
  // 今日尚未收盤時，last 可能就是昨天；流量仍用 last-prev。
  const { delta } = snap;
  let bias: Side | null = null;
  if (delta != null && delta >= 3000) bias = "long";
  if (delta != null && delta <= -3000) bias = "short";
  return { last: snap.last, delta, bias };
}

export function latestOi(): OiBar {
  return OI[OI.length - 1];
}

export { byDate };
