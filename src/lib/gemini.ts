import { GoogleGenAI, Type } from "@google/genai";
import { getOrderDetails, normalizeOrderId } from "./orders";
import { ARIA_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from "./systemPrompt";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!apiKey || apiKey.includes("your_google_ai_studio_key")) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  return new GoogleGenAI({ apiKey });
}

function normalizeModelId(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-latest",
]
  .filter((value): value is string => Boolean(value && value.trim()))
  .map(normalizeModelId)
  .filter((id, index, all) => all.indexOf(id) === index);

const getOrderDetailsDecl = {
  name: "get_order_details",
  description:
    "Look up a live Aura Skincare order by order ID. Accept spoken or written forms such as ORD-101, ORD 101, order ID 101, or just 101 as the same ID. Use this before stating any order status, tracking, cancellation eligibility, or delivery details.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      order_id: {
        type: Type.STRING,
        description:
          "The order ID. For example, ORD-101, ORD 101, order ID 101, and 101 refer to the same order.",
      },
    },
    required: ["order_id"],
  },
};

const CLOSING_OFFER_PATTERN =
  /\b(?:anything else|anything more|other questions?|other things?|further assistance|more i can help)\b/i;
const NEEDS_CUSTOMER_INPUT_PATTERN =
  /\b(?:could you|can you|please)\s+(?:share|provide|confirm|repeat|clarify|tell me)|\bwhat(?:'s| is) your order id\b|\bwhich order\b/i;

function isCustomerDone(message: string, previousAssistant: string) {
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/[.!?,]/g, "")
    .replace(/\s+/g, " ");
  const shortAcknowledgement = /^(?:no|thanks?|thank you)$/i.test(normalized);
  if (shortAcknowledgement && !CLOSING_OFFER_PATTERN.test(previousAssistant)) {
    return false;
  }
  return /^(?:no(?: thanks?| thank you)?|thanks?|thank you|that'?s it|that is it|that'?s all|that is all|nothing else|no more (?:questions|help)|i'?m good|i am good|we'?re good|all good|that'?s everything|that is everything)$/i.test(
    normalized,
  );
}

function addClosingOffer(reply: string) {
  const text = reply.trim();
  if (
    CLOSING_OFFER_PATTERN.test(text) ||
    NEEDS_CUSTOMER_INPUT_PATTERN.test(text)
  ) {
    return text;
  }
  const separator = /[.!?]$/.test(text) ? " " : ". ";
  return `${text}${separator}Is there anything else I can help you with?`;
}

function toContents(messages: ChatTurn[]) {
  const contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> = [];
  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";
    const prev = contents[contents.length - 1];
    if (prev?.role === role) {
      prev.parts[0].text += `\n${message.content}`;
    } else {
      contents.push({ role, parts: [{ text: message.content }] });
    }
  }
  while (contents[0]?.role === "model") {
    contents.shift();
  }
  return contents;
}

function findRecentOrder(messages: ChatTurn[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const mention = message.content.match(
      /\b(?:ORD\s*-?\s*\d+|ORDER(?:\s*ID)?\s*(?:IS\s*)?-?\s*\d+|ID\s*(?:IS\s*)?-?\s*\d+)\b/i,
    )?.[0];
    const standaloneId = message.content.match(/^\s*(\d+)\s*[?.!,]?\s*$/)?.[1];
    const orderId = mention ?? standaloneId;
    if (orderId) return getOrderDetails(normalizeOrderId(orderId));
  }
  return null;
}

function errorLooksLikeInvalidKey(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("api key") ||
    lower.includes("api_key") ||
    lower.includes("permission") ||
    lower.includes("unauthenticated") ||
    lower.includes("401") ||
    lower.includes("403")
  );
}

function errorLooksLikeMissingModel(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("not found") ||
    lower.includes("no longer available") ||
    lower.includes("not_found") ||
    lower.includes("deprecated")
  );
}

function errorLooksLikeCapacity(message: string, error: unknown) {
  const lower = message.toLowerCase();
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;
  return (
    status === 503 ||
    status === 429 ||
    lower.includes("unavailable") ||
    lower.includes("high demand") ||
    lower.includes("resource_exhausted") ||
    lower.includes("try again later") ||
    lower.includes("429") ||
    lower.includes("503")
  );
}

function errorLooksLikeRateLimit(message: string, error: unknown) {
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status)
      : undefined;
  return (
    status === 429 ||
    /resource_exhausted|rate.?limit|quota exceeded/i.test(message)
  );
}

function extractFunctionCalls(response: {
  functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }>;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }>;
    };
  }>;
}): Array<{ name: string; args: Record<string, unknown> }> {
  if (response.functionCalls?.length) {
    return response.functionCalls
      .filter((c) => c.name)
      .map((c) => ({ name: c.name as string, args: c.args ?? {} }));
  }
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const part of parts) {
    if (part.functionCall?.name) {
      calls.push({
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      });
    }
  }
  return calls;
}

async function generateWithModel(args: {
  model: string;
  contents: unknown;
  systemInstruction: string;
  temperature: number;
  tools?: Array<{ functionDeclarations: (typeof getOrderDetailsDecl)[] }>;
}) {
  const ai = getClient();
  return ai.models.generateContent({
    model: args.model,
    contents: args.contents as never,
    config: {
      systemInstruction: args.systemInstruction,
      temperature: args.temperature,
      ...(args.tools ? { tools: args.tools } : {}),
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(args: {
  contents: unknown;
  systemInstruction: string;
  temperature: number;
  tools?: Array<{ functionDeclarations: (typeof getOrderDetailsDecl)[] }>;
}) {
  let lastError: unknown;
  for (const model of MODEL_CANDIDATES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await generateWithModel({ ...args, model });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (errorLooksLikeRateLimit(message, error)) {
          throw error;
        }
        if (errorLooksLikeInvalidKey(message)) {
          throw error;
        }
        const retryable =
          errorLooksLikeMissingModel(message) ||
          errorLooksLikeCapacity(message, error);
        if (!retryable) {
          throw error;
        }
        if (errorLooksLikeCapacity(message, error) && attempt === 0) {
          await sleep(800);
          continue;
        }
        break;
      }
    }
  }
  throw lastError;
}

export async function runAriaTurn(messages: ChatTurn[]): Promise<string> {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;
  const previousAssistantMessage =
    [...messages].reverse().find((message) => message.role === "assistant")
      ?.content ?? "";
  if (
    latestUserMessage &&
    isCustomerDone(latestUserMessage, previousAssistantMessage)
  ) {
    return "No problem. Please end the call from your side whenever you're ready.";
  }

  const contents: Array<{
    role: string;
    parts: Array<Record<string, unknown>>;
  }> = toContents(messages);
  const recentOrder = findRecentOrder(messages);

  if (!contents.length) {
    return "Sorry, I didn't quite catch that. Could you please repeat it?";
  }

  const systemInstruction = recentOrder
    ? `${ARIA_SYSTEM_PROMPT}\n\nA server-verified order lookup is included for this conversation: ${JSON.stringify(recentOrder)}. Use these verified details to answer. Do not call get_order_details again for this order.`
    : ARIA_SYSTEM_PROMPT;

  for (let step = 0; step < 4; step++) {
    const response = await generateWithFallback({
      contents,
      systemInstruction,
      temperature: 0.4,
      ...(recentOrder
        ? {}
        : { tools: [{ functionDeclarations: [getOrderDetailsDecl] }] }),
    });

    const calls = extractFunctionCalls(response);
    if (!calls.length) {
      const text = response.text?.trim();
      if (!text) {
        return "Sorry, I didn't quite catch that. Could you please repeat it?";
      }
      return addClosingOffer(text);
    }

    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) {
      contents.push(
        modelContent as { role: string; parts: Array<Record<string, unknown>> },
      );
    }

    const functionResponseParts = calls.map((call) => {
      let result: unknown = { error: "Unknown tool" };
      if (call.name === "get_order_details") {
        const orderId = String(call.args.order_id ?? "");
        result = getOrderDetails(orderId);
      }
      return {
        functionResponse: {
          name: call.name,
          response: { result },
        },
      };
    });

    contents.push({
      role: "user",
      parts: functionResponseParts,
    });
  }

  return "I need a moment to look that up. Could you say the order ID again?";
}

export async function summariseCall(transcript: ChatTurn[]): Promise<unknown> {
  const lines = transcript
    .map((t) => `${t.role === "user" ? "Customer" : "Aria"}: ${t.content}`)
    .join("\n");

  const response = await generateWithFallback({
    contents: `Transcript:\n${lines}`,
    systemInstruction: SUMMARY_SYSTEM_PROMPT,
    temperature: 0.2,
  });

  const raw = response.text?.trim() ?? "{}";
  const jsonText = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return {
      customer_intent: "OTHER",
      order_id: null,
      resolution_status: "UNRESOLVED",
      call_summary: jsonText.slice(0, 500),
    };
  }
}
