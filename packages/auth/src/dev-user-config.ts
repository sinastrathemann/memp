import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const DevUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email().nullable().default(null),
  name: z.string().nullable().default(null),
  roles: z.array(z.string()).default([]),
});

export type DevUser = z.infer<typeof DevUserSchema>;

const DEFAULT_DEV_USER: DevUser = {
  id: "dev-user-default",
  email: "dev@mindsquare.local",
  name: "Dev User",
  roles: ["AppHub.Admin"],
};

let cached: DevUser | null = null;

export function loadDevUser(): DevUser {
  if (cached) return cached;
  // Suche config/dev-user.yaml in cwd sowie den nächsten 3 Parent-Verzeichnissen —
  // damit die Datei auch gefunden wird wenn der API-Prozess aus apps/api/ startet
  // (pnpm --filter setzt cwd auf das Package, nicht auf's Repo-Root).
  const candidates = [
    resolve(process.cwd(), "config/dev-user.yaml"),
    resolve(process.cwd(), "../config/dev-user.yaml"),
    resolve(process.cwd(), "../../config/dev-user.yaml"),
    resolve(process.cwd(), "../../../config/dev-user.yaml"),
  ];
  const path = candidates.find((p) => existsSync(p));
  if (!path) {
    cached = DEFAULT_DEV_USER;
    return cached;
  }
  const raw = readFileSync(path, "utf8");
  const parsed = DevUserSchema.parse(parseYaml(raw));
  cached = parsed;
  return parsed;
}
