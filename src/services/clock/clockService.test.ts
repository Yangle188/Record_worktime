import { describe, expect, it, vi } from 'vitest';
import { ClockService } from '@/services/clock/clockService';
import type { TimeSource } from '@/services/clock/timeSources';

function createSource(id: string, parse: TimeSource['parse']): TimeSource {
  return {
    id,
    label: id,
    kind: 'jsonTimestamp',
    url: `https://${id}.test/time`,
    note: '',
    parse,
  };
}

const okResponse = () => new Response('{}', { status: 200 });

describe('ClockService.sync', () => {
  it('采样成功后进入 synced，并给出正偏移与源标识', async () => {
    const serverTime = Date.now() + 5_000;
    const service = new ClockService({
      sources: [createSource('stub', async () => serverTime)],
      fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
      samplesPerSource: 2,
    });

    const state = await service.sync();

    expect(state.status).toBe('synced');
    expect(state.sourceId).toBe('stub');
    expect(state.offsetMs).toBeGreaterThan(3_000);
    expect(state.offsetMs).toBeLessThan(6_000);
    expect(state.skewWarning).toBe(false);
    expect(Math.abs(service.now() - serverTime)).toBeLessThan(2_000);
    expect(service.stamp().source).toBe('network');
  });

  it('偏差超过 60 秒时标记设备时间异常（PRD T-4）', async () => {
    const serverTime = Date.now() + 120_000;
    const service = new ClockService({
      sources: [createSource('stub', async () => serverTime)],
      fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
      samplesPerSource: 1,
    });

    const state = await service.sync();

    expect(state.status).toBe('synced');
    expect(state.skewWarning).toBe(true);
    expect(state.message).toContain('设备时间');
  });

  it('全部时间源失败时降级为未校准，打卡退回本地时间（PRD T-5）', async () => {
    const service = new ClockService({
      sources: [
        createSource('broken', async () => {
          throw new Error('解析失败');
        }),
      ],
      fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
      samplesPerSource: 1,
    });

    const state = await service.sync();

    expect(state.status).toBe('degraded');
    expect(state.sourceId).toBeNull();
    expect(service.isCalibrated()).toBe(false);
    expect(service.stamp().source).toBe('local');
  });

  it('HTTP 非 2xx 视为该次采样失败', async () => {
    const service = new ClockService({
      sources: [createSource('stub', async () => Date.now())],
      fetchImpl: (async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
      samplesPerSource: 1,
    });

    expect((await service.sync()).status).toBe('degraded');
  });

  it('设备离线时直接降级且不发请求', async () => {
    const fetchImpl = vi.fn();
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true,
    });

    try {
      const service = new ClockService({
        sources: [createSource('stub', async () => Date.now())],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        samplesPerSource: 1,
      });

      const state = await service.sync();

      expect(state.status).toBe('degraded');
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it('订阅者能收到状态变化', async () => {
    const service = new ClockService({
      sources: [createSource('stub', async () => Date.now())],
      fetchImpl: (async () => okResponse()) as unknown as typeof fetch,
      samplesPerSource: 1,
    });

    const seen: string[] = [];
    const unsubscribe = service.subscribe((state) => seen.push(state.status));

    await service.sync();
    unsubscribe();

    expect(seen).toContain('syncing');
    expect(seen.at(-1)).toBe('synced');
  });
});
