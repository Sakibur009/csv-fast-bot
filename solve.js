// solve.js
export function run(input) {
  const text = input.text;
  const hasHeader = input.header;
  const len = text.length;

  let i = 0;
  // Drop leading U+FEFF (BOM)
  if (len > 0 && text.charCodeAt(0) === 0xfeff) {
    i = 1;
  }

  let columns = null;
  const rows = [];
  const errors = [];

  let line = 1;
  let width = -1;
  let isFirstRecord = true;

  while (i < len) {
    // Skip empty lines (LF or CRLF with no characters)
    const ch0 = text.charCodeAt(i);
    if (ch0 === 10) {
      i++;
      line++;
      continue;
    }
    if (ch0 === 13 && i + 1 < len && text.charCodeAt(i + 1) === 10) {
      i += 2;
      line++;
      continue;
    }

    const recordStartLine = line;
    const rowIndex = isFirstRecord && hasHeader ? null : rows.length;
    const record = [];
    let recordHasChars = false;

    while (true) {
      let field = "";
      let fieldDone = false;

      if (i < len && text.charCodeAt(i) === 34) {
        // Quoted field
        const quoteStart = i;
        let q = i + 1;
        let closed = false;
        let chunkStart = q;
        let hasSpecial = false;
        let parts = null;
        let linesInQuote = 0;

        while (q < len) {
          const c = text.charCodeAt(q);
          if (c === 34) {
            if (q + 1 < len && text.charCodeAt(q + 1) === 34) {
              // Escaped quote ""
              if (!hasSpecial) {
                hasSpecial = true;
                parts = [];
              }
              parts.push(text.slice(chunkStart, q + 1));
              q += 2;
              chunkStart = q;
              continue;
            } else {
              // Closing quote
              if (hasSpecial) {
                if (q > chunkStart) parts.push(text.slice(chunkStart, q));
                field = parts.join("");
              } else {
                field = text.slice(chunkStart, q);
              }
              q++;
              closed = true;
              break;
            }
          } else if (c === 13) {
            // CRLF or lone CR inside quotes -> LF
            if (!hasSpecial) {
              hasSpecial = true;
              parts = [];
            }
            if (q > chunkStart) parts.push(text.slice(chunkStart, q));
            parts.push("\n");
            if (q + 1 < len && text.charCodeAt(q + 1) === 10) {
              q += 2;
            } else {
              q++;
            }
            chunkStart = q;
            linesInQuote++;
          } else if (c === 10) {
            linesInQuote++;
            q++;
          } else {
            q++;
          }
        }

        if (closed) {
          recordHasChars = true;
          line += linesInQuote;
          i = q;

          // Check for junk after closing quote up to comma or line break
          let junkStart = i;
          let junkParts = null;
          let hasJunk = false;

          while (i < len) {
            const c = text.charCodeAt(i);
            if (c === 44 || c === 10) break;
            if (c === 13) {
              if (i + 1 < len && text.charCodeAt(i + 1) === 10) break;
              // Stray CR outside quotes
              if (!junkParts) junkParts = [];
              if (i > junkStart) {
                junkParts.push(text.slice(junkStart, i));
                hasJunk = true;
              }
              errors.push({ code: "stray_cr", line: recordStartLine, row: rowIndex });
              i++;
              junkStart = i;
              continue;
            }
            hasJunk = true;
            i++;
          }

          if (junkParts) {
            if (i > junkStart) junkParts.push(text.slice(junkStart, i));
            if (junkParts.length > 0) field += junkParts.join("");
          } else if (i > junkStart) {
            field += text.slice(junkStart, i);
          }

          if (hasJunk) {
            errors.push({ code: "quote_junk", line: recordStartLine, row: rowIndex });
          }
          fieldDone = true;
        } else {
          // Unterminated quote: treat opening quote as literal and re-read as unquoted
          errors.push({ code: "unterminated_quote", line: recordStartLine, row: rowIndex });
          // Fall through to unquoted reader starting at quoteStart
          i = quoteStart;
        }
      }

      if (!fieldDone) {
        // Unquoted field (fast path)
        let start = i;
        let parts = null;

        while (i < len) {
          const c = text.charCodeAt(i);
          if (c === 44 || c === 10) break;
          if (c === 13) {
            if (i + 1 < len && text.charCodeAt(i + 1) === 10) break;
            // Stray CR dropped
            if (!parts) parts = [];
            if (i > start) {
              parts.push(text.slice(start, i));
              recordHasChars = true;
            }
            errors.push({ code: "stray_cr", line: recordStartLine, row: rowIndex });
            i++;
            start = i;
            continue;
          }
          recordHasChars = true;
          i++;
        }

        if (parts) {
          if (i > start) {
            parts.push(text.slice(start, i));
            recordHasChars = true;
          }
          field = parts.join("");
        } else if (i > start) {
          field = text.slice(start, i);
          recordHasChars = true;
        }
      }

      record.push(field);

      // Check delimiter
      if (i < len) {
        const c = text.charCodeAt(i);
        if (c === 44) {
          recordHasChars = true;
          i++;
          continue; // Next field
        }
        if (c === 10) {
          i++;
          line++;
          break;
        }
        if (c === 13 && i + 1 < len && text.charCodeAt(i + 1) === 10) {
          i += 2;
          line++;
          break;
        }
      } else {
        break;
      }
    }

    // If a line had only dropped stray CRs and no other characters, it's no record
    if (!recordHasChars && record.length === 1 && record[0] === "") {
      continue;
    }

    if (isFirstRecord) {
      isFirstRecord = false;
      width = record.length;
      if (hasHeader) {
        columns = record;
      } else {
        rows.push(record);
      }
    } else {
      const rLen = record.length;
      if (rLen < width) {
        errors.push({
          code: "short_row",
          line: recordStartLine,
          row: rowIndex,
          fields: rLen,
        });
        for (let k = rLen; k < width; k++) {
          record.push("");
        }
      } else if (rLen > width) {
        const extra = record.slice(width);
        record.length = width;
        errors.push({
          code: "long_row",
          line: recordStartLine,
          row: rowIndex,
          extra,
        });
      }
      rows.push(record);
    }
  }

  return { columns, rows, errors };
}
