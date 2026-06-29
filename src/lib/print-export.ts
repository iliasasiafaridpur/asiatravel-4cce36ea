import { toJpeg } from "html-to-image";

// Auto-print script appended only for the print/PDF flow (NOT for JPEG capture).
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

function triggerDownload(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename.toLowerCase().endsWith(".jpg") ? filename : `${filename}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Render a full HTML document off-screen (hidden iframe) and download it as a
 * JPEG image. Same source HTML used for printing → identical look.
 */
export async function downloadDocHtmlAsJpeg(html: string, filename: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "820px",
    height: "10px",
    border: "0",
    background: "#ffffff",
  } as CSSStyleDeclaration);
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("iframe-doc");
    doc.open();
    doc.write(html);
    doc.close();

    // Wait for document load
    await new Promise<void>((resolve) => {
      if (doc.readyState === "complete") resolve();
      else iframe.contentWindow?.addEventListener("load", () => resolve(), { once: true });
    });
    // Fonts
    try { await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* ignore */ }
    // Images
    await Promise.all(
      Array.from(doc.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((r) => { img.onload = img.onerror = () => r(null); }),
      ),
    );
    await new Promise((r) => setTimeout(r, 350));

    const target = doc.body;
    const width = Math.max(target.scrollWidth, 800);
    const height = Math.max(target.scrollHeight, target.offsetHeight, 200);
    iframe.style.height = `${height}px`;

    const dataUrl = await toJpeg(target, {
      quality: 0.95,
      backgroundColor: "#ffffff",
      width,
      height,
      pixelRatio: 2,
    });
    triggerDownload(dataUrl, filename);
  } finally {
    setTimeout(() => iframe.remove(), 600);
  }
}

/**
 * Download a live on-screen element (e.g. the rendered invoice) as a JPEG.
 */
export async function downloadNodeAsJpeg(node: HTMLElement, filename: string) {
  try { await (document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* ignore */ }
  const dataUrl = await toJpeg(node, {
    quality: 0.95,
    backgroundColor: "#ffffff",
    pixelRatio: 2,
  });
  triggerDownload(dataUrl, filename);
}
