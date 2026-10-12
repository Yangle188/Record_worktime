import { GEOLOCATION_PUNCH_TIMEOUT_MS } from '@/config/constants';
import { db } from '@/db/db';
import { ensureSettings } from '@/db/repos/settings.repo';
import { businessDayOf } from '@/domain/time/businessDay';
import { monotonicNow } from '@/domain/time/monotonic';
import type {
  LocationSnapshot,
  PunchAction,
  PunchTimeSource,
  SegmentStatus,
  SessionRecord,
} from '@/domain/types';
import { clockService, type ClockStamp } from '@/services/clock/clockService';
import { getGeocodeProvider } from '@/services/geocode/provider';
import { createLocationSnapshot, getOnce } from '@/services/location/geolocation';

/**
 * 打卡用例（PRD §4.2）。
 *
 * 关键约束：
 * - 全局至多一条 `running` 段，且断言在**同一个事务**内（TECH-DESIGN §5.1）
 * - 定位 / 逆地理失败不阻塞落库（L-2）
 * - 幂等：`idempotencyKey` 唯一索引 + 调用方按钮锁（C-6）
 */

export class PunchConflictError extends Error {
  readonly running: SessionRecord | null;

  constructor(message: string, running: SessionRecord | null) {
    super(message);
    this.name = 'PunchConflictError';
    this.running = running;
  }
}

export interface PunchDependencies {
  /** 只依赖「生成时间戳」的能力，便于测试注入 */
  clock?: ClockReader;
  captureLocation?: () => Promise<LocationSnapshot>;
}

export interface PunchOutcome {
  action: PunchAction;
  session: SessionRecord;
  /** 结束时为本次段时长；开始时为 `null` */
  durationSeconds: number | null;
  timeSource: PunchTimeSource;
  clockOffsetMs: number;
  skewWarning: boolean;
  /** 本次段是否被判为碎片 */
  isFragment: boolean;
  /**
   * 地点补写完成（TECH-DESIGN §10）。
   *
   * 打卡**不等待**它：时间先落库，地点随后补写，因此「点击 → 落库」与定位耗时无关
   * （PRD §6）；UI 通过 `liveQuery` 自动看到补写结果。测试可 await 它。
   */
  locationSettled: Promise<LocationSnapshot | null>;
}

/** 打卡用例只需要「取一个可信时间戳」的能力（PRD T-1）。 */
export interface ClockReader {
  stamp(): ClockStamp;
}

async function captureLocation(deps: PunchDependencies): Promise<LocationSnapshot> {
  const snapshot = await (deps.captureLocation ??
    (() => getOnce({ timeoutMs: GEOLOCATION_PUNCH_TIMEOUT_MS })))();
  return getGeocodeProvider().reverse(snapshot);
}

function resolveClock(deps: PunchDependencies): ClockReader {
  return deps.clock ?? clockService;
}

/**
 * 落库之后再补写地点，不阻塞打卡（TECH-DESIGN §10）。
 *
 * 无论成功与否都会写入一个快照：`null` 只表示「尚未补写」，避免 UI 永远停在「定位中」。
 */
async function attachLocation(
  sessionId: string,
  field: 'startLocation' | 'endLocation',
  deps: PunchDependencies,
  updatedAt: number,
): Promise<LocationSnapshot | null> {
  let snapshot: LocationSnapshot;
  try {
    snapshot = await captureLocation(deps);
  } catch {
    snapshot = createLocationSnapshot('error', monotonicNow());
  }

  try {
    const patch: Partial<SessionRecord> = { updatedAt };
    if (field === 'startLocation') patch.startLocation = snapshot;
    else patch.endLocation = snapshot;
    await db.sessions.update(sessionId, patch);
  } catch {
    return null;
  }

  return snapshot;
}

export async function startPunch(deps: PunchDependencies = {}): Promise<PunchOutcome> {
  const clock = resolveClock(deps);
  const settings = await ensureSettings();
  const stamp = clock.stamp();

  const active = await findRunningSession();
  if (active) {
    throw new PunchConflictError('已有进行中的段，请先结束当前段', active);
  }

  const record: SessionRecord = {
    id: crypto.randomUUID(),
    startedAt: stamp.time,
    endedAt: null,
    durationSeconds: null,
    businessDay: businessDayOf(stamp.time, settings.businessDayBoundaryMinutes),
    // 地点在落库后补写（TECH-DESIGN §10）
    startLocation: null,
    endLocation: null,
    // 地点匹配随 M3 落地；M1 只记录坐标（D-015）
    placeId: null,
    endPlaceId: null,
    timeSource: stamp.source,
    clockOffsetMs: stamp.offsetMs,
    deviceStartedAt: stamp.deviceTime,
    deviceEndedAt: null,
    idempotencyKey: crypto.randomUUID(),
    status: 'running',
    isDeviceClockSkewed: stamp.skewed,
    note: null,
    editedAt: null,
    deleted: 0,
    createdAt: stamp.time,
    updatedAt: stamp.time,
  };

  await db.transaction('rw', db.sessions, async () => {
    const concurrent = await findRunningSession();
    if (concurrent) {
      throw new PunchConflictError('已有进行中的段，请先结束当前段', concurrent);
    }
    await db.sessions.add(record);
  });

  return {
    action: 'start',
    session: record,
    durationSeconds: null,
    timeSource: stamp.source,
    clockOffsetMs: stamp.offsetMs,
    skewWarning: stamp.skewed,
    isFragment: false,
    locationSettled: attachLocation(record.id, 'startLocation', deps, stamp.time),
  };
}

export async function endPunch(deps: PunchDependencies = {}): Promise<PunchOutcome> {
  const clock = resolveClock(deps);
  const settings = await ensureSettings();
  const stamp = clock.stamp();

  const closed = await db.transaction('rw', db.sessions, async () => {
    const running = await findRunningSession();
    if (!running) {
      throw new PunchConflictError('当前没有进行中的段', null);
    }

    const durationSeconds = Math.max(0, Math.round((stamp.time - running.startedAt) / 1000));
    const status: SegmentStatus =
      durationSeconds < settings.fragmentThresholdSeconds ? 'fragment' : 'closed';

    const patch: Partial<SessionRecord> = {
      endedAt: stamp.time,
      durationSeconds,
      status,
      deviceEndedAt: stamp.deviceTime,
      updatedAt: stamp.time,
    };
    await db.sessions.update(running.id, patch);

    return { ...running, ...patch } as SessionRecord;
  });

  return {
    action: 'end',
    session: closed,
    durationSeconds: closed.durationSeconds,
    timeSource: stamp.source,
    clockOffsetMs: stamp.offsetMs,
    skewWarning: stamp.skewed,
    isFragment: closed.status === 'fragment',
    locationSettled: attachLocation(closed.id, 'endLocation', deps, stamp.time),
  };
}

/** 事务内再次确认，避免多标签页并发导致出现两条 `running`。 */
export async function findRunningSession(): Promise<SessionRecord | undefined> {
  return db.sessions
    .where('status')
    .equals('running')
    .filter((session) => session.deleted === 0)
    .first();
}
