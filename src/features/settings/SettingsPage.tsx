import { useMemo, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { META_KEYS, getMeta } from '@/db/repos/meta.repo';
import { updateSettings } from '@/db/repos/settings.repo';
import { useSettings } from '@/db/hooks';
import { clearAllData, db } from '@/db/db';
import { formatDateTime, formatDuration } from '@/domain/time/format';
import {
  BackupValidationError,
  downloadBackup,
  importBackup,
  isBackupReminderDue,
  parseBackup,
} from '@/services/backup/backupService';
import { TIME_SOURCES } from '@/services/clock/timeSources';
import { describeGeocodeAvailability } from '@/services/geocode/provider';

function toTimeInput(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function fromTimeInput(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

interface SettingsForm {
  dailyTargetHours: number;
  weeklyTargetHours: number;
  boundaryTime: string;
  fragmentThresholdSeconds: number;
  longSegmentThresholdHours: number;
  timeSourceIds: string[];
}

/** 设置页（PRD §4.6）：目标与口径、时间源、备份与恢复、清除数据。 */
export function SettingsPage() {
  const settings = useSettings();
  const backupState = useLiveQuery(async () => {
    const lastBackupAt = await getMeta<number | null>(META_KEYS.lastBackupAt, null);
    return { lastBackupAt, reminderDue: isBackupReminderDue(lastBackupAt, Date.now()) };
  }, []);

  // 表单是「已保存设置 + 本地草稿」的派生值，避免用 effect 把外部数据拷贝进 state
  const [draft, setDraft] = useState<Partial<SettingsForm>>({});
  const [status, setStatus] = useState<string | null>(null);

  const form: SettingsForm = useMemo(
    () => ({
      dailyTargetHours: draft.dailyTargetHours ?? settings.dailyTargetHours,
      weeklyTargetHours: draft.weeklyTargetHours ?? settings.weeklyTargetHours,
      boundaryTime: draft.boundaryTime ?? toTimeInput(settings.businessDayBoundaryMinutes),
      fragmentThresholdSeconds: draft.fragmentThresholdSeconds ?? settings.fragmentThresholdSeconds,
      longSegmentThresholdHours:
        draft.longSegmentThresholdHours ?? settings.longSegmentThresholdHours,
      timeSourceIds: draft.timeSourceIds ?? settings.timeSourceIds,
    }),
    [settings, draft],
  );
  const counts = useLiveQuery(async () => {
    const sessions = await db.sessions.filter((session) => session.deleted === 0).toArray();
    return {
      sessions: sessions.length,
      seconds: sessions.reduce((total, session) => total + (session.durationSeconds ?? 0), 0),
      places: await db.places.filter((place) => place.deleted === 0).count(),
    };
  }, []);

  const save = async () => {
    await updateSettings({
      dailyTargetHours: form.dailyTargetHours,
      weeklyTargetHours: form.weeklyTargetHours,
      businessDayBoundaryMinutes: fromTimeInput(form.boundaryTime),
      fragmentThresholdSeconds: form.fragmentThresholdSeconds,
      longSegmentThresholdHours: form.longSegmentThresholdHours,
      timeSourceIds: form.timeSourceIds,
    });
    setDraft({});
    setStatus('设置已保存');
  };

  const toggleTimeSource = (id: string) => {
    const enabled = form.timeSourceIds.includes(id);
    const timeSourceIds = enabled
      ? form.timeSourceIds.filter((item) => item !== id)
      : [...form.timeSourceIds, id];
    setDraft((current) => ({ ...current, timeSourceIds }));
  };

  const handleExport = async () => {
    try {
      await downloadBackup();
      setStatus('已导出备份文件，可在设置页查看「上次备份时间」');
    } catch {
      setStatus('导出失败，请重试');
    }
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const backup = await parseBackup(await file.text());
      const overwrite = window.confirm(
        `备份包含 ${backup.counts.sessions} 段打卡、${backup.counts.places} 个地点。\n\n「确定」= 覆盖导入（清空现有数据后写入）\n「取消」= 合并导入（按幂等键去重追加）`,
      );
      const result = await importBackup(backup, overwrite ? 'overwrite' : 'merge');
      setStatus(
        `导入完成：新增 ${result.sessions} 段打卡、${result.places} 个地点（${
          result.mode === 'overwrite' ? '覆盖' : '合并'
        }）`,
      );
    } catch (caught) {
      setStatus(
        caught instanceof BackupValidationError
          ? `导入失败：${caught.message}`
          : '导入失败，请检查文件',
      );
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('将删除本机全部打卡记录、地点与设置，且不可撤销。确定继续吗？')) return;
    if (!window.confirm('再次确认：删除后只能通过备份文件恢复。确定删除吗？')) return;
    await clearAllData();
    setDraft({});
    setStatus('已清除全部本地数据');
  };

  return (
    <div className="page">
      <section className="card">
        <header className="card__header">
          <h2>目标与统计口径</h2>
        </header>
        <div className="form-grid">
          <label className="field">
            <span>日目标（小时）</span>
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={form.dailyTargetHours}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  dailyTargetHours: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="field">
            <span>周目标（小时）</span>
            <input
              type="number"
              min={1}
              max={168}
              step={0.5}
              value={form.weeklyTargetHours}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  weeklyTargetHours: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="field">
            <span>业务日换日时间</span>
            <input
              type="time"
              value={form.boundaryTime}
              onChange={(event) =>
                setDraft((current) => ({ ...current, boundaryTime: event.target.value }))
              }
            />
            <small>默认 04:00，凌晨 4 点前的打卡归属前一天</small>
          </label>
          <label className="field">
            <span>碎片阈值（秒）</span>
            <input
              type="number"
              min={0}
              max={3600}
              value={form.fragmentThresholdSeconds}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  fragmentThresholdSeconds: Number(event.target.value),
                }))
              }
            />
            <small>短于该时长的段保留记录但不计入工时</small>
          </label>
          <label className="field">
            <span>异常长段阈值（小时）</span>
            <input
              type="number"
              min={1}
              max={48}
              value={form.longSegmentThresholdHours}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  longSegmentThresholdHours: Number(event.target.value),
                }))
              }
            />
            <small>超过后弹窗确认「还在工作吗？」</small>
          </label>
        </div>

        <fieldset className="fieldset">
          <legend>时间源（按优先级降级）</legend>
          {TIME_SOURCES.map((source) => (
            <label key={source.id} className="checkbox">
              <input
                type="checkbox"
                checked={form.timeSourceIds.includes(source.id)}
                onChange={() => toggleTimeSource(source.id)}
              />
              <span>
                {source.label}
                <small>{source.note}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <button type="button" className="button button--primary" onClick={() => void save()}>
          保存设置
        </button>
      </section>

      <section className="card">
        <header className="card__header">
          <h2>数据备份与恢复</h2>
          <span className="card__hint">数据仅存本机，备份是唯一的兜底手段</span>
        </header>

        <dl className="stats-inline">
          <div>
            <dt>打卡段</dt>
            <dd>{counts?.sessions ?? 0} 段</dd>
          </div>
          <div>
            <dt>累计工时</dt>
            <dd>{formatDuration(counts?.seconds ?? 0)}</dd>
          </div>
          <div>
            <dt>地点</dt>
            <dd>{counts?.places ?? 0} 个</dd>
          </div>
          <div>
            <dt>上次备份</dt>
            <dd>
              {backupState?.lastBackupAt ? formatDateTime(backupState.lastBackupAt) : '从未备份'}
            </dd>
          </div>
        </dl>

        {backupState?.reminderDue && (
          <p className="notice notice--warn">距上次备份已超过 7 天，建议立即导出一份。</p>
        )}

        <div className="button-row">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void handleExport()}
          >
            导出 JSON 备份
          </button>
          <label className="button button--outline">
            导入备份
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => void handleImport(event)}
            />
          </label>
        </div>

        <p className="card__footnote">{describeGeocodeAvailability()}</p>
      </section>

      <section className="card card--danger">
        <header className="card__header">
          <h2>危险操作</h2>
        </header>
        <p className="card__footnote">
          清除后本机将不再保留任何打卡数据。请先导出备份，再执行清除。
        </p>
        <button
          type="button"
          className="button button--danger"
          onClick={() => void handleClearAll()}
        >
          清除全部数据
        </button>
      </section>

      {status && <p className="notice notice--info">{status}</p>}
    </div>
  );
}
