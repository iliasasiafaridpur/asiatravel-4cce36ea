// Auto-print script appended only for the print/PDF flow.
const AUTO_PRINT_SCRIPT =
  `<script>window.onload=function(){setTimeout(function(){window.print();},250);setTimeout(function(){window.close();},800);}<\/script>`;

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
