import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLine, findLineAt } from '../src/vot/subtitle-core.js';

test('short line stays whole', () => {
  const line = { text: 'Hello there', startMs: 1000, durationMs: 2000 };
  assert.deepEqual(splitLine(line, 80), [line]);
});

test('long line splits into chunks within the limit, covering the same time', () => {
  const text = 'word '.repeat(60).trim();
  const parts = splitLine({ text, startMs: 10000, durationMs: 30000 }, 80);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.text.length <= 80);
  assert.equal(parts.map((p) => p.text).join(' '), text);
  assert.equal(parts[0].startMs, 10000);
  for (let i = 1; i < parts.length; i++) {
    assert.ok(Math.abs(parts[i].startMs - (parts[i - 1].startMs + parts[i - 1].durationMs)) < 1e-6);
  }
  const last = parts[parts.length - 1];
  assert.ok(Math.abs(last.startMs + last.durationMs - 40000) < 1e-6);
});

test('findLineAt returns the active line or null in gaps', () => {
  const lines = [
    { text: 'a', startMs: 0, durationMs: 1000 },
    { text: 'b', startMs: 2000, durationMs: 1000 },
    { text: 'c', startMs: 3000, durationMs: 500 }
  ];
  assert.equal(findLineAt(lines, 500).text, 'a');
  assert.equal(findLineAt(lines, 1500), null);
  assert.equal(findLineAt(lines, 3000).text, 'c');
  assert.equal(findLineAt(lines, 5000), null);
  assert.equal(findLineAt([], 0), null);
});
