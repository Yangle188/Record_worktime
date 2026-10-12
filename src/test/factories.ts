import { DEFAULT_BUSINESS_DAY_BOUNDARY_MINUTES } from '@/config/constants';
import { DEFAULT_SETTINGS } from '@/db/repos/settings.repo';
import { businessDayOf } from '@/domain/time/businessDay';
import type { LocationSnapshot, PlaceRecord, SessionRecord, SettingsRecord } from '@/domain/types';
import type { ClockReader } from '@/features/punch/punchService';
import type { ClockStamp } from '@/services/clock/clockService';

/** 测试基准时刻：2026-10-12 09:00（本地时间） */
export const BASE_TIME = new Date(2026, 9, 12, 9, 0, 0).getTime();

export function makeSettings(overrides: Partial<SettingsRecord> = {}): SettingsRecord {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

export function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const startedAt = overrides.startedAt ?? BASE_TIME;
  const hasEndedAt = Object.prototype.hasOwnProperty.call(overrides, 'endedAt');
  const endedAt = hasEndedAt ? (overrides.endedAt ?? null) : startedAt + 3_600_000;

  const base: SessionRecord = {
    id: crypto.randomUUID(),
    startedAt,
    endedAt,
    durationSeconds: endedAt === null ? null : Math.round((endedAt - startedAt) / 1000),
    businessDay: businessDayOf(startedAt, DEFAULT_BUSINESS_DAY_BOUNDARY_MINUTES),
    startLocation: null,
    endLocation: null,
    placeId: null,
    endPlaceId: null,
    timeSource: 'network',
    clockOffsetMs: 0,
    deviceStartedAt: startedAt,
    deviceEndedAt: endedAt,
    idempotencyKey: crypto.randomUUID(),
    status: 'closed',
    isDeviceClockSkewed: false,
    note: null,
    editedAt: null,
    deleted: 0,
    createdAt: startedAt,
    updatedAt: startedAt,
  };

  return { ...base, ...overrides };
}

export function makePlace(overrides: Partial<PlaceRecord> = {}): PlaceRecord {
  return {
    id: crypto.randomUUID(),
    name: '公司',
    lat: 31.2304,
    lng: 121.4737,
    radiusM: 200,
    color: '#2563eb',
    icon: null,
    deleted: 0,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    ...overrides,
  };
}

export function makeLocation(overrides: Partial<LocationSnapshot> = {}): LocationSnapshot {
  return {
    lat: 31.2304,
    lng: 121.4737,
    coordSystem: 'WGS84',
    accuracyM: 25,
    address: null,
    poiName: null,
    capturedAt: BASE_TIME,
    status: 'ok',
    errorCode: null,
    reverseGeocode: 'skipped',
    ...overrides,
  };
}

/** 固定时间的时钟桩，让打卡用例完全确定。 */
export function makeClock(time: number, overrides: Partial<ClockStamp> = {}): ClockReader {
  return {
    stamp: () => ({
      time,
      deviceTime: time,
      offsetMs: 0,
      source: 'network',
      skewed: false,
      ...overrides,
    }),
  };
}
