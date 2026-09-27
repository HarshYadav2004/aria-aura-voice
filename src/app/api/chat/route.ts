import { NextResponse } from "next/server";
import { runAriaTurn, type ChatTurn } from "@/lib/gemini";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const messages = body.messages as ChatTurn[] | undefined;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    const sanitized = messages
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim(),
      )
      .slice(-16);

    const reply = await runAriaTurn(sanitized);
    return NextResponse.json({ reply });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("chat error", message);
    const errorStatus =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status?: number }).status)
        : undefined;
    const lower = message.toLowerCase();
    const capacityError =
      errorStatus === 429 ||
      errorStatus === 503 ||
      lower.includes("high demand") ||
      lower.includes("unavailable") ||
      lower.includes("try again later");
    const status = message.includes("GEMINI_API_KEY")
      ? 500
      : capacityError
        ? errorStatus === 429
          ? 429
          : 503
        : 502;
    let friendly = "I had trouble reaching the assistant. Please try again.";
    if (status === 500) {
      friendly =
        "Server is missing GEMINI_API_KEY. Add your Google AI Studio key to .env.local.";
    } else if (capacityError) {
      friendly =
        "Gemini is temporarily busy. Please try again in a few seconds.";
    } else if (lower.includes("not found") || lower.includes("is not found")) {
      friendly =
        "Gemini model name is invalid. In .env.local set GEMINI_MODEL=gemini-2.5-flash and restart npm run dev.";
    } else if (
      lower.includes("api key") ||
      lower.includes("permission") ||
      lower.includes("unauthenticated")
    ) {
      friendly =
        "Google rejected the AI Studio API key. Create a Gemini API key at aistudio.google.com/apikey and paste it into .env.local.";
    }
    return NextResponse.json(
      { error: friendly },
      {
        status,
        ...(capacityError ? { headers: { "Retry-After": "3" } } : {}),
      },
    );
  }
}
