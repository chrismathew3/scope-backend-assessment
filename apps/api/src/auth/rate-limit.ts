/**
 * Login throttling: 5 failed attempts per (IP, email) and 20 per IP within
 * 15 minutes. In-memory is fine for one API process; swap for Postgres or
 * Redis when running more than one.
 */
const WINDOW_MS = 15 * 60 * 1000;
const buckets = new Map<string, number[]>();

function hits(key: string, now: number) {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  buckets.set(key, recent);
  return recent;
}

export function loginBlocked(ip: string | null, email: string): number | null {
  const now = Date.now();
  const pair = hits(`pair:${ip}:${email}`, now);
  const perIp = hits(`ip:${ip}`, now);
  if (pair.length >= 5 || perIp.length >= 20) {
    const oldest = Math.min(...(pair.length >= 5 ? pair : perIp));
    return Math.ceil((oldest + WINDOW_MS - now) / 1000);
  }
  return null;
}

export function recordLoginFailure(ip: string | null, email: string) {
  const now = Date.now();
  hits(`pair:${ip}:${email}`, now).push(now);
  hits(`ip:${ip}`, now).push(now);
}

export function clearLoginFailures(ip: string | null, email: string) {
  buckets.delete(`pair:${ip}:${email}`);
}
