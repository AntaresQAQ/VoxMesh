import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

import type {
  LlmMode,
  ModelCapability,
  ModelDeploymentSummary,
  ProviderConnectionSummary,
  RuntimeRouteSummary,
  RuntimeRoutingSummary,
  SpeechProviderMode,
  VoicePipelineMode
} from "@voxmesh/shared";

interface LlmRoutingConfiguration {
  mode: LlmMode;
  endpoint: string;
  deployment: string;
  apiVersion: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  apiKey: string | null;
}

interface SpeechRoutingConfiguration {
  sttMode: SpeechProviderMode;
  ttsMode: SpeechProviderMode;
  sttEndpoint: string;
  sttDeployment: string;
  sttApiVersion: string;
  sttLanguage: string;
  sttApiKey: string | null;
  ttsEndpoint: string;
  ttsDeployment: string;
  ttsApiVersion: string;
  ttsVoice: string;
  ttsInstructions: string;
  ttsApiKey: string | null;
}

interface VoiceRoutingConfiguration {
  mode: VoicePipelineMode;
  nativeProviderId: string;
}

interface ProviderConnectionRow {
  id: string;
  provider_id: string;
  display_name: string;
  endpoint: string;
  api_key: string | null;
}

interface ModelDeploymentRow {
  id: string;
  connection_id: string;
  display_name: string;
  model_name: string;
  api_version: string;
  declared_capabilities: string;
  verified_capabilities: string;
  provider_options: string;
  configuration_fingerprint: string;
}

interface RuntimeRouteRow {
  id: string;
  display_name: string;
  mode: VoicePipelineMode;
  stt_model_deployment_id: string | null;
  chat_model_deployment_id: string | null;
  tts_model_deployment_id: string | null;
  native_model_deployment_id: string | null;
  fallback_route_id: string | null;
}

interface ActiveRuntimeRouteRow {
  active_route_id: string;
}

/** Owns system-managed provider, model, and route persistence. */
export class RuntimeRoutingStore {
  public constructor(private readonly database: Database.Database) {}

  public sync(input: {
    llm: LlmRoutingConfiguration;
    speech: SpeechRoutingConfiguration;
    voice: VoiceRoutingConfiguration;
  }): void {
    const { llm, speech, voice } = input;
    this.database.transaction(() => {
      this.upsertConnection({
        id: LLM_CONNECTION_ID,
        providerId: llm.mode,
        displayName: `Chat · ${providerDisplayName(llm.mode)}`,
        endpoint:
          llm.mode === "azure-openai"
            ? llm.endpoint
            : llm.mode === "openai-compatible"
              ? llm.baseUrl
              : "",
        apiKey: llm.apiKey
      });
      this.upsertConnection({
        id: STT_CONNECTION_ID,
        providerId: speech.sttMode,
        displayName: `STT · ${providerDisplayName(speech.sttMode)}`,
        endpoint: speech.sttEndpoint,
        apiKey: speech.sttApiKey
      });
      this.upsertConnection({
        id: TTS_CONNECTION_ID,
        providerId: speech.ttsMode,
        displayName: `TTS · ${providerDisplayName(speech.ttsMode)}`,
        endpoint: speech.ttsEndpoint,
        apiKey: speech.ttsApiKey
      });
      this.upsertConnection({
        id: NATIVE_CONNECTION_ID,
        providerId: voice.nativeProviderId,
        displayName: `Native · ${providerDisplayName(voice.nativeProviderId)}`,
        endpoint: "",
        apiKey: null
      });

      this.upsertModel({
        id: LLM_MODEL_ID,
        connectionId: LLM_CONNECTION_ID,
        displayName: `Chat · ${llmModelName(llm)}`,
        modelName: llmModelName(llm),
        apiVersion: llm.apiVersion,
        declaredCapabilities: ["text-input", "text-output", "tool-calling"],
        providerOptions: {
          timeoutMs: llm.timeoutMs,
          maxOutputTokens: llm.maxOutputTokens
        },
        verifiedByDefault: llm.mode === "mock",
        fingerprintValues: [llm]
      });
      this.upsertModel({
        id: STT_MODEL_ID,
        connectionId: STT_CONNECTION_ID,
        displayName: `STT · ${speechModelName(
          speech.sttMode,
          speech.sttDeployment,
          "Mock STT"
        )}`,
        modelName: speechModelName(
          speech.sttMode,
          speech.sttDeployment,
          "Mock STT"
        ),
        apiVersion: speech.sttApiVersion,
        declaredCapabilities: ["audio-input", "text-output", "transcription"],
        providerOptions: { language: speech.sttLanguage },
        verifiedByDefault: speech.sttMode === "mock",
        fingerprintValues: [
          speech.sttMode,
          speech.sttEndpoint,
          speech.sttDeployment,
          speech.sttApiVersion,
          speech.sttLanguage,
          speech.sttApiKey
        ]
      });
      this.upsertModel({
        id: TTS_MODEL_ID,
        connectionId: TTS_CONNECTION_ID,
        displayName: `TTS · ${speechModelName(
          speech.ttsMode,
          speech.ttsDeployment,
          "Mock TTS"
        )}`,
        modelName: speechModelName(
          speech.ttsMode,
          speech.ttsDeployment,
          "Mock TTS"
        ),
        apiVersion: speech.ttsApiVersion,
        declaredCapabilities: [
          "text-input",
          "audio-output",
          "speech-synthesis"
        ],
        providerOptions: {
          voice: speech.ttsVoice,
          instructions: speech.ttsInstructions
        },
        verifiedByDefault: speech.ttsMode === "mock",
        fingerprintValues: [
          speech.ttsMode,
          speech.ttsEndpoint,
          speech.ttsDeployment,
          speech.ttsApiVersion,
          speech.ttsVoice,
          speech.ttsInstructions,
          speech.ttsApiKey
        ]
      });
      this.upsertModel({
        id: NATIVE_MODEL_ID,
        connectionId: NATIVE_CONNECTION_ID,
        displayName: `Native · ${voice.nativeProviderId}`,
        modelName: voice.nativeProviderId,
        apiVersion: "",
        declaredCapabilities: [
          "audio-input",
          "audio-output",
          "text-output",
          "tool-calling",
          "native-multimodal"
        ],
        providerOptions: {},
        verifiedByDefault: voice.nativeProviderId === "mock-native",
        fingerprintValues: [voice.nativeProviderId]
      });

      this.upsertRoute({
        id: COMPOSED_ROUTE_ID,
        displayName: "Default Composed Voice",
        mode: "composed",
        sttModelDeploymentId: STT_MODEL_ID,
        chatModelDeploymentId: LLM_MODEL_ID,
        ttsModelDeploymentId: TTS_MODEL_ID,
        nativeModelDeploymentId: null,
        fallbackRouteId: null
      });
      this.upsertRoute({
        id: NATIVE_ROUTE_ID,
        displayName: "Default Native Voice",
        mode: "native-multimodal",
        sttModelDeploymentId: null,
        chatModelDeploymentId: null,
        ttsModelDeploymentId: null,
        nativeModelDeploymentId: NATIVE_MODEL_ID,
        fallbackRouteId: null
      });
      this.database
        .prepare(
          `INSERT INTO active_runtime_route (id, active_route_id, updated_at)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             active_route_id = excluded.active_route_id,
             updated_at = excluded.updated_at`
        )
        .run(
          voice.mode === "native-multimodal"
            ? NATIVE_ROUTE_ID
            : COMPOSED_ROUTE_ID,
          new Date().toISOString()
        );
    })();
  }

  public getSummary(): RuntimeRoutingSummary {
    const connections = this.database
      .prepare(
        "SELECT id, provider_id, display_name, endpoint, api_key FROM provider_connections ORDER BY display_name, id"
      )
      .all() as ProviderConnectionRow[];
    const models = this.database
      .prepare(
        `SELECT id, connection_id, display_name, model_name, api_version,
                declared_capabilities, verified_capabilities, provider_options,
                configuration_fingerprint
         FROM model_deployments
         ORDER BY display_name, id`
      )
      .all() as ModelDeploymentRow[];
    const routes = this.database
      .prepare(
        `SELECT id, display_name, mode, stt_model_deployment_id,
                chat_model_deployment_id, tts_model_deployment_id,
                native_model_deployment_id, fallback_route_id
         FROM runtime_routes
         ORDER BY display_name, id`
      )
      .all() as RuntimeRouteRow[];
    const active = this.database
      .prepare("SELECT active_route_id FROM active_runtime_route WHERE id = 1")
      .get() as ActiveRuntimeRouteRow | undefined;
    if (!active) {
      throw new Error("Active runtime route is not configured");
    }
    return {
      connections: connections.map(mapProviderConnection),
      models: models.map(mapModelDeployment),
      routes: routes.map(mapRuntimeRoute),
      activeRouteId: active.active_route_id
    };
  }

  public resolveLlm<T extends LlmRoutingConfiguration>(configuration: T): T {
    this.requireRouteAssignment(COMPOSED_ROUTE_ID, "chat");
    return configuration;
  }

  public resolveSpeech<T extends SpeechRoutingConfiguration>(
    configuration: T
  ): T {
    this.requireRouteAssignment(COMPOSED_ROUTE_ID, "stt");
    this.requireRouteAssignment(COMPOSED_ROUTE_ID, "tts");
    return configuration;
  }

  public resolveVoice(
    configuration: VoiceRoutingConfiguration
  ): VoiceRoutingConfiguration {
    const route = this.getActiveRuntimeRoute();
    if (route.mode === "composed") {
      return {
        mode: "composed",
        nativeProviderId: configuration.nativeProviderId
      };
    }
    const modelId = route.native_model_deployment_id;
    if (!modelId) {
      throw new Error("Native runtime route requires a model deployment");
    }
    const provider = this.database
      .prepare(
        `SELECT c.provider_id
         FROM model_deployments m
         JOIN provider_connections c ON c.id = m.connection_id
         WHERE m.id = ?`
      )
      .get(modelId) as { provider_id: string } | undefined;
    if (!provider) {
      throw new Error("Native runtime model deployment was not found");
    }
    return {
      mode: "native-multimodal",
      nativeProviderId: provider.provider_id
    };
  }

  public markRoleVerified(role: "chat" | "stt" | "tts" | "native"): void {
    const modelId =
      role === "chat"
        ? LLM_MODEL_ID
        : role === "stt"
          ? STT_MODEL_ID
          : role === "tts"
            ? TTS_MODEL_ID
            : NATIVE_MODEL_ID;
    const row = this.database
      .prepare(
        "SELECT declared_capabilities FROM model_deployments WHERE id = ?"
      )
      .get(modelId) as { declared_capabilities: string } | undefined;
    if (!row) {
      throw new Error(`Runtime model deployment was not found: ${modelId}`);
    }
    this.markCapabilitiesVerified(
      modelId,
      parseCapabilities(row.declared_capabilities)
    );
  }

  private markCapabilitiesVerified(
    modelDeploymentId: string,
    capabilities: ModelCapability[]
  ): void {
    const row = this.database
      .prepare(
        "SELECT declared_capabilities FROM model_deployments WHERE id = ?"
      )
      .get(modelDeploymentId) as { declared_capabilities: string } | undefined;
    if (!row) {
      throw new Error(`Unknown model deployment: ${modelDeploymentId}`);
    }
    const declared = parseCapabilities(row.declared_capabilities);
    const verified = capabilities.filter((capability) =>
      declared.includes(capability)
    );
    this.database
      .prepare(
        "UPDATE model_deployments SET verified_capabilities = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        JSON.stringify([...new Set(verified)]),
        new Date().toISOString(),
        modelDeploymentId
      );
  }

  private upsertConnection(input: {
    id: string;
    providerId: string;
    displayName: string;
    endpoint: string;
    apiKey: string | null;
  }): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO provider_connections (
           id, provider_id, display_name, endpoint, api_key, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider_id = excluded.provider_id,
           display_name = excluded.display_name,
           endpoint = excluded.endpoint,
           api_key = excluded.api_key,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.providerId,
        input.displayName,
        input.endpoint,
        input.apiKey,
        now,
        now
      );
  }

  private upsertModel(input: {
    id: string;
    connectionId: string;
    displayName: string;
    modelName: string;
    apiVersion: string;
    declaredCapabilities: ModelCapability[];
    providerOptions: Record<string, string | number>;
    verifiedByDefault: boolean;
    fingerprintValues: unknown[];
  }): void {
    const fingerprint = configurationFingerprint(input.fingerprintValues);
    const current = this.database
      .prepare(
        "SELECT verified_capabilities, configuration_fingerprint FROM model_deployments WHERE id = ?"
      )
      .get(input.id) as
      | Pick<
          ModelDeploymentRow,
          "verified_capabilities" | "configuration_fingerprint"
        >
      | undefined;
    const verified = input.verifiedByDefault
      ? input.declaredCapabilities
      : current?.configuration_fingerprint === fingerprint
        ? parseCapabilities(current.verified_capabilities)
        : [];
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO model_deployments (
           id, connection_id, display_name, model_name, api_version,
           declared_capabilities, verified_capabilities, provider_options,
           configuration_fingerprint, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           connection_id = excluded.connection_id,
           display_name = excluded.display_name,
           model_name = excluded.model_name,
           api_version = excluded.api_version,
           declared_capabilities = excluded.declared_capabilities,
           verified_capabilities = excluded.verified_capabilities,
           provider_options = excluded.provider_options,
           configuration_fingerprint = excluded.configuration_fingerprint,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.connectionId,
        input.displayName,
        input.modelName,
        input.apiVersion,
        JSON.stringify(input.declaredCapabilities),
        JSON.stringify(verified),
        JSON.stringify(input.providerOptions),
        fingerprint,
        now,
        now
      );
  }

  private upsertRoute(input: RuntimeRouteSummary): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO runtime_routes (
           id, display_name, mode, stt_model_deployment_id,
           chat_model_deployment_id, tts_model_deployment_id,
           native_model_deployment_id, fallback_route_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           mode = excluded.mode,
           stt_model_deployment_id = excluded.stt_model_deployment_id,
           chat_model_deployment_id = excluded.chat_model_deployment_id,
           tts_model_deployment_id = excluded.tts_model_deployment_id,
           native_model_deployment_id = excluded.native_model_deployment_id,
           fallback_route_id = excluded.fallback_route_id,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.displayName,
        input.mode,
        input.sttModelDeploymentId,
        input.chatModelDeploymentId,
        input.ttsModelDeploymentId,
        input.nativeModelDeploymentId,
        input.fallbackRouteId,
        now,
        now
      );
  }

  private getActiveRuntimeRoute(): RuntimeRouteRow {
    const route = this.database
      .prepare(
        `SELECT r.id, r.display_name, r.mode, r.stt_model_deployment_id,
                r.chat_model_deployment_id, r.tts_model_deployment_id,
                r.native_model_deployment_id, r.fallback_route_id
         FROM active_runtime_route a
         JOIN runtime_routes r ON r.id = a.active_route_id
         WHERE a.id = 1`
      )
      .get() as RuntimeRouteRow | undefined;
    if (!route) {
      throw new Error("Active runtime route was not found");
    }
    return route;
  }

  private requireRouteAssignment(
    routeId: string,
    role: "stt" | "chat" | "tts"
  ): string {
    const route = this.database
      .prepare(
        `SELECT id, display_name, mode, stt_model_deployment_id,
                chat_model_deployment_id, tts_model_deployment_id,
                native_model_deployment_id, fallback_route_id
         FROM runtime_routes WHERE id = ?`
      )
      .get(routeId) as RuntimeRouteRow | undefined;
    const modelId =
      role === "stt"
        ? route?.stt_model_deployment_id
        : role === "chat"
          ? route?.chat_model_deployment_id
          : route?.tts_model_deployment_id;
    if (!modelId) {
      throw new Error(`Runtime route ${routeId} requires a ${role} model`);
    }
    const model = this.database
      .prepare("SELECT id FROM model_deployments WHERE id = ?")
      .get(modelId);
    if (!model) {
      throw new Error(`Runtime model deployment was not found: ${modelId}`);
    }
    return modelId;
  }
}

function mapProviderConnection(
  row: ProviderConnectionRow
): ProviderConnectionSummary {
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    endpoint: row.endpoint,
    apiKeyConfigured: row.api_key !== null
  };
}

function mapModelDeployment(row: ModelDeploymentRow): ModelDeploymentSummary {
  return {
    id: row.id,
    connectionId: row.connection_id,
    displayName: row.display_name,
    modelName: row.model_name,
    apiVersion: row.api_version,
    declaredCapabilities: parseCapabilities(row.declared_capabilities),
    verifiedCapabilities: parseCapabilities(row.verified_capabilities)
  };
}

function mapRuntimeRoute(row: RuntimeRouteRow): RuntimeRouteSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    mode: row.mode,
    sttModelDeploymentId: row.stt_model_deployment_id,
    chatModelDeploymentId: row.chat_model_deployment_id,
    ttsModelDeploymentId: row.tts_model_deployment_id,
    nativeModelDeploymentId: row.native_model_deployment_id,
    fallbackRouteId: row.fallback_route_id
  };
}

function parseCapabilities(value: string): ModelCapability[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isModelCapability)) {
    throw new Error("Stored model capabilities are invalid");
  }
  return parsed;
}

function isModelCapability(value: unknown): value is ModelCapability {
  return (
    value === "text-input" ||
    value === "text-output" ||
    value === "audio-input" ||
    value === "audio-output" ||
    value === "transcription" ||
    value === "speech-synthesis" ||
    value === "tool-calling" ||
    value === "native-multimodal"
  );
}

function configurationFingerprint(values: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function providerDisplayName(providerId: string): string {
  switch (providerId) {
    case "mock":
      return "Mock";
    case "mock-native":
      return "Mock Native Multimodal";
    case "azure-openai":
      return "Azure OpenAI";
    case "openai-compatible":
      return "OpenAI-compatible";
    case "alibaba-model-studio":
      return "Alibaba Cloud Model Studio";
    default:
      return providerId;
  }
}

function llmModelName(config: LlmRoutingConfiguration): string {
  if (config.mode === "mock") return "Mock Chat";
  return config.mode === "azure-openai" ? config.deployment : config.model;
}

function speechModelName(
  mode: SpeechProviderMode,
  configuredName: string,
  mockName: string
): string {
  return mode === "mock" ? mockName : configuredName;
}

const LLM_CONNECTION_ID = "system-connection-chat";
const STT_CONNECTION_ID = "system-connection-stt";
const TTS_CONNECTION_ID = "system-connection-tts";
const NATIVE_CONNECTION_ID = "system-connection-native";
const LLM_MODEL_ID = "system-model-chat";
const STT_MODEL_ID = "system-model-stt";
const TTS_MODEL_ID = "system-model-tts";
const NATIVE_MODEL_ID = "system-model-native";
const COMPOSED_ROUTE_ID = "system-route-composed";
const NATIVE_ROUTE_ID = "system-route-native";
