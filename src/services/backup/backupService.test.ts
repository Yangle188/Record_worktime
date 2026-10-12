import { beforeEach, describe, expect, it } from 'vitest';
import { clearAllData, db } from '@/db/db';
import {
  BackupValidationError,
  buildBackup,
  importBackup,
  isBackupReminderDue,
  parseBackup,
  serializeBackup,
} from '@/services/backup/backupService';
import { BASE_TIME, makePlace, makeSession, makeSettings } from '@/test/factories';

beforeEach(async () => {
  await clearAllData();
});

describe('备份往返（验收 #9）', () => {
  it('导出 → 清空 → 覆盖导入后完整恢复记录、地点与设置', async () => {
    const sessions = [
      makeSession({ startedAt: BASE_TIME, endedAt: BASE_TIME + 3_600_000 }),
      makeSession({ startedAt: BASE_TIME + 7_200_000, endedAt: BASE_TIME + 10_800_000 }),
    ];
    await db.sessions.bulkAdd(sessions);
    await db.places.add(makePlace({ id: 'place-office', name: '公司' }));
    await db.settings.put(makeSettings({ dailyTargetHours: 6, fragmentThresholdSeconds: 120 }));

    const backup = await buildBackup(BASE_TIME);
    expect(backup.counts).toEqual({ sessions: 2, places: 1 });

    await clearAllData();
    expect(await db.sessions.count()).toBe(0);

    const restored = await importBackup(backup, 'overwrite');

    expect(restored.sessions).toBe(2);
    expect(restored.places).toBe(1);
    const restoredSessions = await db.sessions.toArray();
    expect(new Set(restoredSessions.map((session) => session.idempotencyKey))).toEqual(
      new Set(sessions.map((session) => session.idempotencyKey)),
    );
    expect((await db.settings.get('app'))?.dailyTargetHours).toBe(6);
    expect((await db.settings.get('app'))?.fragmentThresholdSeconds).toBe(120);
    expect(await db.places.count()).toBe(1);
  });

  it('合并导入按幂等键去重，不产生重复条目', async () => {
    const session = makeSession();
    await db.sessions.add(session);
    const backup = await buildBackup(BASE_TIME);

    const result = await importBackup(backup, 'merge');

    expect(result.sessions).toBe(0);
    expect(await db.sessions.count()).toBe(1);
  });

  it('序列化后仍可解析（文件真实往返）', async () => {
    await db.sessions.add(makeSession());

    const parsed = await parseBackup(serializeBackup(await buildBackup(BASE_TIME)));

    expect(parsed.counts.sessions).toBe(1);
    expect(parsed.format).toBe('check_app.backup');
  });
});

describe('备份校验', () => {
  it('拒绝非本应用的备份文件', async () => {
    await expect(parseBackup('{"format":"other-app"}')).rejects.toBeInstanceOf(
      BackupValidationError,
    );
  });

  it('拒绝非法 JSON', async () => {
    await expect(parseBackup('not json')).rejects.toThrow(/合法的 JSON/);
  });

  it('拒绝被篡改的数据（校验和不再匹配）', async () => {
    await db.sessions.add(makeSession());
    const backup = await buildBackup(BASE_TIME);
    backup.data.sessions[0].durationSeconds = 999_999;

    await expect(parseBackup(serializeBackup(backup))).rejects.toThrow(/校验失败/);
  });

  it('拒绝高于当前支持的格式版本', async () => {
    await db.sessions.add(makeSession());
    const backup = await buildBackup(BASE_TIME);
    backup.formatVersion = 99;

    await expect(parseBackup(serializeBackup(backup))).rejects.toThrow(/格式版本/);
  });
});

describe('备份提醒', () => {
  it('从未备份时提醒', () => {
    expect(isBackupReminderDue(null, BASE_TIME)).toBe(true);
  });

  it('超过 7 天未备份时提醒', () => {
    expect(isBackupReminderDue(BASE_TIME, BASE_TIME + 8 * 24 * 3600_000)).toBe(true);
    expect(isBackupReminderDue(BASE_TIME, BASE_TIME + 6 * 24 * 3600_000)).toBe(false);
  });
});
