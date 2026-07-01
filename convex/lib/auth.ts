import { Id } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";

/**
 * Authorization helpers. EVERY workspace-scoped query/mutation must funnel through
 * `requireWorkspaceAccess`, which guarantees:
 *   1. the caller is authenticated (valid Clerk identity), and
 *   2. the caller has a membership row in the requested workspace, and
 *   3. (optionally) the caller's role is in an allow-list.
 *
 * Because reads are always filtered by `workspaceId` AND gated by membership, one
 * workspace can never observe another workspace's data.
 */

export type Role = "owner" | "admin" | "member" | "approver";

export const APPROVER_ROLES: Role[] = ["owner", "admin", "approver"];
export const ADMIN_ROLES: Role[] = ["owner", "admin"];

export type Identity = {
  clerkUserId: string;
  email?: string;
  name?: string;
  imageUrl?: string;
};

/** Throw unless the request carries a valid Clerk identity token. */
export async function requireIdentity(
  ctx: QueryCtx | MutationCtx,
): Promise<Identity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthenticated: no valid session. Please sign in.");
  }
  return {
    clerkUserId: identity.subject,
    email: identity.email,
    name: identity.name ?? (identity.givenName as string | undefined),
    imageUrl: identity.pictureUrl,
  };
}

export type WorkspaceAccess = {
  identity: Identity;
  membershipId: Id<"memberships">;
  role: Role;
};

/**
 * Verify the caller belongs to `workspaceId`. If `allowedRoles` is provided, the
 * caller's role must be one of them, otherwise any member is allowed.
 */
export async function requireWorkspaceAccess(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  allowedRoles?: Role[],
): Promise<WorkspaceAccess> {
  const identity = await requireIdentity(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", identity.clerkUserId),
    )
    .unique();

  if (!membership) {
    throw new Error("Forbidden: you are not a member of this workspace.");
  }
  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new Error(
      `Forbidden: this action requires one of [${allowedRoles.join(", ")}]; you are "${membership.role}".`,
    );
  }
  return { identity, membershipId: membership._id, role: membership.role };
}

/** Convenience: is the given role allowed to approve sensitive requests? */
export function canApprove(role: Role): boolean {
  return APPROVER_ROLES.includes(role);
}

/** Convenience: is the given role an admin/owner (can see audit logs, manage members)? */
export function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}
