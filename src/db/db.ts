import Dexie, { type Table } from 'dexie';
import { DB_NAME } from '@/config/constants';
import type { MetaRecord, PlaceRecord, SessionRecord, SettingsRecord } from '@/domain/types';

/**
 * 唯一数据源（D-012 / D-013）：浏览器 IndexedDB，无服务端、无 `user_id`。
 *
 * 索引说明：IndexedDB 的键不接受 `null`，因此软删除用数值 `deleted: 0 | 1`；
 * `&idempotencyKey` 为唯一索引，是「重复点击 / 离线重放不产生重复记录」的最后一道防线（C-6）。
 */
export class CheckAppDatabase extends Dexie {
  sessions!: Table<SessionRecord, string>;
  places!: Table<PlaceRecord, string>;
  settings!: Table<SettingsRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      sessions: 'id, startedAt, endedAt, businessDay, placeId, &idempotencyKey, status, deleted',
      places: 'id, name, deleted',
      settings: 'id',
      meta: 'key',
    });
  }
}

export const db = new CheckAppDatabase();

/** 清除全部本地数据（设置页「清除全部数据」，PRD §6 隐私要求）。 */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', db.sessions, db.places, db.settings, db.meta, async () => {
    await Promise.all([
      db.sessions.clear(),
      db.places.clear(),
      db.settings.clear(),
      db.meta.clear(),
    ]);
  });
}
