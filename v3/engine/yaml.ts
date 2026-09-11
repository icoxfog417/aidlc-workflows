// Minimal YAML subset parser — enough for rule files, plans and config.
// Supports: nested maps (2-space indent), inline arrays, block sequences,
// scalars, quoted strings, booleans/numbers, folded (>) and literal (|)
// block scalars, and # comments. Deliberately not a general YAML parser:
// the rule format is a closed, documented subset.

export type Y = string | number | boolean | null | Y[] | { [k: string]: Y };

type Line = { indent: number; text: string; n: number };

function scan(src: string): Line[] {
  const out: Line[] = [];
  src.split(/\r?\n/).forEach((raw, i) => {
    const noComment = raw.replace(/(^|\s)#.*$/, (m, p1) => (p1 === "" && raw.trimStart().startsWith("#") ? "" : p1));
    if (noComment.trim() === "") return;
    out.push({ indent: noComment.length - noComment.trimStart().length, text: noComment.trim(), n: i + 1 });
  });
  return out;
}

function scalar(raw: string): Y {
  const s = raw.trim();
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map((p) => scalar(p));
  }
  return s;
}

function blockScalar(lines: Line[], i: number, baseIndent: number, fold: boolean): [string, number] {
  const parts: string[] = [];
  let j = i;
  while (j < lines.length && lines[j].indent > baseIndent) {
    parts.push(lines[j].text);
    j++;
  }
  return [fold ? parts.join(" ") : parts.join("\n"), j];
}

function parseBlock(lines: Line[], i: number, indent: number): [Y, number] {
  if (i >= lines.length) return [null, i];

  if (lines[i].text.startsWith("- ")) {
    const arr: Y[] = [];
    let j = i;
    while (j < lines.length && lines[j].indent === indent && lines[j].text.startsWith("- ")) {
      const rest = lines[j].text.slice(2).trim();
      if (rest.includes(": ") || rest.endsWith(":")) {
        // inline map start inside a sequence item
        const synthetic: Line[] = [{ indent: indent + 2, text: rest, n: lines[j].n }];
        let k = j + 1;
        while (k < lines.length && lines[k].indent > indent) {
          synthetic.push(lines[k]);
          k++;
        }
        const [val] = parseBlock(synthetic, 0, indent + 2);
        arr.push(val);
        j = k;
      } else {
        arr.push(scalar(rest));
        j++;
      }
    }
    return [arr, j];
  }

  const map: { [k: string]: Y } = {};
  let j = i;
  while (j < lines.length && lines[j].indent === indent) {
    const line = lines[j];
    const sep = line.text.indexOf(":");
    if (sep < 0) break;
    const key = line.text.slice(0, sep).trim();
    const rest = line.text.slice(sep + 1).trim();
    if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
      const [text, next] = blockScalar(lines, j + 1, indent, rest.startsWith(">"));
      map[key] = text;
      j = next;
    } else if (rest === "") {
      if (j + 1 < lines.length && lines[j + 1].indent > indent) {
        const [val, next] = parseBlock(lines, j + 1, lines[j + 1].indent);
        map[key] = val;
        j = next;
      } else {
        map[key] = null;
        j++;
      }
    } else {
      map[key] = scalar(rest);
      j++;
    }
  }
  return [map, j];
}

export function parseYaml(src: string): Y {
  const lines = scan(src);
  if (lines.length === 0) return {};
  const [val] = parseBlock(lines, 0, lines[0].indent);
  return val;
}
