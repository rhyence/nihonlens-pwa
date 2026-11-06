type Region = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
type Line = Region & { words: Region[] };

// Keep true line boxes for vertical stacks. Split horizontal price rows using
// OCR word geometry, not text-length estimates (Japanese glyphs vary in width).
export function priceRows(lines: Line[]): Region[] {
  return lines.flatMap(line => {
    if (line.words.filter(word => /\d/.test(word.text)).length < 2) return [line];
    return line.words.flatMap((word, index) => {
      if (!/\d/.test(word.text)) return [];
      const next = line.words[index + 1];
      const previous = line.words[index - 1];
      const suffix = next && /^[円ロ口囗]$/.test(next.text.trim()) ? next : undefined;
      const prefix = previous && /^[¥￥]$/.test(previous.text.trim()) ? previous : undefined;
      return [{ ...word, text: (prefix?.text ?? '') + word.text + (suffix?.text ?? ''), bbox: {
        x0: prefix?.bbox.x0 ?? word.bbox.x0, y0: Math.min(word.bbox.y0, suffix?.bbox.y0 ?? word.bbox.y0),
        x1: suffix?.bbox.x1 ?? word.bbox.x1, y1: Math.max(word.bbox.y1, suffix?.bbox.y1 ?? word.bbox.y1),
      } }];
    });
  });
}
