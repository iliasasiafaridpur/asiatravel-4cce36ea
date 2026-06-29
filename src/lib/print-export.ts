// Auto-print script appended only for the print/PDF flow.
const AUTO_PRINT_SCRIPT =
  `<script>window.onload=function(){setTimeout(function(){window.print();},250);setTimeout(function(){window.close();},800);}<\/script>`;

/**
 * Open a printable document (full HTML string) in a new window and trigger
 * the browser print/PDF dialog. The HTML must be a full document; any inline
 * auto-print <script> should be omitted — this helper injects it.
 */
export function printDocHtml(html: string) {
  const w = window.open("", "_blank", "width=1000,height=700");
  if (!w) throw new Error("popup-blocked");
  const withScript = html.includes("</body>")
    ? html.replace("</body>", `${AUTO_PRINT_SCRIPT}</body>`)
    : html + AUTO_PRINT_SCRIPT;
  w.document.write(withScript);
  w.document.close();
}
