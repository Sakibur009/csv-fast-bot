import { readFileSync, writeFileSync } from 'node:fs';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const buf = readFileSync(INPUT_DIR + '/cases.json');
const len = buf.length;

const UNQ = new Uint8Array(256);
UNQ[44] = 1; // ,
UNQ[34] = 1; // "
UNQ[92] = 1; // \

const QUO = new Uint8Array(256);
QUO[34] = 1; // "
QUO[92] = 1; // \

let outCap = Math.max(len * 3 + 1048576, 2097152);
let out = Buffer.allocUnsafe(outCap);
let outPos = 0;

function growOut(need) {
  while (outPos + need > outCap) outCap *= 2;
  const next = Buffer.allocUnsafe(outCap);
  out.copy(next, 0, 0, outPos);
  out = next;
}

function writeAscii(s) {
  const n = s.length;
  if (outPos + n > outCap) growOut(n);
  for (let i = 0; i < n; i++) out[outPos++] = s.charCodeAt(i);
}

let exCap = 65536;
let exBuf = Buffer.allocUnsafe(exCap);

function growEx(exPos, need) {
  while (exPos + need > exCap) exCap *= 2;
  const next = Buffer.allocUnsafe(exCap);
  exBuf.copy(next, 0, 0, exPos);
  exBuf = next;
}

// Shared state only synced on cold paths (quoted fields / long rows)
let gPos = 0;
let gOp = 0;
let gLine = 1;
let gEp = 0;

function skipWs() {
  let p = gPos;
  while (p < len) {
    const c = buf[p];
    if (c === 32 || c === 9 || c === 10 || c === 13) p++;
    else break;
  }
  gPos = p;
}

function skipJsonString() {
  let p = gPos + 1;
  while (p < len) {
    const c = buf[p++];
    if (c === 34) { gPos = p; return; }
    if (c === 92) p++;
  }
  gPos = p;
}

function skipJsonValue() {
  skipWs();
  const c = buf[gPos];
  if (c === 34) {
    skipJsonString();
  } else if (c === 123) {
    gPos++;
    skipWs();
    if (buf[gPos] === 125) { gPos++; return; }
    while (gPos < len) {
      skipWs(); skipJsonString();
      skipWs(); gPos++;
      skipJsonValue();
      skipWs();
      if (buf[gPos] === 44) { gPos++; continue; }
      gPos++; break;
    }
  } else if (c === 91) {
    gPos++;
    skipWs();
    if (buf[gPos] === 93) { gPos++; return; }
    while (gPos < len) {
      skipJsonValue();
      skipWs();
      if (buf[gPos] === 44) { gPos++; continue; }
      gPos++; break;
    }
  } else {
    let p = gPos;
    while (p < len) {
      const ch = buf[p];
      if (ch === 44 || ch === 125 || ch === 93 || ch === 32 || ch === 9 || ch === 10 || ch === 13) break;
      p++;
    }
    gPos = p;
  }
}

function matchKey(key) {
  const klen = key.length;
  const p = gPos;
  if (buf[p] !== 34 || p + klen + 1 >= len || buf[p + klen + 1] !== 34) return false;
  for (let i = 0; i < klen; i++) {
    if (buf[p + 1 + i] !== key.charCodeAt(i)) return false;
  }
  gPos = p + klen + 2;
  return true;
}

function readUnquotedCold(errs, recordLine, recordRow) {
  const b = buf;
  const o = out;
  const unq = UNQ;
  let p = gPos;
  let op = gOp;
  let line = gLine;
  let ended = 2;
  while (true) {
    let c;
    while (unq[c = b[p]] === 0) {
      o[op++] = c;
      p++;
    }
    if (c === 44) { p++; ended = 0; break; }
    if (c === 34) { ended = 2; break; }
    const next = b[p + 1];
    if (next === 110) { p += 2; line++; ended = 1; break; }
    if (next === 114) {
      if (b[p + 2] === 92 && b[p + 3] === 110) { p += 4; line++; ended = 1; break; }
      errs.push(0, recordLine, recordRow, 0, null);
      p += 2;
      continue;
    }
    o[op++] = 92;
    o[op++] = next;
    p += 2;
  }
  gPos = p;
  gOp = op;
  gLine = line;
  return ended;
}

function readQuotedCold(errs, recordLine, recordRow) {
  const b = buf;
  const o = out;
  const quo = QUO;
  let p = gPos;
  let op = gOp;
  let line = gLine;
  const open = p;
  const openLine = line;
  const openOp = op;
  p += 2; // skip \"
  let closed = false;
  while (true) {
    let c;
    while (quo[c = b[p]] === 0) {
      o[op++] = c;
      p++;
    }
    if (c === 34) break;
    const next = b[p + 1];
    if (next === 34) {
      if (b[p + 2] === 92 && b[p + 3] === 34) {
        o[op++] = 92;
        o[op++] = 34;
        p += 4;
        continue;
      }
      p += 2;
      closed = true;
      break;
    }
    if (next === 114) {
      o[op++] = 92;
      o[op++] = 110;
      line++;
      p += (b[p + 2] === 92 && b[p + 3] === 110) ? 4 : 2;
      continue;
    }
    if (next === 110) {
      o[op++] = 92;
      o[op++] = 110;
      line++;
      p += 2;
      continue;
    }
    o[op++] = 92;
    o[op++] = next;
    p += 2;
  }
  if (!closed) {
    op = openOp;
    o[op++] = 92;
    o[op++] = 34;
    gPos = open + 2;
    gOp = op;
    gLine = openLine;
    errs.push(2, recordLine, recordRow, 0, null);
    return readUnquotedCold(errs, recordLine, recordRow);
  }
  const c = b[p];
  if (c === 34) { gPos = p; gOp = op; gLine = line; return 2; }
  if (c === 44) { gPos = p + 1; gOp = op; gLine = line; return 0; }
  if (c === 92) {
    const next = b[p + 1];
    if (next === 110) { gPos = p + 2; gOp = op; gLine = line + 1; return 1; }
    if (next === 114 && b[p + 2] === 92 && b[p + 3] === 110) { gPos = p + 4; gOp = op; gLine = line + 1; return 1; }
  }
  const beforeJunk = op;
  gPos = p;
  gOp = op;
  gLine = line;
  const ended = readUnquotedCold(errs, recordLine, recordRow);
  if (gOp > beforeJunk) errs.push(1, recordLine, recordRow, 0, null);
  return ended;
}

function readUnquotedEx(errs, recordLine, recordRow) {
  if (gEp + (len - gPos) + 16 > exCap) growEx(gEp, (len - gPos) + 16);
  const b = buf;
  const eb = exBuf;
  const unq = UNQ;
  let p = gPos;
  let ep = gEp;
  let line = gLine;
  let ended = 2;
  while (true) {
    let c;
    while (unq[c = b[p]] === 0) {
      eb[ep++] = c;
      p++;
    }
    if (c === 44) { p++; ended = 0; break; }
    if (c === 34) { ended = 2; break; }
    const next = b[p + 1];
    if (next === 110) { p += 2; line++; ended = 1; break; }
    if (next === 114) {
      if (b[p + 2] === 92 && b[p + 3] === 110) { p += 4; line++; ended = 1; break; }
      errs.push(0, recordLine, recordRow, 0, null);
      p += 2;
      continue;
    }
    eb[ep++] = 92;
    eb[ep++] = next;
    p += 2;
  }
  gPos = p;
  gEp = ep;
  gLine = line;
  return ended;
}

function readQuotedEx(errs, recordLine, recordRow) {
  if (gEp + (len - gPos) + 16 > exCap) growEx(gEp, (len - gPos) + 16);
  const b = buf;
  const eb = exBuf;
  const quo = QUO;
  let p = gPos;
  let ep = gEp;
  let line = gLine;
  const open = p;
  const openLine = line;
  const openEp = ep;
  p += 2;
  let closed = false;
  while (true) {
    let c;
    while (quo[c = b[p]] === 0) {
      eb[ep++] = c;
      p++;
    }
    if (c === 34) break;
    const next = b[p + 1];
    if (next === 34) {
      if (b[p + 2] === 92 && b[p + 3] === 34) {
        eb[ep++] = 92; eb[ep++] = 34; p += 4; continue;
      }
      p += 2; closed = true; break;
    }
    if (next === 114) {
      eb[ep++] = 92; eb[ep++] = 110; line++;
      p += (b[p + 2] === 92 && b[p + 3] === 110) ? 4 : 2;
      continue;
    }
    if (next === 110) {
      eb[ep++] = 92; eb[ep++] = 110; line++; p += 2; continue;
    }
    eb[ep++] = 92; eb[ep++] = next; p += 2;
  }
  if (!closed) {
    ep = openEp;
    eb[ep++] = 92; eb[ep++] = 34;
    gPos = open + 2; gEp = ep; gLine = openLine;
    errs.push(2, recordLine, recordRow, 0, null);
    return readUnquotedEx(errs, recordLine, recordRow);
  }
  const c = b[p];
  if (c === 34) { gPos = p; gEp = ep; gLine = line; return 2; }
  if (c === 44) { gPos = p + 1; gEp = ep; gLine = line; return 0; }
  if (c === 92) {
    const next = b[p + 1];
    if (next === 110) { gPos = p + 2; gEp = ep; gLine = line + 1; return 1; }
    if (next === 114 && b[p + 2] === 92 && b[p + 3] === 110) { gPos = p + 4; gEp = ep; gLine = line + 1; return 1; }
  }
  const beforeJunk = ep;
  gPos = p; gEp = ep; gLine = line;
  const ended = readUnquotedEx(errs, recordLine, recordRow);
  if (gEp > beforeJunk) errs.push(1, recordLine, recordRow, 0, null);
  return ended;
}

function parseCsvFromJsonString() {
  const b = buf;
  const unq = UNQ;
  let p = gPos + 1;
  let o = out;
  let op = outPos;

  const caseStart = op;
  const hdr = '{"columns":null,"rows":[';
  for (let i = 0; i < 24; i++) o[op++] = hdr.charCodeAt(i);
  const firstRecStart = op;
  let firstRecEnd = op;

  if (p + 2 < len && b[p] === 0xef && b[p + 1] === 0xbb && b[p + 2] === 0xbf) {
    p += 3;
  } else if (
    p + 5 < len &&
    b[p] === 92 && b[p + 1] === 117 &&
    (b[p + 2] | 32) === 102 && (b[p + 3] | 32) === 101 &&
    (b[p + 4] | 32) === 102 && (b[p + 5] | 32) === 102
  ) {
    p += 6;
  }

  let line = 1;
  let width = -1;
  let rowCount = 0;
  const errs = [];

  while (true) {
    while (b[p] === 92) {
      const next = b[p + 1];
      if (next === 110) { p += 2; line++; }
      else if (next === 114 && b[p + 2] === 92 && b[p + 3] === 110) { p += 4; line++; }
      else break;
    }
    if (b[p] === 34) break;

    const recordLine = line;
    const recordRow = rowCount;
    const recOutStart = op;
    if (rowCount > 0) o[op++] = 44; // ,
    o[op++] = 91; // [

    let fieldCount = 0;
    let ended = 0;
    let firstQuoted = false;
    let firstFieldStart = 0;
    const maxFields = width < 0 ? 0x7fffffff : width;

    do {
      if (fieldCount > 0) o[op++] = 44;
      o[op++] = 34;
      const fStart = op;
      if (b[p] === 92 && b[p + 1] === 34) {
        if (fieldCount === 0) { firstQuoted = true; firstFieldStart = fStart; }
        gPos = p; gOp = op; gLine = line;
        ended = readQuotedCold(errs, recordLine, recordRow);
        p = gPos; op = gOp; line = gLine;
      } else {
        if (fieldCount === 0) { firstQuoted = false; firstFieldStart = fStart; }
        while (true) {
          let c;
          while (unq[c = b[p]] === 0) {
            o[op++] = c;
            p++;
          }
          if (c === 44) { p++; ended = 0; break; }
          if (c === 34) { ended = 2; break; }
          const next = b[p + 1];
          if (next === 110) { p += 2; line++; ended = 1; break; }
          if (next === 114) {
            if (b[p + 2] === 92 && b[p + 3] === 110) { p += 4; line++; ended = 1; break; }
            errs.push(0, recordLine, recordRow, 0, null);
            p += 2;
            continue;
          }
          o[op++] = 92;
          o[op++] = next;
          p += 2;
        }
      }
      o[op++] = 34;
      fieldCount++;
    } while (ended === 0 && fieldCount < maxFields);

    if (fieldCount === 1 && ended !== 0 && !firstQuoted && op - 1 === firstFieldStart) {
      op = recOutStart;
      continue;
    }

    if (width < 0) {
      o[op++] = 93;
      width = fieldCount;
      firstRecEnd = op;
      rowCount = 1;
    } else if (fieldCount < width) {
      errs.push(3, recordLine, recordRow, fieldCount, null);
      const pad = width - fieldCount;
      if (op + pad * 3 + 16 > outCap) { outPos = op; growOut(pad * 3 + 16); o = out; }
      for (let k = 0; k < pad; k++) {
        o[op++] = 44;
        o[op++] = 34;
        o[op++] = 34;
      }
      o[op++] = 93;
      rowCount++;
    } else if (ended === 0) {
      o[op++] = 93;
      gPos = p; gLine = line; gEp = 0;
      let exCount = 0;
      do {
        if (gEp + 16 > exCap) growEx(gEp, 16);
        if (exCount > 0) exBuf[gEp++] = 44;
        exBuf[gEp++] = 34;
        if (b[gPos] === 92 && b[gPos + 1] === 34) {
          ended = readQuotedEx(errs, recordLine, recordRow);
        } else {
          ended = readUnquotedEx(errs, recordLine, recordRow);
        }
        if (gEp + 4 > exCap) growEx(gEp, 4);
        exBuf[gEp++] = 34;
        exCount++;
      } while (ended === 0);
      p = gPos; line = gLine;
      errs.push(4, recordLine, recordRow, 0, Buffer.from(exBuf.subarray(0, gEp)));
      rowCount++;
    } else {
      o[op++] = 93;
      rowCount++;
    }
  }

  gPos = p + 1;
  outPos = op;
  return { errs, rowCount, caseStart, firstRecStart, firstRecEnd };
}

function finalizeCase(res, header) {
  const { errs, rowCount, caseStart, firstRecStart, firstRecEnd } = res;
  if (header) {
    const firstLen = firstRecEnd - firstRecStart;
    if (rowCount === 0) {
      outPos = caseStart;
      writeAscii('{"columns":[],"rows":[');
    } else if (rowCount === 1) {
      out.copyWithin(caseStart + 11, firstRecStart, firstRecEnd);
      const p1 = '{"columns":';
      for (let i = 0; i < 11; i++) out[caseStart + i] = p1.charCodeAt(i);
      outPos = caseStart + 11 + firstLen;
      writeAscii(',"rows":[');
    } else {
      out.copyWithin(caseStart + 16, firstRecStart, firstRecEnd);
      const p1 = '     {"columns":';
      for (let i = 0; i < 16; i++) out[caseStart + i] = p1.charCodeAt(i);
      const p2 = ',"rows":[';
      const p2Pos = caseStart + 16 + firstLen;
      for (let i = 0; i < 9; i++) out[p2Pos + i] = p2.charCodeAt(i);
    }
  }

  writeAscii('],"errors":[');
  for (let i = 0; i < errs.length; i += 5) {
    if (i > 0) writeAscii(',');
    const t = errs[i];
    const eLine = errs[i + 1];
    const eRow = errs[i + 2];
    const rowStr = header ? (eRow === 0 ? 'null' : String(eRow - 1)) : String(eRow);
    if (t === 0) {
      writeAscii('{"code":"stray_cr","line":' + eLine + ',"row":' + rowStr + '}');
    } else if (t === 1) {
      writeAscii('{"code":"quote_junk","line":' + eLine + ',"row":' + rowStr + '}');
    } else if (t === 2) {
      writeAscii('{"code":"unterminated_quote","line":' + eLine + ',"row":' + rowStr + '}');
    } else if (t === 3) {
      writeAscii('{"code":"short_row","line":' + eLine + ',"row":' + rowStr + ',"fields":' + errs[i + 3] + '}');
    } else {
      writeAscii('{"code":"long_row","line":' + eLine + ',"row":' + rowStr + ',"extra":[');
      const exBytes = errs[i + 4];
      if (outPos + exBytes.length + 2 > outCap) growOut(exBytes.length + 2);
      exBytes.copy(out, outPos);
      outPos += exBytes.length;
      out[outPos++] = 93;
      out[outPos++] = 125;
    }
  }
  writeAscii(']}');
}

out[outPos++] = 91; // [
skipWs();
gPos++; // [
skipWs();

let caseIdx = 0;
while (gPos < len && buf[gPos] !== 93) {
  if (caseIdx > 0) {
    if (outPos + 1 > outCap) growOut(1);
    out[outPos++] = 44;
  }
  skipWs();
  gPos++; // {
  while (gPos < len) {
    skipWs();
    if (buf[gPos] === 125) { gPos++; break; }
    if (matchKey('input')) {
      skipWs(); gPos++;
      skipWs(); gPos++;
      let header = false;
      let res = null;
      while (gPos < len) {
        skipWs();
        if (buf[gPos] === 125) { gPos++; break; }
        if (matchKey('text')) {
          skipWs(); gPos++;
          skipWs();
          res = parseCsvFromJsonString();
        } else if (matchKey('header')) {
          skipWs(); gPos++;
          skipWs();
          header = buf[gPos] === 116;
          skipJsonValue();
        } else {
          skipJsonString();
          skipWs(); gPos++;
          skipJsonValue();
        }
        skipWs();
        if (buf[gPos] === 44) gPos++;
      }
      if (res) finalizeCase(res, header);
    } else {
      skipJsonString();
      skipWs(); gPos++;
      skipJsonValue();
    }
    skipWs();
    if (buf[gPos] === 44) gPos++;
  }
  caseIdx++;
  skipWs();
  if (buf[gPos] === 44) gPos++;
  skipWs();
}

if (outPos + 1 > outCap) growOut(1);
out[outPos++] = 93;

writeFileSync(OUTPUT_DIR + '/answers.json', out.subarray(0, outPos));