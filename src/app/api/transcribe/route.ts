import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";

/**
 * Speech-to-text via OpenAI. The audio blob is sent here (server-side) so the OpenAI
 * API key never reaches the browser. Requires an authenticated Clerk session.
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return new NextResponse(
      "Voice input is not configured: OPENAI_API_KEY is missing.",
      { status: 501 },
    );
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return new NextResponse("No audio provided.", { status: 400 });
  }

  try {
    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
    // Match the filename extension to the actual mime type so OpenAI accepts it
    // (Safari sends audio/mp4, Chrome/Firefox audio/webm).
    const mime = audio.type || "audio/webm";
    const ext = mime.includes("mp4")
      ? "mp4"
      : mime.includes("ogg")
        ? "ogg"
        : mime.includes("mpeg")
          ? "mp3"
          : mime.includes("wav")
            ? "wav"
            : "webm";
    const file = new File([audio], `recording.${ext}`, { type: mime });
    const result = await openai.audio.transcriptions.create({
      file,
      model,
    });
    return NextResponse.json({ text: result.text });
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : "Transcription failed.",
      { status: 500 },
    );
  }
}
