import { NextResponse } from "next/server";
import { summariseCall, type ChatTurn } from "@/lib/gemini";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const messages = body.messages as ChatTurn[] | undefined;
    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
    }

    if (messages.length === 0) {
      return NextResponse.json({
        summary: {
          customer_intent: "OTHER",
          order_id: null,
          resolution_status: "UNRESOLVED",
          call_summary: "The call ended before any conversation was captured.",
        },
      });
    }

    const summary = await summariseCall(messages);
    return NextResponse.json({ summary });
  } catch (error) {
    console.error("summary error", error);
    return NextResponse.json(
      {
        summary: {
          customer_intent: "OTHER",
          order_id: null,
          resolution_status: "UNRESOLVED",
          call_summary:
            "The call ended, but the structured summary could not be generated.",
        },
      },
      { status: 200 },
    );
  }
}
