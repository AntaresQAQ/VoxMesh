import {
  AlibabaModelStudioConfigurationError,
  AlibabaModelStudioSpeechToTextProvider,
  AlibabaModelStudioTextToSpeechProvider,
  AzureOpenAiSpeechToTextProvider,
  AzureOpenAiTextToSpeechProvider,
  MockSpeechToTextProvider,
  MockTextToSpeechProvider,
  OpenAiCompatibleSpeechToTextProvider,
  OpenAiCompatibleTextToSpeechProvider,
  validateAlibabaModelStudioSttConfiguration,
  validateAlibabaModelStudioTtsConfiguration,
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
  asBadRequest(() =>
    validateAlibabaModelStudioSttConfiguration({
      endpoint: config.sttEndpoint,
      apiKeyConfigured: Boolean(config.sttApiKey),
      model: config.sttDeployment
    })
  );
}

function validateAlibabaTts(config: StoredSpeechConfiguration): void {
  asBadRequest(() =>
    validateAlibabaModelStudioTtsConfiguration({
      endpoint: config.ttsEndpoint,
      apiKeyConfigured: Boolean(config.ttsApiKey),
      model: config.ttsDeployment,
      voice: config.ttsVoice
    })
  );
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

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function asBadRequest(validate: () => void): void {
  try {
    validate();
  } catch (error) {
    if (error instanceof AlibabaModelStudioConfigurationError) {
      throw badRequest(error.message);
    }
    throw error;
  }
}
