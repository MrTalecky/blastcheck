/**
 * Built-in check registration barrel.
 *
 * The check modules themselves are side-effect-free — each only exports
 * `const check: Check`. Registration happens HERE, explicitly, when this barrel
 * is imported (by `runAudit` wiring in Story 1.4 and by tests). This keeps the
 * import-for-side-effect out of the individual check files, where import order
 * would be fragile, and gives one obvious place that lists what ships in v1.
 *
 * Story 1.3 registers the three git-only checks; the trajectory checks join in
 * Story 2.2.
 */

import { check as churn } from "./churn.js";
import { check as deniedFiles } from "./denied-files.js";
import { registerCheck } from "./registry.js";
import { check as scopeAdhesion } from "./scope-adhesion.js";

registerCheck(deniedFiles);
registerCheck(scopeAdhesion);
registerCheck(churn);

export { churn, deniedFiles, scopeAdhesion };
