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

// OCR.space free public endpoint + key. Runs entirely client-side.
const OCR_SPACE_URL = "https://api.ocr.space/parse/image";
const OCR_SPACE_KEY = "helloworld";

// Send a canvas to OCR.space and return the extracted plain text.
async function ocrSpaceRecognize(canvas: HTMLCanvasElement): Promise<string> {
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error("ছবি প্রসেস করা যায়নি"))),
      "image/jpeg",
      0.85,
    ),
  );

  const form = new FormData();
  form.append("apikey", OCR_SPACE_KEY);
  form.append("language", "eng");
  form.append("isOverlayRequired", "false");
  form.append("OCREngine", "2");
  form.append("scale", "true");
  form.append("file", blob, "passport.jpg");

  const resp = await fetch(OCR_SPACE_URL, { method: "POST", body: form });
  if (!resp.ok) throw new Error(`OCR সার্ভার সাড়া দেয়নি (${resp.status})`);
  const json = await resp.json();
  if (json.IsErroredOnProcessing) {
    const msg = Array.isArray(json.ErrorMessage)
      ? json.ErrorMessage.join(" ")
      : json.ErrorMessage || "OCR ব্যর্থ";
    throw new Error(String(msg));
  }
  return (json.ParsedResults ?? [])
    .map((r: { ParsedText?: string }) => r.ParsedText ?? "")
    .join("\n");
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
  let nameZone = l1
    .slice(5) // strip "P<" + 3-char issuing country
    .replace(/[^A-Z<]/g, "<"); // normalise OCR noise to filler

  // The trailing "<" filler run is frequently misread by OCR as a long run of
  // repeated letters (e.g. "<<<<<<<<" → "Clllllllllck"). A run of 3+ identical
  // letters can never be a real name, so everything from that run to the end is
  // filler. We also absorb the 1-2 stray chars right before the run (the lone
  // "C"/"I"/"|" that "<" often becomes) so the real name ends cleanly.
  nameZone = nameZone.replace(/[CIJ1]{0,2}([A-Z])\1{2,}[A-Z<]*$/, "<<");

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

// Fallback: extract name + passport number from the full visible (non-MRZ)
// passport text. Used when the MRZ lines could not be parsed. Filters out
// random noise and keeps only plausible name words / passport tokens.
function parseVisualText(text: string): PassportFields | null {
  const rawLines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // --- Passport number ---
  // Typical formats: 2 letters + 7 digits (e.g. BW0123456) or
  // 1 letter + 8 digits / 9-char alphanumerics. Pick the best candidate.
  let passport = "";
  const flat = rawLines.join(" ").toUpperCase().replace(/[^A-Z0-9 ]/g, " ");
  const candidates = flat.match(/\b[A-Z]{1,2}\d{6,8}\b|\b\d{8,9}\b/g) || [];
  // Prefer tokens that look like a real passport number (letters + digits).
  passport =
    candidates.find((c) => /[A-Z]/.test(c) && /\d/.test(c)) ||
    candidates[0] ||
    "";

  // --- Full name ---
  // Look for an explicit "Name" label first; otherwise take the longest line
  // made only of uppercase letters/spaces that is not a known header word.
  const NOISE = /(PASSPORT|REPUBLIC|TYPE|CODE|COUNTRY|NATIONALITY|DATE|BIRTH|SEX|PLACE|AUTHORITY|EXPIRY|ISSUE|GIVEN|SURNAME|NAME)/;
  let passenger_name = "";
  const labelIdx = rawLines.findIndex((l) => /name/i.test(l));
  if (labelIdx !== -1) {
    // Name value is often on the same line after a colon, or the next line.
    const sameLine = rawLines[labelIdx].split(/[:\-]/).slice(1).join(" ").trim();
    const next = rawLines[labelIdx + 1] || "";
    const pick = /[A-Za-z]{2,}/.test(sameLine) ? sameLine : next;
    passenger_name = pick;
  }
  if (!passenger_name) {
    const nameLines = rawLines
      .filter((l) => /^[A-Z][A-Z .'-]{4,}$/.test(l) && !NOISE.test(l) && !/\d/.test(l));
    nameLines.sort((a, b) => b.length - a.length);
    passenger_name = nameLines[0] || "";
  }

  // Clean noise/garbage characters and title-case the name.
  passenger_name = passenger_name
    .replace(/[^A-Za-z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  if (!passenger_name && !passport) return null;
  return { passenger_name, passport, mrz_raw: text.trim() };
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

      setProgress(40);
      // Try the cropped MRZ band first, then the full page if needed.
      let fields: PassportFields | null = null;

      const mrzText = await ocrSpaceRecognize(mrzCanvas);
      fields = parseMrz(mrzText);

      if (!fields || (!fields.passenger_name && !fields.passport)) {
        setProgress(75);
        const fullText = await ocrSpaceRecognize(full);
        // Try MRZ parsing on the full page first, then the visual-zone parser.
        fields = parseMrz(fullText) ?? parseVisualText(fullText);
      }
      setProgress(100);

      if (!fields || (!fields.passenger_name && !fields.passport)) {
        showError("পাসপোর্টের তথ্য পড়া যায়নি।\n\n• নিচের ২ লাইন (<<< সহ) সম্পূর্ণ ও স্পষ্ট থাকতে হবে\n• ভালো আলোতে, সোজা করে, ছায়া/চমক ছাড়া ছবি তুলুন\n• ছবিটি ঝাপসা হলে আবার চেষ্টা করুন");
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
