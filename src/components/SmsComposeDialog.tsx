import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";
import { sendSms } from "@/lib/sms.functions";

/** Preview + edit + send one SMS. `build` returns the prefilled message. */
export function SmsComposeDialog({ open, onOpenChange, title, mobile, info, build, kind, moduleKey, refId, name }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; mobile: string;
  info?: React.ReactNode; build: () => Promise<string>; kind: string; moduleKey?: string; refId?: string; name?: string;
}) {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    build().then(setMsg).catch(() => setMsg("")).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const send = async () => {
    if (!msg.trim()) return toast.error("মেসেজ খালি");
    setBusy(true);
    const r = await sendSms({ data: { mobile, message: msg, kind, module_key: moduleKey, ref_id: refId, passenger_name: name } }).catch((e) => ({ ok: false, error: String(e) }));
    setBusy(false);
    if (r.ok) { toast.success("SMS পাঠানো হয়েছে"); onOpenChange(false); } else toast.error("SMS যায়নি: " + (r.error ?? ""));
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" /> {title}</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div>Mobile: <span className="font-mono font-semibold">{mobile}</span></div>
          {info}
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Textarea rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} />}
          <p className="text-[11px] text-muted-foreground">{msg.length} অক্ষর</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>বাতিল</Button>
          <Button onClick={send} disabled={busy || loading}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send SMS</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
