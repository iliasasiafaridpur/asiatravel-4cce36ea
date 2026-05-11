// Passport OCR — uses Lovable AI (Gemini Vision) to read MRZ + visual zone
// from a passport photo and returns structured fields ready to auto-fill a form.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  image: string; // data URL or base64
  mime?: string;
}

const SYSTEM = `You are an expert at reading machine-readable passports.
You will receive a photo of a passport's data page. Extract the fields below
from BOTH the visual zone and the MRZ (bottom two lines) and return them via
the provided tool. If a field is not legible, return an empty string.

Rules:
- passenger_name: Given names + Surname in normal English order, Title Case (e.g. "Mohammad Rahim Uddin"). Strip "<<" markers.
- passport: alphanumeric only, uppercase, no spaces.
- date_of_birth, issue_date, expiry_date: ISO format YYYY-MM-DD.
- gender: "M" or "F".
- nationality / country_code: 3-letter ISO code (e.g. BGD, IND, PAK).
- mrz_raw: the two MRZ lines as you see them, joined with '\\n'.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const body = (await req.json()) as Body;
    if (!body.image) throw new Error("image is required");

    // Normalize to data URL
    const dataUrl = body.image.startsWith("data:")
      ? body.image
      : `data:${body.mime ?? "image/jpeg"};base64,${body.image}`;

    const tool = {
      type: "function",
      function: {
        name: "passport_fields",
        description: "Structured passport fields extracted from the photo.",
        parameters: {
          type: "object",
          properties: {
            passenger_name: { type: "string" },
            passport: { type: "string" },
            date_of_birth: { type: "string" },
            issue_date: { type: "string" },
            expiry_date: { type: "string" },
            gender: { type: "string" },
            nationality: { type: "string" },
            country_code: { type: "string" },
            place_of_birth: { type: "string" },
            mrz_raw: { type: "string" },
            confidence: { type: "string", description: "low | medium | high" },
          },
          required: ["passenger_name", "passport"],
          additionalProperties: false,
        },
      },
    };

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: "Read this passport." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "passport_fields" } },
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error", resp.status, t);
      if (resp.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit. একটু পর আবার চেষ্টা করুন।" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (resp.status === 402) {
        return new Response(JSON.stringify({ error: "Lovable AI ক্রেডিট শেষ। Settings → Workspace → Usage থেকে যোগ করুন।" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway ${resp.status}`);
    }

    const out = await resp.json();
    const call = out?.choices?.[0]?.message?.tool_calls?.[0];
    let fields: Record<string, string> = {};
    if (call?.function?.arguments) {
      try { fields = JSON.parse(call.function.arguments); } catch { /* noop */ }
    }
    return new Response(JSON.stringify({ fields }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("passport-ocr", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
