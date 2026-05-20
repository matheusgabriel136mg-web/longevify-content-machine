/**
 * rate-limiter.ts — Token bucket rate limiter per provider.
 *
 * Singleton em memória. Para uso entre processos, ver lockfile fallback (futuro).
 *
 * Usage:
 *   await rateLimit("anthropic"); // bloqueia se passou do limite, libera quando disponível
 *   await fetch(...);
 */

const LIMITS: Record<string, { perMinute: number; perSecond?: number }> = {
  anthropic: { perMinute: 50, perSecond: 5 },
  higgsfield: { perMinute: 20 },
  apify: { perMinute: 10 },
  cloudinary: { perMinute: 60 },
};

interface Bucket {
  perMinute: number;
  perSecond: number;
  callsInLastMinute: number[];
  callsInLastSecond: number[];
}

const buckets = new Map<string, Bucket>();

function getBucket(provider: string): Bucket {
  if (!buckets.has(provider)) {
    const limits = LIMITS[provider] ?? { perMinute: 60, perSecond: 10 };
    buckets.set(provider, {
      perMinute: limits.perMinute,
      perSecond: limits.perSecond ?? Math.ceil(limits.perMinute / 10),
      callsInLastMinute: [],
      callsInLastSecond: [],
    });
  }
  return buckets.get(provider)!;
}

function prune(bucket: Bucket, now: number): void {
  bucket.callsInLastMinute = bucket.callsInLastMinute.filter((t) => now - t < 60_000);
  bucket.callsInLastSecond = bucket.callsInLastSecond.filter((t) => now - t < 1_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function rateLimit(provider: string): Promise<void> {
  const bucket = getBucket(provider);
  while (true) {
    const now = Date.now();
    prune(bucket, now);
    if (bucket.callsInLastMinute.length < bucket.perMinute && bucket.callsInLastSecond.length < bucket.perSecond) {
      bucket.callsInLastMinute.push(now);
      bucket.callsInLastSecond.push(now);
      return;
    }
    // Wait until oldest call expires
    const minuteWait = bucket.callsInLastMinute.length >= bucket.perMinute ? 60_000 - (now - bucket.callsInLastMinute[0]) : 0;
    const secondWait = bucket.callsInLastSecond.length >= bucket.perSecond ? 1_000 - (now - bucket.callsInLastSecond[0]) : 0;
    const wait = Math.max(minuteWait, secondWait, 100);
    await sleep(wait);
  }
}
