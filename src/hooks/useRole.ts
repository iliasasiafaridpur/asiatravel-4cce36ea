import { useCurrentUser } from "./useCurrentUser";

/**
 * App role classification.
 * - admin = software officer (technical-only). Excluded from cash flow UI.
 * - md = owner. Self-receipts auto-approved; sees MD Panel.
 * - staff = receives payments; must submit daily handover for MD approval.
 */
export function useRole() {
  const { profile, loading } = useCurrentUser();
  const role = (profile?.role ?? "staff").toLowerCase();
  return {
    role,
    isAdmin: role === "admin",
    isMd: role === "md",
    isStaff: role === "staff",
    /** MD or Admin — for unlock / control privileges. */
    canApprove: role === "md" || role === "admin",
    loading,
  };
}
