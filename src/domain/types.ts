/**
 * 领域类型：全应用唯一的类型来源（TECH-DESIGN §4）。
 * 注意：命名使用 camelCase，与 PRD §7 的 snake_case 描述对照见 TECH-DESIGN §4.2。
 */

/** 打卡动作 */
export type PunchAction = 'start' | 'end';

/** 该条记录的时间来源：网络校准 / 本地兜底（PRD T-3） */
export type PunchTimeSource = 'network' | 'local';

/** 段状态（TECH-DESIGN §5.1） */
export type SegmentStatus = 'running' | 'closed' | 'fragment' | 'orphan';

/** 定位结果状态；失败也是一种「已记录」的状态，用于区分失败原因（PRD L-2） */
export type LocationStatus = 'ok' | 'denied' | 'timeout' | 'unavailable' | 'error';

/** 逆地理编码结果 */
export type ReverseGeocodeStatus = 'ok' | 'failed' | 'skipped';

/** 打卡瞬间的位置快照（内嵌值对象，TECH-DESIGN §4.5） */
export interface LocationSnapshot {
  lat: number;
  lng: number;
  /** 库内统一 WGS84（TECH-DESIGN §7.3） */
  coordSystem: 'WGS84';
  accuracyM: number | null;
  address: string | null;
  poiName: string | null;
  capturedAt: number;
  status: LocationStatus;
  errorCode: number | null;
  reverseGeocode: ReverseGeocodeStatus;
}

/** 打卡段（Dexie `sessions` 表） */
export interface SessionRecord {
  id: string;
  /** 校准后的网络时间；离线时为本地时间（PRD T-1） */
  startedAt: number;
  /** `null` 表示进行中 */
  endedAt: number | null;
  durationSeconds: number | null;
  /** `YYYY-MM-DD`，按业务日边界归属的开始日（D-008） */
  businessDay: string;
  startLocation: LocationSnapshot | null;
  endLocation: LocationSnapshot | null;
  placeId: string | null;
  endPlaceId: string | null;
  timeSource: PunchTimeSource;
  /** 打卡瞬间 `网络时间 − 设备时间`（PRD T-3） */
  clockOffsetMs: number;
  /** 设备墙钟原值，仅作参考 */
  deviceStartedAt: number;
  deviceEndedAt: number | null;
  /** 幂等键：重复点击 / 离线重放的防线（C-6） */
  idempotencyKey: string;
  status: SegmentStatus;
  /** 设备时间偏差 > 60s 时打标（PRD T-4） */
  isDeviceClockSkewed: boolean;
  note: string | null;
  /** P1 编辑痕迹 */
  editedAt: number | null;
  /** 软删除标记：0 正常 / 1 已删除（IndexedDB 索引不接受 null） */
  deleted: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

/** 地点（Dexie `places` 表） */
export interface PlaceRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  color: string;
  icon: string | null;
  deleted: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

/** 应用设置（单例，`id` 固定为 `app`） */
export interface SettingsRecord {
  id: 'app';
  dailyTargetHours: number;
  weeklyTargetHours: number;
  businessDayBoundaryMinutes: number;
  fragmentThresholdSeconds: number;
  longSegmentThresholdHours: number;
  defaultPlaceRadiusM: number;
  timeSourceIds: string[];
  schemaVersion: number;
}

/** 键值元数据（Dexie `meta` 表） */
export interface MetaRecord {
  key: string;
  value: unknown;
}
