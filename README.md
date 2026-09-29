# Aria — Aura Skincare AI Voice Customer Support Agent

Browser-based voice CX agent for the Datastraw internship assignment. Evaluators click **Start Call**, speak with Aria through the microphone, and hear replies. After **End Call**, the page shows a transcript and a structured JSON outcome.

Live app: https://aria-aura-voice.vercel.app/

- GitHub repository: https://github.com/HarshYadav2004/aria-aura-voice
- GitHub profile: https://github.com/HarshYadav2004

## Approach (2–3 sentences)

Aria is a modular in-browser voice pipeline: Chrome/Edge **Speech Recognition** for speech-to-text, **Gemini** (Google AI Studio) for reasoning and `get_order_details` function calling, and the browser **Speech Synthesis** API with an Indian-English voice when available. Order data never comes from the model’s imagination — the server looks up a mock database and feeds the tool result back to Gemini, which is also instructed to follow Aura Skincare policies instead of agreeing to every request.

## Architecture

<img src="/architecture.svg" alt="Aria architecture diagram" width="100%" />

- **Why this stack:** Next.js is easy to deploy on Vercel; a single **Google AI Studio** key covers the LLM (as requested). Browser STT/TTS keep extra vendor cost and latency down, which matters for a voice demo.
- **Tool use:** Gemini only calls `get_order_details` when the customer is asking about a real order. General policy questions (shipping time, COD limit) are answered from the system prompt with no tool call.
- **Guardrails:** Policies live in `src/lib/systemPrompt.ts`. The model is told not to invent orders, not to promise refunds/cancellations outside policy, and to refuse out-of-scope requests.

## Known limitation

Browser speech recognition can pick up synthesized audio if it is active while Aria speaks. To prevent self-triggered turns, the app pauses recognition during TTS and resumes it when the response finishes. Barge-in is therefore not supported; wait for Aria to finish before speaking. Supporting interruption safely would require an audio pipeline with acoustic echo cancellation or a speech service that can distinguish microphone input from agent playback.

## Setup

1. Copy env and add your [Google AI Studio](https://aistudio.google.com/apikey) key:

```bash
cp .env.example .env.local
```

```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

2. Install and run:

```bash
npm install
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in **Chrome or Edge**, allow the microphone, click **Start Call**.

Firefox does not support the Web Speech recognition API used here.

## Test orders (also shown in the UI)

| Order ID | Customer     | Product                     | Status                | Notes                                |
| -------- | ------------ | --------------------------- | --------------------- | ------------------------------------ |
| ORD-101  | Priya Sharma | Vitamin C Serum (30ml)      | Out for Delivery      | BlueDart BD-982103, expected by 6 PM |
| ORD-102  | Rahul Verma  | Hydrating Sunscreen SPF 50  | Delivered 14 days ago | Return window expired                |
| ORD-103  | Ananya Patel | Green Tea Face Wash + Toner | Processing            | Eligible for cancellation            |

Suggested probes: track ORD-101, cancel ORD-103, return opened ORD-102 after 14 days, ask for standard delivery time, ask to book a flight to Goa.

## Deploy (Vercel)

1. Push this repo to GitHub.
2. Import the project on Vercel.
3. Set `GEMINI_API_KEY` in the Vercel project environment variables.
4. Deploy. Microphone access requires HTTPS (Vercel provides this).

## How I think (assignment section 9)

### 1. Why this architecture and stack?

A modular STT → LLM+tools → TTS pipeline is easier to debug and to explain than a fully opaque speech-to-speech model. Gemini from AI Studio matches the required API key, has reliable function calling, and is strong at following a policy-heavy system prompt. Next.js keeps the key on the server and deploys in one step.

### 2. What was the most difficult part, and how did you solve it?

Keeping the voice loop stable: Chrome’s SpeechRecognition often stops after a pause, TTS can be picked up as user speech, and tool calls add a thinking gap. The app restarts recognition after each turn, pauses listening while the model is thinking, and only allows barge-in after the agent has started speaking.

### 3. If you had one more week, what would you improve first?

Replace browser TTS with Gemini (or another) streaming TTS and add streaming LLM tokens so Aria starts speaking sooner. That is the largest jump in “natural call” feel after the demo is already policy-correct.

### 4. If this handled 1,000 conversations a day, what would need to change?

Move from in-memory mock orders to a real order API with auth; add call recording consent, PII redaction in transcripts, evals for policy regressions, rate limits and queues on Gemini, human handoff, and observability (latency, tool-error rate, containment rate). Browser STT would likely be replaced with a server STT so quality does not depend on the customer’s browser.

## Project layout

- `src/lib/orders.ts` — mock order database and `get_order_details`
- `src/lib/systemPrompt.ts` — Aria persona and Aura policies
- `src/lib/gemini.ts` — Gemini turn loop + summary
- `src/app/api/chat/route.ts` — conversation endpoint
- `src/app/api/summary/route.ts` — post-call JSON
- `src/components/VoiceDesk.tsx` — Start/End call UI, live state, transcript

## LinkedIn

https://linkedin.com/in/harsh-yadav-056656369
