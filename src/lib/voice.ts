// Voice/sound system has been removed by user request.
// All functions are no-ops kept for compatibility with imports.

export function isVoiceEnabled() { return false; }
export function setVoiceEnabled(_v: boolean) {}
export function getVoiceSettings() {
  return { enabled: false, rate: 1, pitch: 1, volume: 1, voiceURI: "", lang: "en" };
}
export function updateVoiceSettings(_p: unknown) {}
export function listVoices(): unknown[] { return []; }
export function speak(_t: string, _o?: unknown) {}
export function speakWelcome(_n?: string) {}
export function speakModuleEntry(_k: string) {}
export function speakReceived(_a: number) {}
export function speakDelivery(_n?: string) {}
