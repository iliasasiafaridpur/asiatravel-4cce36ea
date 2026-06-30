import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/modules";
import { printDocHtml, buildFileTitle } from "@/lib/print-export";
import logoAsset from "@/assets/logo.png.asset.json";

type Row = Record<string, unknown> & { id: string };

interface Props {
  rows: Row[];
  idColumn: string;
}

const currentMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

const COLS: { key: string; label: string; date?: boolean; num?: boolean }[] = [
  { key: "__id", label: "ID" },
  { key: "entry_date", label: "Date", date: true },
  { key: "passenger_name", label: "Name" },
  { key: "passport", label: "Passport" },
  { key: "mobile", label: "Mobile" },
  { key: "country_name", label: "Country" },
  { key: "sold_price", label: "Price", num: true },
  { key: "vendor_sent_date", label: "V-Send Date", date: true },
  { key: "received_date", label: "V-Rece Date", date: true },
  { key: "delivery_date", label: "Delivery Date", date: true },
];

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function BmetMonthlyPrint({ rows, idColumn }: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<string>(currentMonth());

  const list = useMemo(() => {
    // ID-এর সিরিয়াল নং অনুযায়ী সাজানো (BMET-2606-001, 002 …); সমান হলে তারিখ।
    const serialOf = (s: string) => {
      const m = String(s).match(/(\d+)\s*$/);
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    };
    return rows
      .filter((r) => !r.cancelled)
      .filter((r) => String(r.entry_date ?? "").slice(0, 7) === month)
      .sort((a, b) => {
        const ai = String(a[idColumn] ?? "");
        const bi = String(b[idColumn] ?? "");
        const d = serialOf(ai) - serialOf(bi);
        if (d !== 0) return d;
        const byId = ai.localeCompare(bi);
        if (byId !== 0) return byId;
        return String(a.entry_date ?? "").localeCompare(String(b.entry_date ?? ""));
      });
  }, [rows, month, idColumn]);

  const monthLabel = useMemo(() => {
    if (!month) return "";
    const d = new Date(`${month}-01T00:00:00`);
    return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }, [month]);

  const cellValue = (r: Row, key: string, date?: boolean, num?: boolean) => {
    if (key === "__id") return String(r[idColumn] ?? "");
    const v = r[key];
    if (date) return v ? formatDate(v as string) : "—";
    if (num) return Number(v ?? 0).toLocaleString();
    return String(v ?? "");
  };

  // একই HTML প্রিভিউ ও প্রিন্ট — দুটোতে হুবহু একই তথ্য, কোনো তথ্য কাটবে না।
  const buildHtml = useMemo(() => {
    const head = COLS.map((c) => `<th class="${c.num ? "r" : ""}">${esc(c.label)}</th>`).join("");
    const body = list
      .map(
        (r) =>
          `<tr>${COLS.map(
            (c) =>
              `<td class="${c.num ? "r" : ""}">${esc(
                cellValue(r, c.key, c.date, c.num),
              )}</td>`,
          ).join("")}</tr>`,
      )
      .join("");
    const totalPrice = list.reduce((s, r) => s + Number(r.sold_price ?? 0), 0);

    return `<!doctype html><html><head><meta charset="utf-8"><title>BMET ${esc(monthLabel)}</title>
      <style>
        body{font-family:system-ui,'Noto Sans Bengali',sans-serif;padding:20px;color:#0f172a;position:relative}
        body::before{content:"";position:fixed;inset:0;z-index:9999;pointer-events:none;background-image:url("${window.location.origin}${logoAsset.url}");background-repeat:no-repeat;background-position:center;background-size:60%;opacity:0.06;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        h1{font-size:18px;margin:0 0 2px}
        .sub{color:#64748b;font-size:12px;margin-bottom:2px}
        .meta{color:#64748b;font-size:11px;margin-bottom:10px}
        table{width:100%;border-collapse:collapse;font-size:8.5px;table-layout:auto}
        th,td{border:1px solid #cbd5e1;padding:2px 4px;text-align:left;white-space:nowrap;vertical-align:middle}
        th{background:#f1f5f9;font-size:9px}
        .r{text-align:right;font-variant-numeric:tabular-nums}
        .foot{margin-top:12px;padding-top:8px;border-top:2px solid #0f172a;display:flex;justify-content:space-between;font-size:13px;font-weight:700}
        @page{size:A4 portrait;margin:8mm}
        @media print{button{display:none}}
      </style></head><body>
      <h1>BMET Card — ${esc(monthLabel)}</h1>
      <div class="sub">মাসিক তালিকা · মোট ${list.length} টি</div>
      <div class="meta">প্রিন্ট তারিখ: ${esc(formatDate(new Date().toISOString().slice(0, 10)))}</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <div class="foot"><span>মোট ${list.length} টি</span><span>মোট Price: ৳${totalPrice.toLocaleString()}</span></div>
      </body></html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, monthLabel]);

  const doPrint = () => {
    if (list.length === 0) {
      toast.error("এই মাসে কোনো রেকর্ড নেই");
      return;
    }
    try {
      printDocHtml(buildHtml, buildFileTitle("BMET", monthLabel.replace(/\s+/g, "_")));
    } catch {
      toast.error("প্রিন্ট উইন্ডো খোলা যায়নি (পপ-আপ ব্লক?)");
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-10 gap-1.5"
        title="মাস অনুযায়ী প্রিন্ট"
      >
        <Printer className="h-4 w-4" /> Print
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>BMET মাসিক প্রিন্ট প্রিভিউ</DialogTitle>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">মাস নির্বাচন করুন</Label>
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-9 w-44 text-sm"
              />
            </div>
            <div className="text-sm text-muted-foreground pb-2">
              <b className="text-foreground">{monthLabel}</b> · মোট{" "}
              <b className="text-foreground">{list.length}</b> টি রেকর্ড
            </div>
            <div className="ml-auto pb-1">
              <Button type="button" onClick={doPrint} disabled={list.length === 0} className="gap-1.5">
                <Printer className="h-4 w-4" /> প্রিন্ট করুন
              </Button>
            </div>
          </div>

          {list.length === 0 ? (
            <div className="border rounded-md text-center text-muted-foreground py-12 text-sm">
              এই মাসে কোনো রেকর্ড পাওয়া যায়নি
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden bg-white">
              {/* প্রিভিউ = প্রিন্ট: হুবহু একই HTML একটি iframe-এ দেখানো হচ্ছে */}
              <iframe
                title="BMET print preview"
                srcDoc={buildHtml}
                className="w-full"
                style={{ height: "62vh", border: "none", background: "#fff" }}
              />
            </div>
          )}

        </DialogContent>
      </Dialog>
    </>
  );
}
