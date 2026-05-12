// Lightweight voice/sound helper using browser SpeechSynthesis API.
// No external service or API key required — works fully offline.

type Settings = {
  enabled: boolean;
  rate: number;     // 0.5 - 2
  pitch: number;    // 0 - 2
  volume: number;   // 0 - 1
  voiceURI: string; // selected voice URI ("" = auto)
  lang: string;     // preferred language prefix ("en", "bn", "hi")
};

const STORAGE_KEY = "voice_settings_v2";
const LEGACY_KEY = "voice_enabled_v1";

const DEFAULTS: Settings = {
  enabled: true,
  rate: 1,
  pitch: 1,
  volume: 1,
  voiceURI: "",
  lang: "en",
};

let settings: Settings = { ...DEFAULTS };
let unlocked = false;

function load() {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      settings = { ...DEFAULTS, ...JSON.parse(raw) };
    } else {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy === "0") settings.enabled = false;
    }
  } catch { /* ignore */ }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

if (typeof window !== "undefined") {
  load();
  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
    // Unlock audio context on first user gesture (required by some browsers)
    const unlock = () => {
      if (unlocked) return;
      try {
        const u = new SpeechSynthesisUtterance("");
        u.volume = 0;
        window.speechSynthesis.speak(u);
        unlocked = true;
      } catch { /* ignore */ }
    };
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
  }
}

export function getVoiceSettings(): Settings { return { ...settings }; }
export function isVoiceEnabled(): boolean { return settings.enabled; }

export function setVoiceEnabled(v: boolean) {
  settings.enabled = v;
  save();
  if (!v && typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function updateVoiceSettings(patch: Partial<Settings>) {
  settings = { ...settings, ...patch };
  save();
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = listVoices();
  if (settings.voiceURI) {
    const v = voices.find((x) => x.voiceURI === settings.voiceURI);
    if (v) return v;
  }
  const preferred = [
    "Google US English",
    "Microsoft Aria Online (Natural) - English (United States)",
    "Microsoft Jenny Online (Natural) - English (United States)",
    "Samantha",
    "Karen",
  ];
  for (const name of preferred) {
    const v = voices.find((x) => x.name === name);
    if (v && v.lang?.toLowerCase().startsWith(settings.lang)) return v;
  }
  return voices.find((v) => v.lang?.toLowerCase().startsWith(settings.lang)) ?? voices[0];
}

export function speak(text: string, opts?: { interrupt?: boolean; force?: boolean }) {
  if (!opts?.force && !settings.enabled) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    if (opts?.interrupt) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? (settings.lang === "bn" ? "bn-BD" : "en-US");
    u.rate = settings.rate;
    u.pitch = settings.pitch;
    u.volume = settings.volume;
    synth.speak(u);
  } catch { /* ignore */ }
}

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
