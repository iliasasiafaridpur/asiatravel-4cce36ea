// Lightweight voice/sound helper using browser SpeechSynthesis API.
// No external service or API key required — works fully offline.

let enabled = true;
const STORAGE_KEY = "voice_enabled_v1";

if (typeof window !== "undefined") {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "0") enabled = false;
  } catch { /* ignore */ }
  // Warm up voices list (some browsers load lazily)
  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }
}

export function isVoiceEnabled(): boolean {
  return enabled;
}

export function setVoiceEnabled(v: boolean) {
  enabled = v;
  try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
  if (!v && typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function pickEnglishVoice(): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  // Prefer a clear English voice
  const preferred = [
    "Google US English",
    "Microsoft Aria Online (Natural) - English (United States)",
    "Microsoft Jenny Online (Natural) - English (United States)",
    "Samantha",
    "Karen",
  ];
  for (const name of preferred) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  return voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ?? voices[0];
}

export function speak(text: string, opts?: { interrupt?: boolean }) {
  if (!enabled) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    if (opts?.interrupt) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickEnglishVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-US";
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    synth.speak(u);
  } catch { /* ignore */ }
}

// Module key -> spoken label
const MODULE_SPEECH: Record<string, string> = {
  tickets: "New air ticket entry done",
  bmet: "New B M E T entry done",
  "saudi-visa": "New Saudi visa entry done",
  "kuwait-visa": "New Kuwait visa entry done",
  agents: "New agent added",
  vendors: "New vendor added",
};

export function speakModuleEntry(moduleKey: string) {
  speak(MODULE_SPEECH[moduleKey] ?? "New entry done");
}

export function speakReceived(amount: number) {
  if (amount > 0) speak(`Received amount ${Math.round(amount)} taka`);
}

export function speakDelivery(name?: string) {
  const who = name && name.trim() ? name.trim() : "";
  speak(who ? `${who}, delivery done` : "Delivery done");
}

export function speakWelcome(name?: string) {
  const who = name && name.trim() ? `, ${name.trim()}` : "";
  speak(`Welcome${who} to Asia Tours and Travels management system`, { interrupt: true });
}
