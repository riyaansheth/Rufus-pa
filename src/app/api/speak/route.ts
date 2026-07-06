import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";

/**
 * Text-to-speech via OpenAI, so the assistant can talk back. Runs server-side —
 * the API key never reaches the browser. Requires an authenticated Clerk session.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new NextResponse(
      "Voice output is not configured: OPENAI_API_KEY is missing.",
      { status: 501 },
    );
  }

  let text: string;
  try {
    const body = (await req.json()) as { text?: string };
    text = (body.text ?? "").trim();
  } catch {
    return new NextResponse("Invalid JSON body.", { status: 400 });
  }
  if (!text) return new NextResponse("No text provided.", { status: 400 });
  // Keep spoken replies bounded (cost + latency). The assistant leads with a short
  // confirmation sentence anyway.
  if (text.length > 1500) text = text.slice(0, 1500);

  try {
    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
    const voice = process.env.OPENAI_TTS_VOICE || "alloy";
    const speech = await openai.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: "mp3",
    });
    const buffer = Buffer.from(await speech.arrayBuffer());
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : "Speech synthesis failed.",
      { status: 500 },
    );
  }
}
