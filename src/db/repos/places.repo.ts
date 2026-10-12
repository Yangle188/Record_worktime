import { db } from '@/db/db';
import type { PlaceRecord } from '@/domain/types';

export async function listActivePlaces(): Promise<PlaceRecord[]> {
  return db.places.filter((place) => place.deleted === 0).toArray();
}

export async function softDeletePlace(id: string, now: number): Promise<void> {
  await db.places.update(id, { deleted: 1, updatedAt: now });
}
