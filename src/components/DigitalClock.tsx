import { useEffect, useState } from "react";

function formatTime(d: Date): string {
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  h = h ? h : 12;
  const hh = String(h).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} ${ampm}`;
}

function formatDateFull(d: Date): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const day = String(d.getDate()).padStart(2, "0");
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month}, ${year}`;
}

export function DigitalClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center select-none">
      <div className="rounded-xl border border-cyan-500/30 bg-[oklch(0.16_0.025_250)] px-5 py-2.5 shadow-[0_0_20px_oklch(0.65_0.16_195/0.15)]">
        <div
          className="text-center font-black tracking-widest text-cyan-400"
          style={{
            fontFamily: "'Orbitron', 'Courier New', monospace",
            fontSize: "1.75rem",
            lineHeight: 1.2,
            textShadow: "0 0 12px oklch(0.65 0.16 195 / 0.6), 0 0 24px oklch(0.65 0.16 195 / 0.3)",
          }}
        >
          {formatTime(now)}
        </div>
        <div
          className="text-center font-semibold tracking-wider text-cyan-300/80 mt-1"
          style={{
            fontFamily: "'Orbitron', 'Courier New', monospace",
            fontSize: "0.85rem",
            lineHeight: 1.3,
          }}
        >
          {formatDateFull(now)}
        </div>
      </div>
    </div>
  );
}
