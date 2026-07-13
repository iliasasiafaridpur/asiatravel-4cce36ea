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
 * contact strip) as a self-contained HTML string with inline styles. This is the
 * SINGLE SOURCE OF TRUTH for the pad's top part — both the Blank Pad dialog and
 * the ledger "Pad page print" flow render it, so any update to the letterhead
 * shows up in every place at once.
 *
 * `logoUrl` must be an absolute URL (e.g. `${window.location.origin}${logoAsset.url}`).
 * `opts.metaRowsHtml` renders an optional right-aligned meta block (e.g. Ref/Date
 * on the Blank Pad). `opts.padding` / `opts.marginBottom` tune spacing for the
 * host document.
 */
export function buildPadHeaderHtml(
  logoUrl: string,
  opts?: { padding?: string; marginBottom?: string; metaRowsHtml?: string },
): string {
  const ACCENT = "#496a9d";
  const DARK = "#0b2545";
  const GOLD = "#b08a3e";
  const padding = opts?.padding ?? "0 0 10px";
  const marginBottom = opts?.marginBottom ?? "16px";
  const meta = opts?.metaRowsHtml
    ? `<div style="text-align:right;min-width:130px;">${opts.metaRowsHtml}</div>`
    : "";
  return `<div style="border-bottom:2px solid ${ACCENT};padding:${padding};margin-bottom:${marginBottom};-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
      <div style="display:flex;align-items:center;gap:18px;min-width:0;">
        <div style="height:96px;width:96px;border-radius:16px;background:#fff;border:1px solid ${ACCENT}33;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;"><img src="${logoUrl}" alt="logo" style="height:100%;width:100%;object-fit:contain;"/></div>
        <div>
          <div style="font-size:31px;font-weight:800;letter-spacing:-0.4px;color:${DARK};line-height:1.1;">${PAD_AGENCY.name}</div>
          <div style="font-size:14px;font-style:italic;color:${GOLD};font-weight:600;margin-top:5px;">"${PAD_AGENCY.slogan}"</div>
        </div>
      </div>
      ${meta}
    </div>
    <div style="display:flex;flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding-top:11px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569;white-space:nowrap;">
      <span style="white-space:nowrap;">📍 ${PAD_AGENCY.address}, Bangladesh</span>
      <span style="white-space:nowrap;">📞 ${PAD_AGENCY.phone}</span>
      <span style="white-space:nowrap;">✉️ ${PAD_AGENCY.email}</span>
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
