import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail/gmail/v1";

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

function validate(input: SendEmailInput): SendEmailInput {
  const to = String(input?.to ?? "").trim();
  const subject = String(input?.subject ?? "").trim();
  const html = String(input?.html ?? "");
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(to)) throw new Error("সঠিক ইমেইল ঠিকানা দিন");
  if (!subject) throw new Error("Subject লাগবে");
  if (!html) throw new Error("ইমেইলের কনটেন্ট লাগবে");
  return { to, subject, html };
}

// Build an RFC 2822 message and base64url-encode it (UTF-8 safe).
function buildRawEmail(to: string, subject: string, html: string): string {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;
  const message = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html, "utf-8").toString("base64"),
  ].join("\r\n");
  return Buffer.from(message, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const sendGmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data }) => {
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const GOOGLE_MAIL_API_KEY = process.env.GOOGLE_MAIL_API_KEY;
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY কনফিগার করা নেই");
    if (!GOOGLE_MAIL_API_KEY) throw new Error("Gmail connection কনফিগার করা নেই");

    const raw = buildRawEmail(data.to, data.subject, data.html);

    const res = await fetch(`${GATEWAY_URL}/users/me/messages/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GOOGLE_MAIL_API_KEY,
      },
      body: JSON.stringify({ raw }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error("Gmail send failed", res.status, text);
      throw new Error(`ইমেইল পাঠানো যায়নি (${res.status})`);
    }

    let id: string | undefined;
    try {
      id = JSON.parse(text)?.id;
    } catch {
      // ignore parse error
    }
    return { ok: true as const, id };
  });
