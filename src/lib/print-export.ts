// Auto-print script appended only for the print/PDF flow.
const AUTO_PRINT_SCRIPT =
  `<script>window.onload=function(){setTimeout(function(){window.print();},250);setTimeout(function(){window.close();},800);}<\/script>`;

// Company details for the "Pad" letterhead (matches BlankPadDialog).
const PAD_AGENCY = {
  name: "ASIA TOURS AND TRAVELS",
  slogan: "Customer satisfaction is our primary goal.",
  address: "Bariplaza 4th Floor, Thana Road, Faridpur",
  phone: "+8801721-399599",
  email: "kaiumkhan449@gmail.com",
};

/**
 * Build the top letterhead block of the company "Pad" (logo, name, slogan and
 * contact strip) as a self-contained HTML string with inline styles. Injected
 * at the very top of a print document body so a ledger prints on the pad — only
 * the pad's top part and watermark, per the print flows that opt into it.
 *
 * `logoUrl` must be an absolute URL (e.g. `${window.location.origin}${logoAsset.url}`).
 */
export function buildPadHeaderHtml(logoUrl: string): string {
  const ACCENT = "#496a9d";
  const DARK = "#0b2545";
  const GOLD = "#b08a3e";
  return `<div style="border-bottom:2px solid ${ACCENT};padding:0 0 10px;margin-bottom:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="display:flex;align-items:center;gap:12px;min-width:0;">
      <div style="height:64px;width:64px;border-radius:12px;background:#fff;border:1px solid ${ACCENT}33;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;"><img src="${logoUrl}" alt="logo" style="height:100%;width:100%;object-fit:contain;"/></div>
      <div>
        <div style="font-size:22px;font-weight:800;letter-spacing:-0.3px;color:${DARK};line-height:1.1;">${PAD_AGENCY.name}</div>
        <div style="font-size:11px;font-style:italic;color:${GOLD};font-weight:600;margin-top:3px;">"${PAD_AGENCY.slogan}"</div>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:10px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:11px;color:#475569;">
      <span>📍 ${PAD_AGENCY.address}, Bangladesh</span>
      <span>📞 ${PAD_AGENCY.phone}</span>
      <span>✉️ ${PAD_AGENCY.email}</span>
    </div>
  </div>`;
}


/**
 * Build a clean, human-readable file name for printed / downloaded documents.
 * The browser's "Save as PDF" dialog and the print dialog use the document
 * <title> (and document.title) as the suggested file name — so a descriptive
 * title means a descriptive file name (e.g. "Vendor_Ledger_Ashik_2026-06-30").
 *
 * Pass the meaningful parts (type, party name, date, etc.) and this strips
 * filesystem-invalid characters, collapses whitespace to underscores and
 * keeps Bengali/English letters intact.
 */
export function buildFileTitle(...parts: Array<string | number | null | undefined>): string {
  const cleaned = parts
    .map((p) => (p == null ? "" : String(p)))
    .map((p) =>
      p
        // drop filesystem-invalid characters
        .replace(/[\\/:*?"<>|]+/g, " ")
        // separators that look noisy in a file name
        .replace(/[—·•,]+/g, " ")
        .trim()
        // spaces / dots → underscore
        .replace(/[\s.]+/g, "_"),
    )
    .filter(Boolean);
  const joined = cleaned.join("_").replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "");
  return joined || "Document";
}

/**
 * Open a printable document (full HTML string) in a new window and trigger
 * the browser print/PDF dialog. The HTML must be a full document; any inline
 * auto-print <script> should be omitted — this helper injects it.
 *
 * Pass `docTitle` to control the suggested PDF/print file name. Build it with
 * `buildFileTitle(...)`.
 */
export function printDocHtml(html: string, docTitle?: string) {
  const w = window.open("", "_blank", "width=1000,height=700");
  if (!w) throw new Error("popup-blocked");
  let out = html;
  if (docTitle) {
    const safe = docTitle.replace(/</g, "").replace(/>/g, "");
    if (/<title>[\s\S]*?<\/title>/i.test(out)) {
      out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${safe}</title>`);
    } else if (out.includes("</head>")) {
      out = out.replace("</head>", `<title>${safe}</title></head>`);
    }
  }
  const withScript = out.includes("</body>")
    ? out.replace("</body>", `${AUTO_PRINT_SCRIPT}</body>`)
    : out + AUTO_PRINT_SCRIPT;
  w.document.write(withScript);
  w.document.close();
  if (docTitle) {
    try {
      w.document.title = docTitle.replace(/</g, "").replace(/>/g, "");
    } catch {
      /* cross-origin guard — ignore */
    }
  }
}
