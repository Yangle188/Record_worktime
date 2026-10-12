import type { SessionRecord } from '@/domain/types';

/**
 * 段持续超过阈值时提示确认「还在工作吗？」（C-5 / D-011）。
 * 不自动截断、不伪造结束时间。
 */
export function isLongRunningSegment(
  session: Pick<SessionRecord, 'startedAt' | 'endedAt'>,
  now: number,
  thresholdHours: number,
): boolean {
  if (session.endedAt !== null) return false;
  return now - session.startedAt > thresholdHours * 3_600_000;
}
