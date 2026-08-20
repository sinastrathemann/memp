/**
 * Drossel fuer den lastSeenAt-Stempel.
 *
 * resolveMexpRoles laeuft bei jedem authentifizierten Request. Wuerde dort
 * jedes Mal geschrieben, schriebe persistentMap bei jedem Seitenaufruf die
 * komplette Nutzerdatei auf Disk — bei 805 Nutzern rund 460 KB pro Klick.
 * Einmal pro Stunde und Person genuegt fuer die Anzeige "zuletzt gesehen".
 */

/** Mindestabstand zwischen zwei Schreibvorgaengen: eine Stunde. */
export const LAST_SEEN_THROTTLE_MS = 60 * 60 * 1000;

/** Soll der Stempel jetzt neu geschrieben werden? */
export function shouldTouchLastSeen(lastSeenAt: string | undefined, nowMs: number): boolean {
  if (!lastSeenAt) return true;
  const previous = Date.parse(lastSeenAt);
  if (Number.isNaN(previous)) return true;
  return nowMs - previous >= LAST_SEEN_THROTTLE_MS;
}
