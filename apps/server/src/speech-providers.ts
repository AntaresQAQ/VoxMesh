import {
  AlibabaModelStudioSpeechToTextProvider,
  AlibabaModelStudioTextToSpeechProvider,
  AzureOpenAiSpeechToTextProvider,
  AzureOpenAiTextToSpeechProvider,
  MockSpeechToTextProvider,
  MockTextToSpeechProvider,
  OpenAiCompatibleSpeechToTextProvider,
  OpenAiCompatibleTextToSpeechProvider,
  type SpeechToTextProvider,
  type TextToSpeechProvider
} from "@voxmesh/audio";
import { ProviderRegistry } from "@voxmesh/shared";
import type { StoredSpeechConfiguration } from "@voxmesh/storage";

const sttRegistry = new ProviderRegistry<
  StoredSpeechConfiguration,
  SpeechToTextProvider
>((config) => config.sttMode)
  .register({
    id: "mock",
    displayName: "Mock",
    capabilities: ["stt"],
    validate: () => undefined,
    create: () => new MockSpeechToTextProvider()
  })
  .register({
    id: "azure-openai",
    displayName: "Azure OpenAI",
    capabilities: ["stt"],
    validate: validateAzureStt,
    create: (config) =>
      new AzureOpenAiSpeechToTextProvider({
        endpoint: config.sttEndpoint,
        deployment: config.sttDeployment,
        apiVersion: config.sttApiVersion,
        apiKey: config.sttApiKey ?? "",
        language: config.sttLanguage
      })
  })
  .register({
    id: "openai-compatible",
    displayName: "OpenAI-compatible",
    capabilities: ["stt"],
    validate: validateCompatibleStt,
    create: (config) =>
      new OpenAiCompatibleSpeechToTextProvider({
        baseUrl: config.sttEndpoint,
        model: config.sttDeployment,
        apiKey: config.sttApiKey ?? "",
        language: config.sttLanguage
      })
  })
  .register({
    id: "alibaba-model-studio",
    displayName: "Alibaba Cloud Model Studio",
    capabilities: ["stt"],
    validate: validateAlibabaStt,
    create: (config) =>
      new AlibabaModelStudioSpeechToTextProvider({
        endpoint: config.sttEndpoint,
        model: config.sttDeployment,
        apiKey: config.sttApiKey ?? "",
        language: config.sttLanguage
      })
  });

const ttsRegistry = new ProviderRegistry<
  StoredSpeechConfiguration,
  TextToSpeechProvider
>((config) => config.ttsMode)
  .register({
    id: "mock",
    displayName: "Mock",
    capabilities: ["tts"],
    validate: () => undefined,
    create: () => new MockTextToSpeechProvider()
  })
  .register({
    id: "azure-openai",
    displayName: "Azure OpenAI",
    capabilities: ["tts"],
    validate: validateAzureTts,
    create: (config) =>
      new AzureOpenAiTextToSpeechProvider({
        endpoint: config.ttsEndpoint,
        deployment: config.ttsDeployment,
        apiVersion: config.ttsApiVersion,
        apiKey: config.ttsApiKey ?? "",
        voice: config.ttsVoice,
        instructions: config.ttsInstructions
      })
  })
  .register({
    id: "openai-compatible",
    displayName: "OpenAI-compatible",
    capabilities: ["tts"],
    validate: validateCompatibleTts,
    create: (config) =>
      new OpenAiCompatibleTextToSpeechProvider({
        baseUrl: config.ttsEndpoint,
        model: config.ttsDeployment,
        apiKey: config.ttsApiKey ?? "",
        voice: config.ttsVoice,
        instructions: config.ttsInstructions
      })
  })
  .register({
    id: "alibaba-model-studio",
    displayName: "Alibaba Cloud Model Studio",
    capabilities: ["tts"],
    validate: validateAlibabaTts,
    create: (config) =>
      new AlibabaModelStudioTextToSpeechProvider({
        endpoint: config.ttsEndpoint,
        model: config.ttsDeployment,
        apiKey: config.ttsApiKey ?? "",
        voice: config.ttsVoice,
        instructions: config.ttsInstructions
      })
  });

export function createSpeechToTextProvider(
  config: StoredSpeechConfiguration
): SpeechToTextProvider {
  return sttRegistry.create(config);
}

export function createTextToSpeechProvider(
  config: StoredSpeechConfiguration
): TextToSpeechProvider {
  return ttsRegistry.create(config);
}

/** Tests both selected speech providers with actual synthesized speech. */
export async function testSpeechProviders(
  config: StoredSpeechConfiguration,
  providers: {
    stt: SpeechToTextProvider;
    tts: TextToSpeechProvider;
  } = {
    stt: createSpeechToTextProvider(config),
    tts: createTextToSpeechProvider(config)
  }
) {
  const sampleText =
    config.sttLanguage === "zh"
      ? "语音连接测试成功。"
      : "Speech connection test succeeded.";
  const audio = await providers.tts.synthesize(sampleText);
  const transcript = await providers.stt.transcribe(audio);
  return {
    success: true,
    transcript: transcript.text,
    audioMimeType: audio.mimeType
  };
}

export function validateSpeechConfiguration(
  config: StoredSpeechConfiguration
): void {
  sttRegistry.create(config);
  ttsRegistry.create(config);
}

export function publicSpeechConfiguration(config: StoredSpeechConfiguration) {
  return {
    sttMode: config.sttMode,
    ttsMode: config.ttsMode,
    sttEndpoint: config.sttEndpoint,
    sttDeployment: config.sttDeployment,
    sttApiVersion: config.sttApiVersion,
    sttLanguage: config.sttLanguage,
    sttApiKeyConfigured: config.sttApiKey !== null,
    ttsEndpoint: config.ttsEndpoint,
    ttsDeployment: config.ttsDeployment,
    ttsApiVersion: config.ttsApiVersion,
    ttsVoice: config.ttsVoice,
    ttsInstructions: config.ttsInstructions,
    ttsApiKeyConfigured: config.ttsApiKey !== null
  };
}

export function speechProviderDescriptors() {
  return [...sttRegistry.descriptors(), ...ttsRegistry.descriptors()];
}

function validateAzureStt(config: StoredSpeechConfiguration): void {
  validateAzureConnection(
    config.sttEndpoint,
    config.sttApiKey,
    "Azure OpenAI STT"
  );
  if (!config.sttDeployment || !config.sttApiVersion || !config.sttLanguage) {
    throw badRequest(
      "Azure OpenAI STT requires deployment, API version, and language"
    );
  }
}

function validateAzureTts(config: StoredSpeechConfiguration): void {
  validateAzureConnection(
    config.ttsEndpoint,
    config.ttsApiKey,
    "Azure OpenAI TTS"
  );
  if (!config.ttsDeployment || !config.ttsApiVersion || !config.ttsVoice) {
    throw badRequest(
      "Azure OpenAI TTS requires deployment, API version, and voice"
    );
  }
}

function validateCompatibleStt(config: StoredSpeechConfiguration): void {
  validateCompatibleConnection(
    config.sttEndpoint,
    config.sttApiKey,
    config.sttDeployment,
    "OpenAI-compatible STT"
  );
}

function validateCompatibleTts(config: StoredSpeechConfiguration): void {
  validateCompatibleConnection(
    config.ttsEndpoint,
    config.ttsApiKey,
    config.ttsDeployment,
    "OpenAI-compatible TTS"
  );
  if (!config.ttsVoice) {
    throw badRequest("OpenAI-compatible TTS requires a voice");
  }
}

function validateAlibabaStt(config: StoredSpeechConfiguration): void {
  validateAlibabaConnection(
    config.sttEndpoint,
    config.sttApiKey,
    config.sttDeployment,
    "Alibaba Model Studio STT"
  );
  if (
    !/^fun-asr-(?:flash-8k-)?realtime(?:-|$)/u.test(config.sttDeployment) &&
    !/^qwen-audio-3\.0-asr-flash-streaming(?:-|$)/u.test(config.sttDeployment)
  ) {
    throw badRequest(
      "Alibaba Model Studio STT requires a realtime Fun-ASR or Qwen Audio streaming model"
    );
  }
}

function validateAlibabaTts(config: StoredSpeechConfiguration): void {
  validateAlibabaConnection(
    config.ttsEndpoint,
    config.ttsApiKey,
    config.ttsDeployment,
    "Alibaba Model Studio TTS"
  );
  if (!config.ttsVoice) {
    throw badRequest("Alibaba Model Studio TTS requires a voice");
  }
}

function validateAzureConnection(
  endpointValue: string,
  apiKey: string | null,
  label: string
): void {
  if (!endpointValue || !apiKey) {
    throw badRequest(`${label} requires an endpoint and API key`);
  }
  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw badRequest(`${label} endpoint must be a valid URL`);
  }
  if (endpoint.protocol !== "https:") {
    throw badRequest(`${label} endpoint must use HTTPS`);
  }
}

function validateCompatibleConnection(
  baseUrlValue: string,
  apiKey: string | null,
  model: string,
  label: string
): void {
  if (!baseUrlValue || !apiKey || !model) {
    throw badRequest(`${label} requires a base URL, API key, and model`);
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    throw badRequest(`${label} base URL must be valid`);
  }
  if (baseUrl.protocol !== "https:") {
    throw badRequest(`${label} base URL must use HTTPS`);
  }
}

function validateAlibabaConnection(
  endpointValue: string,
  apiKey: string | null,
  model: string,
  label: string
): void {
  if (!endpointValue || !apiKey || !model) {
    throw badRequest(
      `${label} requires a WebSocket endpoint, API key, and model`
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw badRequest(`${label} WebSocket endpoint must be valid`);
  }
  if (endpoint.protocol !== "wss:") {
    throw badRequest(`${label} endpoint must use WSS`);
  }
  if (endpoint.pathname !== "/api-ws/v1/inference") {
    throw badRequest(`${label} endpoint path must be /api-ws/v1/inference`);
  }
  const supportedHost =
    endpoint.hostname === "dashscope.aliyuncs.com" ||
    endpoint.hostname === "dashscope-intl.aliyuncs.com" ||
    endpoint.hostname.endsWith(".cn-beijing.maas.aliyuncs.com") ||
    endpoint.hostname.endsWith(".ap-southeast-1.maas.aliyuncs.com");
  if (!supportedHost) {
    throw badRequest(`${label} endpoint must use an Alibaba Cloud host`);
  }
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}
