// Escaping HTML templates. State strings come from producer files and are
// always escaped; only values wrapped in Safe (via html`` or raw()) pass through.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

export function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Trusted markup only (icons, internal constants). Never pass state strings. */
export function raw(s) {
  return new Safe(String(s));
}

function serialize(v) {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(serialize).join("");
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += serialize(vals[i]) + strings[i + 1];
  return new Safe(out);
}

/** Join a list of Safe fragments with an optional (trusted) separator. */
export function join(items, sep = "") {
  return new Safe(items.map(serialize).join(sep instanceof Safe ? sep.s : esc(sep)));
}

/** Build a class attribute value from a map/array of candidates. */
export function cx(...parts) {
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    if (typeof p === "string") out.push(p);
    else if (typeof p === "object") for (const [k, on] of Object.entries(p)) if (on) out.push(k);
  }
  return out.join(" ");
}
