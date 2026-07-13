import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, FileText, X } from "lucide-react";
import { printDocHtml, buildFileTitle } from "@/lib/print-export";
import { formatDate } from "@/lib/modules";
import logoAsset from "@/assets/logo.png.asset.json";
import { toast } from "sonner";

const AGENCY = {
  name: "ASIA TOURS AND TRAVELS",
  slogan: "Customer satisfaction is our primary goal.",
  address: "Bariplaza 4th Floor, Thana Road, Faridpur",
  phone: "+8801721-399599",
  email: "kaiumkhan449@gmail.com",
};

type PaperKey = "A4" | "A5" | "Letter" | "Legal";
type Orientation = "portrait" | "landscape";
type BodyStyle = "blank" | "ruled" | "grid";

const PAPER: Record<PaperKey, { label: string; w: string; h: string }> = {
  A4: { label: "A4 (210×297mm)", w: "210mm", h: "297mm" },
  A5: { label: "A5 (148×210mm)", w: "148mm", h: "210mm" },
  Letter: { label: "Letter (8.5×11in)", w: "8.5in", h: "11in" },
  Legal: { label: "Legal (8.5×14in)", w: "8.5in", h: "14in" },
};

const ACCENT = "#496a9d";
const DARK = "#0b2545";
const GOLD = "#b08a3e";

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function BlankPadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [paper, setPaper] = useState<PaperKey>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [bodyStyle, setBodyStyle] = useState<BodyStyle>("blank");

  const [showDate, setShowDate] = useState(true);
  const [showRef, setShowRef] = useState(true);
  const [showTo, setShowTo] = useState(true);
  const [showSubject, setShowSubject] = useState(true);

  const [dateVal, setDateVal] = useState<string>(new Date().toISOString().slice(0, 10));
  const [refVal, setRefVal] = useState<string>("");
  const [toVal, setToVal] = useState<string>("");
  const [subjectVal, setSubjectVal] = useState<string>("");

  const logoUrl = useMemo(() => `${window.location.origin}${logoAsset.url}`, []);

  const buildHtml = () => {
    const p = PAPER[paper];
    const pageW = orientation === "portrait" ? p.w : p.h;
    const pageH = orientation === "portrait" ? p.h : p.w;
    const sizeRule = `${orientation === "portrait" ? p.w : p.h} ${orientation === "portrait" ? p.h : p.w}`;

    const bodyBg =
      bodyStyle === "ruled"
        ? `background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 33px, #d9e0ec 33px, #d9e0ec 34px); background-position: 0 6px;`
        : bodyStyle === "grid"
          ? `background-image: linear-gradient(to right, #e6ebf3 1px, transparent 1px), linear-gradient(to bottom, #e6ebf3 1px, transparent 1px); background-size: 22px 22px;`
          : "";

    const metaRows: string[] = [];
    if (showRef) metaRows.push(`<div class="metarow"><span class="ml">Ref No</span><span class="mv">${refVal ? esc(refVal) : "&nbsp;"}</span></div>`);
    if (showDate) metaRows.push(`<div class="metarow"><span class="ml">Date</span><span class="mv">${dateVal ? esc(formatDate(dateVal)) : "&nbsp;"}</span></div>`);

    const toBlock = showTo
      ? `<div class="toblock"><span class="tol">To</span><div class="tov">${toVal ? esc(toVal).replace(/\n/g, "<br/>") : "&nbsp;"}</div></div>`
      : "";

    const subjectBlock = showSubject
      ? `<div class="subject"><span class="subl">Subject:</span><span class="subv">${subjectVal ? esc(subjectVal) : "&nbsp;"}</span></div>`
      : "";

    return `<!doctype html><html><head><meta charset="utf-8"><title>Asia Tours Pad</title>
<style>
  @page { size: ${sizeRule}; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  html, body { margin: 0; padding: 0; background: #f1f3f7; font-family: ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif; color: #0f172a; }
  .page {
    position: relative; width: ${pageW}; min-height: ${pageH}; margin: 0 auto;
    background: #fff; display: flex; flex-direction: column; overflow: hidden;
  }
  .wm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
  .wm img { width: 62%; max-width: 420px; object-fit: contain; opacity: 0.05; }
  .inner { position: relative; z-index: 1; display: flex; flex-direction: column; flex: 1; }

  /* header */
  .head { border-bottom: 3px solid ${ACCENT}; padding: 14mm 14mm 8mm; }
  .head-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .brand .logo { height: 92px; width: 92px; border-radius: 14px; background: #fff; border: 1px solid ${ACCENT}33; display: flex; align-items: center; justify-content: center; overflow: hidden; flex: none; }
  .brand .logo img { height: 100%; width: 100%; object-fit: contain; }
  .brand .name { font-size: 31px; font-weight: 800; letter-spacing: -0.3px; color: ${DARK}; line-height: 1.1; white-space: nowrap; }
  .brand .slogan { font-size: 13.5px; font-style: italic; color: ${GOLD}; font-weight: 600; margin-top: 5px; }
  .meta { text-align: right; min-width: 130px; }
  .metarow { display: flex; justify-content: flex-end; gap: 8px; font-size: 11.5px; margin-bottom: 4px; }
  .metarow .ml { color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; font-size: 9px; padding-top: 3px; }
  .metarow .mv { min-width: 80px; border-bottom: 1px solid #cbd5e1; font-weight: 600; color: #334155; text-align: left; padding: 0 4px 2px; }
  .head-contact { display: flex; flex-wrap: wrap; gap: 6px 22px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #475569; }
  .head-contact b { color: ${ACCENT}; font-weight: 700; }

  /* recipient + subject */
  .reci { padding: 8mm 14mm 0; }
  .toblock { display: flex; gap: 10px; margin-bottom: 8px; }
  .toblock .tol { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #94a3b8; padding-top: 3px; }
  .toblock .tov { flex: 1; min-height: 20px; border-bottom: 1px dashed #cbd5e1; font-weight: 600; color: #1e293b; font-size: 13px; }
  .subject { display: flex; gap: 8px; align-items: baseline; margin-top: 4px; }
  .subject .subl { font-size: 12px; font-weight: 700; color: ${DARK}; white-space: nowrap; }
  .subject .subv { flex: 1; border-bottom: 1px dashed #cbd5e1; font-weight: 600; color: #1e293b; font-size: 13px; min-height: 18px; }

  /* writing body */
  .body { flex: 1; margin: 6mm 14mm 6mm; border-radius: 6px; ${bodyBg} }

  /* footer */
  .foot { margin-top: auto; padding: 6mm 14mm 10mm; }
  .sign { display: flex; justify-content: flex-end; }
  .sign .box { width: 200px; text-align: center; border-top: 1px solid #94a3b8; padding-top: 4px; font-size: 11px; color: #64748b; }
  .strip { margin-top: 8mm; border-top: 2px solid ${ACCENT}; padding-top: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #94a3b8; }
  .strip b { color: ${ACCENT}; }
</style></head>
<body>
  <div class="page">
    <div class="wm"><img src="${logoUrl}" alt=""/></div>
    <div class="inner">
      <div class="head">
        <div class="head-top">
          <div class="brand">
            <div class="logo"><img src="${logoUrl}" alt="logo"/></div>
            <div>
              <div class="name">${AGENCY.name}</div>
              <div class="slogan">"${AGENCY.slogan}"</div>
            </div>
          </div>
          <div class="meta">${metaRows.join("") || "&nbsp;"}</div>
        </div>
        <div class="head-contact">
          <span>📍 <b></b>${AGENCY.address}, Bangladesh</span>
          <span>📞 <b></b>${AGENCY.phone}</span>
          <span>✉️ <b></b>${AGENCY.email}</span>
        </div>
      </div>

      ${showTo || showSubject ? `<div class="reci">${toBlock}${subjectBlock}</div>` : ""}

      <div class="body"></div>

      <div class="foot">
        <div class="sign"><div class="box">Authorized Signature</div></div>
        <div class="strip">
          <span>${esc(AGENCY.name)}</span>
          <span>Thank you for choosing <b>us</b>.</span>
        </div>
      </div>
    </div>
  </div>
</body></html>`;
  };

  const handlePrint = () => {
    try {
      const docTitle = buildFileTitle(
        "Asia_Tours_Letterhead",
        subjectVal || toVal || refVal || "",
        showDate ? dateVal : "",
      );
      printDocHtml(buildHtml(), docTitle);
    } catch {
      toast.error("পপ-আপ ব্লক হয়েছে — অনুমতি দিন");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" /> Blank Pad — কোম্পানি লেটারহেড
          </DialogTitle>
        </DialogHeader>

        <div className="grid max-h-[78vh] grid-cols-1 gap-4 overflow-y-auto px-5 pb-4 md:grid-cols-[300px_1fr]">
          {/* controls */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">পেপার সাইজ</Label>
                <Select value={paper} onValueChange={(v) => setPaper(v as PaperKey)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAPER) as PaperKey[]).map((k) => (
                      <SelectItem key={k} value={k}>{PAPER[k].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">অরিয়েন্টেশন</Label>
                <Select value={orientation} onValueChange={(v) => setOrientation(v as Orientation)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait</SelectItem>
                    <SelectItem value="landscape">Landscape</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">বডি স্টাইল</Label>
              <Select value={bodyStyle} onValueChange={(v) => setBodyStyle(v as BodyStyle)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="blank">সম্পূর্ণ ফাঁকা (Blank)</SelectItem>
                  <SelectItem value="ruled">লাইন টানা (Ruled)</SelectItem>
                  <SelectItem value="grid">গ্রিড (Dotted/Grid)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Ref No দেখাও</Label>
                <Switch checked={showRef} onCheckedChange={setShowRef} />
              </div>
              {showRef && (
                <Input value={refVal} onChange={(e) => setRefVal(e.target.value)} placeholder="যেমন: ATT/2026/001" className="h-8" />
              )}

              <div className="flex items-center justify-between pt-1">
                <Label className="text-xs">তারিখ দেখাও</Label>
                <Switch checked={showDate} onCheckedChange={setShowDate} />
              </div>
              {showDate && (
                <Input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="h-8" />
              )}

              <div className="flex items-center justify-between pt-1">
                <Label className="text-xs">প্রাপক (To) দেখাও</Label>
                <Switch checked={showTo} onCheckedChange={setShowTo} />
              </div>
              {showTo && (
                <Input value={toVal} onChange={(e) => setToVal(e.target.value)} placeholder="প্রাপকের নাম / ঠিকানা" className="h-8" />
              )}

              <div className="flex items-center justify-between pt-1">
                <Label className="text-xs">বিষয় (Subject) দেখাও</Label>
                <Switch checked={showSubject} onCheckedChange={setShowSubject} />
              </div>
              {showSubject && (
                <Input value={subjectVal} onChange={(e) => setSubjectVal(e.target.value)} placeholder="বিষয় লিখুন" className="h-8" />
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={onClose}>
                <X className="h-4 w-4" /> বন্ধ
              </Button>
              <Button className="flex-1" onClick={handlePrint}>
                <Printer className="h-4 w-4" /> Print / PDF
              </Button>
            </div>
          </div>

          {/* live preview */}
          <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 text-[11px] text-muted-foreground">প্রিভিউ (প্রিন্টে হুবহু এমন আসবে)</div>
            <div className="overflow-hidden rounded border bg-white">
              <iframe
                title="blank-pad-preview"
                className="h-[60vh] w-full border-0 bg-white"
                srcDoc={buildHtml()}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
