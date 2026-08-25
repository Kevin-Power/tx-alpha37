const tw = new Intl.NumberFormat("zh-TW");
const tw0 = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 });
const tw1 = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const tw2 = new Intl.NumberFormat("zh-TW", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function n0(v: number): string {
  return tw0.format(Math.round(v));
}

export function n1(v: number): string {
  return tw1.format(v);
}

export function n2(v: number): string {
  return tw2.format(v);
}

export function nInt(v: number): string {
  return tw.format(Math.round(v));
}

export function twd(v: number, signed = false): string {
  const abs = n0(Math.abs(v));
  if (signed) {
    if (v > 0) return `+${abs}`;
    if (v < 0) return `−${abs}`;
  }
  return v < 0 ? `−${abs}` : abs;
}

export function pct(v: number, digits = 1, signed = true): string {
  const x = v * 100;
  const body = digits === 0 ? n0(Math.abs(x)) : n1(Math.abs(x));
  if (!signed) return `${v < 0 ? "−" : ""}${body}%`;
  if (x > 0) return `+${body}%`;
  if (x < 0) return `−${body}%`;
  return `${body}%`;
}

export function pts(v: number, signed = true): string {
  const body = n0(Math.abs(v));
  if (!signed) return body;
  if (v > 0) return `+${body}`;
  if (v < 0) return `−${body}`;
  return body;
}

export function signedClass(v: number): string {
  if (v > 0) return "text-up";
  if (v < 0) return "text-down";
  return "text-muted";
}

/** 台灣慣例：上漲紅、下跌綠。 */
export function mktClass(change: number): string {
  if (change > 0) return "text-up";
  if (change < 0) return "text-down";
  return "text-muted";
}

export function compactTwd(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 100_000_000) return `${sign}${n1(a / 100_000_000)} 億`;
  if (a >= 10_000) return `${sign}${n1(a / 10_000)} 萬`;
  return `${sign}${n0(a)}`;
}
