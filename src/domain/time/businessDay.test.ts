import { describe, expect, it } from 'vitest';
import { businessDayOf, businessDayRange } from '@/domain/time/businessDay';

/** 业务日边界默认 04:00（D-008）。 */
const BOUNDARY = 4 * 60;

describe('businessDayOf', () => {
  it('把凌晨 4 点前的打卡归属前一天', () => {
    const at = new Date(2026, 9, 12, 3, 59, 0).getTime();
    expect(businessDayOf(at, BOUNDARY)).toBe('2026-10-11');
  });

  it('04:00 整起算作当天', () => {
    const at = new Date(2026, 9, 12, 4, 0, 0).getTime();
    expect(businessDayOf(at, BOUNDARY)).toBe('2026-10-12');
  });

  it('跨 0 点的段归属开始日（支持熬夜工作）', () => {
    const startedAt = new Date(2026, 9, 12, 22, 0, 0).getTime();
    const endedAt = new Date(2026, 9, 13, 1, 30, 0).getTime();
    expect(businessDayOf(startedAt, BOUNDARY)).toBe('2026-10-12');
    expect(businessDayOf(endedAt, BOUNDARY)).toBe('2026-10-12');
  });

  it('边界可配置为 0 点', () => {
    const at = new Date(2026, 9, 12, 3, 59, 0).getTime();
    expect(businessDayOf(at, 0)).toBe('2026-10-12');
  });
});

describe('businessDayRange', () => {
  it('返回 [04:00, 次日 04:00) 的半开区间', () => {
    const { start, end } = businessDayRange('2026-10-12', BOUNDARY);
    expect(start).toBe(new Date(2026, 9, 12, 4, 0, 0, 0).getTime());
    expect(end).toBe(new Date(2026, 9, 13, 4, 0, 0, 0).getTime());
  });

  it('与 businessDayOf 互为逆运算', () => {
    const { start, end } = businessDayRange('2026-10-12', BOUNDARY);
    expect(businessDayOf(start, BOUNDARY)).toBe('2026-10-12');
    expect(businessDayOf(end - 1, BOUNDARY)).toBe('2026-10-12');
    expect(businessDayOf(end, BOUNDARY)).toBe('2026-10-13');
  });
});
