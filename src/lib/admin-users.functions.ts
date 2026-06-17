import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Generate a human-friendly temporary password, e.g. "Asia-7421". */
function genTempPassword(): string {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `Asia-${n}`;
}

type ResetInput = { userId: string };

/**
 * Admin-only: set a random temporary password for a user and flag their
 * profile so they MUST change it on next login. The temp password is
 * returned ONCE so the admin can hand it to the user. Admin never gets to
 * choose the password, and the user replaces it immediately — privacy kept.
 */
export const adminResetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ResetInput): ResetInput => {
    const userId = String(input?.userId ?? "").trim();
    if (!userId) throw new Error("userId লাগবে");
    return { userId };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId: callerId } = context;

    // Only admins may reset other users' passwords.
    const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
      _user_id: callerId,
      _role: "admin",
    });
    if (roleErr) throw new Error("রোল যাচাই ব্যর্থ");
    if (!isAdmin) throw new Error("শুধু Admin পাসওয়ার্ড রিসেট করতে পারবেন");

    const tempPassword = genTempPassword();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      password: tempPassword,
    });
    if (updErr) throw new Error("পাসওয়ার্ড রিসেট ব্যর্থ: " + updErr.message);

    const { error: flagErr } = await supabaseAdmin
      .from("profiles")
      .update({ must_reset_password: true } as never)
      .eq("user_id", data.userId);
    if (flagErr) throw new Error("ফ্ল্যাগ সেট ব্যর্থ: " + flagErr.message);

    return { tempPassword };
  });
