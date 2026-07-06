import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";

/** Parse OPENAI_TTS_SPEED into OpenAI's accepted 0.25–4.0 range. */
function clampSpeed(raw: string | undefined, fallback: number): number {
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(4, Math.max(0.25, n));
}

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
    // tts-1 is OpenAI's low-latency (real-time) speech model — noticeably faster
    // to first audio than gpt-4o-mini-tts. Override via OPENAI_TTS_MODEL.
    const model = process.env.OPENAI_TTS_MODEL || "tts-1";
    const voice = process.env.OPENAI_TTS_VOICE || "alloy";
    // Speak a touch faster than default (1.0). Tunable via OPENAI_TTS_SPEED.
    const speed = clampSpeed(process.env.OPENAI_TTS_SPEED, 1.1);
    const speech = await openai.audio.speech.create({
      model,
      voice,
      input: text,
      response_format: "mp3",
      speed,
    });
    // Stream the audio straight through so the browser can start playing before
    // the whole clip is synthesized (big perceived-latency win). Fall back to a
    // buffered response if the SDK didn't hand us a stream body.
    if (speech.body) {
      return new NextResponse(speech.body as ReadableStream, {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "Transfer-Encoding": "chunked",
        },
      });
    }
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
