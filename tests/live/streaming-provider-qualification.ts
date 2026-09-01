import {
  MockMcpServer,
  StreamingAgentRuntime,
  type AgentRunResult,
  type StreamingAgentEvent,
  type StreamingLlmEvent,
  type StreamingLlmProvider
} from "../../packages/agent-core/src/index.js";
import {
  decodePcm16Wav,
  type AudioData,
  type StreamingAudioFormat,
  type StreamingSpeechToTextProvider,
  type StreamingSynthesisEvent,
  type StreamingTextToSpeechProvider,
  type StreamingTranscriptionEvent
} from "../../packages/audio/src/index.js";
import { VOICE_STREAM_LIMITS } from "../../packages/shared/src/voice-stream.js";

import {
  executeLiveProviderRequest,
  LiveTestConfigurationError,
  type LiveCapabilityId,
  type LiveChatConfiguration,
  type LiveProviderConfiguration,
  type LiveRequestBudget,
  type LiveSpeechToTextConfiguration,
  type LiveTextToSpeechConfiguration
} from "./provider-test-harness.js";
import {
  qualificationRequestOptions,
  readQualificationAudioFixture,
  requiredLiveConfiguration,
  validateQualificationPcmWav
} from "./buffered-provider-qualification.js";
import { recordQualificationEvidence } from "./qualification-evidence.js";

const INPUT_FORMAT: StreamingAudioFormat = {
  encoding: "pcm16le",
  sampleRate: 16_000,
  channels: 1
};
const OUTPUT_FORMAT: StreamingAudioFormat = {
  encoding: "pcm16le",
  sampleRate: 24_000,
  channels: 1
};
const INPUT_FRAME_BYTES = 640;

export interface StreamingQualificationDependencies {
  validateConfiguration?: (config: LiveProviderConfiguration) => void;
  createChat: (config: LiveChatConfiguration) => StreamingLlmProvider;
  createStt: (
    config: LiveSpeechToTextConfiguration
  ) => StreamingSpeechToTextProvider;
  createTts: (
    config: LiveTextToSpeechConfiguration
  ) => StreamingTextToSpeechProvider;
  readAudioFixture?: (path: string) => Promise<AudioData>;
  recordEvidence?: typeof recordQualificationEvidence;
}

export interface StreamingAudioQualificationResult {
  audioByteLength: number;
  durationMs: number;
  chunkCount: number;
}

export interface StreamingComposedQualificationResult extends StreamingAudioQualificationResult {
  transcript: string;
  response: string;
  usedTools: string[];
}

/** Executes opt-in live streaming qualification through project contracts. */
export class StreamingProviderQualification {
  readonly #readAudioFixture: (path: string) => Promise<AudioData>;
  readonly #recordEvidence: typeof recordQualificationEvidence;

  public constructor(
    private readonly providerFamily: string,
    private readonly providerLabel: string,
    private readonly config: LiveProviderConfiguration,
    private readonly budget: LiveRequestBudget,
    private readonly dependencies: StreamingQualificationDependencies
  ) {
    dependencies.validateConfiguration?.(config);
    this.#readAudioFixture =
      dependencies.readAudioFixture ?? readQualificationAudioFixture;
    this.#recordEvidence =
      dependencies.recordEvidence ?? recordQualificationEvidence;
  }

  public chatDirect(): Promise<string> {
    return this.#recordEvidence(
      this.providerFamily,
      "streaming-chat-direct",
      async () => {
        const consumed = await consumeAgent(
          new StreamingAgentRuntime(
            this.chatProvider("direct Streaming Chat"),
            new MockMcpServer(),
            1
          ).run("Reply with the single word READY.", {
            toolMode: "disabled",
            signal: new AbortController().signal
          })
        );
        if (!consumed.result.response.trim()) {
          throw new Error(
            `${this.providerLabel} direct Streaming Chat returned an invalid response`
          );
        }
        return consumed.result.response;
      }
    );
  }

  public chatWithTools(): Promise<string> {
    return this.#recordEvidence(
      this.providerFamily,
      "streaming-chat-tools",
      async () => {
        const consumed = await consumeAgent(
          new StreamingAgentRuntime(
            this.chatProvider("tool-assisted Streaming Chat"),
            new MockMcpServer(),
            1
          ).run("Check the light status using the available tool.", {
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        );
        if (
          !consumed.result.response.trim() ||
          !consumed.result.usedTools.includes("mock.get_device_status")
        ) {
          throw new Error(
            `${this.providerLabel} tool-assisted Streaming Chat did not complete the expected tool flow`
          );
        }
        return consumed.result.response;
      }
    );
  }

  public transcribe(): Promise<string> {
    return this.#recordEvidence(
      this.providerFamily,
      "streaming-stt",
      async () => await this.transcribeInput("Streaming STT")
    );
  }

  public synthesize(): Promise<StreamingAudioQualificationResult> {
    return this.#recordEvidence(
      this.providerFamily,
      "streaming-tts",
      async () =>
        await this.synthesizeText(
          "Streaming voice qualification succeeded.",
          "Streaming TTS"
        )
    );
  }

  public composedVoice(): Promise<StreamingComposedQualificationResult> {
    return this.#recordEvidence(
      this.providerFamily,
      "streaming-composed-voice",
      async () => {
        const transcript = await this.transcribeInput("composed Streaming STT");
        const consumed = await consumeAgent(
          new StreamingAgentRuntime(
            this.chatProvider("composed Streaming Chat"),
            new MockMcpServer(),
            1
          ).run(transcript, {
            toolMode: "enabled",
            signal: new AbortController().signal
          })
        );
        if (
          !consumed.result.response.trim() ||
          !consumed.result.usedTools.includes("mock.get_device_status")
        ) {
          throw new Error(
            `${this.providerLabel} composed Streaming Chat did not complete the expected tool flow`
          );
        }
        const audio = await this.synthesizeText(
          consumed.result.response,
          "composed Streaming TTS"
        );
        return {
          transcript,
          response: consumed.result.response,
          usedTools: consumed.result.usedTools,
          ...audio
        };
      }
    );
  }

  private chatProvider(operation: string): StreamingLlmProvider {
    const config = requiredLiveConfiguration(
      this.config.chat,
      `${this.providerLabel} Chat configuration`
    );
    const provider = this.dependencies.createChat(config);
    return {
      stream: (input) =>
        collectThenReplay(
          executeLiveProviderRequest(
            qualificationRequestOptions(
              `${this.providerLabel} ${operation}`,
              config,
              this.budget
            ),
            async (requestSignal) =>
              await collectEvents(
                provider.stream({
                  ...input,
                  signal: AbortSignal.any([input.signal, requestSignal])
                })
              )
          )
        )
    };
  }

  private async transcribeInput(operation: string): Promise<string> {
    const config = requiredLiveConfiguration(
      this.config.stt,
      `${this.providerLabel} STT configuration`
    );
    const fixturePath = requiredLiveConfiguration(
      config.fixturePath,
      `${this.providerLabel} STT fixture path`
    );
    const audio = await this.#readAudioFixture(fixturePath);
    validateQualificationPcmWav(
      audio,
      `${this.providerLabel} STT fixture`,
      INPUT_FORMAT.sampleRate
    );
    const pcm = decodePcm16Wav(audio.data).pcm;
    const maximumPcmBytes =
      INPUT_FORMAT.sampleRate *
      INPUT_FORMAT.channels *
      2 *
      (VOICE_STREAM_LIMITS.maxCaptureDurationMs / 1_000);
    if (
      pcm.byteLength > maximumPcmBytes ||
      pcm.byteLength % INPUT_FRAME_BYTES !== 0
    ) {
      throw new LiveTestConfigurationError(
        `${this.providerLabel} Streaming STT fixture must contain complete 20 ms frames within the 60-second limit`
      );
    }
    const events = await executeLiveProviderRequest(
      qualificationRequestOptions(
        `${this.providerLabel} ${operation}`,
        config,
        this.budget
      ),
      async (signal) => {
        const session = await this.dependencies
          .createStt(config)
          .startSession({ format: INPUT_FORMAT, signal });
        const collected = observe(collectEvents(session));
        try {
          let sequence = 1;
          for (
            let offset = 0;
            offset < pcm.byteLength;
            offset += INPUT_FRAME_BYTES
          ) {
            await session.write({
              sequence,
              format: INPUT_FORMAT,
              data: pcm.slice(offset, offset + INPUT_FRAME_BYTES)
            });
            sequence += 1;
          }
          await session.finishInput();
          const result = await collected;
          if (!result.success) throw result.error;
          return result.value;
        } finally {
          await session.close();
          await collected;
        }
      }
    );
    return validateTranscription(events, this.providerLabel);
  }

  private async synthesizeText(
    text: string,
    operation: string
  ): Promise<StreamingAudioQualificationResult> {
    const config = requiredLiveConfiguration(
      this.config.tts,
      `${this.providerLabel} TTS configuration`
    );
    const events = await executeLiveProviderRequest(
      qualificationRequestOptions(
        `${this.providerLabel} ${operation}`,
        config,
        this.budget
      ),
      async (signal) => {
        const session = await this.dependencies
          .createTts(config)
          .startSynthesis({ text, signal });
        try {
          return await collectEvents(session);
        } finally {
          await session.close();
        }
      }
    );
    return validateSynthesis(events, this.providerLabel);
  }
}

export function streamingMinimumRequestCount(
  capabilities: readonly LiveCapabilityId[]
): number {
  return (
    (capabilities.includes("streaming-chat") ? 3 : 0) +
    (capabilities.includes("streaming-stt") ? 1 : 0) +
    (capabilities.includes("streaming-tts") ? 1 : 0) +
    (capabilities.includes("streaming-composed-voice") ? 4 : 0)
  );
}

async function consumeAgent(
  generator: AsyncGenerator<StreamingAgentEvent, AgentRunResult>
): Promise<{ events: StreamingAgentEvent[]; result: AgentRunResult }> {
  const events: StreamingAgentEvent[] = [];
  while (true) {
    const next = await generator.next();
    if (next.done) return { events, result: next.value };
    events.push(next.value);
  }
}

async function collectEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function observe<T>(
  operation: Promise<T>
): Promise<{ success: true; value: T } | { success: false; error: unknown }> {
  return operation.then(
    (value) => ({ success: true, value }),
    (error: unknown) => ({ success: false, error })
  );
}

async function* collectThenReplay(
  events: Promise<StreamingLlmEvent[]>
): AsyncGenerator<StreamingLlmEvent> {
  for (const event of await events) yield event;
}

function validateTranscription(
  events: StreamingTranscriptionEvent[],
  providerLabel: string
): string {
  assertOrderedEvents(events, providerLabel, "Streaming STT");
  const finals = events.filter((event) => event.type === "final");
  if (
    finals.length !== 1 ||
    events.at(-1)?.type !== "final" ||
    !finals[0]?.result.text.trim()
  ) {
    throw new Error(
      `${providerLabel} Streaming STT returned an invalid response`
    );
  }
  return finals[0].result.text;
}

function validateSynthesis(
  events: StreamingSynthesisEvent[],
  providerLabel: string
): StreamingAudioQualificationResult {
  assertOrderedEvents(
    events.map((event) => ({
      sequence: event.type === "audio" ? event.chunk.sequence : event.sequence
    })),
    providerLabel,
    "Streaming TTS"
  );
  const completed = events.filter((event) => event.type === "completed");
  const audio = events.filter((event) => event.type === "audio");
  const audioByteLength = audio.reduce(
    (total, event) => total + event.chunk.data.byteLength,
    0
  );
  const terminal = completed[0];
  const expectedDurationMs =
    (audioByteLength /
      (OUTPUT_FORMAT.sampleRate * OUTPUT_FORMAT.channels * 2)) *
    1_000;
  if (
    completed.length !== 1 ||
    events.at(-1)?.type !== "completed" ||
    audio.length === 0 ||
    audio.some(
      (event) =>
        !sameFormat(event.chunk.format, OUTPUT_FORMAT) ||
        event.chunk.data.byteLength === 0 ||
        event.chunk.data.byteLength % 2 !== 0
    ) ||
    terminal === undefined ||
    !sameFormat(terminal.format, OUTPUT_FORMAT) ||
    terminal.audioBytes !== audioByteLength ||
    terminal.durationMs <= 0 ||
    Math.abs(terminal.durationMs - expectedDurationMs) > 0.001
  ) {
    throw new Error(
      `${providerLabel} Streaming TTS returned an invalid response`
    );
  }
  return {
    audioByteLength,
    durationMs: terminal.durationMs,
    chunkCount: audio.length
  };
}

function assertOrderedEvents(
  events: Array<{ sequence: number }>,
  providerLabel: string,
  operation: string
): void {
  if (
    events.length === 0 ||
    events.some((event, index) => event.sequence !== index + 1)
  ) {
    throw new Error(
      `${providerLabel} ${operation} returned out-of-order events`
    );
  }
}

function sameFormat(
  left: StreamingAudioFormat,
  right: StreamingAudioFormat
): boolean {
  return (
    left.encoding === right.encoding &&
    left.sampleRate === right.sampleRate &&
    left.channels === right.channels
  );
}
