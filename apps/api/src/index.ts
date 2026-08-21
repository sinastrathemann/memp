import "./bootstrap.js";

import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { hubAuthMiddleware, parseBootstrapAdmins } from "@mexp/auth";
import { rootLogger } from "@mexp/shared";
import { Hono } from "hono";
import { env } from "./deps.js";
import { errorHandler } from "./error-handler.js";
import { adminPersonioRoutes } from "./routes/admin-personio.js";
import { adminSharepointRoutes } from "./routes/admin-sharepoint.js";
import { adminUsersImportRoutes } from "./routes/admin-users-import.js";
import { adminUserRoutes } from "./routes/admin-users.js";
import { authRoutes } from "./routes/auth.js";
import { blueprintRoutes } from "./routes/blueprints.js";
import { budgetRoutes } from "./routes/budget.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { documentRoutes } from "./routes/documents.js";
import { eventRoutes } from "./routes/events.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { myDashboardRoutes } from "./routes/my-dashboard.js";
import { qnaRoutes } from "./routes/qna.js";
import { registrationFormRoutes } from "./routes/registration-form.js";
import { reportRoutes } from "./routes/reports.js";
import { tenderRoutes } from "./routes/tenders.js";
import { userSearchRoutes } from "./routes/user-search.js";
import { vendorRoutes } from "./routes/vendors.js";
import { mountStatic } from "./static-serve.js";

const log = rootLogger.child({ module: "api" });

const app = new Hono();

app.onError(errorHandler);

// Unauth: Hub-Upstream-Probe
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "mexp",
    version: process.env.APP_VERSION ?? "dev",
    timestamp: new Date().toISOString(),
  }),
);

// Hub-Auth for everything below — except vendor/qna routes that carry their own
// token-based auth (external vendors have no Entra SSO identity).
app.use(
  "*",
  hubAuthMiddleware({
    publicPathPatterns: [
      /^\/api\/vendors\/session$/, // GET — vendor magic-link session lookup (vendors.ts)
      /^\/api\/tenders\/[^/]+\/qna$/, // GET+POST — vendor Q&A list/ask via token (qna.ts)
      // Everything outside /api/* is public: the SPA shell + hashed assets + any
      // client-side route (e.g. /events/evt-1, /admin/users on a hard refresh).
      // Real auth is enforced by (a) the /api/* endpoints themselves and (b) the
      // SPA's own /api/me bootstrap, which redirects to /auth/logout on 401.
      /^(?!\/api(?:\/|$))/,
    ],
  }),
);

app.route("/api", authRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin/users", adminUsersImportRoutes);
app.route("/api/admin/personio", adminPersonioRoutes);
app.route("/api/admin/sharepoint", adminSharepointRoutes);
app.route("/api/events", eventRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api", budgetRoutes);
app.route("/api", documentRoutes);
app.route("/api", feedbackRoutes);
app.route("/api", registrationFormRoutes);
app.route("/api/reports", reportRoutes);
app.route("/api/my", myDashboardRoutes);
app.route("/api/tenders", tenderRoutes);
app.route("/api/vendors", vendorRoutes);
app.route("/api", qnaRoutes);
app.route("/api/blueprints", blueprintRoutes);
app.route("/api/users", userSearchRoutes);

// Serve SPA (last so API routes win on their prefixes)
const webRoot = process.env.MEXP_WEB_DIST ?? resolve(process.cwd(), "web-dist");
mountStatic(app, webRoot);

const port = Number(process.env.PORT ?? env.API_PORT ?? 3000);
const host = process.env.HOST ?? env.API_HOST ?? "0.0.0.0";

// W5: zweite der beiden im Design-Spec (§3) zugesagten Sicherungen fuer den Admin-
// Bootstrap -- die erste (Log bei Rollenvergabe) sitzt in routes/_user-resolution.ts.
// Nur die Anzahl, keine Adressen (PII). Gehoert entfernt, sobald der regulaere Weg
// ueber AppHub.Admin steht (siehe docs/runbook.md).
const bootstrapAdminCount = parseBootstrapAdmins(env.MEXP_BOOTSTRAP_ADMINS).length;

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  if (bootstrapAdminCount > 0) {
    log.warn(
      { count: bootstrapAdminCount },
      "MEXP_BOOTSTRAP_ADMINS gesetzt - Notausgang aktiv, siehe docs/runbook.md",
    );
  }
  log.info({ port: info.port, host, webRoot }, "mEXP started");
});
