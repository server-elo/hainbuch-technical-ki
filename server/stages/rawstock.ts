// Raw-stock guard: the LLM proposes, the code decides. Raw material must
// always be LARGER than the finished part (machining allowance).

const STANDARD_BAR_D = [
  8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 42, 45, 50, 55,
  60, 63, 65, 70, 75, 80, 85, 90, 95, 100, 110, 115, 120, 130, 140, 150, 160, 180, 200,
];

export function normalizeRawStock(
  form: string,
  finished: number[] | undefined,
  proposed: string
): string {
  if (!finished || finished.length === 0 || finished.some((v) => !Number.isFinite(v) || v <= 0)) {
    return proposed;
  }
  const up5 = (v: number) => Math.ceil((v + 4) / 5) * 5;
  if (form === "Rundstange" || form === "Rohr" || form === "Sechskant") {
    const [d, l] = finished;
    const rawD = STANDARD_BAR_D.find((s) => s >= d + 3) ?? Math.ceil(d + 5);
    const rawL = l ? Math.ceil(l + 6) : undefined;
    return rawL ? `Ø${rawD} x ${rawL} mm` : `Ø${rawD} mm`;
  }
  // Block / Platte / Flachmaterial: +4 mm allowance per axis, rounded to 5 mm
  return finished.map(up5).join(" x ") + " mm";
}
