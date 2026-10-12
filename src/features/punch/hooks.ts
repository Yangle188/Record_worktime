import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CLOCK_RESYNC_INTERVAL_MS } from '@/config/constants';
import { db } from '@/db/db';
import { clockService, type ClockState } from '@/services/clock/clockService';
import type { SessionRecord } from '@/domain/types';
import { endPunch, PunchConflictError, startPunch, type PunchOutcome } from './punchService';

/** 订阅时钟状态，并在启动 / 恢复网络 / 定期重采样时同步（PRD T-2、T-3）。 */
export function useClock(): ClockState {
  const [state, setState] = useState<ClockState>(() => clockService.getState());

  useEffect(() => clockService.subscribe(setState), []);

  useEffect(() => {
    void clockService.sync();
    const timer = window.setInterval(() => void clockService.sync(), CLOCK_RESYNC_INTERVAL_MS);
    const handleOnline = () => void clockService.sync();
    window.addEventListener('online', handleOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return state;
}

/** 每秒走动的校准时间，用于实时计时与走秒展示（C-4 / V-2）。 */
export function useCalibratedNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => clockService.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(clockService.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

export interface RunningSessionState {
  /** `false` 表示查询尚未返回，不能据此判断「当前没有进行中的段」 */
  loaded: boolean;
  running: SessionRecord | null;
}

/**
 * 进行中的段。
 *
 * 用 `{ running }` 包装而不是直接返回记录：`useLiveQuery` 的 `undefined` 同时表示
 * 「加载中」和「没有结果」，包装后才能区分，避免加载期间按钮显示错误的动作。
 */
export function useRunningSession(): RunningSessionState {
  const result = useLiveQuery(async () => {
    const found = await db.sessions
      .where('status')
      .equals('running')
      .filter((session) => session.deleted === 0)
      .first();
    return { loaded: true, running: found ?? null };
  }, []);

  return result ?? { loaded: false, running: null };
}

export interface PunchController {
  running: SessionRecord | null;
  /** 进行中状态尚未确定 */
  loading: boolean;
  busy: boolean;
  outcome: PunchOutcome | null;
  error: string | null;
  toggle: () => Promise<void>;
  dismissOutcome: () => void;
  dismissError: () => void;
}

export function usePunchController(): PunchController {
  const { loaded, running } = useRunningSession();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PunchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 同步锁：连续点击时第二次调用会在 await 之前就被拦下（C-6）
  const inFlight = useRef(false);

  const toggle = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);

    try {
      const result = running ? await endPunch() : await startPunch();
      setOutcome(result);
    } catch (caught) {
      if (caught instanceof PunchConflictError) {
        setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : '打卡失败，请重试');
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [running]);

  return {
    running,
    loading: !loaded,
    busy,
    outcome,
    error,
    toggle,
    dismissOutcome: () => setOutcome(null),
    dismissError: () => setError(null),
  };
}
