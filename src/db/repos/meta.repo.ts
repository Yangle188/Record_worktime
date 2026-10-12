import { db } from '@/db/db';

export const META_KEYS = {
  calibrationOffsetMs: 'calibrationOffsetMs',
  calibrationAt: 'calibrationAt',
  calibrationSourceId: 'calibrationSourceId',
  deviceId: 'deviceId',
  lastBackupAt: 'lastBackupAt',
  lastImportAt: 'lastImportAt',
} as const;

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const record = await db.meta.get(key);
  return record ? (record.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

/** 设备标识：仅用于备份文件溯源，不参与任何上传。 */
export async function ensureDeviceId(): Promise<string> {
  const existing = await getMeta<string | null>(META_KEYS.deviceId, null);
  if (existing) return existing;
  const created = crypto.randomUUID();
  await setMeta(META_KEYS.deviceId, created);
  return created;
}
