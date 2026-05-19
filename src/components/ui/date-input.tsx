import * as React from "react";
import { Calendar } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function toDMY(iso: string | undefined | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function parseDMY(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3];
  const d = Number(dd), mo = Number(mm), y = Number(yyyy);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "value"> {
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, className, placeholder, ...rest }, ref) => {
    const [text, setText] = React.useState<string>(toDMY(value));
    const pickerRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
      setText(toDMY(value));
    }, [value]);

    const emit = (iso: string) => {
      onChange?.({ target: { value: iso } });
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = e.target.value;
      setText(t);
      if (t === "") { emit(""); return; }
      const iso = parseDMY(t);
      if (iso) emit(iso);
    };

    const handleBlur = () => {
      if (text === "") return;
      const iso = parseDMY(text);
      if (iso) setText(toDMY(iso));
      else setText(toDMY(value));
    };

    const openPicker = () => {
      const el = pickerRef.current;
      if (!el) return;
      // @ts-ignore showPicker may not be typed
      if (typeof el.showPicker === "function") el.showPicker();
      else el.click();
    };

    return (
      <div className="relative w-full">
        <Input
          ref={ref}
          type="text"
          inputMode="numeric"
          value={text}
          onChange={handleTextChange}
          onBlur={handleBlur}
          onClick={openPicker}
          onFocus={openPicker}
          readOnly
          placeholder={placeholder ?? "DD/MM/YYYY"}
          className={cn("pr-10 cursor-pointer", className)}
          {...rest}
        />
        <button
          type="button"
          onClick={openPicker}
          tabIndex={-1}
          aria-label="Pick date"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-primary hover:text-primary/80"
        >
          <Calendar className="h-4 w-4" />
        </button>
        <input
          ref={pickerRef}
          type="date"
          value={value ?? ""}
          onChange={(e) => {
            setText(toDMY(e.target.value));
            emit(e.target.value);
          }}
          tabIndex={-1}
          aria-hidden
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 0,
            height: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
      </div>
    );
  },
);
DateInput.displayName = "DateInput";
