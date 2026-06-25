// Input formatters for travel manager forms.

export function capitalizeWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(^|\s|[-'])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

export function upper(s: string): string {
  return s.toUpperCase();
}

// Mobile mask: digits only, hyphen after first 5 digits, max 11 digits => "01711-XXXXXX"
export function maskMobile(s: string): string {
  const rawDigits = s.replace(/\D/g, "");
  // পরিচিতি বোর্ডে +880/880 দিয়ে নাম্বার থাকলেও এন্ট্রি ফর্মে একই BD
  // নাম্বার 01711-XXXXXX ফরম্যাটে বসবে।
  const normalized = rawDigits.startsWith("880") && rawDigits.length === 13
    ? `0${rawDigits.slice(3)}`
    : rawDigits.startsWith("88") && rawDigits.length === 13
      ? `0${rawDigits.slice(2)}`
      : rawDigits;
  const digits = normalized.slice(0, 11);
  if (digits.length <= 5) return digits;
  return digits.slice(0, 5) + "-" + digits.slice(5);
}

export function applyFormat(format: string | undefined, value: string): string {
  switch (format) {
    case "passport":
      return upper(value);
    case "mobile":
      return maskMobile(value);
    default:
      return value;
  }
}
