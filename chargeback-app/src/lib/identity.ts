/**
 * Display-only heuristic shared by the user screens: humans authenticate as
 * emails, service principals as application IDs (GUIDs or other non-email
 * identifiers). Never used for attribution — only for labels and counts.
 */
export const isServicePrincipal = (id: string) => !id.includes("@");
