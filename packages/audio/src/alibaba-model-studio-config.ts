interface AlibabaConnectionConfiguration {
  endpoint: string;
  apiKeyConfigured: boolean;
  model: string;
}

/** Fields required to validate a dedicated Alibaba STT connection. */
export type AlibabaSttConfiguration = AlibabaConnectionConfiguration;

/** Fields required to validate an Alibaba TTS model and voice pair. */
export interface AlibabaTtsConfiguration extends AlibabaConnectionConfiguration {
  voice: string;
}

/** Identifies configuration errors before credentials can reach a socket. */
export class AlibabaModelStudioConfigurationError extends Error {
  public override readonly name = "AlibabaModelStudioConfigurationError";
}

/** Validates Alibaba STT configuration without opening a network connection. */
export function validateAlibabaModelStudioSttConfiguration(
  config: AlibabaSttConfiguration
): void {
  validateAlibabaConnection(config, "Alibaba Model Studio STT");
  if (
    !/^fun-asr-(?:flash-8k-)?realtime(?:-|$)/u.test(config.model) &&
    !/^qwen-audio-3\.0-asr-flash-streaming(?:-|$)/u.test(config.model)
  ) {
    throw configurationError(
      "Alibaba Model Studio STT requires a realtime Fun-ASR or Qwen Audio streaming model"
    );
  }
}

/** Validates Alibaba TTS configuration without opening a network connection. */
export function validateAlibabaModelStudioTtsConfiguration(
  config: AlibabaTtsConfiguration
): void {
  validateAlibabaConnection(config, "Alibaba Model Studio TTS");
  if (!config.voice) {
    throw configurationError("Alibaba Model Studio TTS requires a voice");
  }
  if (
    config.model === "qwen-audio-3.0-tts-plus" &&
    QWEN_AUDIO_FLASH_SYSTEM_VOICES.has(config.voice)
  ) {
    throw configurationError(
      "qwen-audio-3.0-tts-plus does not support this Flash voice; use longanlingxin, longanlufeng, or a Plus-compatible cloned voice"
    );
  }
  if (
    config.model === "qwen-audio-3.0-tts-flash" &&
    QWEN_AUDIO_PLUS_SYSTEM_VOICES.has(config.voice)
  ) {
    throw configurationError(
      "qwen-audio-3.0-tts-flash does not support this Plus voice; select a Flash-compatible voice"
    );
  }
}

/** Validates the Alibaba OpenAI-compatible base URL without using credentials. */
export function validateAlibabaModelStudioCompatibleEndpoint(
  endpointValue: string
): void {
  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw configurationError(
      "Alibaba Model Studio compatible endpoint must be valid"
    );
  }
  if (endpoint.protocol !== "https:") {
    throw configurationError(
      "Alibaba Model Studio compatible endpoint must use HTTPS"
    );
  }
  if (endpoint.username || endpoint.password) {
    throw configurationError(
      "Alibaba Model Studio compatible endpoint must not contain embedded credentials"
    );
  }
  if (endpoint.pathname.replace(/\/+$/u, "") !== "/compatible-mode/v1") {
    throw configurationError(
      "Alibaba Model Studio compatible endpoint path must be /compatible-mode/v1"
    );
  }
  if (!isAlibabaModelStudioHost(endpoint.hostname)) {
    throw configurationError(
      "Alibaba Model Studio compatible endpoint must use an Alibaba Cloud host"
    );
  }
}

function validateAlibabaConnection(
  config: AlibabaConnectionConfiguration,
  label: string
): void {
  if (!config.endpoint || !config.apiKeyConfigured || !config.model) {
    throw configurationError(
      `${label} requires a WebSocket endpoint, API key, and model`
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw configurationError(`${label} WebSocket endpoint must be valid`);
  }
  if (endpoint.protocol !== "wss:") {
    throw configurationError(`${label} endpoint must use WSS`);
  }
  if (endpoint.username || endpoint.password) {
    throw configurationError(
      `${label} endpoint must not contain embedded credentials`
    );
  }
  if (endpoint.pathname !== "/api-ws/v1/inference") {
    throw configurationError(
      `${label} endpoint path must be /api-ws/v1/inference`
    );
  }
  if (!isAlibabaModelStudioHost(endpoint.hostname)) {
    throw configurationError(
      `${label} endpoint must use an Alibaba Cloud host`
    );
  }
}

/** Returns whether a hostname is an approved Alibaba Model Studio API host. */
export function isAlibabaModelStudioHost(hostname: string): boolean {
  return (
    hostname === "dashscope.aliyuncs.com" ||
    hostname === "dashscope-intl.aliyuncs.com" ||
    hostname.endsWith(".cn-beijing.maas.aliyuncs.com") ||
    hostname.endsWith(".ap-southeast-1.maas.aliyuncs.com")
  );
}

function configurationError(
  message: string
): AlibabaModelStudioConfigurationError {
  return new AlibabaModelStudioConfigurationError(message);
}

const QWEN_AUDIO_PLUS_SYSTEM_VOICES = new Set([
  "longanlingxin",
  "longanlufeng"
]);
const QWEN_AUDIO_FLASH_SYSTEM_VOICES = new Set([
  "longanfengyue",
  "longanyuanfei",
  "longanlingxi",
  "longanxiaoxin",
  "longanhuan_v3.6",
  "longjielidou_v3.6",
  "longpaopao_v3.6",
  "longhuohuo_v3.6",
  "longchuanshu_v3.6",
  "loongmary",
  "loongeva_v3.6",
  "loongjohn"
]);
