// Hash router. Routes are declared in routes.js; each view module exports
// { title, section, load?(ctx), render(ctx) -> Safe, mount?(root, ctx) -> cleanup? }.

import { ROUTES } from "../routes.js";

function compile(path) {
  const keys = [];
  const re = new RegExp(
    "^" +
      path.replace(/\/:([a-zA-Z_]+)/g, (_, k) => {
        keys.push(k);
        return "/([^/]+)";
      }) +
      "/?$",
  );
  return { re, keys };
}

const COMPILED = ROUTES.map((r) => ({ ...r, ...compile(r.path) }));

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(qs || "")) };
}

function decode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null; // malformed percent-escape (hand-edited / corrupted link)
  }
}

/** Route match, or null. A segment that cannot be decoded is not-found, never an exception. */
export function match(path) {
  for (const r of COMPILED) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      for (let i = 0; i < r.keys.length; i++) {
        const v = decode(m[i + 1]);
        if (v === null) return null;
        params[r.keys[i]] = v;
      }
      return { route: r, params };
    }
  }
  return null;
}

export function href(path, query) {
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  return `#${path}${qs}`;
}

export function navigate(path, query) {
  location.hash = href(path, query);
}
