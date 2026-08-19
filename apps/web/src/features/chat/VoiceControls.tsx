import { useEffect, useRef, useState } from "react";

import type { VoiceResponse } from "@voxmesh/shared";

import { apiClient } from "../../api.js";
import { useI18n } from "../../i18n/i18n.js";
import { localizedError } from "../../utils/errors.js";
import {
  BrowserAudioRecorder,
  playBase64Audio,
  type AudioRecorder
} from "./browser-audio.js";

export interface VoiceControlsProps {
  createRecorder?: () => AudioRecorder;
  submitVoice?: (audio: Blob) => Promise<VoiceResponse>;
  playAudio?: typeof playBase64Audio;
}

export function VoiceControls({
  createRecorder = () => new BrowserAudioRecorder(),
  submitVoice = apiClient.voice,
  playAudio = playBase64Audio
}: VoiceControlsProps) {
  const { t } = useI18n();
  const recorder = useRef<AudioRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<VoiceResponse>();
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      recorder.current?.cancel();
    },
    []
  );

  const start = async () => {
    setError("");
    setResult(undefined);
    const nextRecorder = createRecorder();
    recorder.current = nextRecorder;
    try {
      await nextRecorder.start();
      setRecording(true);
    } catch (caught) {
      recorder.current = null;
      setError(localizedError(caught, t, "voice.recordingFailed"));
    }
  };

  const stop = async () => {
    const activeRecorder = recorder.current;
    if (!activeRecorder) return;
    setRecording(false);
    setProcessing(true);
    setError("");
    try {
      const audio = await activeRecorder.stop();
      const response = await submitVoice(audio);
      setResult(response);
    } catch (caught) {
      setError(localizedError(caught, t, "voice.processingFailed"));
    } finally {
      recorder.current = null;
      setProcessing(false);
    }
  };

  const play = async () => {
    if (!result) return;
    setError("");
    try {
      await playAudio(result.audio);
    } catch (caught) {
      setError(localizedError(caught, t, "voice.playbackFailed"));
    }
  };

  return (
    <section className="voice-controls" aria-labelledby="voice-controls-title">
      <h3 id="voice-controls-title">{t("voice.title")}</h3>
      <p className="muted">{t("voice.description")}</p>
      <div className="button-row">
        <button
          type="button"
          disabled={recording || processing}
          onClick={() => void start()}
        >
          {t("voice.start")}
        </button>
        <button type="button" disabled={!recording} onClick={() => void stop()}>
          {t("voice.stop")}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!result || recording || processing}
          onClick={() => void play()}
        >
          {t("voice.play")}
        </button>
      </div>
      {recording ? <p role="status">{t("voice.recording")}</p> : null}
      {processing ? <p role="status">{t("voice.processing")}</p> : null}
      {result ? (
        <div className="voice-result" aria-live="polite">
          <p>
            <strong>{t("voice.transcript")}:</strong> {result.transcript}
          </p>
          <p>
            <strong>{t("voice.response")}:</strong> {result.response}
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
