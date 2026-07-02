/**
 * Role model (Methodology §10.1) — hierarchical: viewer < steward < publisher.
 */
export const ROLES = ["viewer", "steward", "publisher"] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { viewer: 0, steward: 1, publisher: 2 };

export function atLeast(role: Role | undefined | null, required: Role): boolean {
  return role != null && RANK[role] >= RANK[required];
}

/** Resolve the highest role granted by a set of Entra ID group ids. */
export function roleFromGroups(
  groups: string[],
  groupToRole: Partial<Record<string, Role>>,
): Role | null {
  let best: Role | null = null;
  for (const g of groups) {
    const r = groupToRole[g];
    if (r && (!best || RANK[r] > RANK[best])) best = r;
  }
  return best;
}
