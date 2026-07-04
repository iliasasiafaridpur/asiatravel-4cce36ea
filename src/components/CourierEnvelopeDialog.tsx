import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Package } from "lucide-react";
import { printDocHtml, buildFileTitle } from "@/lib/print-export";

type PaperSize = "A4" | "A5" | "A6" | "A7";

// International paper dimensions in millimeters (width × height, portrait).
const SIZES: Record<PaperSize, { w: number; h: number; label: string }> = {
  A4: { w: 210, h: 297, label: "A4 — ২১.০ × ২৯.৭ সেমি (পুরো পাতা)" },
  A5: { w: 148, h: 210, label: "A5 — ১৪.৮ × ২১.০ সেমি (অর্ধেক)" },
  A6: { w: 105, h: 148, label: "A6 — ১০.৫ × ১৪.৮ সেমি (চার ভাগের এক)" },
  A7: { w: 74, h: 105, label: "A7 — ৭.৪ × ১০.৫ সেমি" },
};

const MM_TO_PX = 96 / 25.4; // CSS px per mm

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function CourierEnvelopeDialog({
  open,
  onOpenChange,
  name,
  phones,
  address,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  phones: string[];
  address: string;
}) {
  const [size, setSize] = useState<PaperSize>("A5");
  const dim = SIZES[size];

  // On-screen preview: scale the real paper size down so it fits the dialog.
  const previewWidthPx = dim.w * MM_TO_PX;
  const previewScale = useMemo(() => Math.min(1, 320 / previewWidthPx), [previewWidthPx]);

  const phoneStr = phones.filter(Boolean).join(", ");

  const EnvelopeContent = (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontSize: "11px", letterSpacing: "1px", color: "#64748b", textTransform: "uppercase" }}>
          প্রাপক / To
        </div>
        <div style={{ fontSize: "17px", fontWeight: 700, marginTop: "4px" }}>{name}</div>
        {address ? (
          <div style={{ fontSize: "13px", marginTop: "6px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{address}</div>
        ) : (
          <div style={{ fontSize: "13px", marginTop: "6px", color: "#94a3b8", fontStyle: "italic" }}>ঠিকানা নেই</div>
        )}
        {phoneStr ? (
          <div style={{ fontSize: "13px", marginTop: "6px", fontWeight: 600 }}>মোবাইলঃ {phoneStr}</div>
        ) : null}
      </div>
      <div style={{ fontSize: "11px", color: "#94a3b8", borderTop: "1px dashed #cbd5e1", paddingTop: "6px" }}>
        প্রেরকঃ Asia Travel International
      </div>
    </div>
  );

  const handlePrint = () => {
    const padMm = Math.max(6, Math.round(dim.w * 0.06));
    const html = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8" />
<title></title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Noto Sans Bengali', 'Hind Siliguri', system-ui, -apple-system, sans-serif; color: #0f172a; }
  .envelope {
    width: ${dim.w}mm;
    height: ${dim.h}mm;
    padding: ${padMm}mm;
    border: 1px dashed #94a3b8;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow: hidden;
  }
  .lbl { font-size: 10pt; letter-spacing: 1px; color: #64748b; text-transform: uppercase; }
  .nm { font-size: 15pt; font-weight: 700; margin-top: 3mm; }
  .addr { font-size: 12pt; margin-top: 3mm; line-height: 1.5; white-space: pre-wrap; }
  .noaddr { font-size: 12pt; margin-top: 3mm; color: #94a3b8; font-style: italic; }
  .ph { font-size: 12pt; margin-top: 3mm; font-weight: 600; }
  .from { font-size: 9pt; color: #94a3b8; border-top: 1px dashed #cbd5e1; padding-top: 2mm; }
  @media print {
    .envelope { border: none; }
  }
</style>
</head>
<body>
  <div class="envelope">
    <div>
      <div class="lbl">প্রাপক / To</div>
      <div class="nm">${esc(name)}</div>
      ${address ? `<div class="addr">${esc(address)}</div>` : `<div class="noaddr">ঠিকানা নেই</div>`}
      ${phoneStr ? `<div class="ph">মোবাইলঃ ${esc(phoneStr)}</div>` : ""}
    </div>
    <div class="from">প্রেরকঃ Asia Travel International</div>
  </div>
</body>
</html>`;
    printDocHtml(html, buildFileTitle("Courier", name, size));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4 w-4" /> কুরিয়ার খাম প্রিন্ট
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">কাগজের সাইজ</label>
            <Select value={size} onValueChange={(v) => setSize(v as PaperSize)}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SIZES) as PaperSize[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {SIZES[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              ট্রে-তে A4 কাগজ থাকবে; লেখা {size} সাইজের জায়গা জুড়ে প্রিন্ট হবে।
            </p>
          </div>

          {/* Live preview with dotted border showing the selected size */}
          <div className="flex justify-center rounded-lg bg-muted/40 p-4">
            <div
              style={{
                width: `${previewWidthPx * previewScale}px`,
                height: `${dim.h * MM_TO_PX * previewScale}px`,
              }}
            >
              <div
                style={{
                  width: `${previewWidthPx}px`,
                  height: `${dim.h * MM_TO_PX}px`,
                  transform: `scale(${previewScale})`,
                  transformOrigin: "top left",
                }}
              >
                <div
                  className="h-full w-full rounded-sm border-2 border-dashed border-primary/60 bg-background p-4"
                  style={{ boxSizing: "border-box" }}
                >
                  {EnvelopeContent}
                </div>
              </div>
            </div>
          </div>

          <Button onClick={handlePrint} className="w-full">
            <Printer className="h-4 w-4" /> প্রিন্ট করুন
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
