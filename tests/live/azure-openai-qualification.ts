import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  AgentRuntime,
  MockMcpServer,
  type LlmProvider
} from "../../packages/agent-core/src/index.js";
import { AzureOpenAiProvider } from "../../packages/ai/src/index.js";
import {
  AzureOpenAiSpeechToTextProvider,
  AzureOpenAiTextToSpeechProvider,
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

const PROVIDER_FAMILY = "azure-openai";
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

interface AzureQualificationDependencies {
  createChat: (config: LiveChatConfiguration) => LlmProvider;
  createStt: (config: LiveSpeechToTextConfiguration) => SpeechToTextProvider;
  createTts: (config: LiveTextToSpeechConfiguration) => TextToSpeechProvider;
  readAudioFixture: (path: string) => Promise<AudioData>;
  recordEvidence: typeof recordQualificationEvidence;
}

const defaultDependencies: AzureQualificationDependencies = {
  createChat: (config) =>
    new AzureOpenAiProvider({
      endpoint: config.endpoint.href,
      deployment: config.model,
      apiVersion: required(config.apiVersion, "Azure Chat API version"),
      apiKey: config.apiKey.reveal()
    }),
  createStt: (config) =>
    new AzureOpenAiSpeechToTextProvider({
      endpoint: config.endpoint.href,
      deployment: config.model,
      apiVersion: required(config.apiVersion, "Azure STT API version"),
      apiKey: config.apiKey.reveal(),
      language: config.language ?? "",
      timeoutMs: config.timeoutMs
    }),
  createTts: (config) =>
    new AzureOpenAiTextToSpeechProvider({
      endpoint: config.endpoint.href,
      deployment: config.model,
      apiVersion: required(config.apiVersion, "Azure TTS API version"),
      apiKey: config.apiKey.reveal(),
      voice: config.voice,
      instructions: config.instructions ?? "",
      timeoutMs: config.timeoutMs
    }),
  readAudioFixture,
  recordEvidence: recordQualificationEvidence
};

export interface AzureComposedQualificationResult {
  transcript: string;
  response: string;
  usedTools: string[];
  audioMimeType: string;
  audioByteLength: number;
}

/** Executes the bounded Azure scenarios selected by the live-test plan. */
export class AzureOpenAiQualification {
  public constructor(
    private readonly config: LiveProviderConfiguration,
    private readonly budget: LiveRequestBudget,
    private readonly dependencies: AzureQualificationDependencies = defaultDependencies
  ) {}

  public chatDirect(): Promise<string> {
    return this.dependencies.recordEvidence(
      PROVIDER_FAMILY,
      "chat-direct",
      async () => {
        const result = await this.chatProvider("Azure direct Chat").complete({
          messages: [
            {
              role: "user",
              content: "Reply with the single word READY."
            }
          ],
          tools: []
        });
        if (result.type !== "message" || !result.content.trim()) {
          throw new Error("Azure direct Chat returned an invalid response");
        }
        return result.content;
      }
    );
  }

  public chatWithTools(): Promise<string> {
    return this.dependencies.recordEvidence(
      PROVIDER_FAMILY,
      "chat-tools",
      async () => {
        const result = await new AgentRuntime(
          this.chatProvider("Azure tool-assisted Chat"),
          new MockMcpServer(),
          1
        ).run("Check the light status using the available tool.");
        if (
          !result.response.trim() ||
          !result.usedTools.includes("mock.get_device_status")
        ) {
          throw new Error(
            "Azure tool-assisted Chat did not complete the expected tool flow"
          );
        }
        return result.response;
      }
    );
  }

  public transcribe(): Promise<string> {
    return this.dependencies.recordEvidence(
      PROVIDER_FAMILY,
      "stt",
      async () => {
        const config = required(this.config.stt, "Azure STT configuration");
        const audio = await this.inputAudio(config);
        const result = await executeLiveProviderRequest(
          requestOptions("Azure STT", config, this.budget),
          () => this.dependencies.createStt(config).transcribe(audio)
        );
        if (!result.text.trim()) {
          throw new Error("Azure STT returned an invalid response");
        }
        return result.text;
      }
    );
  }

  public synthesize(): Promise<AudioData> {
    return this.dependencies.recordEvidence(
      PROVIDER_FAMILY,
      "tts",
      async () => {
        const config = required(this.config.tts, "Azure TTS configuration");
        return await this.synthesizeText(
          config,
          "Azure provider qualification succeeded."
        );
      }
    );
  }

  public composedVoice(): Promise<AzureComposedQualificationResult> {
    return this.dependencies.recordEvidence(
      PROVIDER_FAMILY,
      "composed-voice",
      async () => {
        const sttConfig = required(this.config.stt, "Azure STT configuration");
        const input = await this.inputAudio(sttConfig);
        const transcription = await executeLiveProviderRequest(
          requestOptions("Azure composed STT", sttConfig, this.budget),
          () => this.dependencies.createStt(sttConfig).transcribe(input)
        );
        if (!transcription.text.trim()) {
          throw new Error("Azure composed STT returned an invalid response");
        }
        const agent = await new AgentRuntime(
          this.chatProvider("Azure composed Chat"),
          new MockMcpServer(),
          1
        ).run(transcription.text);
        if (
          !agent.response.trim() ||
          !agent.usedTools.includes("mock.get_device_status")
        ) {
          throw new Error(
            "Azure composed Chat did not complete the expected tool flow"
          );
        }
        const ttsConfig = required(this.config.tts, "Azure TTS configuration");
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

  private chatProvider(label: string): LlmProvider {
    const config = required(this.config.chat, "Azure Chat configuration");
    const provider = this.dependencies.createChat(config);
    return {
      complete: (input) =>
        executeLiveProviderRequest(
          requestOptions(label, config, this.budget),
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
        "Azure qualification requires WAV TTS output"
      );
    }
    const audio = await executeLiveProviderRequest(
      requestOptions("Azure TTS", config, this.budget),
      () => this.dependencies.createTts(config).synthesize(text)
    );
    validatePcmWav(audio, "Azure TTS");
    return audio;
  }

  private async inputAudio(
    config: LiveSpeechToTextConfiguration
  ): Promise<AudioData> {
    const fixturePath = required(config.fixturePath, "Azure STT fixture path");
    const audio = await this.dependencies.readAudioFixture(fixturePath);
    validatePcmWav(audio, "Azure STT fixture", 16_000);
    return audio;
  }
}

export function azureMinimumRequestCount(
  capabilities: readonly LiveCapabilityId[]
): number {
  return (
    (capabilities.includes("chat") ? 3 : 0) +
    (capabilities.includes("stt") ? 1 : 0) +
    (capabilities.includes("tts") ? 1 : 0) +
    (capabilities.includes("composed-voice") ? 4 : 0)
  );
}

async function readAudioFixture(path: string): Promise<AudioData> {
  if (!isAbsolute(path)) {
    throw new LiveTestConfigurationError(
      "Azure STT fixture path must be absolute"
    );
  }
  const data = new Uint8Array(await readFile(path));
  if (data.byteLength === 0 || data.byteLength > MAX_AUDIO_BYTES) {
    throw new LiveTestConfigurationError(
      "Azure STT fixture must contain between 1 byte and 5 MB"
    );
  }
  return { data, mimeType: "audio/wav" };
}

function validatePcmWav(
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

function requestOptions(
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

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new LiveTestConfigurationError(`${label} is required`);
  }
  return value;
}
