import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  AgentRuntime,
  MockMcpServer,
  type LlmProvider
} from "../../packages/agent-core/src/index.js";
import {
  decodePcm16Wav,
  type AudioData,
  type SpeechToTextProvider,
  type TextToSpeechProvider
} from "../../packages/audio/src/index.js";

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
import { recordQualificationEvidence } from "./qualification-evidence.js";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

export interface BufferedQualificationDependencies {
  validateConfiguration?: (config: LiveProviderConfiguration) => void;
  createChat: (config: LiveChatConfiguration) => LlmProvider;
  createStt: (config: LiveSpeechToTextConfiguration) => SpeechToTextProvider;
  createTts: (config: LiveTextToSpeechConfiguration) => TextToSpeechProvider;
  readAudioFixture?: (path: string) => Promise<AudioData>;
  recordEvidence?: typeof recordQualificationEvidence;
}

export interface BufferedComposedQualificationResult {
  transcript: string;
  response: string;
  usedTools: string[];
  audioMimeType: string;
  audioByteLength: number;
}

/** Executes provider-neutral buffered qualification through injected adapters. */
export class BufferedProviderQualification {
  readonly #readAudioFixture: (path: string) => Promise<AudioData>;
  readonly #recordEvidence: typeof recordQualificationEvidence;

  public constructor(
    private readonly providerFamily: string,
    private readonly providerLabel: string,
    private readonly config: LiveProviderConfiguration,
    private readonly budget: LiveRequestBudget,
    private readonly dependencies: BufferedQualificationDependencies
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
      "chat-direct",
      async () => {
        const result = await this.chatProvider("direct Chat").complete({
          messages: [
            {
              role: "user",
              content: "Reply with the single word READY."
            }
          ],
          tools: []
        });
        if (result.type !== "message" || !result.content.trim()) {
          throw new Error(
            `${this.providerLabel} direct Chat returned an invalid response`
          );
        }
        return result.content;
      }
    );
  }

  public chatWithTools(): Promise<string> {
    return this.#recordEvidence(this.providerFamily, "chat-tools", async () => {
      const result = await new AgentRuntime(
        this.chatProvider("tool-assisted Chat"),
        new MockMcpServer(),
        1
      ).run("Check the light status using the available tool.");
      if (
        !result.response.trim() ||
        !result.usedTools.includes("mock.get_device_status")
      ) {
        throw new Error(
          `${this.providerLabel} tool-assisted Chat did not complete the expected tool flow`
        );
      }
      return result.response;
    });
  }

  public transcribe(): Promise<string> {
    return this.#recordEvidence(this.providerFamily, "stt", async () => {
      const config = requiredLiveConfiguration(
        this.config.stt,
        `${this.providerLabel} STT configuration`
      );
      const audio = await this.inputAudio(config);
      const provider = this.dependencies.createStt(config);
      const result = await executeLiveProviderRequest(
        qualificationRequestOptions(
          `${this.providerLabel} STT`,
          config,
          this.budget
        ),
        () => provider.transcribe(audio)
      );
      if (!result.text.trim()) {
        throw new Error(
          `${this.providerLabel} STT returned an invalid response`
        );
      }
      return result.text;
    });
  }

  public synthesize(): Promise<AudioData> {
    return this.#recordEvidence(this.providerFamily, "tts", async () => {
      const config = requiredLiveConfiguration(
        this.config.tts,
        `${this.providerLabel} TTS configuration`
      );
      return await this.synthesizeText(
        config,
        `${this.providerLabel} qualification succeeded.`
      );
    });
  }

  public composedVoice(): Promise<BufferedComposedQualificationResult> {
    return this.#recordEvidence(
      this.providerFamily,
      "composed-voice",
      async () => {
        const sttConfig = requiredLiveConfiguration(
          this.config.stt,
          `${this.providerLabel} STT configuration`
        );
        const input = await this.inputAudio(sttConfig);
        const transcription = await executeLiveProviderRequest(
          qualificationRequestOptions(
            `${this.providerLabel} composed STT`,
            sttConfig,
            this.budget
          ),
          () => this.dependencies.createStt(sttConfig).transcribe(input)
        );
        if (!transcription.text.trim()) {
          throw new Error(
            `${this.providerLabel} composed STT returned an invalid response`
          );
        }
        const agent = await new AgentRuntime(
          this.chatProvider("composed Chat"),
          new MockMcpServer(),
          1
        ).run(transcription.text);
        if (
          !agent.response.trim() ||
          !agent.usedTools.includes("mock.get_device_status")
        ) {
          throw new Error(
            `${this.providerLabel} composed Chat did not complete the expected tool flow`
          );
        }
        const ttsConfig = requiredLiveConfiguration(
          this.config.tts,
          `${this.providerLabel} TTS configuration`
        );
        const output = await this.synthesizeText(ttsConfig, agent.response);
        return {
          transcript: transcription.text,
          response: agent.response,
          usedTools: agent.usedTools,
          audioMimeType: output.mimeType,
          audioByteLength: output.data.byteLength
        };
      }
    );
  }

  private chatProvider(operation: string): LlmProvider {
    const config = requiredLiveConfiguration(
      this.config.chat,
      `${this.providerLabel} Chat configuration`
    );
    const provider = this.dependencies.createChat(config);
    return {
      complete: (input) =>
        executeLiveProviderRequest(
          qualificationRequestOptions(
            `${this.providerLabel} ${operation}`,
            config,
            this.budget
          ),
          (requestSignal) =>
            provider.complete({
              ...input,
              signal: input.signal
                ? AbortSignal.any([input.signal, requestSignal])
                : requestSignal
            })
        )
    };
  }

  private async synthesizeText(
    config: LiveTextToSpeechConfiguration,
    text: string
  ): Promise<AudioData> {
    if (config.responseFormat !== "wav") {
      throw new LiveTestConfigurationError(
        `${this.providerLabel} qualification requires WAV TTS output`
      );
    }
    const provider = this.dependencies.createTts(config);
    const audio = await executeLiveProviderRequest(
      qualificationRequestOptions(
        `${this.providerLabel} TTS`,
        config,
        this.budget
      ),
      () => provider.synthesize(text)
    );
    validateQualificationPcmWav(audio, `${this.providerLabel} TTS`);
    return audio;
  }

  private async inputAudio(
    config: LiveSpeechToTextConfiguration
  ): Promise<AudioData> {
    const fixturePath = requiredLiveConfiguration(
      config.fixturePath,
      `${this.providerLabel} STT fixture path`
    );
    const audio = await this.#readAudioFixture(fixturePath);
    validateQualificationPcmWav(
      audio,
      `${this.providerLabel} STT fixture`,
      16_000
    );
    return audio;
  }
}

export function bufferedMinimumRequestCount(
  capabilities: readonly LiveCapabilityId[]
): number {
  return (
    (capabilities.includes("chat") ? 3 : 0) +
    (capabilities.includes("stt") ? 1 : 0) +
    (capabilities.includes("tts") ? 1 : 0) +
    (capabilities.includes("composed-voice") ? 4 : 0)
  );
}

export async function readQualificationAudioFixture(
  path: string
): Promise<AudioData> {
  if (!isAbsolute(path)) {
    throw new LiveTestConfigurationError("STT fixture path must be absolute");
  }
  const data = new Uint8Array(await readFile(path));
  if (data.byteLength === 0 || data.byteLength > MAX_AUDIO_BYTES) {
    throw new LiveTestConfigurationError(
      "STT fixture must contain between 1 byte and 5 MB"
    );
  }
  return { data, mimeType: "audio/wav" };
}

export function validateQualificationPcmWav(
  audio: AudioData,
  label: string,
  expectedSampleRate?: number
): void {
  if (!audio.mimeType.includes("wav")) {
    throw new Error(`${label} returned an invalid response`);
  }
  if (audio.data.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(`${label} exceeded the 5 MB qualification limit`);
  }
  const decoded = decodePcm16Wav(audio.data);
  if (
    decoded.channels !== 1 ||
    (expectedSampleRate !== undefined &&
      decoded.sampleRate !== expectedSampleRate)
  ) {
    throw new Error(
      expectedSampleRate === undefined
        ? `${label} must use mono PCM16 WAV audio`
        : `${label} must use mono ${expectedSampleRate / 1_000} kHz PCM16 WAV audio`
    );
  }
}

export function qualificationRequestOptions(
  label: string,
  config:
    | LiveChatConfiguration
    | LiveSpeechToTextConfiguration
    | LiveTextToSpeechConfiguration,
  budget: LiveRequestBudget
) {
  return {
    label,
    timeoutMs: config.timeoutMs,
    budget,
    secrets: [config.apiKey]
  };
}

export function requiredLiveConfiguration<T>(
  value: T | undefined,
  label: string
): T {
  if (value === undefined) {
    throw new LiveTestConfigurationError(`${label} is required`);
  }
  return value;
}
