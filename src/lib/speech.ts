export type AgentState = "idle" | "listening" | "thinking" | "speaking";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export function mergeSpeechFragments(fragments: string[]): string {
  let words: string[] = [];
  for (const fragment of fragments) {
    const nextWords = fragment
      .trim()
      .replace(/\s+/g, " ")
      .split(" ")
      .filter(Boolean);
    if (!nextWords.length) continue;
    if (!words.length) {
      words = nextWords;
      continue;
    }

    const currentText = words.join(" ");
    const nextText = nextWords.join(" ");
    const currentLower = currentText.toLowerCase();
    const nextLower = nextText.toLowerCase();
    if (
      nextLower === currentLower ||
      currentLower.startsWith(`${nextLower} `)
    ) {
      continue;
    }
    if (nextLower.startsWith(`${currentLower} `)) {
      words = nextWords;
      continue;
    }

    let overlap = Math.min(words.length, nextWords.length);
    while (overlap > 0) {
      const currentSuffix = words.slice(-overlap).join(" ").toLowerCase();
      const nextPrefix = nextWords.slice(0, overlap).join(" ").toLowerCase();
      if (currentSuffix === nextPrefix) break;
      overlap -= 1;
    }
    words = [...words, ...nextWords.slice(overlap)];
  }
  return words.join(" ");
}

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

export function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function pickIndianVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const scored = voices.map((voice) => {
    const name = voice.name.toLowerCase();
    const lang = voice.lang.toLowerCase();
    let score = 0;
    if (lang.startsWith("en-in")) score += 50;
    if (lang.startsWith("hi")) score += 30;
    if (
      name.includes("heera") ||
      name.includes("raveena") ||
      name.includes("neerja")
    )
      score += 20;
    if (name.includes("india")) score += 15;
    if (
      name.includes("female") ||
      name.includes("zira") ||
      name.includes("samantha")
    )
      score += 4;
    return { voice, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].voice : (voices[0] ?? null);
}

export function speakText(
  text: string,
  voice: SpeechSynthesisVoice | null,
  onEnd: () => void,
) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.04;
  utterance.pitch = 1.02;
  utterance.lang = voice?.lang || "en-IN";
  if (voice) utterance.voice = voice;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
  return utterance;
}

export function stopSpeaking() {
  if (typeof window !== "undefined") {
    window.speechSynthesis.cancel();
  }
}
