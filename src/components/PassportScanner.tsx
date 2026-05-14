import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface PassportFields {
  passenger_name?: string;
  passport?: string;
  date_of_birth?: string;
  issue_date?: string;
  expiry_date?: string;
  gender?: string;
  nationality?: string;
  country_code?: string;
  mrz_raw?: string;
}

interface Props {
  onResult: (fields: PassportFields) => void;
  compact?: boolean;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/passport-ocr`;

async function fileToDataUrl(file: File): Promise<string> {
  // Some phones return HEIC which the browser cannot decode → reject early
  if (/\.hei[cf]$/i.test(file.name) || /heic|heif/i.test(file.type)) {
    throw new Error("HEIC ছবি সাপোর্ট করে না — JPG/PNG দিয়ে আপলোড করুন");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      const t = window.setTimeout(() => rej(new Error("ছবি লোড টাইমআউট")), 15000);
      i.onload = () => { window.clearTimeout(t); res(i); };
      i.onerror = () => { window.clearTimeout(t); rej(new Error("ছবি ডিকোড করা যায়নি")); };
      i.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PassportScanner({ onResult, compact }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setErrorOpen(true);
  };

    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("লগ-ইন প্রয়োজন");
        setBusy(false);
        return;
      }
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 60000);
      let resp: Response;
      try {
        resp = await fetch(FUNC_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ image: dataUrl }),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new Error("সার্ভার রেসপন্স দিচ্ছে না (টাইমআউট) — আবার চেষ্টা করুন");
        }
        throw err;
      } finally {
        window.clearTimeout(timer);
      }
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || `HTTP ${resp.status}`);
      const fields: PassportFields = json.fields ?? {};
      if (!fields.passenger_name && !fields.passport) {
        toast.error("পাসপোর্ট পড়া যায়নি — পরিষ্কার ছবি দিয়ে আবার চেষ্টা করুন");
      } else {
        toast.success(`তথ্য পাওয়া গেছে: ${fields.passenger_name ?? ""}`);
        onResult(fields);
      }
    } catch (e) {
      toast.error("OCR সমস্যা: " + (e as Error).message);
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className={`flex gap-2 ${compact ? "" : "p-3 rounded-md border bg-muted/30"}`}>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        size={compact ? "sm" : "default"}
        onClick={() => cameraRef.current?.click()}
        disabled={busy}
        className="gap-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        {busy ? "পড়ছি..." : "পাসপোর্ট স্ক্যান"}
      </Button>
      <Button type="button" size={compact ? "sm" : "default"} variant="outline" onClick={() => fileRef.current?.click()} disabled={busy} className="gap-1.5">
        <Upload className="h-4 w-4" /> ছবি আপলোড
      </Button>
    </div>
  );
}
