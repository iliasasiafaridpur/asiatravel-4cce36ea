import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X, Copy, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { toJpeg } from "html-to-image";

export interface ReceiptInfo {
  receiptId: string;
  date: string;
  passengerName: string;
  mobile?: string;
  refId: string;
  serviceType: string;
  sold: number;
  previouslyReceived: number;
  paid: number;
  discount: number;
  method: string;
  remarks?: string;
  receivedByName: string;
  agencyName?: string;
  airline?: string;
  route?: string;
  flightDate?: string;
}

function fmt(n: number) {
  return `৳${n.toLocaleString()}`;
}


export function ReceiptDialog({
  receipt,
  open,
  onClose,
}: {
  receipt: ReceiptInfo | null;
  open: boolean;
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  if (!receipt) return null;

  const total = receipt.paid + receipt.discount;
  const newReceived = receipt.previouslyReceived + total;
  const remaining = Math.max(0, receipt.sold - newReceived);

  const handlePrint = () => {
    const node = printRef.current;
    if (!node) return;
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>Receipt ${receipt.receiptId}</title>
      <style>
        @page { size: A5; margin: 10mm; }
        body { font-family: ui-sans-serif, system-ui, sans-serif; color:#111; margin:0; padding:16px; }
        .r { max-width:520px; margin:0 auto; }
        .h { text-align:center; border-bottom:2px solid #111; padding-bottom:8px; margin-bottom:12px; }
        .h h1 { margin:0; font-size:18px; }
        .h .sub { font-size:11px; color:#555; }
        .row { display:flex; justify-content:space-between; gap:8px; font-size:12px; padding:3px 0; }
        .row b { font-weight:600; }
        .sect { margin-top:10px; padding-top:8px; border-top:1px dashed #aaa; }
        .total { font-size:14px; font-weight:700; border-top:2px solid #111; margin-top:8px; padding-top:6px; }
        .ft { margin-top:18px; font-size:10px; color:#666; text-align:center; }
        .sig { margin-top:30px; display:flex; justify-content:space-between; font-size:11px; }
        .sig div { border-top:1px solid #111; padding-top:4px; width:40%; text-align:center; }
      </style></head><body>${node.innerHTML}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
    }, 300);
  };

  const receiptText = () => {
    const lines = [
      `*Payment Receipt*`,
      `Receipt: ${receipt.receiptId}`,
      `Date: ${receipt.date}`,
      ``,
      `Name: ${receipt.passengerName}`,
      `Ref: ${receipt.refId}`,
      `Service: ${receipt.serviceType}`,
      receipt.airline ? `Airline: ${receipt.airline}` : "",
      receipt.route ? `Route: ${receipt.route}` : "",
      receipt.flightDate ? `Flight: ${receipt.flightDate}` : "",
      ``,
      `Sold: ${fmt(receipt.sold)}`,
      `Previously Received: ${fmt(receipt.previouslyReceived)}`,
      receipt.paid > 0 ? `Paid Now (${receipt.method}): ${fmt(receipt.paid)}` : "",
      receipt.discount > 0 ? `Discount: ${fmt(receipt.discount)}` : "",
      `*Total Adjusted: ${fmt(total)}*`,
      `Remaining Due: ${fmt(remaining)}`,
      ``,
      `Received by: ${receipt.receivedByName}`,
      receipt.agencyName ? `\n— ${receipt.agencyName}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return lines;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(receiptText());
      toast.success("Receipt text copied");
    } catch {
      toast.error("Copy failed — receipt text select করে copy করুন");
    }
  };

  // Build an offscreen DOM that uses ONLY safe rgb/hex colors (no oklch),
  // since html2canvas cannot parse oklch() values from Tailwind tokens.
  const buildPrintableNode = (): HTMLDivElement => {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;top:0;left:0;z-index:-1;opacity:0;pointer-events:none;width:520px;box-sizing:border-box;background:#ffffff;color:#111;padding:20px;font-family:ui-sans-serif,system-ui,sans-serif;";
    wrap.innerHTML = `
      <div style="text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px;">
        <h1 style="margin:0;font-size:18px;font-weight:700;">${receipt.agencyName || "Asia Travel"}</h1>
        <div style="font-size:11px;color:#555;">Payment Receipt</div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Receipt #</b><span style="font-family:ui-monospace,monospace;">${receipt.receiptId}</span></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Date</b><span>${receipt.date}</span></div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #aaa;">
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Passenger</b><span>${receipt.passengerName}</span></div>
        ${receipt.mobile ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Mobile</b><span>${receipt.mobile}</span></div>` : ""}
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Ref ID</b><span style="font-family:ui-monospace,monospace;">${receipt.refId}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Service</b><span>${receipt.serviceType}</span></div>
        ${receipt.airline ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Airline</b><span>${receipt.airline}</span></div>` : ""}
        ${receipt.route ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Route</b><span>${receipt.route}</span></div>` : ""}
        ${receipt.flightDate ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Flight Date</b><span>${receipt.flightDate}</span></div>` : ""}
      </div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px dashed #aaa;">
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Sold Price</b><span>${fmt(receipt.sold)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Previously Received</b><span>${fmt(receipt.previouslyReceived)}</span></div>
        ${receipt.paid > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Paid Now (${receipt.method})</b><span style="color:#059669;">+${fmt(receipt.paid)}</span></div>` : ""}
        ${receipt.discount > 0 ? `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;"><b>Discount</b><span style="color:#d97706;">−${fmt(receipt.discount)}</span></div>` : ""}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;border-top:2px solid #111;margin-top:8px;padding-top:6px;"><span>Total Adjusted</span><span>${fmt(total)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;margin-top:4px;"><b>Remaining Due</b><span style="font-weight:600;color:${remaining > 0 ? "#e11d48" : "#059669"};">${fmt(remaining)}</span></div>
      </div>
      ${receipt.remarks ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #aaa;font-size:12px;"><b>Remarks:</b> ${receipt.remarks}</div>` : ""}
      <div style="margin-top:30px;display:flex;justify-content:space-between;font-size:11px;">
        <div style="border-top:1px solid #111;padding-top:4px;width:40%;text-align:center;">Received by<br/>${receipt.receivedByName}</div>
        <div style="border-top:1px solid #111;padding-top:4px;width:40%;text-align:center;">Customer Signature</div>
      </div>
      <div style="margin-top:18px;font-size:10px;color:#666;text-align:center;">Thank you for choosing us. This is a computer generated receipt.</div>
    `;
    document.body.appendChild(wrap);
    return wrap;
  };

  const renderJpegBlob = async (): Promise<Blob | null> => {
    const node = buildPrintableNode();
    try {
      const dataUrl = await toJpeg(node, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch (e) {
      console.error("renderJpegBlob failed", e);
      return null;
    } finally {
      node.remove();
    }
  };

  const jpgFileName = () =>
    `Receipt-${receipt.receiptId}-${(receipt.passengerName || "").replace(/[^a-z0-9]+/gi, "_")}.jpg`;



  const handleDownloadJpg = async () => {
    setBusy(true);
    try {
      const blob = await renderJpegBlob();
      if (!blob) throw new Error("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = jpgFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("JPG ডাউনলোড শুরু হয়েছে");
    } catch {
      toast.error("JPG তৈরি করা যায়নি");
    } finally {
      setBusy(false);
    }
  };

  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator).canShare === "function";

  const handleShareImage = async () => {
    setBusy(true);
    try {
      const blob = await renderJpegBlob();
      if (!blob) throw new Error("blob");
      const file = new File([blob], jpgFileName(), { type: "image/jpeg" });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({
          files: [file],
          title: `Receipt ${receipt.receiptId}`,
          text: receiptText(),
        });
      } else {
        toast.error("এই ব্রাউজার image share সমর্থন করে না — JPG ডাউনলোড করে attach করুন");
      }
    } catch (e: unknown) {
      const err = e as { name?: string };
      if (err?.name !== "AbortError") toast.error("Share করা যায়নি");
    } finally {
      setBusy(false);
    }
  };

  const handleWhatsApp = () => {
    const phone = normalizeBdPhone(receipt.mobile);
    const lines = receiptText();
    const text = encodeURIComponent(lines);
    const url = phone
      ? `https://web.whatsapp.com/send?phone=${phone}&text=${text}`
      : `https://web.whatsapp.com/send?text=${text}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2 flex flex-row items-center justify-between space-y-0">
          <DialogTitle className="text-base">Payment Receipt</DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] overflow-y-auto px-4 pb-2">
          <div ref={printRef}>
            <div className="r">
              <div className="h text-center border-b-2 border-foreground pb-2 mb-3">
                <h1 className="text-base font-bold m-0">{receipt.agencyName || "Asia Travel"}</h1>
                <div className="sub text-[10px] text-muted-foreground">Payment Receipt</div>
              </div>

              <div className="row flex justify-between text-xs py-0.5">
                <b>Receipt #</b>
                <span className="font-mono">{receipt.receiptId}</span>
              </div>
              <div className="row flex justify-between text-xs py-0.5">
                <b>Date</b>
                <span>{receipt.date}</span>
              </div>

              <div className="sect mt-2 pt-2 border-t border-dashed">
                <div className="row flex justify-between text-xs py-0.5">
                  <b>Passenger</b>
                  <span>{receipt.passengerName}</span>
                </div>
                {receipt.mobile && (
                  <div className="row flex justify-between text-xs py-0.5">
                    <b>Mobile</b>
                    <span>{receipt.mobile}</span>
                  </div>
                )}
                <div className="row flex justify-between text-xs py-0.5">
                  <b>Ref ID</b>
                  <span className="font-mono">{receipt.refId}</span>
                </div>
                <div className="row flex justify-between text-xs py-0.5">
                  <b>Service</b>
                  <span>{receipt.serviceType}</span>
                </div>
                {receipt.airline && (
                  <div className="row flex justify-between text-xs py-0.5">
                    <b>Airline</b>
                    <span>{receipt.airline}</span>
                  </div>
                )}
                {receipt.route && (
                  <div className="row flex justify-between text-xs py-0.5">
                    <b>Route</b>
                    <span>{receipt.route}</span>
                  </div>
                )}
                {receipt.flightDate && (
                  <div className="row flex justify-between text-xs py-0.5">
                    <b>Flight Date</b>
                    <span>{receipt.flightDate}</span>
                  </div>
                )}
              </div>

              <div className="sect mt-2 pt-2 border-t border-dashed">
                <div className="row flex justify-between text-xs py-0.5">
                  <b>Sold Price</b>
                  <span className="tabular-nums">{fmt(receipt.sold)}</span>
                </div>
                <div className="row flex justify-between text-xs py-0.5">
                  <b>Previously Received</b>
                  <span className="tabular-nums">{fmt(receipt.previouslyReceived)}</span>
                </div>
                {receipt.paid > 0 && (
                  <div className="row flex justify-between text-xs py-0.5">
                    <b>Paid Now ({receipt.method})</b>
                    <span className="tabular-nums text-emerald-600">+{fmt(receipt.paid)}</span>
                  </div>
                )}
                {receipt.discount > 0 && (
                  <div className="row flex justify-between text-xs py-0.5">
                    <b>Discount</b>
                    <span className="tabular-nums text-amber-600">−{fmt(receipt.discount)}</span>
                  </div>
                )}
                <div className="total flex justify-between text-sm font-bold border-t-2 border-foreground mt-2 pt-1.5">
                  <span>Total Adjusted</span>
                  <span className="tabular-nums">{fmt(total)}</span>
                </div>
                <div className="row flex justify-between text-xs py-0.5 mt-1">
                  <b>Remaining Due</b>
                  <span
                    className={`tabular-nums font-semibold ${remaining > 0 ? "text-rose-500" : "text-emerald-600"}`}
                  >
                    {fmt(remaining)}
                  </span>
                </div>
              </div>

              {receipt.remarks && (
                <div className="sect mt-2 pt-2 border-t border-dashed text-xs">
                  <b>Remarks:</b> {receipt.remarks}
                </div>
              )}

              <div className="sig mt-6 flex justify-between text-[11px]">
                <div className="border-t border-foreground pt-1 w-[40%] text-center">
                  Received by
                  <br />
                  {receipt.receivedByName}
                </div>
                <div className="border-t border-foreground pt-1 w-[40%] text-center">
                  Customer Signature
                </div>
              </div>

              <div className="ft mt-4 text-[10px] text-center text-muted-foreground">
                Thank you for choosing us. This is a computer generated receipt.
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 p-3 border-t bg-muted/30">
          <Button variant="outline" size="sm" className="flex-1 min-w-[5.5rem]" onClick={onClose}>
            <X className="h-4 w-4" /> বন্ধ
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 min-w-[5.5rem]"
            onClick={handleCopy}
          >
            <Copy className="h-4 w-4" /> Copy
          </Button>
          <Button variant="outline" size="sm" className="flex-1 min-w-[7rem]" onClick={handlePrint}>
            <Printer className="h-4 w-4" /> Print / PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 min-w-[5.5rem]"
            onClick={handleDownloadJpg}
            disabled={busy}
          >
            <ImageIcon className="h-4 w-4" /> JPG
          </Button>
          {canShareFiles && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 min-w-[7rem]"
              onClick={handleShareImage}
              disabled={busy}
            >
              <Share2 className="h-4 w-4" /> Share Image
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 min-w-[7rem] bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleWhatsApp}
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
