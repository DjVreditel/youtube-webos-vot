function readVarint(buf, pos) {
  let result = 0;
  let scale = 1;
  let byte;
  do {
    byte = buf[pos.i++];
    result += (byte & 0x7f) * scale;
    scale *= 128;
  } while (byte & 0x80);
  return result;
}

function writeVarint(out, value) {
  let v = value;
  while (v > 0x7f) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

export function parseFields(buf) {
  const pos = { i: 0 };
  const fields = [];
  while (pos.i < buf.length) {
    const tag = readVarint(buf, pos);
    const num = Math.floor(tag / 8);
    const wire = tag % 8;
    if (wire === 0) fields.push({ num, wire, value: readVarint(buf, pos) });
    else if (wire === 2) {
      const len = readVarint(buf, pos);
      fields.push({ num, wire, value: buf.subarray(pos.i, pos.i + len) });
      pos.i += len;
    } else if (wire === 1 || wire === 5) {
      const len = wire === 1 ? 8 : 4;
      fields.push({ num, wire, value: buf.subarray(pos.i, pos.i + len) });
      pos.i += len;
    } else {
      throw new Error(`SABR: unsupported wire type ${wire}`);
    }
  }
  return fields;
}

export function encodeFields(fields) {
  const out = [];
  for (const f of fields) {
    writeVarint(out, f.num * 8 + f.wire);
    if (f.wire === 0) writeVarint(out, f.value);
    else {
      const bytes = f.value;
      if (f.wire === 2) writeVarint(out, bytes.length);
      for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
    }
  }
  return new Uint8Array(out);
}

function umpVarint(buf, pos) {
  const first = buf[pos.i];
  const size = first < 128 ? 1 : first < 192 ? 2 : first < 224 ? 3 : first < 240 ? 4 : 5;
  let value;
  if (size === 1) value = first;
  else if (size === 2) value = (first & 0x3f) + buf[pos.i + 1] * 64;
  else if (size === 3) value = (first & 0x1f) + (buf[pos.i + 1] + buf[pos.i + 2] * 256) * 32;
  else if (size === 4)
    value = (first & 0x0f) + (buf[pos.i + 1] + buf[pos.i + 2] * 256 + buf[pos.i + 3] * 65536) * 16;
  else
    value =
      buf[pos.i + 1] + buf[pos.i + 2] * 256 + buf[pos.i + 3] * 65536 + buf[pos.i + 4] * 16777216;
  pos.i += size;
  return value;
}

export function parseUmp(buf) {
  const pos = { i: 0 };
  const parts = [];
  while (pos.i < buf.length) {
    const type = umpVarint(buf, pos);
    const size = umpVarint(buf, pos);
    parts.push({ type, data: buf.subarray(pos.i, pos.i + size) });
    pos.i += size;
  }
  return parts;
}
