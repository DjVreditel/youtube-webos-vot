export function splitLine(line, maxChars) {
  if (line.text.length <= maxChars) return [line];
  const chunks = [];
  let current = '';
  for (const word of line.text.split(/\s+/)) {
    if (current && current.length + 1 + word.length > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) chunks.push(current);
  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0);
  let startMs = line.startMs;
  return chunks.map((text) => {
    const durationMs = (line.durationMs * text.length) / totalChars;
    const part = { text, startMs, durationMs };
    startMs += durationMs;
    return part;
  });
}

export function findLineAt(lines, timeMs) {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid];
    if (timeMs < line.startMs) hi = mid - 1;
    else if (timeMs >= line.startMs + line.durationMs) lo = mid + 1;
    else return line;
  }
  return null;
}
