import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db } from '@/db/db';
import { businessDayOf } from '@/domain/time/businessDay';
import type { LocationSnapshot } from '@/domain/types';
import {
  endPunch,
  PunchConflictError,
  startPunch,
  type PunchDependencies,
} from '@/features/punch/punchService';
import { createLocationSnapshot } from '@/services/location/geolocation';
import { BASE_TIME, makeClock, makeLocation, makeSession } from '@/test/factories';

function deps(time: number, location?: LocationSnapshot): PunchDependencies {
  return {
    clock: makeClock(time),
    captureLocation: async () => location ?? makeLocation(),
  };
}

beforeEach(async () => {
  await clearAllData();
});

describe('startPunch', () => {
  it('落库一条 running 段，写入幂等键与业务日', async () => {
    const outcome = await startPunch(deps(BASE_TIME));

    expect(outcome.action).toBe('start');
    expect(outcome.session.status).toBe('running');
    expect(outcome.session.endedAt).toBeNull();
    expect(outcome.session.durationSeconds).toBeNull();
    expect(outcome.session.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(outcome.session.businessDay).toBe(businessDayOf(BASE_TIME, 240));
    expect(outcome.session.timeSource).toBe('network');

    const stored = await db.sessions.toArray();
    expect(stored).toHaveLength(1);

    // 地点在落库之后补写（TECH-DESIGN §10）
    await outcome.locationSettled;
    const patched = await db.sessions.toArray();
    expect(patched[0]?.startLocation?.status).toBe('ok');
  });

  it('落库不等待定位（PRD §6：点击 → 落库 < 3s）', async () => {
    let resolveLocation: ((value: LocationSnapshot) => void) | undefined;
    const pendingLocation = new Promise<LocationSnapshot>((resolve) => {
      resolveLocation = resolve;
    });

    const outcome = await startPunch({
      clock: makeClock(BASE_TIME),
      captureLocation: () => pendingLocation,
    });

    // 定位尚未返回，段已经落库
    expect(outcome.session.startLocation).toBeNull();
    const stored = await db.sessions.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.startLocation).toBeNull();

    resolveLocation?.(makeLocation({ lat: 31.1, lng: 121.2 }));
    await outcome.locationSettled;

    const patched = await db.sessions.toArray();
    expect(patched[0]?.startLocation?.lat).toBeCloseTo(31.1, 5);
  });

  it('重复点击开始不会产生第二条记录（C-6）', async () => {
    await startPunch(deps(BASE_TIME));

    await expect(startPunch(deps(BASE_TIME + 1_000))).rejects.toBeInstanceOf(PunchConflictError);
    expect(await db.sessions.count()).toBe(1);
  });

  it('幂等键在数据库层唯一，重复写入被拒绝', async () => {
    const record = makeSession({ idempotencyKey: 'fixed-key' });
    await db.sessions.add(record);

    await expect(db.sessions.add(makeSession({ idempotencyKey: 'fixed-key' }))).rejects.toThrow();
    expect(await db.sessions.count()).toBe(1);
  });

  it('定位被拒绝时仍可完成打卡，并标注未记录地点（验收 #7）', async () => {
    const denied = createLocationSnapshot('denied', BASE_TIME, 1);
    const outcome = await startPunch(deps(BASE_TIME, denied));

    expect(outcome.session.startedAt).toBe(BASE_TIME);

    await outcome.locationSettled;
    const stored = await db.sessions.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.startLocation?.status).toBe('denied');
    expect(stored[0]?.startLocation?.lat).toBe(0);
  });

  it('未校准时使用本地时间并标记 local（PRD T-5）', async () => {
    const outcome = await startPunch({
      clock: makeClock(BASE_TIME, { source: 'local' }),
      captureLocation: async () => makeLocation(),
    });

    expect(outcome.session.timeSource).toBe('local');
  });

  it('设备时间异常时打标（PRD T-4）', async () => {
    const outcome = await startPunch({
      clock: makeClock(BASE_TIME, { skewed: true, offsetMs: 120_000 }),
      captureLocation: async () => makeLocation(),
    });

    expect(outcome.session.isDeviceClockSkewed).toBe(true);
    expect(outcome.session.clockOffsetMs).toBe(120_000);
    expect(outcome.skewWarning).toBe(true);
  });
});

describe('endPunch', () => {
  it('闭合段并计算时长', async () => {
    await startPunch(deps(BASE_TIME));
    const outcome = await endPunch(deps(BASE_TIME + 5_400_000));

    expect(outcome.action).toBe('end');
    expect(outcome.durationSeconds).toBe(5400);
    expect(outcome.session.status).toBe('closed');
    expect(outcome.isFragment).toBe(false);

    const stored = await db.sessions.toArray();
    expect(stored[0]?.endedAt).toBe(BASE_TIME + 5_400_000);
    expect(stored[0]?.durationSeconds).toBe(5400);
  });

  it('短于碎片阈值时标记为 fragment，保留记录', async () => {
    await startPunch(deps(BASE_TIME));
    const outcome = await endPunch(deps(BASE_TIME + 30_000));

    expect(outcome.durationSeconds).toBe(30);
    expect(outcome.session.status).toBe('fragment');
    expect(outcome.isFragment).toBe(true);
  });

  it('没有进行中的段时结束会报冲突', async () => {
    await expect(endPunch(deps(BASE_TIME))).rejects.toBeInstanceOf(PunchConflictError);
  });

  it('结束时间早于开始时间时不会产生负时长', async () => {
    // 设备时间被回拨的极端情况：仍不应写入负值
    await startPunch(deps(BASE_TIME));
    const outcome = await endPunch(deps(BASE_TIME - 60_000));

    expect(outcome.durationSeconds).toBe(0);
  });

  it('多段循环后每段独立计算（C-2）', async () => {
    await startPunch(deps(BASE_TIME));
    await endPunch(deps(BASE_TIME + 3_600_000));
    await startPunch(deps(BASE_TIME + 7_200_000));
    await endPunch(deps(BASE_TIME + 10_800_000));

    const stored = await db.sessions.orderBy('startedAt').toArray();
    expect(stored).toHaveLength(2);
    expect(stored.map((session) => session.durationSeconds)).toEqual([3600, 3600]);
  });
});
