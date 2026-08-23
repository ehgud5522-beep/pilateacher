import { Capacitor } from "@capacitor/core";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";

export class SttProvider {
  constructor(kind) { this.kind = kind; }
  isAvailable() { return false; }
  get capability() { return { available: this.isAvailable(), kind: this.kind }; }
  get native() { return null; }
  get web() { return null; }
}

class DeviceSttProvider extends SttProvider {
  constructor({ native = null, web = null } = {}) {
    super(native ? "native" : web ? "web_speech" : "unavailable");
    this.nativeProvider = native;
    this.webProvider = web;
  }
  isAvailable() { return !!(this.nativeProvider || this.webProvider); }
  get native() { return this.nativeProvider; }
  get web() { return this.webProvider; }
}

export function createSttProvider({ native = undefined, web = undefined } = {}) {
  let nativeProvider = native;
  let webProvider = web;
  if (nativeProvider === undefined) {
    try { nativeProvider = Capacitor.isNativePlatform() ? SpeechRecognition : globalThis.window?.Capacitor?.Plugins?.SpeechRecognition || null; }
    catch (_error) { nativeProvider = null; }
  }
  if (webProvider === undefined) {
    try { webProvider = globalThis.window?.SpeechRecognition || globalThis.window?.webkitSpeechRecognition || null; }
    catch (_error) { webProvider = null; }
  }
  return new DeviceSttProvider({ native: nativeProvider, web: webProvider });
}

export const MAX_STT_SECONDS = 90;
