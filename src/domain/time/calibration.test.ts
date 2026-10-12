import { describe, expect, it } from 'vitest';
import {
  computeOffsetMs,
  isDeviceClockSkewed,
  pickLowestRtt,
  reconcileCalibration,
  type TimeSample,
} from '@/domain/time/calibration';

function sample(overrides: Partial<TimeSample> = {}): TimeSample {
  return {
    sourceId: 'a',
    serverTime: 1_000_000,
    sentAt: 1_000_000,
    receivedAt: 1_000_000,
    rttMs: 0,
    offsetMs: 0,
    ...overrides,
  };
}

describe('computeOffsetMs', () => {
  it('按往返中点推导偏移量', () => {
    // 发包 1_000_000，收包 1_000_200，服务端 1_000_500 → 中点 1_000_100 → 偏移 +400
    expect(computeOffsetMs(1_000_500, 1_000_000, 1_000_200)).toBe(400);
  });

  it('服务端时间落后于设备时得到负偏移', () => {
    expect(computeOffsetMs(999_900, 1_000_000, 1_000_200)).toBe(-200);
  });
});

describe('pickLowestRtt', () => {
  it('返回 RTT 最小的样本（对称路径假设下误差最小）', () => {
    const chosen = pickLowestRtt([
      sample({ sourceId: 'slow', rttMs: 480, offsetMs: 100 }),
      sample({ sourceId: 'fast', rttMs: 25, offsetMs: 140 }),
      sample({ sourceId: 'mid', rttMs: 120, offsetMs: 110 }),
    ]);
    expect(chosen?.sourceId).toBe('fast');
  });

  it('没有样本时返回 null', () => {
    expect(pickLowestRtt([])).toBeNull();
  });
});

describe('isDeviceClockSkewed', () => {
  it('偏差严格大于 60 秒才算异常', () => {
    expect(isDeviceClockSkewed(60_000)).toBe(false);
    expect(isDeviceClockSkewed(60_001)).toBe(true);
    expect(isDeviceClockSkewed(-90_000)).toBe(true);
  });
});

describe('reconcileCalibration', () => {
  it('以最小 RTT 源为准', () => {
    const outcome = reconcileCalibration([
      sample({ sourceId: 'fast', rttMs: 30, offsetMs: 500 }),
      sample({ sourceId: 'slow', rttMs: 400, offsetMs: 520 }),
    ]);
    expect(outcome?.sourceId).toBe('fast');
    expect(outcome?.offsetMs).toBe(500);
    expect(outcome?.rejectedSources).toHaveLength(0);
  });

  it('与选定源偏差过大的源被丢弃', () => {
    const outcome = reconcileCalibration([
      sample({ sourceId: 'fast', rttMs: 30, offsetMs: 500 }),
      sample({ sourceId: 'bogus', rttMs: 400, offsetMs: 9_000 }),
    ]);
    expect(outcome?.sourceId).toBe('fast');
    expect(outcome?.rejectedSources.map((item) => item.sourceId)).toEqual(['bogus']);
  });

  it('全部源不可用时返回 null', () => {
    expect(reconcileCalibration([])).toBeNull();
  });
});
