import { formatOffset } from '@/domain/time/format';
import { describeClockStatus } from '@/services/clock/clockService';

import { useClock } from '@/features/punch/hooks';

/** 顶部常驻的校准时钟与同步状态（PRD T-2、T-3）。 */
export function SyncStatusBar() {
  const clock = useClock();
  const tone = clock.status === 'synced' ? 'ok' : clock.status === 'syncing' ? 'busy' : 'warn';

  return (
    <div className={`sync-status sync-status--${tone}`}>
      <span className="sync-status__dot" aria-hidden="true" />
      <span className="sync-status__label">{describeClockStatus(clock)}</span>
      {clock.status === 'synced' && (
        <span className="sync-status__detail">
          偏差 {formatOffset(clock.offsetMs)} · 源 {clock.sourceId}
        </span>
      )}
      {clock.skewWarning && <span className="sync-status__warn">设备时间异常</span>}
      {clock.message && clock.status !== 'synced' && (
        <span className="sync-status__detail">{clock.message}</span>
      )}
    </div>
  );
}
