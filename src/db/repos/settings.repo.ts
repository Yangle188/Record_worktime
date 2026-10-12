import {
  DEFAULT_BUSINESS_DAY_BOUNDARY_MINUTES,
  DEFAULT_DAILY_TARGET_HOURS,
  DEFAULT_FRAGMENT_THRESHOLD_SECONDS,
  DEFAULT_LONG_SEGMENT_THRESHOLD_HOURS,
  DEFAULT_PLACE_RADIUS_M,
  DEFAULT_TIME_SOURCE_IDS,
  DEFAULT_WEEKLY_TARGET_HOURS,
} from '@/config/constants';
import { db } from '@/db/db';
import type { SettingsRecord } from '@/domain/types';

/** 当前 schema 版本，同时写入设置与备份文件头（TECH-DESIGN §4.6）。 */
export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: SettingsRecord = {
  id: 'app',
  dailyTargetHours: DEFAULT_DAILY_TARGET_HOURS,
  weeklyTargetHours: DEFAULT_WEEKLY_TARGET_HOURS,
  businessDayBoundaryMinutes: DEFAULT_BUSINESS_DAY_BOUNDARY_MINUTES,
  fragmentThresholdSeconds: DEFAULT_FRAGMENT_THRESHOLD_SECONDS,
  longSegmentThresholdHours: DEFAULT_LONG_SEGMENT_THRESHOLD_HOURS,
  defaultPlaceRadiusM: DEFAULT_PLACE_RADIUS_M,
  timeSourceIds: [...DEFAULT_TIME_SOURCE_IDS],
  schemaVersion: SCHEMA_VERSION,
};

/** 读取设置，缺失时写入默认值（首次启动）。 */
export async function ensureSettings(): Promise<SettingsRecord> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function updateSettings(
  patch: Partial<Omit<SettingsRecord, 'id'>>,
): Promise<SettingsRecord> {
  const current = await ensureSettings();
  const next: SettingsRecord = { ...current, ...patch, id: 'app' };
  await db.settings.put(next);
  return next;
}
