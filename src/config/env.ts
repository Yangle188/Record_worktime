/**
 * 环境变量读取与校验。
 * 高德 Key 仅 M3 需要（D-015）；M1 为空时应用走降级实现，不报错。
 */
export interface AppEnv {
  amapKey: string | null;
  amapSecurityCode: string | null;
}

function readOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const env: AppEnv = {
  amapKey: readOptional(import.meta.env.VITE_AMAP_KEY),
  amapSecurityCode: readOptional(import.meta.env.VITE_AMAP_SECURITY_CODE),
};

export const isAmapConfigured = env.amapKey !== null;
