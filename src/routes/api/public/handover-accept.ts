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



export const Route = createFileRoute("/api/public/handover-accept")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // SECURITY: this public link must NEVER approve a handover by itself.
        // Anyone who receives a forwarded email would otherwise be able to
        // approve. Approval is allowed ONLY from inside the app, after the
        // MD/Owner logs in with their own ID + password (server-side role +
        // RLS enforced in the MD Panel). This endpoint only directs them to
        // log in — it performs no database writes.
        const token = new URL(request.url).searchParams.get("t")?.trim() ?? "";

        const loginBtn = `<div style="margin-top:18px"><a href="https://asiatravel.lovable.app/md-panel${token ? `?t=${encodeURIComponent(token)}` : ""}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 24px;border-radius:9px">🔐 লগইন করে অনুমোদন করুন</a></div>`;

        const body = `
          <p>নিরাপত্তার জন্য এই লিংক থেকে সরাসরি অনুমোদন করা যায় না।</p>
          <p>অনুগ্রহ করে <b>MD/Owner</b> আইডি দিয়ে সফটওয়্যারে লগইন করুন, তারপর <b>MD Panel</b> থেকে টাকা বুঝে পেয়ে অনুমোদন (approve) করুন।</p>
          ${loginBtn}
          <div class="meta" style="margin-top:16px">🔐 শুধুমাত্র আপনার নিজের আইডি ও পাসওয়ার্ড দিয়েই এই অনুমোদন সম্ভব — অন্য কেউ পারবে না।</div>`;

        return html(page("লগইন করে অনুমোদন করুন", "#0f172a", "🔐", body));
      },
    },
  },
});
