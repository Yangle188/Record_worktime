import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { DEFAULT_SETTINGS, ensureSettings } from '@/db/repos/settings.repo';
import type { SettingsRecord } from '@/domain/types';

/**
 * 读取应用设置；库中还没有记录时先返回默认值。
 *
 * ⚠️ 默认值的写库动作必须放在 liveQuery **之外**：Dexie 的 querier 运行在只读 zone 中，
 * 在其中写库会抛 `DexieError`，会让首次启动（尚无设置记录）时该查询永久失败。
 */
export function useSettings(): SettingsRecord {
  const stored = useLiveQuery(() => db.settings.get('app'), []);

  useEffect(() => {
    void ensureSettings();
  }, []);

  return stored ?? DEFAULT_SETTINGS;
}
