import { UNNAMED_PLACE_LABEL } from '@/config/constants';
import type {
  LocationSnapshot,
  PlaceRecord,
  PunchTimeSource,
  SegmentStatus,
  SessionRecord,
  SettingsRecord,
} from '@/domain/types';

/**
 * 唯一的工时汇总入口（TECH-DESIGN §9）。
 *
 * 图表与列表明细**都必须**消费本函数的返回值，禁止各自重算，
 * 以此保证 PRD 验收标准 #10「图表与明细数字完全一致」。
 */

export type RangePreset = 'today' | 'week' | 'month' | 'custom';

export interface SummaryRange {
  start: number;
  end: number;
  preset: RangePreset;
  label: string;
}

export interface SessionView {
  id: string;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number;
  status: SegmentStatus;
  running: boolean;
  businessDay: string;
  placeId: string | null;
  placeName: string | null;
  location: LocationSnapshot | null;
  /** 该条记录的时间来源（PRD T-3 明细展示） */
  timeSource: PunchTimeSource;
  skewed: boolean;
}

export interface DayBucket {
  day: string;
  totalSeconds: number;
  effectiveSeconds: number;
  fragmentSeconds: number;
  targetSeconds: number;
  achievement: number;
}

export interface PlaceBucket {
  placeId: string | null;
  placeName: string;
  color: string | null;
  seconds: number;
  ratio: number;
  sessionCount: number;
}

export interface RangeSummary {
  range: SummaryRange;
  totalSeconds: number;
  effectiveSeconds: number;
  fragmentSeconds: number;
  targetSeconds: number;
  achievement: number;
  byDay: DayBucket[];
  byPlace: PlaceBucket[];
  sessions: SessionView[];
}

export interface SummarizeInput {
  sessions: readonly SessionRecord[];
  places: readonly PlaceRecord[];
  settings: SettingsRecord;
  range: SummaryRange;
  /** 用于计算「进行中」段的实时时长 */
  now: number;
}

/**
 * 段时长：
 * - 已闭合 → `endedAt − startedAt`
 * - 进行中 → 按当前校准时间实时计算（TECH-DESIGN §9 D3）
 * - `orphan`（未闭合且非运行态）→ 0，**不伪造工时**（D-011）
 */
export function segmentDurationSeconds(session: SessionRecord, now: number): number {
  if (session.endedAt !== null) {
    return Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000));
  }
  if (session.status === 'running') {
    return Math.max(0, Math.round((now - session.startedAt) / 1000));
  }
  return 0;
}

export function summarize(input: SummarizeInput): RangeSummary {
  const { sessions, places, settings, range, now } = input;
  const fragmentThresholdSeconds = settings.fragmentThresholdSeconds;
  const placeById = new Map(
    places.filter((place) => place.deleted === 0).map((place) => [place.id, place]),
  );

  const views: SessionView[] = sessions
    .filter(
      (session) =>
        session.deleted === 0 && session.startedAt >= range.start && session.startedAt < range.end,
    )
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((session) => {
      const durationSeconds = segmentDurationSeconds(session, now);
      const running = session.status === 'running' && session.endedAt === null;
      const place = session.placeId ? placeById.get(session.placeId) : undefined;

      let status: SegmentStatus;
      if (running) {
        status = 'running';
      } else if (session.endedAt === null) {
        status = 'orphan';
      } else {
        status = durationSeconds < fragmentThresholdSeconds ? 'fragment' : 'closed';
      }

      return {
        id: session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        durationSeconds,
        status,
        running,
        businessDay: session.businessDay,
        placeId: session.placeId,
        placeName: place?.name ?? null,
        location: session.startLocation,
        timeSource: session.timeSource,
        skewed: session.isDeviceClockSkewed,
      };
    });

  let effectiveSeconds = 0;
  let fragmentSeconds = 0;
  for (const view of views) {
    if (view.status === 'fragment') {
      fragmentSeconds += view.durationSeconds;
    } else {
      effectiveSeconds += view.durationSeconds;
    }
  }
  // 不变量：total 恒等于两类之和（orphan 时长为 0，天然成立）
  const totalSeconds = effectiveSeconds + fragmentSeconds;

  const byDay = buildDayBuckets(views, settings);
  const byPlace = buildPlaceBuckets(views, placeById, totalSeconds);

  const targetSeconds =
    range.preset === 'week'
      ? settings.weeklyTargetHours * 3600
      : settings.dailyTargetHours * 3600;

  return {
    range,
    totalSeconds,
    effectiveSeconds,
    fragmentSeconds,
    targetSeconds,
    achievement: targetSeconds > 0 ? effectiveSeconds / targetSeconds : 0,
    byDay,
    byPlace,
    sessions: views,
  };
}

function buildDayBuckets(views: readonly SessionView[], settings: SettingsRecord): DayBucket[] {
  const targetSeconds = settings.dailyTargetHours * 3600;
  const buckets = new Map<string, DayBucket>();

  for (const view of views) {
    const bucket =
      buckets.get(view.businessDay) ??
      ({
        day: view.businessDay,
        totalSeconds: 0,
        effectiveSeconds: 0,
        fragmentSeconds: 0,
        targetSeconds,
        achievement: 0,
      } satisfies DayBucket);

    bucket.totalSeconds += view.durationSeconds;
    if (view.status === 'fragment') {
      bucket.fragmentSeconds += view.durationSeconds;
    } else {
      bucket.effectiveSeconds += view.durationSeconds;
    }
    buckets.set(view.businessDay, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((bucket) => ({
      ...bucket,
      achievement: bucket.targetSeconds > 0 ? bucket.effectiveSeconds / bucket.targetSeconds : 0,
    }));
}

function buildPlaceBuckets(
  views: readonly SessionView[],
  placeById: Map<string, PlaceRecord>,
  totalSeconds: number,
): PlaceBucket[] {
  const buckets = new Map<string, PlaceBucket>();

  for (const view of views) {
    const place = view.placeId ? placeById.get(view.placeId) : undefined;
    const key = place?.id ?? '__unmatched__';
    const bucket =
      buckets.get(key) ??
      ({
        placeId: place?.id ?? null,
        placeName: place?.name ?? UNNAMED_PLACE_LABEL,
        color: place?.color ?? null,
        seconds: 0,
        ratio: 0,
        sessionCount: 0,
      } satisfies PlaceBucket);

    bucket.seconds += view.durationSeconds;
    bucket.sessionCount += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .map((bucket) => ({
      ...bucket,
      ratio: totalSeconds > 0 ? bucket.seconds / totalSeconds : 0,
    }));
}
