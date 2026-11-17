export const practiceLaunchKey = (workspace: string): string => `factoryze:explicit-launch:${workspace}`;

/** A fresh explicit task open reveals its starter once. Restarts retain the editor layout. */
export function consumePracticeLaunch(storage: Pick<Storage, 'getItem' | 'removeItem'>, workspace: string, now = Date.now()): boolean {
  const key = practiceLaunchKey(workspace);
  const value = storage.getItem(key);
  storage.removeItem(key);
  if (!value) return false;
  const started = Number(value);
  return Number.isFinite(started) && started <= now && now - started < 60_000;
}
