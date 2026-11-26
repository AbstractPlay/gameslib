const CELL_RE = /^[a-z]+\d+$/i;

export function parseSetupPlace(m: string): string | undefined {
  const cell = m.toLowerCase().replace(/\s+/g, "");
  return CELL_RE.test(cell) ? cell : undefined;
}

export function parsePlayMove(m: string): { from: string; to: string } | undefined {
  const body = m.toLowerCase().replace(/\s+/g, "");
  if (!body.includes("-")) {
    return undefined;
  }
  const [from, to, extra] = body.split("-");
  if (from === undefined || to === undefined || extra !== undefined) {
    return undefined;
  }
  if (!CELL_RE.test(from) || !CELL_RE.test(to)) {
    return undefined;
  }
  return { from, to };
}