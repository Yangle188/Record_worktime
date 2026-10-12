import { CLOCK_SAMPLES_PER_SOURCE, DEFAULT_TIME_SOURCE_IDS } from '@/config/constants';
import { META_KEYS, setMeta } from '@/db/repos/meta.repo';
import {
  computeOffsetMs,
  isDeviceClockSkewed,
  pickLowestRtt,
  reconcileCalibration,
  type TimeSample,
} from '@/domain/time/calibration';
import { deviceNow, monotonicNow } from '@/domain/time/monotonic';
import type { PunchTimeSource } from '@/domain/types';
import { resolveTimeSources, type TimeSource } from '@/services/clock/timeSources';

export type ClockStatus = 'idle' | 'syncing' | 'synced' | 'degraded';

export interface ClockState {
  status: ClockStatus;
  /** 网络时间 − 设备时间 */
  offsetMs: number;
  rttMs: number | null;
  sourceId: string | null;
  syncedAt: number | null;
  /** 偏差 > 60s，提示「设备时间异常」（PRD T-4） */
  skewWarning: boolean;
  message: string | null;
}

/** 打卡瞬间需要落库的时间信息。 */
export interface ClockStamp {
  /** 入库时间：已校准用网络时间，否则退化为设备时间（PRD T-5） */
  time: number;
  deviceTime: number;
  offsetMs: number;
  source: PunchTimeSource;
  skewed: boolean;
}

export type ClockListener = (state: ClockState) => void;

const INITIAL_STATE: ClockState = {
  status: 'idle',
  offsetMs: 0,
  rttMs: null,
  sourceId: null,
  syncedAt: null,
  skewWarning: false,
  message: null,
};

export interface ClockServiceOptions {
  sources?: TimeSource[];
  fetchImpl?: typeof fetch;
  samplesPerSource?: number;
}

export class ClockService {
  private state: ClockState = INITIAL_STATE;
  private readonly listeners = new Set<ClockListener>();
  private readonly sources: TimeSource[];
  private readonly fetchImpl: typeof fetch;
  private readonly samplesPerSource: number;

  constructor(options: ClockServiceOptions = {}) {
    this.sources = options.sources ?? resolveTimeSources(DEFAULT_TIME_SOURCE_IDS);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.samplesPerSource = options.samplesPerSource ?? CLOCK_SAMPLES_PER_SOURCE;
  }

  getState(): ClockState {
    return this.state;
  }

  subscribe(listener: ClockListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isCalibrated(): boolean {
    return this.state.status === 'synced';
  }

  /** 校准后的「现在」（PRD T-2）。 */
  now(): number {
    return monotonicNow() + this.state.offsetMs;
  }

  deviceNow(): number {
    return deviceNow();
  }

  /** 打卡取时间：未校准时使用设备本地时间并标记 `local`（PRD T-5）。 */
  stamp(): ClockStamp {
    const deviceTime = deviceNow();
    if (this.isCalibrated()) {
      return {
        time: this.now(),
        deviceTime,
        offsetMs: this.state.offsetMs,
        source: 'network',
        skewed: this.state.skewWarning,
      };
    }
    return {
      time: deviceTime,
      deviceTime,
      offsetMs: this.state.offsetMs,
      source: 'local',
      skewed: this.state.skewWarning,
    };
  }

  async sync(): Promise<ClockState> {
    this.setState({ ...this.state, status: 'syncing', message: null });

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return this.setState({
        ...this.state,
        status: 'degraded',
        message: '设备离线，使用本地时间（未校准）',
      });
    }

    const bestPerSource: TimeSample[] = [];
    for (const source of this.sources) {
      const best = await this.sampleSource(source);
      if (best) bestPerSource.push(best);
    }

    const outcome = reconcileCalibration(bestPerSource);
    if (!outcome) {
      return this.setState({
        status: 'degraded',
        offsetMs: 0,
        rttMs: null,
        sourceId: null,
        syncedAt: null,
        skewWarning: false,
        message: '全部时间源不可用，使用本地时间（未校准）',
      });
    }

    const skewWarning = isDeviceClockSkewed(outcome.offsetMs);
    const next: ClockState = {
      status: 'synced',
      offsetMs: outcome.offsetMs,
      rttMs: outcome.rttMs,
      sourceId: outcome.sourceId,
      syncedAt: deviceNow(),
      skewWarning,
      message: skewWarning
        ? `设备时间与网络时间偏差 ${Math.round(outcome.offsetMs / 1000)} 秒，请检查设备时间`
        : null,
    };

    await this.persist(next);
    return this.setState(next);
  }

  private async sampleSource(source: TimeSource): Promise<TimeSample | null> {
    const samples: TimeSample[] = [];

    for (let attempt = 0; attempt < this.samplesPerSource; attempt += 1) {
      const sentAt = monotonicNow();
      try {
        const response = await this.fetchImpl(source.url, { cache: 'no-store' });
        if (!response.ok) continue;
        const serverTime = await source.parse(response);
        const receivedAt = monotonicNow();
        samples.push({
          sourceId: source.id,
          serverTime,
          sentAt,
          receivedAt,
          rttMs: Math.max(0, receivedAt - sentAt),
          offsetMs: computeOffsetMs(serverTime, sentAt, receivedAt),
        });
      } catch {
        // 单次采样失败不影响其它样本；全部失败则该源视为不可用
      }
    }

    return pickLowestRtt(samples);
  }

  private async persist(state: ClockState): Promise<void> {
    try {
      await setMeta(META_KEYS.calibrationOffsetMs, state.offsetMs);
      await setMeta(META_KEYS.calibrationAt, state.syncedAt);
      await setMeta(META_KEYS.calibrationSourceId, state.sourceId);
    } catch {
      // 持久化失败不影响本次校准结果
    }
  }

  private setState(next: ClockState): ClockState {
    this.state = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }
}

export const clockService = new ClockService();

export function describeClockStatus(state: ClockState): string {
  switch (state.status) {
    case 'syncing':
      return '同步中…';
    case 'synced':
      return '已同步';
    case 'degraded':
      return '未校准（本地时间）';
    default:
      return '等待同步';
  }
}
