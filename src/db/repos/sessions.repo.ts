import { db } from '@/db/db';
import type { SessionRecord } from '@/domain/types';

/** 至多存在一条 `running` 段（TECH-DESIGN §5.1 并发不变量）。 */
export async function findRunningSession(): Promise<SessionRecord | undefined> {
  return db.sessions
    .where('status')
    .equals('running')
    .filter((session) => session.deleted === 0)
    .first();
}

export async function listSessionsInRange(start: number, end: number): Promise<SessionRecord[]> {
  return db.sessions
    .where('startedAt')
    .between(start, end, true, false)
    .filter((session) => session.deleted === 0)
    .toArray();
}

export async function listActiveSessions(): Promise<SessionRecord[]> {
  return db.sessions.filter((session) => session.deleted === 0).toArray();
}

export async function softDeleteSession(id: string, now: number): Promise<void> {
  await db.sessions.update(id, { deleted: 1, updatedAt: now });
}
