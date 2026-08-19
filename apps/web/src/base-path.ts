/**
 * Ermittelt den Pfad, unter dem die App öffentlich eingehängt ist.
 *
 * Hinter dem mindsquare Agent Hub läuft mEXP unter `https://<hub>/<slug>/`, aber
 * der Hub entfernt den `/<slug>`-Präfix, bevor der Request den Container erreicht
 * (Hub-Vertrag A.2.1, `strip_prefix=true`). Einen `X-Forwarded-Prefix`-Header gibt
 * es dabei bewusst nicht — die App erfährt ihren Präfix also über keinen der
 * beiden Kanäle allein:
 *
 *   - Der BROWSER kennt den vollen Pfad   → `/mexp/events/evt-1`
 *   - Der SERVER kennt den gestrippten    → `/events/evt-1`
 *
 * Die Differenz ist exakt der Einhängepunkt. `static-serve.ts` schreibt seine
 * Sicht beim Ausliefern in ein `<meta>`-Tag, hier wird gegengerechnet. Das
 * funktioniert bei beliebiger Routen-Tiefe und ohne Sonderkonfiguration im Hub.
 *
 * Lokal (Vite-Dev) bleibt der Platzhalter unersetzt — dann ist der Präfix leer,
 * was korrekt ist, weil die App dort auf der Wurzel liegt.
 */

const PLACEHOLDER = "__MEXP_SERVER_PATH__";

function readServerPath(): string | null {
  if (typeof document === "undefined") return null;
  const content = document.querySelector('meta[name="mexp-server-path"]')?.getAttribute("content");
  if (!content || content === PLACEHOLDER) return null;
  return content;
}

/**
 * Reine Berechnung, damit sie ohne DOM testbar ist.
 * `serverPath === null` heisst: kein Server-Hinweis vorhanden (Vite-Dev).
 */
export function computeBasePath(browserPath: string, serverPath: string | null): string {
  if (serverPath === null) return "";

  // Der Server-Pfad ist immer das Suffix des Browser-Pfads. Trifft das nicht zu,
  // stimmt eine Annahme nicht — dann lieber ohne Präfix weiterlaufen als raten.
  if (!browserPath.endsWith(serverPath)) return "";

  const base = browserPath.slice(0, browserPath.length - serverPath.length);
  // Ohne Trailing-Slash, damit `${BASE_PATH}/api/...` nie zu einem Doppel-Slash wird.
  return base.replace(/\/+$/, "");
}

function deriveBasePath(): string {
  // Ohne DOM (Unit-Test, künftiges SSR) gibt es keinen Präfix zu ermitteln.
  if (typeof window === "undefined") return "";
  return computeBasePath(window.location.pathname, readServerPath());
}

/** Präfix ohne Trailing-Slash — `""` wenn die App auf der Wurzel liegt. */
export const BASE_PATH = deriveBasePath();

/** Hängt einen wurzel-relativen Pfad an den Einhängepunkt der App. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
