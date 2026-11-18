import { KeyValue, createKeyValue } from './types';

export interface ParsedUrl {
  base: string;
  params: { key: string; value: string }[];
}

export function parseUrlQuery(raw: string): ParsedUrl {
  const input = (raw ?? '').trim();
  const qIndex = input.indexOf('?');
  if (qIndex === -1) return { base: input, params: [] };
  const base = input.slice(0, qIndex);
  const query = input.slice(qIndex + 1).split('#')[0];
  const params: { key: string; value: string }[] = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    const value = eq === -1 ? '' : part.slice(eq + 1);
    try {
      params.push({ key: decodeURIComponent(key), value: decodeURIComponent(value) });
    } catch {
      params.push({ key, value });
    }
  }
  return { base, params };
}

export function splitUrlToParams(raw: string, existing: KeyValue[] = []): { url: string; params: KeyValue[] } {
  const parsed = parseUrlQuery(raw);
  if (!parsed.params.length) return { url: raw, params: existing };
  const merged = [...existing];
  for (const p of parsed.params) {
    const hit = merged.find((item) => item.key === p.key && item.enabled);
    if (hit) hit.value = p.value;
    else merged.push(createKeyValue(p.key, p.value));
  }
  return { url: parsed.base, params: merged.filter((p) => p.key || p.value) };
}

export function applyParams(url: string, params: KeyValue[]): string {
  const enabled = params.filter((p) => p.enabled && p.key);
  if (!enabled.length) return url;
  const [base, hash = ''] = url.split('#');
  const sep = base.includes('?') ? '&' : '?';
  const qs = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
    .join('&');
  return hash ? `${base}${sep}${qs}#${hash}` : `${base}${sep}${qs}`;
}

export function substituteVars(input: string, vars: Record<string, string>): string {
  if (!input) return input;
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}
