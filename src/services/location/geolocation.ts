import { GEOLOCATION_TIMEOUT_MS } from '@/config/constants';
import { monotonicNow } from '@/domain/time/monotonic';
import type { LocationSnapshot, LocationStatus } from '@/domain/types';

/**
 * 打卡时的一次性定位（D-004 / PRD L-1、L-2）。
 *
 * 约定：**任何失败都返回快照而不是抛错**，保证定位问题绝不阻塞打卡。
 * 库内坐标统一 WGS84（TECH-DESIGN §7.3）。
 */

export interface GeolocationOptions {
  timeoutMs?: number;
  highAccuracy?: boolean;
}

const GEOLOCATION_ERROR_STATUS: Record<number, LocationStatus> = {
  1: 'denied',
  2: 'unavailable',
  3: 'timeout',
};

export function isSecureContextAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

export function createLocationSnapshot(
  status: LocationStatus,
  capturedAt: number,
  errorCode: number | null = null,
): LocationSnapshot {
  return {
    lat: 0,
    lng: 0,
    coordSystem: 'WGS84',
    accuracyM: null,
    address: null,
    poiName: null,
    capturedAt,
    status,
    errorCode,
    reverseGeocode: 'skipped',
  };
}

export async function getOnce(options: GeolocationOptions = {}): Promise<LocationSnapshot> {
  const capturedAt = monotonicNow();

  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return createLocationSnapshot('unavailable', capturedAt);
  }
  if (!isSecureContextAvailable()) {
    // 定位 API 要求安全上下文（PRD §6）
    return createLocationSnapshot('unavailable', capturedAt);
  }

  const { timeoutMs = GEOLOCATION_TIMEOUT_MS, highAccuracy = true } = options;

  return new Promise<LocationSnapshot>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracy = position.coords.accuracy;
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          coordSystem: 'WGS84',
          accuracyM: Number.isFinite(accuracy) ? accuracy : null,
          address: null,
          poiName: null,
          capturedAt,
          status: 'ok',
          errorCode: null,
          reverseGeocode: 'skipped',
        });
      },
      (error) => {
        resolve(
          createLocationSnapshot(
            GEOLOCATION_ERROR_STATUS[error.code] ?? 'error',
            capturedAt,
            typeof error.code === 'number' ? error.code : null,
          ),
        );
      },
      { enableHighAccuracy: highAccuracy, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export function describeLocationStatus(status: LocationStatus): string {
  switch (status) {
    case 'ok':
      return '已记录坐标';
    case 'denied':
      return '定位权限被拒绝，未记录地点';
    case 'timeout':
      return '定位超时，未记录地点';
    case 'unavailable':
      return '当前环境无法定位，未记录地点';
    default:
      return '定位失败，未记录地点';
  }
}
