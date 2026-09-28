"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getOrderDetails, normalizeOrderId, SAMPLE_ORDERS } from "@/lib/orders";
import type { ChatTurn } from "@/lib/gemini";
import {
  getSpeechRecognition,
  mergeSpeechFragments,
  pickIndianVoice,
  speakText,
  stopSpeaking,
  type AgentState,
  type SpeechRecognitionLike,
} from "@/lib/speech";

const GREETING =
  "Hi, this is Aria from Aura Skincare. How can I help you today?";
const TURN_END_DELAY_MS = 1800;

function StateDot({ state, label }: { state: AgentState; label?: string }) {
  const map: Record<AgentState, { label: string; className: string }> = {
    idle: { label: "Ready to listen", className: "status-dot-idle" },
    listening: { label: "Listening...", className: "status-dot-live" },
    thinking: { label: "AI is thinking...", className: "status-dot-thinking" },
    speaking: {
      label: "AI is responding...",
      className: "status-dot-speaking",
    },
  };
  const item = map[state];
  return (
    <div className="status-pill">
      <span className={`status-dot ${item.className}`} />
      {label ?? item.label}
    </div>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function VoiceMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v18M8 7v10M4 10v4m12-7v10m4-7v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MicMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <rect
        x="9"
        y="3"
        width="6"
        height="12"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.5 11a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="m21 3-7.2 18-3.9-7.9L2 9.2 21 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M10 13 21 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <rect
        x="8"
        y="8"
        width="12"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function VoiceDesk() {
  const [state, setState] = useState<AgentState>("idle");
  const [inCall, setInCall] = useState(false);
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [liveCaption, setLiveCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<unknown | null>(null);
  const [summarising, setSummarising] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [turnTimestamps, setTurnTimestamps] = useState<number[]>([]);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(
    SAMPLE_ORDERS[0].order_id,
  );

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptPaneRef = useRef<HTMLDivElement | null>(null);
  const inCallRef = useRef(false);
  const micEnabledRef = useRef(false);
  const callStartedAtRef = useRef<number | null>(null);
  const stateRef = useRef<AgentState>("idle");
  const transcriptRef = useRef<ChatTurn[]>([]);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const shouldListenRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const pendingSpeechRef = useRef("");
  const completedSpeechRef = useRef("");
  const recognitionFinalsRef = useRef(new Map<number, string>());
  const turnEndTimerRef = useRef<number | null>(null);

  useEffect(() => {
    inCallRef.current = inCall;
  }, [inCall]);
  useEffect(() => {
    micEnabledRef.current = micEnabled;
  }, [micEnabled]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    const pane = transcriptPaneRef.current;
    if (pane && pane.scrollHeight > pane.clientHeight) {
      pane.scrollTo({ top: pane.scrollHeight, behavior: "smooth" });
    }
  }, [transcript, liveCaption]);

  useEffect(() => {
    const loadVoices = () => {
      voiceRef.current = pickIndianVoice();
    };
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  useEffect(() => {
    if (!inCall) return;
    const timer = window.setInterval(() => {
      if (callStartedAtRef.current !== null) {
        setElapsedSeconds(
          Math.floor((Date.now() - callStartedAtRef.current) / 1000),
        );
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [inCall]);

  const speakReply = useCallback((text: string) => {
    const speechGeneration = ++speechGenerationRef.current;
    stateRef.current = "speaking";
    setState("speaking");
    speakText(text, voiceRef.current, () => {
      if (speechGeneration !== speechGenerationRef.current) return;
      if (!inCallRef.current || !micEnabledRef.current) return;
      stateRef.current = "listening";
      setState("listening");
      shouldListenRef.current = true;
      try {
        recognitionRef.current?.start();
      } catch {
        /* already started */
      }
    });
  }, []);

  const sendToAgent = useCallback(
    async (userText: string) => {
      const orderMention = userText.match(
        /\b(?:ORD|ORDER(?:\s*ID)?|ID)\s*(?:IS\s*)?-?\s*\d+\b/i,
      )?.[0];
      if (orderMention) {
        const order = getOrderDetails(normalizeOrderId(orderMention));
        if (!("error" in order)) setSelectedOrderId(order.order_id);
      }
      const next: ChatTurn[] = [
        ...transcriptRef.current,
        { role: "user", content: userText },
      ];
      setTranscript(next);
      setTurnTimestamps((previous) => [
        ...previous,
        callStartedAtRef.current === null
          ? 0
          : Math.floor((Date.now() - callStartedAtRef.current) / 1000),
      ]);
      transcriptRef.current = next;
      stateRef.current = "thinking";
      setState("thinking");
      shouldListenRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Chat failed");
        }
        const reply = data.reply as string;
        const withReply: ChatTurn[] = [
          ...transcriptRef.current,
          { role: "assistant", content: reply },
        ];
        setTranscript(withReply);
        setTurnTimestamps((previous) => [
          ...previous,
          callStartedAtRef.current === null
            ? 0
            : Math.floor((Date.now() - callStartedAtRef.current) / 1000),
        ]);
        transcriptRef.current = withReply;
        if (!inCallRef.current) return;
        speakReply(reply);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong.";
        shouldListenRef.current = false;
        micEnabledRef.current = false;
        setMicEnabled(false);
        stateRef.current = "idle";
        setState("idle");
        setLiveCaption("");
        try {
          recognitionRef.current?.abort();
        } catch {
          /* ignore */
        }
        setError(
          `${message} Voice input is paused. Tap the microphone button to retry.`,
        );
      }
    },
    [speakReply],
  );

  const attachRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setError(
        "Voice input needs Chrome or Edge. Please open this app in Chrome.",
      );
      return null;
    }
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event) => {
      let interim = "";
      for (const index of recognitionFinalsRef.current.keys()) {
        if (index >= event.resultIndex)
          recognitionFinalsRef.current.delete(index);
      }
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal)
          recognitionFinalsRef.current.set(i, piece);
        else interim += piece;
      }
      const currentFinals = [...recognitionFinalsRef.current.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, piece]) => piece);
      pendingSpeechRef.current = mergeSpeechFragments([
        completedSpeechRef.current,
        ...currentFinals,
      ]);

      if (interim.trim() && turnEndTimerRef.current !== null) {
        window.clearTimeout(turnEndTimerRef.current);
        turnEndTimerRef.current = null;
      }

      if (pendingSpeechRef.current && stateRef.current !== "thinking") {
        if (!interim.trim()) {
          if (turnEndTimerRef.current !== null) {
            window.clearTimeout(turnEndTimerRef.current);
          }
          turnEndTimerRef.current = window.setTimeout(() => {
            turnEndTimerRef.current = null;
            const spoken = pendingSpeechRef.current.trim();
            pendingSpeechRef.current = "";
            completedSpeechRef.current = "";
            recognitionFinalsRef.current.clear();
            if (!spoken || stateRef.current === "thinking") return;
            setLiveCaption("");
            setState("listening");
            void sendToAgent(spoken);
          }, TURN_END_DELAY_MS);
        }
      }

      setLiveCaption(mergeSpeechFragments([pendingSpeechRef.current, interim]));
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      if (event.error === "not-allowed") {
        setError(
          "Microphone permission was blocked. Allow the mic and start the call again.",
        );
      }
    };

    recognition.onend = () => {
      if (recognitionFinalsRef.current.size > 0) {
        if (stateRef.current !== "thinking" && shouldListenRef.current) {
          completedSpeechRef.current = pendingSpeechRef.current;
        }
        recognitionFinalsRef.current.clear();
      }
      if (
        inCallRef.current &&
        shouldListenRef.current &&
        stateRef.current !== "thinking"
      ) {
        try {
          recognition.start();
        } catch {
          /* ignore */
        }
      }
    };

    recognitionRef.current = recognition;
    return recognition;
  }, [sendToAgent]);

  const startCall = async () => {
    if (turnEndTimerRef.current !== null) {
      window.clearTimeout(turnEndTimerRef.current);
      turnEndTimerRef.current = null;
    }
    pendingSpeechRef.current = "";
    completedSpeechRef.current = "";
    recognitionFinalsRef.current.clear();
    setError(null);
    setSummary(null);
    setTranscript([]);
    transcriptRef.current = [];
    setTurnTimestamps([]);
    setLiveCaption("");

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Please allow microphone access to start the call.");
      return;
    }

    const recognition = attachRecognition();
    if (!recognition) return;

    setInCall(true);
    inCallRef.current = true;
    setMicEnabled(true);
    micEnabledRef.current = true;
    callStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    shouldListenRef.current = false;
    const greetingTurn: ChatTurn[] = [{ role: "assistant", content: GREETING }];
    setTranscript(greetingTurn);
    setTurnTimestamps([0]);
    transcriptRef.current = greetingTurn;
    speakReply(GREETING);
  };

  const endCall = async () => {
    if (turnEndTimerRef.current !== null) {
      window.clearTimeout(turnEndTimerRef.current);
      turnEndTimerRef.current = null;
    }
    pendingSpeechRef.current = "";
    completedSpeechRef.current = "";
    recognitionFinalsRef.current.clear();
    shouldListenRef.current = false;
    inCallRef.current = false;
    setInCall(false);
    setMicEnabled(false);
    micEnabledRef.current = false;
    if (callStartedAtRef.current !== null) {
      setElapsedSeconds(
        Math.floor((Date.now() - callStartedAtRef.current) / 1000),
      );
    }
    callStartedAtRef.current = null;
    speechGenerationRef.current += 1;
    stateRef.current = "idle";
    setState("idle");
    setLiveCaption("");
    stopSpeaking();
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;

    setSummarising(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: transcriptRef.current }),
      });
      const data = await res.json();
      setSummary(data.summary);
    } catch {
      setSummary({
        customer_intent: "OTHER",
        order_id: null,
        resolution_status: "UNRESOLVED",
        call_summary: "The call ended, but the summary could not be generated.",
      });
    } finally {
      setSummarising(false);
    }
  };

  const toggleMicrophone = () => {
    if (!inCall) {
      void startCall();
      return;
    }
    if (micEnabled) {
      setMicEnabled(false);
      micEnabledRef.current = false;
      shouldListenRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      if (stateRef.current === "listening") setState("idle");
      return;
    }
    setMicEnabled(true);
    micEnabledRef.current = true;
    if (stateRef.current === "idle") {
      setState("listening");
      shouldListenRef.current = true;
      try {
        recognitionRef.current?.start();
      } catch {
        /* already started */
      }
    }
  };

  const copySummary = async () => {
    if (summary == null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(summary, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(
        "Could not copy the summary. Check your browser clipboard permissions.",
      );
    }
  };

  const summaryData =
    summary && typeof summary === "object" && !Array.isArray(summary)
      ? (summary as Record<string, unknown>)
      : null;
  const orderDetails = getOrderDetails(selectedOrderId);
  const currentOrder =
    "error" in orderDetails ? SAMPLE_ORDERS[0] : orderDetails;
  const liveStatus = liveCaption
    ? "Customer is speaking..."
    : !micEnabled && inCall
      ? "Microphone paused"
      : state;

  return (
    <div className="voice-app">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">
            <VoiceMark />
          </span>
          <span className="brand-name">AI Voice Support</span>
        </div>
        <div className="topbar-meta">
          <span className="online-label">
            <span className={`online-dot ${error ? "online-dot-error" : ""}`} />
            {error ? "Connection issue" : "AI Agent Online"}
          </span>
          <span className="topbar-divider" />
          <span className="timer-label">{formatDuration(elapsedSeconds)}</span>
        </div>
      </header>

      <main className="dashboard-grid">
        <section
          className="panel conversation-panel"
          aria-labelledby="conversation-title"
        >
          <div className="panel-heading conversation-heading">
            <div>
              <p className="eyebrow">VOICE WORKSPACE</p>
              <h1 id="conversation-title">Live Customer Conversation</h1>
            </div>
            <div className="call-heading-actions">
              <StateDot
                state={liveCaption ? "listening" : inCall ? state : "idle"}
                label={liveCaption ? "Customer is speaking..." : undefined}
              />
              <span className="call-duration">
                {formatDuration(elapsedSeconds)}
              </span>
              {!inCall ? (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void startCall()}
                >
                  Start call
                </button>
              ) : (
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => void endCall()}
                >
                  End call
                </button>
              )}
            </div>
          </div>

          <div
            className={`voice-status ${inCall ? "voice-status-active" : ""}`}
          >
            <div
              className={`voice-orb ${inCall && micEnabled ? "voice-orb-active" : ""} voice-orb-${state}`}
            >
              <VoiceMark />
            </div>
            <div className="voice-status-copy">
              <strong>
                {inCall
                  ? liveStatus === "listening"
                    ? "Listening..."
                    : liveCaption
                      ? "Customer is speaking..."
                      : liveStatus === "thinking"
                        ? "AI is thinking..."
                        : liveStatus === "speaking"
                          ? "AI is responding..."
                          : liveStatus
                  : error
                    ? "Connection needs attention"
                    : "Ready to start call"}
              </strong>
              <span>
                {liveCaption ||
                  (inCall
                    ? "Voice session is active"
                    : error || "Your AI agent is ready for a customer")}
              </span>
            </div>
            <div
              className={`waveform ${inCall && micEnabled ? "waveform-active" : ""}`}
              aria-label={
                micEnabled && inCall
                  ? "Voice activity active"
                  : "Voice activity idle"
              }
            >
              {[10, 18, 26, 14, 22, 30, 16, 24, 12].map((height, index) => (
                <span
                  key={index}
                  style={
                    { "--bar-height": `${height}px` } as React.CSSProperties
                  }
                />
              ))}
            </div>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              {!inCall && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void startCall()}
                >
                  Try again
                </button>
              )}
            </div>
          )}

          <div className="transcript-heading">
            <h2>Conversation transcript</h2>
            <span>
              {transcript.length ? `${transcript.length} messages` : "Live"}
            </span>
          </div>
          <div
            ref={transcriptPaneRef}
            className="transcript"
            aria-live="polite"
          >
            {transcript.length === 0 && (
              <div className="transcript-empty">
                <span className="empty-mark">
                  <VoiceMark />
                </span>
                <strong>Your conversation will appear here</strong>
                <span>Start a call to begin a live transcript.</span>
              </div>
            )}
            {transcript.map((turn, index) => (
              <article
                key={`${turn.role}-${index}`}
                className={`message-row ${turn.role === "user" ? "message-row-customer" : ""}`}
              >
                <div
                  className={`message-avatar ${turn.role === "user" ? "message-avatar-customer" : ""}`}
                  aria-hidden="true"
                >
                  {turn.role === "assistant" ? "A" : "C"}
                </div>
                <div className="message-content">
                  <div className="message-meta">
                    <strong>
                      {turn.role === "assistant" ? "AI Agent" : "Customer"}
                    </strong>
                    <time>{formatDuration(turnTimestamps[index] ?? 0)}</time>
                  </div>
                  <p
                    className={`message-bubble ${turn.role === "user" ? "message-bubble-customer" : ""}`}
                  >
                    {turn.content}
                  </p>
                </div>
              </article>
            ))}
            {liveCaption && (
              <article className="message-row message-row-customer">
                <div
                  className="message-avatar message-avatar-customer"
                  aria-hidden="true"
                >
                  C
                </div>
                <div className="message-content">
                  <div className="message-meta">
                    <strong>Customer</strong>
                    <span className="live-caption-tag">Speaking</span>
                  </div>
                  <p className="message-bubble message-bubble-customer message-bubble-interim">
                    {liveCaption}
                  </p>
                </div>
              </article>
            )}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const input = form.elements.namedItem(
                "typed",
              ) as HTMLInputElement;
              const value = input.value.trim();
              if (!value || !inCall) return;
              input.value = "";
              void sendToAgent(value);
            }}
          >
            <button
              className={`icon-button mic-button ${micEnabled && inCall ? "mic-button-active" : ""}`}
              type="button"
              aria-label={
                micEnabled && inCall ? "Pause microphone" : "Enable microphone"
              }
              title={
                micEnabled && inCall ? "Pause microphone" : "Enable microphone"
              }
              onClick={toggleMicrophone}
            >
              <MicMark />
            </button>
            <input
              name="typed"
              placeholder="Type a message..."
              aria-label="Type a message"
              disabled={!inCall}
            />
            <button
              className="send-button"
              type="submit"
              aria-label="Send message"
              disabled={!inCall}
            >
              <SendMark />
            </button>
          </form>
          <div className="composer-footer">
            <span>
              {inCall
                ? "Press the mic to pause voice input"
                : "Start a call to enable messaging"}
            </span>
            <span
              className={`mic-state ${micEnabled && inCall ? "mic-state-active" : ""}`}
            >
              <span />
              {micEnabled && inCall ? "Microphone on" : "Microphone off"}
            </span>
          </div>
        </section>

        <aside className="side-column">
          <section className="panel order-panel" aria-labelledby="order-title">
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">CUSTOMER CONTEXT</p>
                <h2 id="order-title">Current Order</h2>
              </div>
              <span className="order-id">{currentOrder.order_id}</span>
            </div>
            <div className="order-customer-row">
              <div className="customer-avatar">
                {currentOrder.customer
                  .split(" ")
                  .map((part) => part[0])
                  .join("")}
              </div>
              <div>
                <span className="field-label">CUSTOMER</span>
                <strong>{currentOrder.customer}</strong>
              </div>
              <span className="order-status">
                <span />
                {currentOrder.status}
              </span>
            </div>
            <div className="delivery-row">
              <div>
                <span className="field-label">
                  {currentOrder.eta ? "EXPECTED DELIVERY" : "LATEST UPDATE"}
                </span>
                <strong>{currentOrder.eta ?? currentOrder.notes}</strong>
              </div>
              {currentOrder.courier && (
                <div className="delivery-carrier">
                  <span className="field-label">CARRIER</span>
                  <strong>{currentOrder.courier}</strong>
                </div>
              )}
            </div>
            <div className="order-items-heading">
              <strong>Order items</strong>
              <span>1 item</span>
            </div>
            <div className="order-item">
              <div className="product-thumb" aria-hidden="true">
                <span>AS</span>
              </div>
              <div className="product-copy">
                <strong>{currentOrder.product}</strong>
                <span>Qty: 1</span>
              </div>
              <strong className="product-price">{currentOrder.value}</strong>
            </div>
            <div className="order-total-row">
              <span>Order value</span>
              <strong>{currentOrder.value}</strong>
            </div>
            <p className="order-footnote">
              Live order context for the Aura Skincare demo.
            </p>
            <div className="all-orders-section">
              <div className="all-orders-heading">
                <strong>All orders</strong>
                <span>{SAMPLE_ORDERS.length}</span>
              </div>
              <div className="all-orders-list">
                {SAMPLE_ORDERS.map((order) => (
                  <button
                    key={order.order_id}
                    type="button"
                    className={`all-order-row ${selectedOrderId === order.order_id ? "all-order-row-selected" : ""}`}
                    aria-pressed={selectedOrderId === order.order_id}
                    onClick={() => setSelectedOrderId(order.order_id)}
                  >
                    <span className="all-order-main">
                      <strong>{order.order_id}</strong>
                      <span>
                        {order.customer} · {order.product}
                      </span>
                    </span>
                    <span className="all-order-status">{order.status}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section
            className="panel summary-panel"
            aria-labelledby="summary-title"
          >
            <div className="panel-heading compact-heading">
              <div>
                <p className="eyebrow">CALL OUTCOME</p>
                <h2 id="summary-title">Post-Call Summary</h2>
              </div>
              {summary != null && (
                <span className="completed-badge">
                  <span />
                  Completed
                </span>
              )}
            </div>
            {summarising ? (
              <div className="summary-loading">
                <span className="loading-ring" />
                Generating structured summary...
              </div>
            ) : summaryData ? (
              <div className="summary-details">
                <div className="summary-row">
                  <span>Customer issue</span>
                  <strong>
                    {String(summaryData.customer_intent ?? "Not identified")
                      .replaceAll("_", " ")
                      .toLowerCase()}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>AI resolution</span>
                  <strong>
                    {String(summaryData.call_summary ?? "Summary unavailable")}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Sentiment</span>
                  <strong className="muted-value">Not assessed</strong>
                </div>
                <div className="summary-row">
                  <span>Action items</span>
                  <strong>
                    {summaryData.resolution_status === "RESOLVED"
                      ? "No further action required"
                      : "Review recommended"}
                  </strong>
                </div>
                {summaryData.order_id != null && (
                  <div className="summary-row">
                    <span>Order ID</span>
                    <strong>{String(summaryData.order_id)}</strong>
                  </div>
                )}
                <div className="summary-row">
                  <span>Call duration</span>
                  <strong>{formatDuration(elapsedSeconds)}</strong>
                </div>
              </div>
            ) : (
              <div className="summary-empty">
                <span className="summary-empty-icon">
                  <VoiceMark />
                </span>
                <strong>Summary appears after the call</strong>
                <span>
                  Customer intent, resolution, and follow-up details will be
                  captured here.
                </span>
              </div>
            )}
            <div className="json-section">
              <button
                type="button"
                className="json-toggle"
                onClick={() => setJsonOpen((open) => !open)}
                aria-expanded={jsonOpen}
              >
                <span>View JSON Summary</span>
                <span
                  className={`chevron ${jsonOpen ? "chevron-open" : ""}`}
                  aria-hidden="true"
                >
                  ⌄
                </span>
              </button>
              {jsonOpen && (
                <div className="json-content">
                  {summary != null ? (
                    <pre>{JSON.stringify(summary, null, 2)}</pre>
                  ) : (
                    <p>JSON will be available when the call is complete.</p>
                  )}
                  <button
                    type="button"
                    className="copy-button"
                    onClick={() => void copySummary()}
                    disabled={summary == null}
                  >
                    <CopyMark />
                    {copied ? "Copied" : "Copy JSON"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </aside>
      </main>
      <footer className="app-footer">
        <span>Aria AI Support</span>
        <span>Secure voice workspace</span>
      </footer>
    </div>
  );
}
