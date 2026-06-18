/**
 * Speech provider abstraction for Arcarna Voice.
 *
 * Today: Browser Web Speech API (SpeechRecognition for STT, speechSynthesis
 * for TTS) — free, works client-side, no extra infra. The interface is kept
 * provider-agnostic so a premium fallback (OpenAI Whisper/TTS) or a
 * self-hosted Whisper instance can be added later without touching callers.
 */

export interface SpeechProvider {
  readonly name: string;
  isSupported(): boolean;
  /** Listens for one utterance and resolves with the transcript. */
  listen(): Promise<string>;
  /** Speaks text aloud; resolves once playback finishes. */
  speak(text: string): Promise<void>;
  /** Cancels any in-progress listen/speak. */
  stop(): void;
}

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

class WebSpeechProvider implements SpeechProvider {
  readonly name = "web-speech";
  private recognition: SpeechRecognitionLike | null = null;

  isSupported(): boolean {
    return typeof window !== "undefined" && !!getRecognitionCtor() && !!window.speechSynthesis;
  }

  listen(): Promise<string> {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return Promise.reject(new Error("Speech recognition is not supported in this browser."));

    return new Promise((resolve, reject) => {
      const recognition = new Ctor();
      recognition.lang = "en-GB";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      this.recognition = recognition;

      recognition.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript ?? "";
        resolve(transcript);
      };
      recognition.onerror = (event: any) => {
        reject(new Error(event?.error ? `Speech recognition error: ${event.error}` : "Speech recognition failed"));
      };
      recognition.onend = () => {
        this.recognition = null;
      };
      recognition.start();
    });
  }

  speak(text: string): Promise<void> {
    if (!window.speechSynthesis) return Promise.reject(new Error("Speech synthesis is not supported in this browser."));
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-GB";
      utterance.onend = () => resolve();
      utterance.onerror = () => reject(new Error("Speech synthesis failed"));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    this.recognition?.stop();
    this.recognition = null;
    window.speechSynthesis?.cancel();
  }
}

let provider: SpeechProvider | null = null;

/** Returns the active speech provider (currently always Web Speech API). */
export function getSpeechProvider(): SpeechProvider {
  if (!provider) provider = new WebSpeechProvider();
  return provider;
}
