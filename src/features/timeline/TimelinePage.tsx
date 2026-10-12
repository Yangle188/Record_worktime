import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings } from '@/db/hooks';
import { listSessionsInRange } from '@/db/repos/sessions.repo';
import { businessDayOf, businessDayRange } from '@/domain/time/businessDay';
import {
  formatAccuracy,
  formatCoordinate,
  formatDuration,
  formatTimeHM,
} from '@/domain/time/format';
import { describeLocationStatus } from '@/services/location/geolocation';
import { summarize } from '@/domain/stats/summarize';
import { useCalibratedNow } from '@/features/punch/hooks';

/** 记录页（PRD §4.6、V-3）：今日时间轴 + 段详情。 */
export function TimelinePage() {
  const now = useCalibratedNow(1000);
  const [dayOffset, setDayOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const settings = useSettings();
  const boundary = settings.businessDayBoundaryMinutes;
  const day = businessDayOf(now + dayOffset * 86_400_000, boundary);
  const range = useMemo(() => businessDayRange(day, boundary), [day, boundary]);
  const sessions = useLiveQuery(
    () => listSessionsInRange(range.start, range.end),
    [range.start, range.end],
  );

  const summary = useMemo(() => {
    if (!sessions) return null;
    return summarize({
      sessions,
      places: [],
      settings,
      range: { ...range, preset: 'today', label: day },
      now,
    });
  }, [settings, sessions, range, day, now]);

  const positionPercent = (timestamp: number) => {
    const ratio = ((timestamp - range.start) / (range.end - range.start)) * 100;
    return Math.max(0, Math.min(100, ratio));
  };

  return (
    <div className="page">
      <section className="card">
        <header className="card__header">
          <h2>时间轴</h2>
          <div className="day-switcher">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDayOffset((v) => v - 1)}
            >
              前一天
            </button>
            <span className="day-switcher__label">{day}</span>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setDayOffset((v) => Math.min(0, v + 1))}
              disabled={dayOffset >= 0}
            >
              后一天
            </button>
          </div>
        </header>

        {summary && summary.sessions.length > 0 ? (
          <>
            <div className="gantt" role="list">
              {summary.sessions.map((session) => {
                const start = positionPercent(session.startedAt);
                const end = positionPercent(session.endedAt ?? now);
                return (
                  <div key={session.id} className="gantt__row" role="listitem">
                    <span className="gantt__axis">{formatTimeHM(session.startedAt)}</span>
                    <button
                      type="button"
                      className={`gantt__bar gantt__bar--${session.status}`}
                      style={{ left: `${start}%`, width: `${Math.max(end - start, 0.8)}%` }}
                      onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
                      aria-label={`${formatTimeHM(session.startedAt)} 到 ${
                        session.endedAt ? formatTimeHM(session.endedAt) : '现在'
                      }，时长 ${formatDuration(session.durationSeconds)}`}
                    />
                  </div>
                );
              })}
            </div>

            <ul className="segment-list segment-list--detailed">
              {summary.sessions.map((session) => (
                <li key={session.id} className="segment-list__item segment-list__item--stacked">
                  <div className="segment-list__row">
                    <span className="segment-list__time">
                      {formatTimeHM(session.startedAt)}
                      {session.endedAt !== null
                        ? ` – ${formatTimeHM(session.endedAt)}`
                        : ' – 进行中'}
                    </span>
                    <span className="segment-list__duration">
                      {formatDuration(session.durationSeconds)}
                    </span>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setExpandedId(expandedId === session.id ? null : session.id)}
                    >
                      {expandedId === session.id ? '收起' : '明细'}
                    </button>
                  </div>
                  {expandedId === session.id && (
                    <dl className="segment-detail">
                      <div>
                        <dt>地点</dt>
                        <dd>{session.placeName ?? '未命名地点'}</dd>
                      </div>
                      <div>
                        <dt>定位</dt>
                        <dd>
                          {describeLocationStatus(session.location?.status ?? 'error')}
                          {session.location?.status === 'ok' &&
                            ` · ${formatCoordinate(session.location.lat, session.location.lng)} · ${formatAccuracy(session.location.accuracyM)}`}
                        </dd>
                      </div>
                      <div>
                        <dt>时间来源</dt>
                        <dd>
                          {session.timeSource === 'network' ? '联网校准' : '本地时间（未校准）'}
                          {session.skewed ? ' · 设备时间异常' : ''}
                        </dd>
                      </div>
                    </dl>
                  )}
                </li>
              ))}
            </ul>

            <p className="card__footnote">
              有效工时 {formatDuration(summary.effectiveSeconds)}
              {summary.fragmentSeconds > 0 &&
                ` · 碎片 ${formatDuration(summary.fragmentSeconds)}（不计入）`}
            </p>
          </>
        ) : (
          <p className="empty-state">这一天没有打卡记录。</p>
        )}
      </section>
    </div>
  );
}
