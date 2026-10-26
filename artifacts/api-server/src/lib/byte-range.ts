/**
 * One byte range from a `Range` header — phase 3. Phones play a video only when
 * the server answers `Range` with 206 (Safari will not play it otherwise), and
 * every browser needs it to skip ahead. One range only: a multi-range header is
 * answered with the whole file, as RFC 9110 allows.
 */
export type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

export function parseByteRange(header: string | undefined, size: number): ByteRange {
  if (!header || !Number.isFinite(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return null;
  if (from === "") {
    // The last N bytes.
    const suffix = Number(to);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return "unsatisfiable";
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (end < start) return null;
  return { start, end };
}
