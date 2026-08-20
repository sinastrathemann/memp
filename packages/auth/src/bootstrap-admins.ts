/**
 * Notausgang fuer die erste Administratorin: MEXP_BOOTSTRAP_ADMINS benennt
 * E-Mail-Adressen, die beim Anmelden die Rolle `admin` erhalten.
 *
 * Hintergrund: In einer frischen Hub-Instanz gibt es keinen mEXP-Admin. Die
 * regulaeren Wege setzen entweder die Hub-Rolle AppHub.Admin voraus (kann die
 * App-Eigentuemerin nicht selbst vergeben) oder einen bestehenden Admin, der
 * die Rolle zuweist. Henne und Ei.
 *
 * Wer diese Variable setzen kann, verwaltet die App im Hub und koennte ohnehin
 * ein beliebiges Image einspielen — der Bootstrap vergroessert die
 * Angriffsflaeche also nicht, er macht einen bestehenden Vertrauensweg nutzbar.
 *
 * Die Variable gehoert entfernt, sobald AppHub.Admin im Hub vergeben ist.
 */

/** Kommaseparierte Liste in normalisierte E-Mail-Adressen zerlegen. */
export function parseBootstrapAdmins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Steht diese Adresse in MEXP_BOOTSTRAP_ADMINS? */
export function isBootstrapAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = parseBootstrapAdmins(process.env.MEXP_BOOTSTRAP_ADMINS);
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
