import * as React from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function toDMY(iso: string | undefined | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function isoToDate(iso: string | undefined | null): Date | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export interface DateInputProps {
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  className?: string;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
  "aria-label"?: string;
}

export const DateInput = React.forwardRef<HTMLButtonElement, DateInputProps>(
  ({ value, onChange, className, placeholder, id, disabled, min, max, ...rest }, ref) => {
    const [open, setOpen] = React.useState(false);
    const selected = isoToDate(value);
    const display = toDMY(value);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-9 w-full justify-between font-normal px-3 cursor-pointer",
              !display && "text-muted-foreground",
              className,
            )}
            {...rest}
          >

            <span>{display || placeholder || "DD-MM-YYYY"}</span>
            <CalendarIcon className="h-4 w-4 text-primary opacity-80" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={(d) => {
              onChange?.({ target: { value: d ? dateToIso(d) : "" } });
              if (d) setOpen(false);
            }}
            disabled={(d) => {
              const minD = isoToDate(min);
              const maxD = isoToDate(max);
              if (minD && d < minD) return true;
              if (maxD && d > maxD) return true;
              return false;
            }}
            captionLayout="dropdown"
            initialFocus
            className="p-3 pointer-events-auto"
          />
          {value ? (
            <div className="flex justify-end border-t p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange?.({ target: { value: "" } });
                  setOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    );
  },
);
DateInput.displayName = "DateInput";
