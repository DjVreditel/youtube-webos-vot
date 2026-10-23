import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFields, encodeFields, parseUmp } from '../src/vot/sabr-core.js';

test('protobuf fields survive an encode/parse round trip', () => {
  const nested = encodeFields([{ num: 1, wire: 0, value: 140 }]);
  const fields = [
    { num: 1, wire: 2, value: nested },
    { num: 2, wire: 0, value: 1712653867474717 },
    { num: 28, wire: 0, value: 76266 },
    { num: 40, wire: 0, value: 1 },
    { num: 5, wire: 2, value: new Uint8Array([1, 2, 3, 250]) }
  ];
  const parsed = parseFields(encodeFields(fields));
  assert.equal(parsed.length, fields.length);
  assert.equal(parsed[1].value, 1712653867474717);
  assert.equal(parsed[2].value, 76266);
  assert.deepEqual(Array.from(parsed[4].value), [1, 2, 3, 250]);
  assert.equal(parseFields(parsed[0].value)[0].value, 140);
});

test('fixed-width fields are kept as raw bytes', () => {
  const buf = new Uint8Array([0x09, 1, 2, 3, 4, 5, 6, 7, 8, 0x15, 9, 9, 9, 9]);
  const parsed = parseFields(buf);
  assert.equal(parsed[0].num, 1);
  assert.equal(parsed[0].value.length, 8);
  assert.equal(parsed[1].num, 2);
  assert.equal(parsed[1].value.length, 4);
  assert.deepEqual(Array.from(encodeFields(parsed)), Array.from(buf));
});

test('UMP parts with one- and two-byte sizes', () => {
  const payload = new Uint8Array(200).fill(7);
  const buf = new Uint8Array([20, 3, 0xa, 0xb, 0xc, 21, 0x88, 3, ...payload, 22, 1, 5]);
  const parts = parseUmp(buf);
  assert.deepEqual(parts.map((p) => p.type), [20, 21, 22]);
  assert.deepEqual(Array.from(parts[0].data), [0xa, 0xb, 0xc]);
  assert.equal(parts[1].data.length, 200);
  assert.deepEqual(Array.from(parts[2].data), [5]);
});
