"use client";

import * as React from "react";

/**
 * Browser microphone → OpenAI transcription.
 *
 * Records audio with MediaRecorder, POSTs the blob to /api/transcribe (which calls
 * OpenAI server-side so the API key never reaches the client), and returns the text.
 * Privacy: recording only starts on an explicit user toggle.
 */
export function useVoiceRecorder({
  onTranscript,
  onError,
}: {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);

  const stop = React.useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const start = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      onError?.("Microphone is not available in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const mime = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size === 0) return;
        setBusy(true);
        try {
          // OpenAI infers the audio format from the filename extension, so it must
          // match the actual mime type (Safari records audio/mp4, not webm).
          const ext = mime.includes("mp4")
            ? "mp4"
            : mime.includes("ogg")
              ? "ogg"
              : mime.includes("mpeg")
                ? "mp3"
                : mime.includes("wav")
                  ? "wav"
                  : "webm";
          const form = new FormData();
          form.append("audio", blob, `recording.${ext}`);
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const msg = await res.text();
            throw new Error(msg || "Transcription failed.");
          }
          const data = (await res.json()) as { text?: string };
          if (data.text) onTranscript(data.text);
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "Transcription failed.");
        } finally {
          setBusy(false);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      onError?.("Microphone permission was denied.");
    }
  }, [onError, onTranscript]);

  const toggle = React.useCallback(() => {
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);

  return { recording, busy, toggle };
}
