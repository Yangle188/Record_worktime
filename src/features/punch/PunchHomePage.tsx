import { useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { listActivePlaces } from '@/db/repos/places.repo';
import { listSessionsInRange } from '@/db/repos/sessions.repo';
import { META_KEYS, getMeta } from '@/db/repos/meta.repo';
import { businessDayOf, businessDayRange } from '@/domain/time/businessDay';
import { formatDuration, formatTimeHM } from '@/domain/time/format';
import { isLongRunningSegment } from '@/domain/time/segment';
import { summarize } from '@/domain/stats/summarize';
import { isBackupReminderDue } from '@/services/backup/backupService';
import { useSettings } from '@/db/hooks';
import { GoalRing } from './GoalRing';
import { PunchResultCard } from './PunchResultCard';
import { useCalibratedNow, usePunchController } from './hooks';

/** 打卡首页（PRD §4.6）：校准时钟 + 主按钮 + 进行中计时 + 今日累计 + 环形进度。 */
export function PunchHomePage() {
  const now = useCalibratedNow(1000);
  const controller = usePunchController();
  const alertedSegmentRef = useRef<string | null>(null);

  const settings = useSettings();
  const boundary = settings.businessDayBoundaryMinutes;
  const day = businessDayOf(now, boundary);
  const range = useMemo(() => businessDayRange(day, boundary), [day, boundary]);

  const sessions = useLiveQuery(
    () => listSessionsInRange(range.start, range.end),
    [range.start, range.end],
  );
  const places = useLiveQuery(() => listActivePlaces(), []);
  const lastBackupAt = useLiveQuery(() => getMeta<number | null>(META_KEYS.lastBackupAt, null), []);

  const summary = useMemo(() => {
    if (!sessions || !places) return null;
    return summarize({
      sessions,
      places,
      settings,
      range: { ...range, preset: 'today', label: day },
      now,
    });
  }, [settings, sessions, places, range, day, now]);

  const running = controller.running;
  const runningSeconds = running ? Math.max(0, Math.round((now - running.startedAt) / 1000)) : 0;
  const activeTimeSources = settings.timeSourceIds;
  const reminderDue = isBackupReminderDue(lastBackupAt ?? null, now);

  useEffect(() => {
    if (!running) return;
    if (
      isLongRunningSegment(running, now, settings.longSegmentThresholdHours) &&
      alertedSegmentRef.current !== running.id
    ) {
      alertedSegmentRef.current = running.id;
      window.confirm(
        `这个段已经持续超过 ${settings.longSegmentThresholdHours} 小时了，还在工作吗？\n（不会自动截断，可稍后手动修正）`,
      );
    }
  }, [running, settings, now]);

  return (
    <div className="page">
      {reminderDue && (
        <p className="notice notice--warn">
          已超过 7 天未备份本机数据。浏览器清理站点数据会导致记录永久丢失，建议前往
          <Link to="/settings">设置</Link> 导出备份。
        </p>
      )}

      <section className="punch-hero">
        <GoalRing
          achievement={summary?.achievement ?? 0}
          headline={formatDuration(summary?.totalSeconds ?? 0)}
          caption={`今日目标 ${settings.dailyTargetHours} 小时`}
          running={Boolean(running)}
        />

        <button
          type="button"
          className={`punch-button${running ? ' punch-button--running' : ''}`}
          onClick={() => void controller.toggle()}
          disabled={controller.busy || controller.loading}
        >
          <span className="punch-button__label">
            {controller.loading
              ? '读取中…'
              : controller.busy
                ? '处理中…'
                : running
                  ? '结束工作'
                  : '开始工作'}
          </span>
          {running && <span className="punch-button__timer">{formatDuration(runningSeconds)}</span>}
        </button>

        <p className="punch-hero__hint">
          {running
            ? `进行中 · 开始于 ${formatTimeHM(running.startedAt)}（${running.timeSource === 'network' ? '校准时间' : '本地时间'}）`
            : '打卡会记录联网校准的时间与一次定位坐标'}
        </p>
        <p className="punch-hero__meta">启用时间源：{activeTimeSources.join('、')}</p>
      </section>

      <section className="card">
        <header className="card__header">
          <h2>今日分段</h2>
          <span className="card__hint">{day}</span>
        </header>
        {sessions === undefined ? (
          <p className="empty-state">正在读取本机记录…</p>
        ) : summary && summary.sessions.length > 0 ? (
          <ul className="segment-list">
            {summary.sessions.map((session) => (
              <li key={session.id} className="segment-list__item">
                <span className="segment-list__time">
                  {formatTimeHM(session.startedAt)}
                  {session.endedAt !== null ? ` – ${formatTimeHM(session.endedAt)}` : ' – 进行中'}
                </span>
                <span className="segment-list__duration">
                  {formatDuration(session.durationSeconds)}
                </span>
                <span className={`segment-list__tag segment-list__tag--${session.status}`}>
                  {session.status === 'running'
                    ? '计时中'
                    : session.status === 'fragment'
                      ? '碎片'
                      : session.status === 'orphan'
                        ? '未闭合'
                        : '已完成'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">今天还没有打卡，点上面的按钮开始记录吧。</p>
        )}
        {summary && summary.fragmentSeconds > 0 && (
          <p className="card__footnote">
            碎片合计 {formatDuration(summary.fragmentSeconds)}，保留记录但不计入工时。
          </p>
        )}
      </section>

      {controller.error && (
        <div className="notice notice--error" role="alert">
          {controller.error}
          <button type="button" className="button button--ghost" onClick={controller.dismissError}>
            关闭
          </button>
        </div>
      )}

      {controller.outcome && (
        <PunchResultCard
          outcome={controller.outcome}
          totalSecondsToday={summary?.totalSeconds ?? 0}
          onClose={controller.dismissOutcome}
        />
      )}
    </div>
  );
}
