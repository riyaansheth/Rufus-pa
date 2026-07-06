"use client";

import * as React from "react";

/**
 * Browser microphone → OpenAI transcription, hands-free.
 *
 * Records audio with MediaRecorder and monitors loudness via an AnalyserNode:
 * once the user has spoken and then stays silent for ~1.8s, recording stops
 * automatically — tap once, just talk. Tap again to stop manually. The blob is
 * POSTed to /api/transcribe (OpenAI key stays server-side).
 *
 * Privacy: recording only ever starts from an explicit user action.
 */

const SILENCE_STOP_MS = 1800; // stop this long after speech ends
const SPEECH_RMS_THRESHOLD = 0.02; // normalized RMS above this counts as speech
const MAX_RECORDING_MS = 60_000; // hard cap

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
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const meterTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupMeter = React.useCallback(() => {
    if (meterTimerRef.current) {
      clearInterval(meterTimerRef.current);
      meterTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const stop = React.useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const start = React.useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state === "recording") return;
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
        cleanupMeter();
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
          const text = data.text?.trim();
          if (text) onTranscript(text);
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "Transcription failed.");
        } finally {
          setBusy(false);
        }
      };

      // --- Silence auto-stop: watch loudness; after speech, 1.8s of quiet ends it.
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let spokeYet = false;
        let lastLoudAt = Date.now();
        meterTimerRef.current = setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          if (rms > SPEECH_RMS_THRESHOLD) {
            spokeYet = true;
            lastLoudAt = Date.now();
          } else if (spokeYet && Date.now() - lastLoudAt > SILENCE_STOP_MS) {
            stop();
          }
        }, 120);
      } catch {
        // Metering unavailable → tap-to-stop still works.
      }
      maxTimerRef.current = setTimeout(stop, MAX_RECORDING_MS);

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      onError?.("Microphone permission was denied.");
    }
  }, [cleanupMeter, onError, onTranscript, stop]);

  const toggle = React.useCallback(() => {
    if (recording) stop();
    else void start();
  }, [recording, start, stop]);

  React.useEffect(() => cleanupMeter, [cleanupMeter]);

  return { recording, busy, toggle, start, stop };
}
