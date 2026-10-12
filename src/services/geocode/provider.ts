import { isAmapConfigured } from '@/config/env';
import type { LocationSnapshot } from '@/domain/types';

/**
 * 逆地理 provider 接口（PRD §6 可维护性：可替换高德 / 腾讯 / 百度）。
 *
 * M1 状态（D-015）：只提供**空实现**，不请求任何第三方服务，坐标照常落库、地址留空。
 * 高德实现（`AMap.Geocoder`）随 M3 地点体系一并落地。
 */
export interface GeocodeProvider {
  readonly id: string;
  readonly available: boolean;
  reverse(snapshot: LocationSnapshot): Promise<LocationSnapshot>;
}

export class NoopGeocodeProvider implements GeocodeProvider {
  readonly id = 'noop';
  readonly available = false;

  async reverse(snapshot: LocationSnapshot): Promise<LocationSnapshot> {
    return { ...snapshot, address: null, reverseGeocode: 'skipped' };
  }
}

let currentProvider: GeocodeProvider = new NoopGeocodeProvider();

export function getGeocodeProvider(): GeocodeProvider {
  return currentProvider;
}

/** 供 M3 注入高德实现，或测试注入桩实现。 */
export function setGeocodeProvider(provider: GeocodeProvider): void {
  currentProvider = provider;
}

export function describeGeocodeAvailability(): string {
  return isAmapConfigured
    ? '已检测到高德 Key，但逆地理实现随 M3 接入（D-015）'
    : '未配置地图 Key：M1 只记录坐标，不解析地址（D-015）';
}
