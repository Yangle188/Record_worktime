import { describe, expect, it } from 'vitest';
import { UNNAMED_PLACE_LABEL } from '@/config/constants';
import { summarize, type RangeSummary } from '@/domain/stats/summarize';
import type { PlaceRecord, SessionRecord, SettingsRecord } from '@/domain/types';
import { makeSession, makeSettings } from '@/test/factories';

const DAY_START = new Date(2026, 9, 12, 4, 0, 0).getTime();
const DAY_END = new Date(2026, 9, 13, 4, 0, 0).getTime();

const settings = (overrides: Partial<SettingsRecord> = {}): SettingsRecord =>
  makeSettings(overrides);

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord =>
  makeSession({ startedAt: DAY_START + 3_600_000, ...overrides });

function run(sessions: SessionRecord[], overrides?: { settings?: SettingsRecord; places?: PlaceRecord[] }) {
  return summarize({
    sessions,
    places: overrides?.places ?? [],
    settings: overrides?.settings ?? settings(),
    range: { start: DAY_START, end: DAY_END, preset: 'today', label: '2026-10-12' },
    now: DAY_END,
  });
}

function placeTotal(summary: RangeSummary): number {
  return summary.byPlace.reduce((total, bucket) => total + bucket.seconds, 0);
}

function dayTotal(summary: RangeSummary): number {
  return summary.byDay.reduce((total, bucket) => total + bucket.totalSeconds, 0);
}

describe('summarize', () => {
  it('图表数据源与逐条明细完全一致（PRD 验收 #10）', () => {
    const summary = run([
      session({ startedAt: DAY_START + 3_600_000, endedAt: DAY_START + 3_600_000 + 5_400_000 }),
      session({ startedAt: DAY_START + 10_800_000, endedAt: DAY_START + 10_800_000 + 3_600_000 }),
    ]);

    const bySession = summary.sessions.reduce((total, item) => total + item.durationSeconds, 0);
    expect(summary.totalSeconds).toBe(bySession);
    expect(dayTotal(summary)).toBe(bySession);
    expect(placeTotal(summary)).toBe(bySession);
  });

  it('碎片段保留记录但不计入有效工时', () => {
    const summary = run([
      session({ startedAt: DAY_START + 3_600_000, endedAt: DAY_START + 3_600_000 + 3_600_000 }),
      session({ startedAt: DAY_START + 7_200_000, endedAt: DAY_START + 7_200_000 + 30_000 }),
    ]);

    expect(summary.effectiveSeconds).toBe(3600);
    expect(summary.fragmentSeconds).toBe(30);
    expect(summary.totalSeconds).toBe(3630);
    expect(summary.sessions).toHaveLength(2);
    expect(summary.sessions[1]?.status).toBe('fragment');
  });

  it('跨 0 点的段归属开始日', () => {
    const startedAt = new Date(2026, 9, 12, 22, 0, 0).getTime();
    const endedAt = new Date(2026, 9, 13, 1, 0, 0).getTime();
    const summary = run([session({ startedAt, endedAt })]);

    expect(summary.byDay).toHaveLength(1);
    expect(summary.byDay[0]?.day).toBe('2026-10-12');
    expect(summary.byDay[0]?.effectiveSeconds).toBe(3 * 3600);
  });

  it('进行中的段按当前时间实时累计并标记 running', () => {
    const startedAt = DAY_START + 3_600_000;
    const now = startedAt + 1_800_000;
    const summary = summarize({
      sessions: [session({ startedAt, endedAt: null, status: 'running', durationSeconds: null })],
      places: [],
      settings: settings(),
      range: { start: DAY_START, end: DAY_END, preset: 'today', label: '2026-10-12' },
      now,
    });

    expect(summary.totalSeconds).toBe(1800);
    expect(summary.sessions[0]?.running).toBe(true);
    expect(summary.achievement).toBeCloseTo(1800 / (8 * 3600), 5);
  });

  it('未闭合的历史段（orphan）不伪造工时', () => {
    const summary = run([
      session({ startedAt: DAY_START + 3_600_000, endedAt: null, status: 'orphan', durationSeconds: null }),
    ]);

    expect(summary.totalSeconds).toBe(0);
    expect(summary.sessions[0]?.status).toBe('orphan');
  });

  it('软删除的记录不参与统计', () => {
    const summary = run([
      session({ startedAt: DAY_START + 3_600_000, endedAt: DAY_START + 3_600_000 + 3_600_000 }),
      session({ startedAt: DAY_START + 5_400_000, endedAt: DAY_START + 5_400_000 + 3_600_000, deleted: 1 }),
    ]);

    expect(summary.sessions).toHaveLength(1);
    expect(summary.totalSeconds).toBe(3600);
  });

  it('未匹配地点的时长归入「未命名地点」桶', () => {
    const summary = run([
      session({ startedAt: DAY_START + 3_600_000, endedAt: DAY_START + 3_600_000 + 1_800_000 }),
    ]);

    expect(summary.byPlace).toHaveLength(1);
    expect(summary.byPlace[0]?.placeName).toBe(UNNAMED_PLACE_LABEL);
    expect(summary.byPlace[0]?.placeId).toBeNull();
    expect(summary.byPlace[0]?.ratio).toBe(1);
  });

  it('按地点汇总时同一地点合并、占比之和为 1', () => {
    const place: PlaceRecord = {
      id: 'place-office',
      name: '公司',
      lat: 31.2,
      lng: 121.4,
      radiusM: 200,
      color: '#2563eb',
      icon: null,
      deleted: 0,
      createdAt: DAY_START,
      updatedAt: DAY_START,
    };

    const summary = run(
      [
        session({
          startedAt: DAY_START + 3_600_000,
          endedAt: DAY_START + 3_600_000 + 3_600_000,
          placeId: place.id,
        }),
        session({
          startedAt: DAY_START + 7_200_000,
          endedAt: DAY_START + 7_200_000 + 1_800_000,
          placeId: place.id,
        }),
        session({
          startedAt: DAY_START + 10_800_000,
          endedAt: DAY_START + 10_800_000 + 1_800_000,
        }),
      ],
      { places: [place] },
    );

    expect(summary.byPlace).toHaveLength(2);
    expect(summary.byPlace[0]?.placeName).toBe('公司');
    expect(summary.byPlace[0]?.seconds).toBe(5400);
    expect(summary.byPlace[0]?.sessionCount).toBe(2);
    const ratioSum = summary.byPlace.reduce((total, bucket) => total + bucket.ratio, 0);
    expect(ratioSum).toBeCloseTo(1, 5);
  });

  it('周视图使用周目标计算达成率', () => {
    const summary = summarize({
      sessions: [
        session({ startedAt: DAY_START + 3_600_000, endedAt: DAY_START + 3_600_000 + 7_200_000 }),
      ],
      places: [],
      settings: settings({ weeklyTargetHours: 20 }),
      range: { start: DAY_START, end: DAY_END, preset: 'week', label: '本周' },
      now: DAY_END,
    });

    expect(summary.targetSeconds).toBe(20 * 3600);
    expect(summary.achievement).toBeCloseTo(7200 / (20 * 3600), 5);
  });
});
