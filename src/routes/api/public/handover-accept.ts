import { createFileRoute } from "@tanstack/react-router";

const page = (title: string, color: string, icon: string, body: string) => `<!doctype html><html lang="bn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</title>
<style>
  body{font-family:'Noto Sans Bengali','Segoe UI',Arial,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#eef1f5;color:#111;padding:20px}
  .card{max-width:440px;width:100%;background:#fff;border:1px solid #e2e2e2;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.10);padding:30px 26px;text-align:center}
  .icon{width:74px;height:74px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:38px;background:${color}1a;color:${color}}
  h1{margin:0 0 6px;font-size:20px;color:${color}}
  p{margin:6px 0;color:#444;font-size:14px;line-height:1.7}
  .amt{font-size:26px;font-weight:800;color:#059669;margin:12px 0}
  .meta{margin-top:14px;border-top:1px solid #eee;padding-top:12px;font-size:12.5px;color:#666;line-height:1.9}
  .meta b{color:#111}
  .brand{margin-top:18px;font-size:11px;color:#999}
</style></head><body>
<div class="card">
  <div class="icon">${icon}</div>
  <h1>${title}</h1>
  ${body}
  <div class="brand">এশিয়া ট্যুরস্ এন্ড ট্রাভেলস্</div>
</div>
</body></html>`;

const html = (content: string, status = 200) =>
  new Response(content, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

const money = (n: unknown) => `৳ ${(Number(n) || 0).toLocaleString()}`;

const fmtDate = (d: unknown) => {
  if (!d) return "";
  const dt = new Date(String(d));
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const Route = createFileRoute("/api/public/handover-accept")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("t")?.trim() ?? "";
        if (!token) {
          return html(page("লিংকটি সঠিক নয়", "#b91c1c", "⚠️", "<p>এই লিংকটিতে কোনো হ্যান্ডওভার তথ্য নেই।</p>"), 400);
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("approve_handover_by_token" as never, { _token: token } as never);

          if (error) {
            return html(page("সমস্যা হয়েছে", "#b91c1c", "⚠️", `<p>গ্রহণ করা যায়নি। আবার চেষ্টা করুন।</p>`), 500);
          }

          const res = (data ?? {}) as {
            ok?: boolean; already?: boolean; reason?: string;
            from_name?: string; handover_id?: string; amount?: number; closing_date?: string;
          };

          if (!res.ok) {
            const msg = res.reason === "not_found"
              ? "এই হ্যান্ডওভারটি খুঁজে পাওয়া যায়নি।"
              : res.reason === "not_pending"
                ? "এই হ্যান্ডওভারটি আর অপেক্ষমান নেই।"
                : "লিংকটি সঠিক নয়।";
            return html(page("গ্রহণ করা যায়নি", "#b91c1c", "⚠️", `<p>${msg}</p>`), 400);
          }

          const meta = `<div class="meta">
            প্রেরক: <b>${res.from_name ?? "—"}</b><br>
            হ্যান্ডওভার আইডি: <b>${res.handover_id ?? "—"}</b><br>
            ক্লোজিং তারিখ: <b>${fmtDate(res.closing_date)}</b>
          </div>`;

          if (res.already) {
            return html(page("আগেই গ্রহণ করা হয়েছে", "#0284c7", "✓", `<p>এই জমাটি ইতিমধ্যে গ্রহণ (approved) করা হয়েছে।</p><div class="amt">${money(res.amount)}</div>${meta}`));
          }

          return html(page("টাকা গ্রহণ সম্পন্ন", "#059669", "✅", `<p>জমার রিকোয়েস্ট সফলভাবে গ্রহণ করা হয়েছে।</p><div class="amt">${money(res.amount)}</div>${meta}`));
        } catch {
          return html(page("সমস্যা হয়েছে", "#b91c1c", "⚠️", "<p>সার্ভারে সমস্যা হয়েছে। আবার চেষ্টা করুন।</p>"), 500);
        }
      },
    },
  },
});
