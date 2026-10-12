/**
 * 时间校准的纯计算部分（TECH-DESIGN §6.2）：NTP 简化算法的 offset / RTT 推导与多源取信。
 * 网络 IO 在 `services/clock`，这里只做可单测的数学。
 */

/** 一次采样 */
export interface TimeSample {
  sourceId: string;
  /** 服务端时间（epoch ms） */
  serverTime: number;
  /** 发包时刻（单调时间轴） */
  sentAt: number;
  /** 收包时刻（单调时间轴） */
  receivedAt: number;
  /** 往返时延 */
  rttMs: number;
  /** `服务端时间 − (发包 + 收包) / 2` */
  offsetMs: number;
}

/** 设备与网络时间偏差超过该值即视为「设备时间异常」（PRD T-4） */
export const CLOCK_SKEW_THRESHOLD_MS = 60_000;

/** 多个时间源之间偏差超过该值即认为该源不可信（PRD §9 多源降级） */
export const MAX_SOURCE_DISAGREEMENT_MS = 2_000;

/** 假设往返路径对称，取中点作为服务端时间对应的本地时刻。 */
export function computeOffsetMs(serverTime: number, sentAt: number, receivedAt: number): number {
  return serverTime - (sentAt + receivedAt) / 2;
}

/** 最小 RTT 样本最接近对称路径，误差最小。 */
export function pickLowestRtt(samples: readonly TimeSample[]): TimeSample | null {
  if (samples.length === 0) return null;
  return samples.reduce((best, sample) => (sample.rttMs < best.rttMs ? sample : best));
}

export function isDeviceClockSkewed(
  offsetMs: number,
  thresholdMs: number = CLOCK_SKEW_THRESHOLD_MS,
): boolean {
  return Math.abs(offsetMs) > thresholdMs;
}

export interface RejectedSource {
  sourceId: string;
  offsetMs: number;
  deviationMs: number;
}

export interface CalibrationOutcome {
  offsetMs: number;
  sourceId: string;
  rttMs: number;
  /** 与选定源偏差过大而被丢弃的源 */
  rejectedSources: RejectedSource[];
}

/**
 * 多源取信：以最小 RTT 源为准，其余源仅作合理性校验。
 * @param bestPerSource 每个时间源一条最优样本
 */
export function reconcileCalibration(
  bestPerSource: readonly TimeSample[],
  maxDisagreementMs: number = MAX_SOURCE_DISAGREEMENT_MS,
): CalibrationOutcome | null {
  const chosen = pickLowestRtt(bestPerSource);
  if (!chosen) return null;

  const rejectedSources = bestPerSource
    .filter((sample) => sample.sourceId !== chosen.sourceId)
    .map((sample) => ({
      sourceId: sample.sourceId,
      offsetMs: sample.offsetMs,
      deviationMs: Math.abs(sample.offsetMs - chosen.offsetMs),
    }))
    .filter((sample) => sample.deviationMs > maxDisagreementMs);

  return {
    offsetMs: chosen.offsetMs,
    sourceId: chosen.sourceId,
    rttMs: chosen.rttMs,
    rejectedSources,
  };
}
