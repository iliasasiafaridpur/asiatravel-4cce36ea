import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface PassportFields {
  passenger_name?: string;
  passport?: string;
  mrz_raw?: string;
}

interface Props {
  onResult: (fields: PassportFields) => void;
  compact?: boolean;
}

// Load image file → grayscale + upscaled canvas data URL for better OCR.
async function fileToProcessedCanvas(file: File): Promise<HTMLCanvasElement> {
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
    // Upscale so the small MRZ font is large enough for OCR.
    const target = 2000;
    const scale = Math.min(2.5, Math.max(1, target / Math.max(img.width, img.height)));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    // Grayscale + contrast boost to make the MRZ characters crisp.
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const c = gray < 110 ? 0 : gray > 165 ? 255 : gray;
      d[i] = d[i + 1] = d[i + 2] = c;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Crop the bottom ~30% of the page where the MRZ lives.
function cropMrzRegion(src: HTMLCanvasElement): HTMLCanvasElement {
  const h = Math.round(src.height * 0.32);
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(src, 0, src.height - h, src.width, h, 0, 0, src.width, h);
  return out;
}

// Parse a TD3 passport MRZ (two 44-char lines) → name + passport number.
function parseMrz(text: string): PassportFields | null {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, "").toUpperCase())
    .filter((l) => l.length >= 25 && /[A-Z0-9<]/.test(l));

  // Line 1 starts with P< (passport). Find it.
  const l1Idx = lines.findIndex((l) => /^P[A-Z0-9<]</.test(l) || l.startsWith("P<"));
  if (l1Idx === -1 || l1Idx + 1 >= lines.length) return null;

  let l1 = lines[l1Idx].replace(/[^A-Z0-9<]/g, "");
  let l2 = lines[l1Idx + 1].replace(/[^A-Z0-9<]/g, "");

  // --- Name from line 1 ---
  // Format: P<ISSUER + SURNAME<<GIVEN<NAMES, padded with "<" filler.
  // OCR often misreads the "<" filler as |, digits, or stray marks. Anything
  // that is not A-Z inside the name zone is treated as filler.
  const nameZone = l1
    .slice(5) // strip "P<" + 3-char issuing country
    .replace(/[^A-Z<]/g, "<"); // normalise OCR noise to filler
  const [surnameRaw, givenRaw = ""] = nameZone.split("<<");
  const titleCase = (s: string) =>
    s.replace(/</g, " ").trim().replace(/\s+/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const surname = titleCase(surnameRaw);
  const given = titleCase(givenRaw);
  const passenger_name = [given, surname].filter(Boolean).join(" ").trim();

  // --- Passport number from line 2 (first 9 chars, < = filler) ---
  const passport = l2.slice(0, 9).replace(/</g, "").trim();

  if (!passenger_name && !passport) return null;
  return { passenger_name, passport, mrz_raw: `${l1}\n${l2}` };
}

export function PassportScanner({ onResult, compact }: Props) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const showError = (msg: string) => {
    setErrorMsg(msg);
    setErrorOpen(true);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setProgress(0);
    try {
      const full = await fileToProcessedCanvas(file);
      const mrzCanvas = cropMrzRegion(full);

      // Lazy-load Tesseract only in the browser when actually scanning.
      const { createWorker, PSM } = await import("tesseract.js");

      const worker = await createWorker("eng", 1, {
        logger: (m: { status?: string; progress?: number }) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });
      // MRZ uses only A-Z, 0-9 and "<". Whitelisting these stops the engine
      // from inventing garbage (|, l, I, etc.) for the "<" filler characters.
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });

      const runOcr = (canvas: HTMLCanvasElement) => worker.recognize(canvas);

      let fields: PassportFields | null;
      try {
        // First try the cropped MRZ band; fall back to the full page.
        let { data } = await runOcr(mrzCanvas);
        fields = parseMrz(data.text);
        if (!fields) {
          ({ data } = await runOcr(full));
          fields = parseMrz(data.text);
        }
      } finally {
        await worker.terminate();
      }

      if (!fields || (!fields.passenger_name && !fields.passport)) {
        showError("পাসপোর্টের MRZ পড়া যায়নি।\n\n• নিচের ২ লাইন (<<< সহ) সম্পূর্ণ ও স্পষ্ট থাকতে হবে\n• ভালো আলোতে, সোজা করে, ছায়া/চমক ছাড়া ছবি তুলুন\n• ছবিটি ঝাপসা হলে আবার চেষ্টা করুন");
      } else {
        toast.success(`তথ্য পাওয়া গেছে: ${fields.passenger_name ?? ""}`);
        onResult(fields);
      }
    } catch (e) {
      showError("OCR সমস্যা: " + (e as Error).message);
    } finally {
      setBusy(false);
      setProgress(0);
      if (cameraRef.current) cameraRef.current.value = "";
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
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
        {busy ? (progress ? `পড়ছি... ${progress}%` : "পড়ছি...") : "পাসপোর্ট স্ক্যান"}
      </Button>
      <Button type="button" size={compact ? "sm" : "default"} variant="outline" onClick={() => fileRef.current?.click()} disabled={busy} className="gap-1.5">
        <Upload className="h-4 w-4" /> ছবি আপলোড
      </Button>
    </div>
    <AlertDialog open={errorOpen} onOpenChange={setErrorOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>⚠️ পাসপোর্ট স্ক্যান ব্যর্থ</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{errorMsg}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>বুঝলাম</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
