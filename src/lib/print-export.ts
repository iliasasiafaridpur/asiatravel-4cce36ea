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
    const width = Math.max(target.scrollWidth, doc.documentElement.scrollWidth, 800);
    const height = Math.max(
      target.scrollHeight,
      target.offsetHeight,
      doc.documentElement.scrollHeight,
      200,
    );
    // Make the iframe big enough so nothing is clipped during capture.
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    await new Promise((r) => setTimeout(r, 50));

    const dataUrl = await toJpeg(target, {
      quality: 0.95,
      backgroundColor: "#ffffff",
      width,
      height,
      pixelRatio: safePixelRatio(width, height),
    });
    triggerDownload(dataUrl, filename);
  } finally {
    setTimeout(() => iframe.remove(), 600);
  }
}

/**
 * Browsers cap canvas dimensions/area (~16384px per side on Chrome). For very
 * tall documents a pixelRatio of 2 overflows that cap and the image comes out
 * cropped. Scale the ratio down so width*ratio and height*ratio stay safe.
 */
function safePixelRatio(width: number, height: number): number {
  const MAX_SIDE = 14000; // safety margin below the 16384 hard cap
  const MAX_AREA = 120_000_000; // ~120MP to stay well within memory limits
  let ratio = 2;
  ratio = Math.min(ratio, MAX_SIDE / Math.max(width, 1), MAX_SIDE / Math.max(height, 1));
  const areaRatio = Math.sqrt(MAX_AREA / Math.max(width * height, 1));
  ratio = Math.min(ratio, areaRatio);
  return Math.max(1, Math.min(2, ratio));
}

/**
 * Download a live on-screen element (e.g. the rendered invoice) as a JPEG.
 */
export async function downloadNodeAsJpeg(node: HTMLElement, filename: string) {
  try { await (document as Document & { fonts?: FontFaceSet }).fonts?.ready; } catch { /* ignore */ }
  const width = Math.max(node.scrollWidth, node.offsetWidth, 1);
  const height = Math.max(node.scrollHeight, node.offsetHeight, 1);
  const dataUrl = await toJpeg(node, {
    quality: 0.95,
    backgroundColor: "#ffffff",
    width,
    height,
    pixelRatio: safePixelRatio(width, height),
  });
  triggerDownload(dataUrl, filename);
}
