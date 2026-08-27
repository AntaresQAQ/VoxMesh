import { useEffect, useRef, useState } from "react";

import { useI18n } from "../../i18n/i18n.js";
import { localizedError } from "../../utils/errors.js";
import {
  DefaultBrowserVoiceStreamSession,
  supportsBrowserVoiceStream,
  type BrowserVoiceStreamCallbacks,
  type BrowserVoiceStreamSession,
  type BrowserVoiceStreamSessionOptions,
  type BrowserVoiceStreamState
} from "./voice-stream-client.js";

export interface StreamingVoiceControlsProps {
  supported?: boolean;
  createSession?: (
    options: BrowserVoiceStreamSessionOptions
  ) => BrowserVoiceStreamSession;
}

/** Accessible browser controls for one non-resumable streaming voice session. */
export function StreamingVoiceControls({
  supported = supportsBrowserVoiceStream(),
  createSession = (options) => new DefaultBrowserVoiceStreamSession(options)
}: StreamingVoiceControlsProps) {
  const { t } = useI18n();
  const session = useRef<BrowserVoiceStreamSession | null>(null);
  const starting = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [allowTools, setAllowTools] = useState(true);
  const [state, setState] = useState<BrowserVoiceStreamState>();
  const [level, setLevel] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [transcript, setTranscript] = useState("");
  const [assistant, setAssistant] = useState("");
  const [tool, setTool] = useState("");
  const [pressure, setPressure] = useState<"normal" | "high">("normal");
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      session.current?.cancel();
      session.current = null;
    },
    []
  );

  const reset = () => {
    setLevel(0);
    setPartialTranscript("");
    setTranscript("");
    setAssistant("");
    setTool("");
    setPressure("normal");
    setError("");
  };

  const start = async () => {
    if (!supported || starting.current || active(state)) return;
    starting.current = true;
    setIsStarting(true);
    reset();
    setState("connecting");
    const callbacks: BrowserVoiceStreamCallbacks = {
      onState: setState,
      onLevel: setLevel,
      onPartialTranscript: setPartialTranscript,
      onFinalTranscript: (value) => {
        setTranscript(value);
        setPartialTranscript("");
      },
      onAssistantText: setAssistant,
      onTool: setTool,
      onPressure: setPressure,
      onError: setError
    };
    const next = createSession({ allowTools, callbacks });
    session.current = next;
    try {
      await next.start();
    } catch (caught) {
      if (session.current !== next) return;
      next.cancel();
      session.current = null;
      setState("failed");
      setError(localizedError(caught, t, "voice.streaming.startFailed"));
    } finally {
      starting.current = false;
      setIsStarting(false);
    }
  };

  const finish = async () => {
    try {
      await session.current?.finishInput();
    } catch (caught) {
      session.current?.cancel();
      session.current = null;
      setLevel(0);
      setPressure("normal");
      setState("failed");
      setError(localizedError(caught, t, "voice.streaming.finishFailed"));
    }
  };

  const cancel = () => {
    session.current?.cancel();
    session.current = null;
    setLevel(0);
    setPressure("normal");
    setState("cancelled");
  };

  const isActive = active(state);
  return (
    <section
      className="voice-controls streaming-voice-controls"
      aria-labelledby="streaming-voice-controls-title"
    >
      <h3 id="streaming-voice-controls-title">{t("voice.streaming.title")}</h3>
      <p className="muted">{t("voice.streaming.description")}</p>
      {!supported ? (
        <p className="warning" role="status">
          {t("voice.streaming.unsupported")}
        </p>
      ) : null}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={allowTools}
          disabled={isActive}
          onChange={(event) => setAllowTools(event.target.checked)}
        />
        {t("voice.streaming.allowTools")}
      </label>
      <div className="button-row">
        <button
          type="button"
          disabled={!supported || isActive || isStarting}
          onClick={() => void start()}
        >
          {t("voice.streaming.start")}
        </button>
        <button
          type="button"
          disabled={state !== "capturing"}
          onClick={() => void finish()}
        >
          {t("voice.streaming.finish")}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={!isActive}
          onClick={cancel}
        >
          {t("voice.streaming.cancel")}
        </button>
      </div>
      <div className="voice-level">
        <div className="voice-level-label">
          <span>{t("voice.microphoneLevel")}</span>
          <span>
            {state === "capturing" ? `${level}%` : t("voice.levelIdle")}
          </span>
        </div>
        <div
          className="voice-level-meter"
          role="meter"
          aria-label={t("voice.microphoneLevel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={level}
        >
          <span style={{ width: `${level}%` }} />
        </div>
      </div>
      {state ? (
        <p role="status" aria-live="polite">
          {t(streamingStateKey(state))}
        </p>
      ) : null}
      {pressure === "high" ? (
        <p className="warning" role="status">
          {t("voice.streaming.pressure")}
        </p>
      ) : null}
      {tool ? (
        <p className="muted" role="status">
          {t("voice.streaming.tool", { tool })}
        </p>
      ) : null}
      {partialTranscript || transcript || assistant ? (
        <div className="voice-result" aria-live="polite">
          <p>
            <strong>{t("voice.transcript")}:</strong>{" "}
            {transcript || partialTranscript}
          </p>
          <p>
            <strong>{t("voice.response")}:</strong> {assistant}
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

function active(state: BrowserVoiceStreamState | undefined): boolean {
  return (
    state === "connecting" || state === "capturing" || state === "processing"
  );
}

function streamingStateKey(state: BrowserVoiceStreamState) {
  switch (state) {
    case "connecting":
      return "voice.streaming.state.connecting" as const;
    case "capturing":
      return "voice.streaming.state.capturing" as const;
    case "processing":
      return "voice.streaming.state.processing" as const;
    case "completed":
      return "voice.streaming.state.completed" as const;
    case "cancelled":
      return "voice.streaming.state.cancelled" as const;
    case "failed":
      return "voice.streaming.state.failed" as const;
  }
}
