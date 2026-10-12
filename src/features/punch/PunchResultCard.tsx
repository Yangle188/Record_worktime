import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { formatAccuracy, formatClock, formatCoordinate, formatDuration } from '@/domain/time/format';
import { describeLocationStatus } from '@/services/location/geolocation';
import type { PunchOutcome } from './punchService';

interface PunchResultCardProps {
  outcome: PunchOutcome;
  totalSecondsToday: number;
  onClose: () => void;
}

/**
 * 打卡结果卡片（PRD V-1、验收 #2）：每次打卡后必定弹出。
 *
 * M1 按 D-015 不含地图缩略图与逆地理地址，改为展示坐标 + 精度 + 时间来源。
 * 地点是**落库之后**补写的（TECH-DESIGN §10），因此这里订阅记录本身而不是读 outcome 快照，
 * 定位返回后卡片会自动更新。
 */
export function PunchResultCard({ outcome, totalSecondsToday, onClose }: PunchResultCardProps) {
  const isStart = outcome.action === 'start';

  const session = useLiveQuery(() => db.sessions.get(outcome.session.id), [outcome.session.id]);
  const location =
    session === undefined ? undefined : isStart ? session.startLocation : session.endLocation;

  return (
    <div className="result-card-backdrop" role="dialog" aria-modal="true" aria-label="打卡结果">
      <section className="result-card">
        <header className="result-card__header">
          <span className={`result-card__badge result-card__badge--${isStart ? 'start' : 'end'}`}>
            {isStart ? '开始工作' : '结束工作'}
          </span>
          <h2>{formatClock(outcome.session.startedAt)}</h2>
          <p className="result-card__sub">
            时间来源：{outcome.timeSource === 'network' ? '联网校准' : '本地时间（未校准）'}
            {outcome.clockOffsetMs !== 0 && ` · 偏差 ${Math.round(outcome.clockOffsetMs)} ms`}
          </p>
        </header>

        <dl className="result-card__metrics">
          <div>
            <dt>{isStart ? '本次' : '本次时长'}</dt>
            <dd>{formatDuration(outcome.durationSeconds ?? 0)}</dd>
          </div>
          <div>
            <dt>今日累计</dt>
            <dd>{formatDuration(totalSecondsToday)}</dd>
          </div>
        </dl>

        <div className="result-card__location">
          <span className="result-card__location-status">
            {location === undefined
              ? '读取中…'
              : location === null
                ? '正在获取定位…'
                : describeLocationStatus(location.status)}
          </span>
          {location && location.status === 'ok' && (
            <span className="result-card__location-detail">
              {formatCoordinate(location.lat, location.lng)} · {formatAccuracy(location.accuracyM)}
            </span>
          )}
        </div>

        {outcome.skewWarning && (
          <p className="result-card__warning">设备时间与网络时间偏差超过 60 秒，该条记录已打标。</p>
        )}
        {outcome.isFragment && (
          <p className="result-card__warning">本次段短于碎片阈值，保留记录但不计入工时。</p>
        )}

        <button type="button" className="button button--primary" onClick={onClose} autoFocus>
          知道了
        </button>
      </section>
    </div>
  );
}
