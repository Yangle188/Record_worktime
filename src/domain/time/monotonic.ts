/**
 * 单调时钟（TECH-DESIGN §6.2）。
 *
 * 以 `performance.now()` 为基准，起点锚定一次设备墙钟，之后完全免疫用户中途拨动系统时间。
 * 所有「现在几点」的读取都必须走这里，而不是 `Date.now()`。
 */

let epochAtPerfStart: number | null = null;

/** 单调递增的「设备时间轴」（epoch ms）。 */
export function monotonicNow(): number {
  if (epochAtPerfStart === null) {
    epochAtPerfStart = Date.now() - performance.now();
  }
  return epochAtPerfStart + performance.now();
}

/** 设备墙钟原值，仅用于记录「设备自己认为的」时间（PRD T-1）。 */
export function deviceNow(): number {
  return Date.now();
}

/** 测试用：重置锚点。 */
export function resetMonotonicClock(): void {
  epochAtPerfStart = null;
}
