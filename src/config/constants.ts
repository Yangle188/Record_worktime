/** 全局默认值：均可在设置页覆盖（PRD §4.5、§4.6）。 */

export const APP_VERSION = '0.1.0';

export const DB_NAME = 'check_app';

/** 日目标（小时） */
export const DEFAULT_DAILY_TARGET_HOURS = 8;

/** 周目标（小时） */
export const DEFAULT_WEEKLY_TARGET_HOURS = 40;

/** 业务日边界：默认 04:00 换日（D-008） */
export const DEFAULT_BUSINESS_DAY_BOUNDARY_MINUTES = 4 * 60;

/** 碎片阈值（秒）：短于该值的段保留记录但不计入工时（PRD §4.5） */
export const DEFAULT_FRAGMENT_THRESHOLD_SECONDS = 60;

/** 异常长段阈值（小时）：超过则弹窗确认（C-5 / D-011） */
export const DEFAULT_LONG_SEGMENT_THRESHOLD_HOURS = 12;

/** 地点默认半径（米） */
export const DEFAULT_PLACE_RADIUS_M = 200;

/** 单次定位超时（毫秒）—— 用于首页展示型定位 */
export const GEOLOCATION_TIMEOUT_MS = 8_000;

/**
 * 打卡路径的定位超时（毫秒）。
 *
 * 打卡要满足 PRD §6「点击打卡到落库 < 3s（含定位耗时）」，因此不能沿用 8s 的展示型超时；
 * 超时即按 L-2 落库但不记录地点（可事后补，P1）。
 */
export const GEOLOCATION_PUNCH_TIMEOUT_MS = 3_000;

/** 首页「当前地址」前台刷新间隔（毫秒，D-004 例外条款，不落库） */
export const FOREGROUND_LOCATION_REFRESH_MS = 60_000;

/** 时钟重采样间隔（毫秒） */
export const CLOCK_RESYNC_INTERVAL_MS = 15 * 60_000;

/** 每个时间源的采样次数 */
export const CLOCK_SAMPLES_PER_SOURCE = 3;

/** 超过该时长未备份则在首页提醒（PRD §9） */
export const BACKUP_REMINDER_AFTER_MS = 7 * 24 * 60 * 60_000;

/** 默认启用的时间源 id，按优先级排列（TECH-DESIGN §6.2） */
export const DEFAULT_TIME_SOURCE_IDS = ['timeapi-io', 'cloudflare-trace'];

/** 「未匹配到地点」在汇总中的展示名（PRD P-3） */
export const UNNAMED_PLACE_LABEL = '未命名地点';
