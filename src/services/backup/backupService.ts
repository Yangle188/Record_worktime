import { APP_VERSION, BACKUP_REMINDER_AFTER_MS } from '@/config/constants';
import { db } from '@/db/db';
import { META_KEYS, ensureDeviceId, getMeta, setMeta } from '@/db/repos/meta.repo';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '@/db/repos/settings.repo';
import type { MetaRecord, PlaceRecord, SessionRecord, SettingsRecord } from '@/domain/types';

/**
 * JSON 备份的导出 / 导入（PRD §7 数据安全要求、验收标准 #9）。
 * 纯本地方案下这是唯一的数据兜底手段，因此提前到 M1。
 */

export const BACKUP_FORMAT = 'check_app.backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupData {
  sessions: SessionRecord[];
  places: PlaceRecord[];
  settings: SettingsRecord | null;
  meta: MetaRecord[];
}

export interface BackupFile {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  deviceId: string;
  counts: { sessions: number; places: number };
  checksum: string;
  data: BackupData;
}

export type ImportMode = 'overwrite' | 'merge';

export interface ImportResult {
  mode: ImportMode;
  sessions: number;
  places: number;
}

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

/** 规范化序列化：对象键排序后输出，保证同一份数据得到同一校验和。 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export async function computeChecksum(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalStringify(data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

export async function buildBackup(exportedAt = Date.now()): Promise<BackupFile> {
  const [sessions, places, settings, meta, deviceId] = await Promise.all([
    db.sessions.toArray(),
    db.places.toArray(),
    db.settings.get('app'),
    db.meta.toArray(),
    ensureDeviceId(),
  ]);

  const data: BackupData = { sessions, places, settings: settings ?? null, meta };

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt,
    deviceId,
    counts: { sessions: sessions.length, places: places.length },
    checksum: await computeChecksum(data),
    data,
  };
}

export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

/** 校验并解析备份文本；任何结构问题都抛 `BackupValidationError`。 */
export async function parseBackup(text: string): Promise<BackupFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupValidationError('文件不是合法的 JSON');
  }

  const file = parsed as Partial<BackupFile>;
  if (file.format !== BACKUP_FORMAT) {
    throw new BackupValidationError('不是本应用导出的备份文件');
  }
  if (typeof file.formatVersion !== 'number' || file.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupValidationError(
      `备份格式版本 ${String(file.formatVersion)} 高于当前应用支持的版本`,
    );
  }
  if (!file.data || !Array.isArray(file.data.sessions) || !Array.isArray(file.data.places)) {
    throw new BackupValidationError('备份数据不完整（缺少 sessions / places）');
  }

  const expected = await computeChecksum(file.data);
  if (file.checksum && file.checksum !== expected) {
    throw new BackupValidationError('备份校验失败，文件可能已损坏或被修改');
  }

  return { ...(file as BackupFile), checksum: expected };
}

/**
 * 导入备份。
 * - `overwrite`：清空打卡段与地点后写入（完整恢复，验收 #9）
 * - `merge`：按 `id` 与 `idempotencyKey` 去重后追加
 *
 * 全程单事务，失败整体回滚，不会产生半套数据。
 */
export async function importBackup(
  file: BackupFile,
  mode: ImportMode,
  importedAt = Date.now(),
): Promise<ImportResult> {
  return db.transaction('rw', db.sessions, db.places, db.settings, db.meta, async () => {
    if (mode === 'overwrite') {
      await Promise.all([db.sessions.clear(), db.places.clear(), db.settings.clear()]);
    }

    const existingSessions = await db.sessions.toArray();
    const knownSessionIds = new Set(existingSessions.map((session) => session.id));
    const knownIdempotencyKeys = new Set(
      existingSessions.map((session) => session.idempotencyKey),
    );
    const sessionsToAdd = file.data.sessions.filter(
      (session) =>
        !knownSessionIds.has(session.id) && !knownIdempotencyKeys.has(session.idempotencyKey),
    );
    if (sessionsToAdd.length > 0) await db.sessions.bulkAdd(sessionsToAdd);

    const existingPlaces = await db.places.toArray();
    const knownPlaceIds = new Set(existingPlaces.map((place) => place.id));
    const placesToAdd = file.data.places.filter((place) => !knownPlaceIds.has(place.id));
    if (placesToAdd.length > 0) await db.places.bulkAdd(placesToAdd);

    if (file.data.settings) {
      await db.settings.put(file.data.settings);
    } else if (!(await db.settings.get('app'))) {
      await db.settings.put(DEFAULT_SETTINGS);
    }

    // meta 不完全覆盖：保留本机的设备标识与校准结果，仅补记导入时间
    const localDeviceId = await getMeta<string | null>(META_KEYS.deviceId, null);
    if (!localDeviceId && file.deviceId) await setMeta(META_KEYS.deviceId, file.deviceId);
    await setMeta(META_KEYS.lastImportAt, importedAt);

    return { mode, sessions: sessionsToAdd.length, places: placesToAdd.length };
  });
}

export async function markBackupCompleted(backedUpAt = Date.now()): Promise<void> {
  await setMeta(META_KEYS.lastBackupAt, backedUpAt);
}

export async function getLastBackupAt(): Promise<number | null> {
  return getMeta<number | null>(META_KEYS.lastBackupAt, null);
}

/** 超过 7 天未备份则提醒（PRD §9 对策：降低 Safari 清理存储导致丢失的概率）。 */
export function isBackupReminderDue(lastBackupAt: number | null, now: number): boolean {
  if (lastBackupAt === null) return true;
  return now - lastBackupAt > BACKUP_REMINDER_AFTER_MS;
}

export function backupFileName(exportedAt: number): string {
  const date = new Date(exportedAt);
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
  const time = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('');
  return `check_app-backup-${stamp}-${time}.json`;
}

/** 触发浏览器下载，并记录「上次备份时间」。 */
export async function downloadBackup(exportedAt = Date.now()): Promise<BackupFile> {
  const file = await buildBackup(exportedAt);
  const blob = new Blob([serializeBackup(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = backupFileName(exportedAt);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  await markBackupCompleted(exportedAt);
  return file;
}
