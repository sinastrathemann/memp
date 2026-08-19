import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { rootLogger } from "@mexp/shared";
import type { Hono } from "hono";

const log = rootLogger.child({ module: "api/static-serve" });

const API_PREFIXES = ["/api"];

/**
 * Platzhalter im `<meta name="mexp-server-path">` von `apps/web/index.html`.
 * Wird pro Request durch den Pfad ersetzt, den DIESER Server gesehen hat — das
 * Frontend rechnet daraus seinen Einhängepunkt aus (siehe web/src/base-path.ts).
 */
const SERVER_PATH_PLACEHOLDER = "__MEXP_SERVER_PATH__";

/**
 * Assets in beliebiger Tiefe. Vite baut mit `base: "./"`, die Bundle-URLs sind
 * also relativ zum Dokument. Bei einem harten Reload auf `/<slug>/events/evt-1`
 * fragt der Browser deshalb `/events/assets/index-<hash>.js` an statt
 * `/assets/...`. Ohne diese Regel bekäme er die SPA-Hülle als JavaScript
 * geliefert und die App bootet nicht.
 */
const NESTED_ASSET_RE = /(?:^|\/)assets\/(.+)$/;

function isApiPath(path: string): boolean {
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Der Pfad landet in einem HTML-Attribut. Zeichen ausserhalb dessen, was ein
 * URL-Pfad braucht, werden gar nicht erst durchgelassen — das ist strenger als
 * Escaping und schliesst Attribut-Ausbrüche sicher aus.
 */
function safeServerPath(path: string): string {
  return /^[A-Za-z0-9/_.~%:@!$&'()*+,;=-]*$/.test(path) ? path : "/";
}

export function mountStatic(app: Hono, webRoot: string): void {
  if (!existsSync(webRoot)) {
    log.warn({ webRoot }, "web-dist not found — SPA serving disabled (dev mode)");
    return;
  }

  app.use("*", async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    const match = NESTED_ASSET_RE.exec(c.req.path);
    if (!match?.[1]) return next();

    const assetPath = `/assets/${match[1]}`;
    const resolved = resolve(webRoot, `.${assetPath}`);
    if (!resolved.startsWith(webRoot + sep)) {
      // Path traversal attempt — reject
      return c.notFound();
    }

    return serveStatic({
      root: webRoot,
      rewriteRequestPath: () => assetPath,
      onFound: (_path, ctx) => {
        ctx.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    })(c, next);
  });

  const indexHtml = readFileSync(resolve(webRoot, "index.html"), "utf8");

  app.get("*", async (c) => {
    if (isApiPath(c.req.path)) {
      return c.notFound();
    }
    const filePath = resolve(webRoot, `.${c.req.path}`);
    if (!filePath.startsWith(webRoot + sep) && filePath !== webRoot) {
      // Path traversal attempt — reject
      return c.notFound();
    }
    if (c.req.path !== "/" && existsSync(filePath) && !filePath.endsWith("index.html")) {
      return serveStatic({ root: webRoot })(c, async () => {});
    }
    c.header("Cache-Control", "no-cache, must-revalidate");
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.body(indexHtml.replace(SERVER_PATH_PLACEHOLDER, safeServerPath(c.req.path)));
  });
}
