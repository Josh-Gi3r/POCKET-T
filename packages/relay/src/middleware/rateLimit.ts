import type { Redis } from 'ioredis';

export function createRateLimiter(redis: Redis) {
  async function check(
    key:           string,
    maxPerWindow:  number,
    windowSeconds: number,
  ): Promise<boolean> {
    const k     = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSeconds);
    return count <= maxPerWindow;
  }

  return {
    // stdin writes: 30/sec per session
    inputWrite: (accountId: string, sessionId: string) =>
      check(`input:${accountId}:${sessionId}`, 30, 1),
    // spawns: 10/min per account
    spawn: (accountId: string) =>
      check(`spawn:${accountId}`, 10, 60),
    // push: 100/hour per account
    push: (accountId: string) =>
      check(`push:${accountId}`, 100, 3600),
    // login: 5 attempts per 15min per IP
    login: (ip: string) =>
      check(`login:${ip}`, 5, 900),
    // register: 5 accounts per hour per IP
    register: (ip: string) =>
      check(`register:${ip}`, 5, 3600),
    // push subscribe: 20 per hour per user
    pushSub: (userId: string) =>
      check(`pushsub:${userId}`, 20, 3600),
  };
}
