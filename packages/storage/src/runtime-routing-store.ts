import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type {
  LlmMode,
  ModelCapability,
  ModelDeploymentInput,
  ModelDeploymentSummary,
  ProviderConnectionInput,
  ProviderConnectionSummary,
  ProviderReadiness,
  ProviderReadinessErrorCategory,
  NormalizedRuntimeRouteInput,
  RuntimeRouteSummary,
  RuntimeRoutingSummary,
  SpeechProviderMode,
  StreamingRuntimeAvailability,
  VoicePipelineMode
} from "@voxmesh/shared";
import { providerReadinessErrorMessage } from "@voxmesh/shared";

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
  routeId?: string;
  fallbackRouteId?: string | null;
}

interface ProviderConnectionRow {
  id: string;
  provider_id: string;
  display_name: string;
  endpoint: string;
  api_key: string | null;
  enabled: number;
  readiness_state: string;
  readiness_last_tested_at: string | null;
  readiness_error_category: string | null;
  readiness_error_message: string | null;
  readiness_generation: number;
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
  enabled: number;
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
  stt_streaming_enabled: number;
  chat_streaming_enabled: number;
  tts_streaming_enabled: number;
  enabled: number;
  readiness_state: string;
  readiness_last_tested_at: string | null;
  readiness_error_category: string | null;
  readiness_error_message: string | null;
  readiness_generation: number;
}

interface ActiveRuntimeRouteRow {
  active_route_id: string;
}

type RuntimeRouteRole = "stt" | "chat" | "tts" | "native";

export interface RuntimeRouteVerificationSnapshot {
  routeId: string;
  routeSignature: string;
  assignments: Array<{
    role: RuntimeRouteRole;
    modelId: string;
    connectionId: string;
    verificationToken: string;
  }>;
}

export interface RuntimeRouteReadinessTest {
  routeId: string;
  generation: number;
  snapshot: RuntimeRouteVerificationSnapshot;
}

export interface RuntimeReadinessError {
  category: ProviderReadinessErrorCategory;
}

export interface RuntimeVoiceRouteAssignmentSnapshot {
  role: "stt" | "chat" | "tts";
  modelDeploymentId: string;
  modelDisplayName: string;
  providerId: string;
  providerDisplayName: string;
  configurationFingerprint: string;
  streamingEnabled: boolean;
}

export interface RuntimeVoiceRouteSnapshot {
  routeId: string;
  routeDisplayName: string;
  mode: "composed";
  configurationFingerprint: string;
  assignments: [
    RuntimeVoiceRouteAssignmentSnapshot,
    RuntimeVoiceRouteAssignmentSnapshot,
    RuntimeVoiceRouteAssignmentSnapshot
  ];
}

const unavailableStreamingRuntime: StreamingRuntimeAvailability = {
  transportAvailable: false,
  browserClientAvailable: false,
  sttProviderIds: [],
  chatProviderIds: [],
  ttsProviderIds: []
};

/** Owns system-managed provider, model, and route persistence. */
export class RuntimeRoutingStore {
  private readonly streamingAvailability: StreamingRuntimeAvailability;

  public constructor(
    private readonly database: Database.Database,
    streamingAvailability: StreamingRuntimeAvailability = unavailableStreamingRuntime
  ) {
    this.streamingAvailability = {
      ...streamingAvailability,
      sttProviderIds: [...new Set(streamingAvailability.sttProviderIds)],
      chatProviderIds: [...new Set(streamingAvailability.chatProviderIds)],
      ttsProviderIds: [...new Set(streamingAvailability.ttsProviderIds)]
    };
  }

  public initializeDefaults(): void {
    if (this.isInitialized()) return;
    if (this.hasSystemRecords()) {
      this.markInitialized();
      return;
    }
    this.sync({
      llm: {
        mode: "mock",
        endpoint: "",
        deployment: "",
        apiVersion: "",
        baseUrl: "",
        model: "Mock Chat",
        timeoutMs: 30_000,
        maxOutputTokens: 1_024,
        apiKey: null
      },
      speech: {
        sttMode: "mock",
        ttsMode: "mock",
        sttEndpoint: "",
        sttDeployment: "Mock STT",
        sttApiVersion: "",
        sttLanguage: "en",
        sttApiKey: null,
        ttsEndpoint: "",
        ttsDeployment: "Mock TTS",
        ttsApiVersion: "",
        ttsVoice: "mock",
        ttsInstructions: "",
        ttsApiKey: null
      },
      voice: { mode: "composed", nativeProviderId: "mock-native" }
    });
    this.markInitialized();
  }

  private sync(input: {
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
        apiKey: llm.apiKey,
        enabled: true
      });
      this.upsertConnection({
        id: STT_CONNECTION_ID,
        providerId: speech.sttMode,
        displayName: `STT · ${providerDisplayName(speech.sttMode)}`,
        endpoint: speech.sttEndpoint,
        apiKey: speech.sttApiKey,
        enabled: true
      });
      this.upsertConnection({
        id: TTS_CONNECTION_ID,
        providerId: speech.ttsMode,
        displayName: `TTS · ${providerDisplayName(speech.ttsMode)}`,
        endpoint: speech.ttsEndpoint,
        apiKey: speech.ttsApiKey,
        enabled: true
      });
      this.upsertConnection({
        id: NATIVE_CONNECTION_ID,
        providerId: voice.nativeProviderId,
        displayName: `Native · ${providerDisplayName(voice.nativeProviderId)}`,
        endpoint: "",
        apiKey: null,
        enabled: true
      });

      this.upsertModel({
        id: LLM_MODEL_ID,
        connectionId: LLM_CONNECTION_ID,
        displayName: `Chat · ${llmModelName(llm)}`,
        modelName: llmModelName(llm),
        apiVersion: llm.apiVersion,
        declaredCapabilities: [
          "text-input",
          "text-output",
          "tool-calling",
          "non-streaming"
        ],
        providerOptions: {
          timeoutMs: llm.timeoutMs,
          maxOutputTokens: llm.maxOutputTokens
        },
        verifiedByDefault: llm.mode === "mock",
        enabled: true,
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
        declaredCapabilities: [
          "audio-input",
          "text-output",
          "transcription",
          "non-streaming"
        ],
        providerOptions: { language: speech.sttLanguage },
        verifiedByDefault: speech.sttMode === "mock",
        enabled: true,
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
          "speech-synthesis",
          "non-streaming"
        ],
        providerOptions: {
          voice: speech.ttsVoice,
          instructions: speech.ttsInstructions
        },
        verifiedByDefault: speech.ttsMode === "mock",
        enabled: true,
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
          "native-multimodal",
          "non-streaming"
        ],
        providerOptions: {},
        verifiedByDefault: voice.nativeProviderId === "mock-native",
        enabled: true,
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
        fallbackRouteId: null,
        sttStreamingEnabled: false,
        chatStreamingEnabled: false,
        ttsStreamingEnabled: false,
        enabled: true
      });
      this.upsertRoute({
        id: NATIVE_ROUTE_ID,
        displayName: "Default Native Voice",
        mode: "native-multimodal",
        sttModelDeploymentId: null,
        chatModelDeploymentId: null,
        ttsModelDeploymentId: null,
        nativeModelDeploymentId: NATIVE_MODEL_ID,
        fallbackRouteId: null,
        sttStreamingEnabled: false,
        chatStreamingEnabled: false,
        ttsStreamingEnabled: false,
        enabled: true
      });
      const routeId =
        voice.mode === "native-multimodal"
          ? NATIVE_ROUTE_ID
          : COMPOSED_ROUTE_ID;
      this.database
        .prepare(
          "INSERT OR IGNORE INTO active_runtime_route (id, active_route_id, updated_at) VALUES (1, ?, ?)"
        )
        .run(routeId, new Date().toISOString());
    })();
  }

  private hasSystemRecords(): boolean {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM model_deployments WHERE id = ?")
      .get(LLM_MODEL_ID) as { count: number };
    return row.count === 1;
  }

  private isInitialized(): boolean {
    const row = this.database
      .prepare("SELECT initialized FROM runtime_routing_metadata WHERE id = 1")
      .get() as { initialized: number } | undefined;
    return row?.initialized === 1;
  }

  private markInitialized(): void {
    this.database
      .prepare(
        "INSERT OR REPLACE INTO runtime_routing_metadata (id, initialized) VALUES (1, 1)"
      )
      .run();
  }

  public getSummary(): RuntimeRoutingSummary {
    const connections = this.database
      .prepare(
        `SELECT id, provider_id, display_name, endpoint, api_key, enabled,
                readiness_state, readiness_last_tested_at,
                readiness_error_category, readiness_error_message,
                readiness_generation
         FROM provider_connections
         ORDER BY display_name, id`
      )
      .all() as ProviderConnectionRow[];
    const models = this.database
      .prepare(
        `SELECT id, connection_id, display_name, model_name, api_version,
                declared_capabilities, verified_capabilities, provider_options,
                configuration_fingerprint, enabled
         FROM model_deployments
         ORDER BY display_name, id`
      )
      .all() as ModelDeploymentRow[];
    const routes = this.database
      .prepare(
        `SELECT id, display_name, mode, stt_model_deployment_id,
                chat_model_deployment_id, tts_model_deployment_id,
                native_model_deployment_id, fallback_route_id,
                stt_streaming_enabled, chat_streaming_enabled,
                tts_streaming_enabled, enabled,
                readiness_state, readiness_last_tested_at,
                readiness_error_category, readiness_error_message,
                readiness_generation
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
      activeRouteId: active.active_route_id,
      streamingAvailability: {
        ...this.streamingAvailability,
        sttProviderIds: [...this.streamingAvailability.sttProviderIds],
        chatProviderIds: [...this.streamingAvailability.chatProviderIds],
        ttsProviderIds: [...this.streamingAvailability.ttsProviderIds]
      }
    };
  }

  public createConnection(
    input: ProviderConnectionInput
  ): RuntimeRoutingSummary {
    validateConnectionInput(input);
    this.upsertConnection({
      id: randomUUID(),
      providerId: input.providerId,
      displayName: input.displayName,
      endpoint: input.endpoint,
      apiKey: input.apiKey ?? null,
      enabled: input.enabled
    });
    return this.getSummary();
  }

  public updateConnection(
    id: string,
    input: ProviderConnectionInput
  ): RuntimeRoutingSummary {
    validateConnectionInput(input);
    const current = this.getConnection(id);
    const apiKey = input.clearApiKey ? null : (input.apiKey ?? current.api_key);
    const changed =
      current.provider_id !== input.providerId ||
      current.endpoint !== input.endpoint ||
      current.api_key !== apiKey ||
      current.enabled !== (input.enabled ? 1 : 0);
    if (changed && this.activeRouteUsesConnection(id)) {
      throw badRequest(
        "Connection is assigned to the active runtime route; activate another route before changing it"
      );
    }
    this.database.transaction(() => {
      this.upsertConnection({
        id,
        providerId: input.providerId,
        displayName: input.displayName,
        endpoint: input.endpoint,
        apiKey,
        enabled: input.enabled
      });
      if (changed) {
        this.resetConnectionVerification(id);
        this.invalidateConnectionReadiness(id);
      }
    })();
    return this.getSummary();
  }

  public deleteConnection(id: string): RuntimeRoutingSummary {
    const references = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM model_deployments WHERE connection_id = ?"
      )
      .get(id) as { count: number };
    if (references.count > 0) {
      throw badRequest("Connection is still referenced by model deployments");
    }
    const result = this.database
      .prepare("DELETE FROM provider_connections WHERE id = ?")
      .run(id);
    if (result.changes !== 1) throw notFound("Connection was not found");
    return this.getSummary();
  }

  public createModel(input: ModelDeploymentInput): RuntimeRoutingSummary {
    const connection = this.getConnection(input.connectionId);
    validateModelInput(input, connection);
    const id = randomUUID();
    this.upsertModel({
      id,
      connectionId: input.connectionId,
      displayName: input.displayName,
      modelName: input.modelName,
      apiVersion: input.apiVersion,
      declaredCapabilities: input.declaredCapabilities,
      providerOptions: input.providerOptions,
      verifiedByDefault: isMockProvider(connection.provider_id),
      enabled: input.enabled,
      fingerprintValues: modelFingerprintValues(connection, input)
    });
    return this.getSummary();
  }

  public updateModel(
    id: string,
    input: ModelDeploymentInput
  ): RuntimeRoutingSummary {
    const connection = this.getConnection(input.connectionId);
    validateModelInput(input, connection);
    const current = this.getModel(id);
    const runtimeChanged =
      modelRuntimeSignature(current) !== modelRuntimeSignatureFromInput(input);
    if (runtimeChanged && this.activeRouteUsesModel(id)) {
      throw badRequest(
        "Model deployment is assigned to the active runtime route; activate another route before changing it"
      );
    }
    this.database.transaction(() => {
      this.upsertModel({
        id,
        connectionId: input.connectionId,
        displayName: input.displayName,
        modelName: input.modelName,
        apiVersion: input.apiVersion,
        declaredCapabilities: input.declaredCapabilities,
        providerOptions: input.providerOptions,
        verifiedByDefault: isMockProvider(connection.provider_id),
        enabled: input.enabled,
        fingerprintValues: modelFingerprintValues(connection, input),
        preserveVerification: !runtimeChanged
      });
      if (runtimeChanged) {
        this.invalidateModelReadiness(id, [
          current.connection_id,
          input.connectionId
        ]);
      }
    })();
    return this.getSummary();
  }

  public deleteModel(id: string): RuntimeRoutingSummary {
    const references = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM runtime_routes
         WHERE stt_model_deployment_id = ? OR chat_model_deployment_id = ?
            OR tts_model_deployment_id = ? OR native_model_deployment_id = ?`
      )
      .get(id, id, id, id) as { count: number };
    if (references.count > 0) {
      throw badRequest(
        "Model deployment is still referenced by runtime routes"
      );
    }
    const result = this.database
      .prepare("DELETE FROM model_deployments WHERE id = ?")
      .run(id);
    if (result.changes !== 1) throw notFound("Model deployment was not found");
    return this.getSummary();
  }

  public createRoute(
    input: NormalizedRuntimeRouteInput
  ): RuntimeRoutingSummary {
    const id = randomUUID();
    const normalized = normalizeRouteInput(input);
    this.validateRoute(id, normalized, false);
    this.upsertRoute({ id, ...normalized });
    return this.getSummary();
  }

  public updateRoute(
    id: string,
    input: NormalizedRuntimeRouteInput
  ): RuntimeRoutingSummary {
    const current = this.getRoute(id);
    const normalized = normalizeRouteInput(input);
    this.validateRoute(id, normalized, false);
    if (
      this.getActiveRuntimeRoutes().some((route) => route.id === id) &&
      routeVerificationSignature(current) !==
        routeVerificationSignatureFromInput(id, normalized)
    ) {
      throw badRequest(
        "Active runtime route cannot be changed; activate another route first"
      );
    }
    this.database.transaction(() => {
      this.upsertRoute({ id, ...normalized });
      if (
        routeVerificationSignature(current) !==
        routeVerificationSignatureFromInput(id, normalized)
      ) {
        this.invalidateRouteReadiness(id);
      }
    })();
    return this.getSummary();
  }

  public deleteRoute(id: string): RuntimeRoutingSummary {
    const active = this.getActiveRuntimeRoute();
    if (active.id === id)
      throw badRequest("Active runtime route cannot be deleted");
    const fallbacks = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM runtime_routes WHERE fallback_route_id = ?"
      )
      .get(id) as { count: number };
    if (fallbacks.count > 0) {
      throw badRequest("Runtime route is still referenced as a fallback");
    }
    const result = this.database
      .prepare("DELETE FROM runtime_routes WHERE id = ?")
      .run(id);
    if (result.changes !== 1) throw notFound("Runtime route was not found");
    return this.getSummary();
  }

  public activateRoute(
    routeId: string,
    requireVerified = true
  ): RuntimeRoutingSummary {
    const route = this.getRoute(routeId);
    this.validateRoute(routeId, routeInputFromRow(route), requireVerified);
    if (!route.enabled)
      throw badRequest("Disabled runtime route cannot be activated");
    this.database
      .prepare(
        `INSERT INTO active_runtime_route (id, active_route_id, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           active_route_id = excluded.active_route_id,
           updated_at = excluded.updated_at`
      )
      .run(routeId, new Date().toISOString());
    return this.getSummary();
  }

  public resolveLlm<T extends LlmRoutingConfiguration>(
    configuration: T,
    routeId?: string
  ): T {
    const active =
      routeId === undefined ? this.getValidatedActiveRuntimeRoute() : undefined;
    const route =
      routeId !== undefined
        ? this.getRoute(routeId)
        : active?.mode === "composed"
          ? active
          : active?.fallback_route_id
            ? this.getRoute(active.fallback_route_id)
            : undefined;
    if (!route) {
      throw badRequest(
        "Chat requires an active Composed route or an explicit Composed fallback"
      );
    }
    if (route.mode !== "composed") {
      throw badRequest("Chat requires a Composed runtime route");
    }
    const modelId = route.chat_model_deployment_id;
    if (!modelId) throw badRequest("Composed route requires a Chat model");
    const model = this.requireModelCapabilities(
      modelId,
      ["text-input", "text-output", "tool-calling", "non-streaming"],
      false
    );
    const connection = this.getConnection(model.connection_id);
    const mode = llmMode(connection.provider_id);
    const options = parseProviderOptions(model.provider_options);
    return {
      ...configuration,
      mode,
      endpoint: mode === "azure-openai" ? connection.endpoint : "",
      deployment: mode === "azure-openai" ? model.model_name : "",
      baseUrl: mode === "openai-compatible" ? connection.endpoint : "",
      model: mode === "openai-compatible" ? model.model_name : "",
      apiVersion: model.api_version,
      timeoutMs: numberOption(
        options.timeoutMs,
        configuration.timeoutMs,
        "timeoutMs"
      ),
      maxOutputTokens: numberOption(
        options.maxOutputTokens,
        configuration.maxOutputTokens,
        "maxOutputTokens"
      ),
      apiKey: connection.api_key
    };
  }

  public resolveSpeech<T extends SpeechRoutingConfiguration>(
    configuration: T,
    routeId?: string
  ): T {
    const active =
      routeId === undefined ? this.getValidatedActiveRuntimeRoute() : undefined;
    const route =
      routeId !== undefined
        ? this.getRoute(routeId)
        : active?.mode === "composed"
          ? active
          : active?.fallback_route_id
            ? this.getRoute(active.fallback_route_id)
            : undefined;
    if (!route) {
      throw badRequest(
        "Speech requires an active Composed route or an explicit Composed fallback"
      );
    }
    if (route.mode !== "composed") {
      throw badRequest("Speech requires a Composed runtime route");
    }
    if (!route.stt_model_deployment_id || !route.tts_model_deployment_id) {
      throw badRequest("Composed route requires STT and TTS models");
    }
    const stt = this.requireModelCapabilities(
      route.stt_model_deployment_id,
      ["audio-input", "text-output", "transcription", "non-streaming"],
      false
    );
    const tts = this.requireModelCapabilities(
      route.tts_model_deployment_id,
      ["text-input", "audio-output", "speech-synthesis", "non-streaming"],
      false
    );
    const sttConnection = this.getConnection(stt.connection_id);
    const ttsConnection = this.getConnection(tts.connection_id);
    const sttOptions = parseProviderOptions(stt.provider_options);
    const ttsOptions = parseProviderOptions(tts.provider_options);
    return {
      ...configuration,
      sttMode: speechMode(sttConnection.provider_id),
      sttEndpoint: sttConnection.endpoint,
      sttDeployment: stt.model_name,
      sttApiVersion: stt.api_version,
      sttLanguage: stringOption(
        sttOptions.language,
        configuration.sttLanguage,
        "language"
      ),
      sttApiKey: sttConnection.api_key,
      ttsMode: speechMode(ttsConnection.provider_id),
      ttsEndpoint: ttsConnection.endpoint,
      ttsDeployment: tts.model_name,
      ttsApiVersion: tts.api_version,
      ttsVoice: stringOption(ttsOptions.voice, configuration.ttsVoice, "voice"),
      ttsInstructions: stringOption(
        ttsOptions.instructions,
        configuration.ttsInstructions,
        "instructions"
      ),
      ttsApiKey: ttsConnection.api_key
    };
  }

  public resolveVoice(
    configuration: VoiceRoutingConfiguration,
    routeId?: string
  ): VoiceRoutingConfiguration {
    const route =
      routeId === undefined
        ? this.getValidatedActiveRuntimeRoute()
        : this.getRoute(routeId);
    if (route.mode === "composed") {
      return {
        mode: "composed",
        nativeProviderId: configuration.nativeProviderId,
        routeId: route.id,
        fallbackRouteId: null
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
      nativeProviderId: provider.provider_id,
      routeId: route.id,
      fallbackRouteId: route.fallback_route_id
    };
  }

  public getRouteSummary(id: string): RuntimeRouteSummary {
    return mapRuntimeRoute(this.getRoute(id));
  }

  public captureVoiceRouteSnapshot(
    routeId?: string
  ): RuntimeVoiceRouteSnapshot {
    const active =
      routeId === undefined ? this.getValidatedActiveRuntimeRoute() : null;
    const route =
      routeId !== undefined
        ? this.getRoute(routeId)
        : active?.mode === "composed"
          ? active
          : active?.fallback_route_id
            ? this.getRoute(active.fallback_route_id)
            : undefined;
    if (!route || route.mode !== "composed") {
      throw badRequest(
        "Streaming voice requires a Composed route or an explicit Composed fallback"
      );
    }
    if (route.enabled !== 1) {
      throw badRequest("Disabled runtime route cannot start a voice run");
    }
    this.validateRoute(
      route.id,
      routeInputFromRow(route),
      routeId === undefined
    );
    const assignment = (
      role: "stt" | "chat" | "tts",
      modelId: string | null,
      streamingEnabled: boolean
    ): RuntimeVoiceRouteAssignmentSnapshot => {
      if (!modelId) {
        throw new Error(`Composed runtime route requires a ${role} model`);
      }
      const model = this.getModel(modelId);
      const connection = this.getConnection(model.connection_id);
      return {
        role,
        modelDeploymentId: model.id,
        modelDisplayName: model.display_name,
        providerId: connection.provider_id,
        providerDisplayName: connection.display_name,
        configurationFingerprint: this.modelVerificationToken(model.id),
        streamingEnabled
      };
    };
    const assignments: RuntimeVoiceRouteSnapshot["assignments"] = [
      assignment(
        "stt",
        route.stt_model_deployment_id,
        route.stt_streaming_enabled === 1
      ),
      assignment(
        "chat",
        route.chat_model_deployment_id,
        route.chat_streaming_enabled === 1
      ),
      assignment(
        "tts",
        route.tts_model_deployment_id,
        route.tts_streaming_enabled === 1
      )
    ];
    return {
      routeId: route.id,
      routeDisplayName: route.display_name,
      mode: "composed",
      configurationFingerprint: configurationFingerprint([
        routeVerificationSignature(route),
        assignments.map((entry) => entry.configurationFingerprint)
      ]),
      assignments
    };
  }

  public captureRouteVerification(
    id: string
  ): RuntimeRouteVerificationSnapshot {
    const route = this.getRoute(id);
    const assignments = routeAssignments(route).map(({ role, modelId }) => ({
      role,
      modelId,
      connectionId: this.getModel(modelId).connection_id,
      verificationToken: this.modelVerificationToken(modelId)
    }));
    return {
      routeId: id,
      routeSignature: routeVerificationSignature(route),
      assignments
    };
  }

  /**
   * Starts an explicit route test. The generation prevents an older test from
   * overwriting status after a newer test or configuration change.
   */
  public beginRouteReadinessTest(
    snapshot: RuntimeRouteVerificationSnapshot
  ): RuntimeRouteReadinessTest {
    return this.database.transaction(() => {
      this.assertVerificationCurrent(snapshot);
      const generation = this.nextReadinessGeneration();
      this.database
        .prepare(
          `UPDATE runtime_routes
           SET readiness_state = 'testing',
               readiness_error_category = NULL,
               readiness_error_message = NULL,
               readiness_generation = ?,
               updated_at = ?
           WHERE id = ?`
        )
        .run(generation, new Date().toISOString(), snapshot.routeId);
      return { routeId: snapshot.routeId, generation, snapshot };
    })();
  }

  public beginConnectionReadinessTest(
    test: RuntimeRouteReadinessTest,
    role: RuntimeRouteRole
  ): void {
    const connectionId = connectionIdForRole(test.snapshot, role);
    const currentRoute = this.database
      .prepare("SELECT readiness_generation FROM runtime_routes WHERE id = ?")
      .get(test.routeId) as { readiness_generation: number } | undefined;
    if (currentRoute?.readiness_generation !== test.generation) {
      throw badRequest(
        "Runtime route test was superseded; test the route again"
      );
    }
    const result = this.database
      .prepare(
        `UPDATE provider_connections
         SET readiness_state = 'testing',
             readiness_error_category = NULL,
             readiness_error_message = NULL,
             readiness_generation = ?,
             updated_at = ?
         WHERE id = ? AND readiness_generation <= ?`
      )
      .run(
        test.generation,
        new Date().toISOString(),
        connectionId,
        test.generation
      );
    if (result.changes !== 1) {
      throw badRequest(
        "Provider connection test was superseded; test the route again"
      );
    }
  }

  public markConnectionReadinessReady(
    test: RuntimeRouteReadinessTest,
    role: RuntimeRouteRole
  ): void {
    const connectionId = connectionIdForRole(test.snapshot, role);
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE provider_connections
         SET readiness_state = 'ready',
             readiness_last_tested_at = ?,
             readiness_error_category = NULL,
             readiness_error_message = NULL,
             updated_at = ?
         WHERE id = ? AND readiness_generation = ?`
      )
      .run(now, now, connectionId, test.generation);
    if (result.changes !== 1) {
      throw badRequest(
        "Provider connection test was superseded; test the route again"
      );
    }
  }

  public markConnectionReadinessFailed(
    test: RuntimeRouteReadinessTest,
    role: RuntimeRouteRole,
    error: RuntimeReadinessError
  ): void {
    const connectionId = connectionIdForRole(test.snapshot, role);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE provider_connections
         SET readiness_state = 'failed',
             readiness_last_tested_at = ?,
             readiness_error_category = ?,
             readiness_error_message = ?,
             updated_at = ?
         WHERE id = ? AND readiness_generation = ?`
      )
      .run(
        now,
        error.category,
        providerReadinessErrorMessage(error.category),
        now,
        connectionId,
        test.generation
      );
  }

  public markRouteReadinessReady(test: RuntimeRouteReadinessTest): void {
    this.database.transaction(() => {
      this.assertVerificationCurrent(test.snapshot);
      const now = new Date().toISOString();
      const result = this.database
        .prepare(
          `UPDATE runtime_routes
           SET readiness_state = 'ready',
               readiness_last_tested_at = ?,
               readiness_error_category = NULL,
               readiness_error_message = NULL,
               updated_at = ?
           WHERE id = ? AND readiness_generation = ?`
        )
        .run(now, now, test.routeId, test.generation);
      if (result.changes !== 1) {
        throw badRequest(
          "Runtime route test was superseded; test the route again"
        );
      }
      this.markRouteVerified(test.snapshot);
    })();
  }

  public markRouteReadinessFailed(
    test: RuntimeRouteReadinessTest,
    error: RuntimeReadinessError
  ): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `UPDATE runtime_routes
         SET readiness_state = 'failed',
             readiness_last_tested_at = ?,
             readiness_error_category = ?,
             readiness_error_message = ?,
             updated_at = ?
         WHERE id = ? AND readiness_generation = ?`
      )
      .run(
        now,
        error.category,
        providerReadinessErrorMessage(error.category),
        now,
        test.routeId,
        test.generation
      );
  }

  public reconcileInterruptedReadinessTests(): void {
    const interrupted =
      (
        this.database
          .prepare(
            `SELECT
               (SELECT COUNT(*) FROM provider_connections WHERE readiness_state = 'testing') +
               (SELECT COUNT(*) FROM runtime_routes WHERE readiness_state = 'testing')
               AS count`
          )
          .get() as { count: number }
      ).count > 0;
    if (!interrupted) return;
    this.database.transaction(() => {
      const generation = this.nextReadinessGeneration();
      const now = new Date().toISOString();
      for (const table of ["provider_connections", "runtime_routes"]) {
        this.database
          .prepare(
            `UPDATE ${table}
             SET readiness_state = 'unknown',
                 readiness_last_tested_at = NULL,
                 readiness_error_category = NULL,
                 readiness_error_message = NULL,
                 readiness_generation = ?,
                 updated_at = ?
             WHERE readiness_state = 'testing'`
          )
          .run(generation, now);
      }
    })();
  }

  public markRouteVerified(snapshot: RuntimeRouteVerificationSnapshot): void {
    this.database.transaction(() => {
      this.assertVerificationCurrent(snapshot);
      const capabilitiesByModel = new Map<string, Set<ModelCapability>>();
      for (const assignment of snapshot.assignments) {
        const capabilities =
          capabilitiesByModel.get(assignment.modelId) ??
          new Set<ModelCapability>();
        for (const capability of verifiedCapabilitiesForRole(assignment.role)) {
          capabilities.add(capability);
        }
        capabilitiesByModel.set(assignment.modelId, capabilities);
      }
      for (const [modelId, capabilities] of capabilitiesByModel) {
        this.markCapabilitiesVerified(modelId, [...capabilities]);
      }
    })();
  }

  private assertVerificationCurrent(
    snapshot: RuntimeRouteVerificationSnapshot
  ): void {
    const route = this.getRoute(snapshot.routeId);
    if (
      routeVerificationSignature(route) !== snapshot.routeSignature ||
      snapshot.assignments.some(
        ({ role, modelId, connectionId, verificationToken }) =>
          routeModelId(route, role) !== modelId ||
          this.getModel(modelId).connection_id !== connectionId ||
          this.modelVerificationToken(modelId) !== verificationToken
      )
    ) {
      throw badRequest(
        "Runtime route configuration changed during testing; test the route again"
      );
    }
  }

  private activeRouteUsesConnection(connectionId: string): boolean {
    return this.getActiveRuntimeRoutes().some((route) =>
      routeAssignments(route).some(
        ({ modelId }) => this.getModel(modelId).connection_id === connectionId
      )
    );
  }

  private activeRouteUsesModel(modelId: string): boolean {
    return this.getActiveRuntimeRoutes().some((route) =>
      routeAssignments(route).some(
        (assignment) => assignment.modelId === modelId
      )
    );
  }

  private getActiveRuntimeRoutes(): RuntimeRouteRow[] {
    const active = this.getActiveRuntimeRoute();
    if (active.mode !== "native-multimodal" || !active.fallback_route_id) {
      return [active];
    }
    return [active, this.getRoute(active.fallback_route_id)];
  }

  private modelVerificationToken(modelId: string): string {
    const model = this.getModel(modelId);
    const connection = this.getConnection(model.connection_id);
    return configurationFingerprint([
      model.configuration_fingerprint,
      model.enabled,
      connection.provider_id,
      connection.endpoint,
      connection.api_key,
      connection.enabled
    ]);
  }

  private getConnection(id: string): ProviderConnectionRow {
    const row = this.database
      .prepare(
        `SELECT id, provider_id, display_name, endpoint, api_key, enabled,
                readiness_state, readiness_last_tested_at,
                readiness_error_category, readiness_error_message,
                readiness_generation
         FROM provider_connections WHERE id = ?`
      )
      .get(id) as ProviderConnectionRow | undefined;
    if (!row) throw notFound("Connection was not found");
    return row;
  }

  private getModel(id: string): ModelDeploymentRow {
    const row = this.database
      .prepare(
        `SELECT id, connection_id, display_name, model_name, api_version,
                declared_capabilities, verified_capabilities, provider_options,
                configuration_fingerprint, enabled
         FROM model_deployments WHERE id = ?`
      )
      .get(id) as ModelDeploymentRow | undefined;
    if (!row) throw notFound("Model deployment was not found");
    return row;
  }

  private getRoute(id: string): RuntimeRouteRow {
    const row = this.database
      .prepare(
        `SELECT id, display_name, mode, stt_model_deployment_id,
                chat_model_deployment_id, tts_model_deployment_id,
                native_model_deployment_id, fallback_route_id,
                stt_streaming_enabled, chat_streaming_enabled,
                tts_streaming_enabled, enabled,
                readiness_state, readiness_last_tested_at,
                readiness_error_category, readiness_error_message,
                readiness_generation
         FROM runtime_routes WHERE id = ?`
      )
      .get(id) as RuntimeRouteRow | undefined;
    if (!row) throw notFound("Runtime route was not found");
    return row;
  }

  private validateRoute(
    id: string,
    input: NormalizedRuntimeRouteInput,
    requireVerified: boolean
  ): void {
    if (input.mode === "composed") {
      if (
        !input.sttModelDeploymentId ||
        !input.chatModelDeploymentId ||
        !input.ttsModelDeploymentId ||
        input.nativeModelDeploymentId ||
        input.fallbackRouteId
      ) {
        throw badRequest(
          "Composed routes require STT, Chat, and TTS models without Native or fallback assignments"
        );
      }
      const stt = this.requireModelCapabilities(
        input.sttModelDeploymentId,
        ["audio-input", "text-output", "transcription", "non-streaming"],
        requireVerified
      );
      const chat = this.requireModelCapabilities(
        input.chatModelDeploymentId,
        ["text-input", "text-output", "tool-calling", "non-streaming"],
        requireVerified
      );
      const tts = this.requireModelCapabilities(
        input.ttsModelDeploymentId,
        ["text-input", "audio-output", "speech-synthesis", "non-streaming"],
        requireVerified
      );
      if (input.sttStreamingEnabled) {
        this.requireStreamingCapability(stt, requireVerified);
      }
      if (input.chatStreamingEnabled) {
        this.requireStreamingCapability(chat, requireVerified);
      }
      if (input.ttsStreamingEnabled) {
        this.requireStreamingCapability(tts, requireVerified);
      }
      if (requireVerified) {
        this.requireStreamingRuntimeAvailability(input, { stt, chat, tts });
      }
      return;
    }

    if (
      !input.nativeModelDeploymentId ||
      input.sttModelDeploymentId ||
      input.chatModelDeploymentId ||
      input.ttsModelDeploymentId ||
      input.sttStreamingEnabled ||
      input.chatStreamingEnabled ||
      input.ttsStreamingEnabled
    ) {
      throw badRequest(
        "Native routes require one Native model and cannot configure Composed streaming assignments"
      );
    }
    this.requireModelCapabilities(
      input.nativeModelDeploymentId,
      [
        "audio-input",
        "audio-output",
        "text-output",
        "tool-calling",
        "native-multimodal"
      ],
      requireVerified
    );
    if (input.fallbackRouteId) {
      if (input.fallbackRouteId === id) {
        throw badRequest("Runtime route cannot fall back to itself");
      }
      const fallback = this.getRoute(input.fallbackRouteId);
      if (fallback.mode !== "composed" || fallback.enabled !== 1) {
        throw badRequest(
          "Native fallback must reference an enabled Composed route"
        );
      }
      this.validateRoute(
        fallback.id,
        routeInputFromRow(fallback),
        requireVerified
      );
    }
  }

  private requireStreamingRuntimeAvailability(
    input: NormalizedRuntimeRouteInput,
    models: {
      stt: ModelDeploymentRow;
      chat: ModelDeploymentRow;
      tts: ModelDeploymentRow;
    }
  ): void {
    if (
      !input.sttStreamingEnabled &&
      !input.chatStreamingEnabled &&
      !input.ttsStreamingEnabled
    ) {
      return;
    }
    if (!this.streamingAvailability.transportAvailable) {
      throw badRequest("Streaming voice transport is unavailable");
    }
    if (!this.streamingAvailability.browserClientAvailable) {
      throw badRequest("Streaming browser client is unavailable");
    }
    this.requireStreamingAdapter(
      "STT",
      input.sttStreamingEnabled,
      models.stt,
      this.streamingAvailability.sttProviderIds
    );
    this.requireStreamingAdapter(
      "Chat",
      input.chatStreamingEnabled,
      models.chat,
      this.streamingAvailability.chatProviderIds
    );
    this.requireStreamingAdapter(
      "TTS",
      input.ttsStreamingEnabled,
      models.tts,
      this.streamingAvailability.ttsProviderIds
    );
  }

  private requireStreamingAdapter(
    role: "STT" | "Chat" | "TTS",
    enabled: boolean,
    model: ModelDeploymentRow,
    providerIds: readonly string[]
  ): void {
    if (!enabled) return;
    const providerId = this.getConnection(model.connection_id).provider_id;
    if (!providerIds.includes(providerId)) {
      throw badRequest(
        `${role} streaming adapter is unavailable for provider ${providerId}`
      );
    }
  }

  private requireModelCapabilities(
    modelId: string,
    capabilities: ModelCapability[],
    requireVerified: boolean
  ): ModelDeploymentRow {
    const model = this.getModel(modelId);
    const connection = this.getConnection(model.connection_id);
    if (model.enabled !== 1 || connection.enabled !== 1) {
      throw badRequest(
        "Runtime route references a disabled model or connection"
      );
    }
    const declared = parseCapabilities(model.declared_capabilities);
    const verified = parseCapabilities(model.verified_capabilities);
    const missingDeclared = capabilities.filter(
      (capability) => !declared.includes(capability)
    );
    if (missingDeclared.length > 0) {
      throw badRequest(
        `Model ${model.display_name} is missing declared capabilities: ${missingDeclared.join(", ")}`
      );
    }
    if (requireVerified) {
      const missingVerified = capabilities.filter(
        (capability) => !verified.includes(capability)
      );
      if (missingVerified.length > 0) {
        throw badRequest(
          `Model ${model.display_name} is missing verified capabilities: ${missingVerified.join(", ")}`
        );
      }
    }
    return model;
  }

  private requireStreamingCapability(
    model: ModelDeploymentRow,
    requireVerified: boolean
  ): void {
    const declared = parseCapabilities(model.declared_capabilities);
    const verified = parseCapabilities(model.verified_capabilities);
    if (!declared.includes("streaming")) {
      throw badRequest(
        `Model ${model.display_name} requires declared streaming capability`
      );
    }
    if (requireVerified && !verified.includes("streaming")) {
      throw badRequest(
        `Model ${model.display_name} requires verified streaming capability`
      );
    }
  }

  private invalidateConnectionReadiness(connectionId: string): void {
    const generation = this.nextReadinessGeneration();
    const now = new Date().toISOString();
    this.resetReadiness(
      "provider_connections",
      "id = ?",
      [connectionId],
      generation,
      now
    );
    this.database
      .prepare(
        `UPDATE runtime_routes
         SET readiness_state = 'unknown',
             readiness_last_tested_at = NULL,
             readiness_error_category = NULL,
             readiness_error_message = NULL,
             readiness_generation = ?,
             updated_at = ?
         WHERE stt_model_deployment_id IN (
                 SELECT id FROM model_deployments WHERE connection_id = ?
               )
            OR chat_model_deployment_id IN (
                 SELECT id FROM model_deployments WHERE connection_id = ?
               )
            OR tts_model_deployment_id IN (
                 SELECT id FROM model_deployments WHERE connection_id = ?
               )
            OR native_model_deployment_id IN (
                 SELECT id FROM model_deployments WHERE connection_id = ?
               )`
      )
      .run(
        generation,
        now,
        connectionId,
        connectionId,
        connectionId,
        connectionId
      );
  }

  private invalidateModelReadiness(
    modelId: string,
    connectionIds: readonly string[]
  ): void {
    const generation = this.nextReadinessGeneration();
    const now = new Date().toISOString();
    for (const connectionId of new Set(connectionIds)) {
      this.resetReadiness(
        "provider_connections",
        "id = ?",
        [connectionId],
        generation,
        now
      );
    }
    this.database
      .prepare(
        `UPDATE runtime_routes
         SET readiness_state = 'unknown',
             readiness_last_tested_at = NULL,
             readiness_error_category = NULL,
             readiness_error_message = NULL,
             readiness_generation = ?,
             updated_at = ?
         WHERE stt_model_deployment_id = ?
            OR chat_model_deployment_id = ?
            OR tts_model_deployment_id = ?
            OR native_model_deployment_id = ?`
      )
      .run(generation, now, modelId, modelId, modelId, modelId);
  }

  private invalidateRouteReadiness(routeId: string): void {
    this.resetReadiness(
      "runtime_routes",
      "id = ?",
      [routeId],
      this.nextReadinessGeneration(),
      new Date().toISOString()
    );
  }

  private resetReadiness(
    table: "provider_connections" | "runtime_routes",
    predicate: string,
    parameters: readonly unknown[],
    generation: number,
    now: string
  ): void {
    this.database
      .prepare(
        `UPDATE ${table}
         SET readiness_state = 'unknown',
             readiness_last_tested_at = NULL,
             readiness_error_category = NULL,
             readiness_error_message = NULL,
             readiness_generation = ?,
             updated_at = ?
         WHERE ${predicate}`
      )
      .run(generation, now, ...parameters);
  }

  private nextReadinessGeneration(): number {
    this.database
      .prepare(
        "UPDATE runtime_readiness_sequence SET generation = generation + 1 WHERE id = 1"
      )
      .run();
    const row = this.database
      .prepare("SELECT generation FROM runtime_readiness_sequence WHERE id = 1")
      .get() as { generation: number } | undefined;
    if (!row) {
      throw new Error("Runtime readiness sequence is not initialized");
    }
    return row.generation;
  }

  private resetConnectionVerification(connectionId: string): void {
    this.database
      .prepare(
        "UPDATE model_deployments SET verified_capabilities = '[]', updated_at = ? WHERE connection_id = ?"
      )
      .run(new Date().toISOString(), connectionId);
  }

  private markCapabilitiesVerified(
    modelDeploymentId: string,
    capabilities: ModelCapability[]
  ): void {
    const row = this.database
      .prepare(
        "SELECT declared_capabilities, verified_capabilities FROM model_deployments WHERE id = ?"
      )
      .get(modelDeploymentId) as
      | {
          declared_capabilities: string;
          verified_capabilities: string;
        }
      | undefined;
    if (!row) {
      throw new Error(`Unknown model deployment: ${modelDeploymentId}`);
    }
    const declared = parseCapabilities(row.declared_capabilities);
    const verified = [
      ...new Set([
        ...parseCapabilities(row.verified_capabilities),
        ...capabilities.filter((capability) => declared.includes(capability))
      ])
    ];
    this.database
      .prepare(
        "UPDATE model_deployments SET verified_capabilities = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        JSON.stringify(verified),
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
    enabled: boolean;
  }): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO provider_connections (
           id, provider_id, display_name, endpoint, api_key, enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider_id = excluded.provider_id,
           display_name = excluded.display_name,
           endpoint = excluded.endpoint,
           api_key = excluded.api_key,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.providerId,
        input.displayName,
        input.endpoint,
        input.apiKey,
        input.enabled ? 1 : 0,
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
    providerOptions: Record<string, string | number | boolean>;
    verifiedByDefault: boolean;
    enabled: boolean;
    fingerprintValues: unknown[];
    preserveVerification?: boolean;
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
      ? input.declaredCapabilities.filter(
          (capability) => capability !== "streaming"
        )
      : current &&
          (input.preserveVerification ||
            current.configuration_fingerprint === fingerprint)
        ? parseCapabilities(current.verified_capabilities)
        : [];
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO model_deployments (
           id, connection_id, display_name, model_name, api_version,
           declared_capabilities, verified_capabilities, provider_options,
           configuration_fingerprint, enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           connection_id = excluded.connection_id,
           display_name = excluded.display_name,
           model_name = excluded.model_name,
           api_version = excluded.api_version,
           declared_capabilities = excluded.declared_capabilities,
           verified_capabilities = excluded.verified_capabilities,
           provider_options = excluded.provider_options,
           configuration_fingerprint = excluded.configuration_fingerprint,
           enabled = excluded.enabled,
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
        input.enabled ? 1 : 0,
        now,
        now
      );
  }

  private upsertRoute(
    input: NormalizedRuntimeRouteInput & { id: string }
  ): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO runtime_routes (
           id, display_name, mode, stt_model_deployment_id,
           chat_model_deployment_id, tts_model_deployment_id,
           native_model_deployment_id, fallback_route_id,
           stt_streaming_enabled, chat_streaming_enabled,
           tts_streaming_enabled, enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           mode = excluded.mode,
           stt_model_deployment_id = excluded.stt_model_deployment_id,
           chat_model_deployment_id = excluded.chat_model_deployment_id,
           tts_model_deployment_id = excluded.tts_model_deployment_id,
           native_model_deployment_id = excluded.native_model_deployment_id,
           fallback_route_id = excluded.fallback_route_id,
           stt_streaming_enabled = excluded.stt_streaming_enabled,
           chat_streaming_enabled = excluded.chat_streaming_enabled,
           tts_streaming_enabled = excluded.tts_streaming_enabled,
           enabled = excluded.enabled,
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
        input.sttStreamingEnabled ? 1 : 0,
        input.chatStreamingEnabled ? 1 : 0,
        input.ttsStreamingEnabled ? 1 : 0,
        input.enabled ? 1 : 0,
        now,
        now
      );
  }

  private getActiveRuntimeRoute(): RuntimeRouteRow {
    const route = this.database
      .prepare(
        `SELECT r.id, r.display_name, r.mode, r.stt_model_deployment_id,
                r.chat_model_deployment_id, r.tts_model_deployment_id,
                r.native_model_deployment_id, r.fallback_route_id,
                r.stt_streaming_enabled, r.chat_streaming_enabled,
                r.tts_streaming_enabled, r.enabled,
                r.readiness_state, r.readiness_last_tested_at,
                r.readiness_error_category, r.readiness_error_message,
                r.readiness_generation
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

  private getValidatedActiveRuntimeRoute(): RuntimeRouteRow {
    const route = this.getActiveRuntimeRoute();
    this.validateRoute(route.id, routeInputFromRow(route), true);
    if (route.enabled !== 1) {
      throw badRequest("Disabled runtime route cannot be used");
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
    apiKeyConfigured: row.api_key !== null,
    enabled: row.enabled === 1,
    readiness: mapReadiness(row)
  };
}

function mapModelDeployment(row: ModelDeploymentRow): ModelDeploymentSummary {
  return {
    id: row.id,
    connectionId: row.connection_id,
    displayName: row.display_name,
    modelName: row.model_name,
    apiVersion: row.api_version,
    providerOptions: parseProviderOptions(row.provider_options),
    declaredCapabilities: parseCapabilities(row.declared_capabilities),
    verifiedCapabilities: parseCapabilities(row.verified_capabilities),
    enabled: row.enabled === 1
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
    fallbackRouteId: row.fallback_route_id,
    sttStreamingEnabled: row.stt_streaming_enabled === 1,
    chatStreamingEnabled: row.chat_streaming_enabled === 1,
    ttsStreamingEnabled: row.tts_streaming_enabled === 1,
    enabled: row.enabled === 1,
    readiness: mapReadiness(row)
  };
}

function mapReadiness(row: {
  readiness_state: string;
  readiness_last_tested_at: string | null;
  readiness_error_category: string | null;
  readiness_error_message: string | null;
}): ProviderReadiness {
  if (!isReadinessState(row.readiness_state)) {
    throw new Error(`Invalid provider readiness state: ${row.readiness_state}`);
  }
  if (
    row.readiness_error_category !== null &&
    !isReadinessErrorCategory(row.readiness_error_category)
  ) {
    throw new Error(
      `Invalid provider readiness error category: ${row.readiness_error_category}`
    );
  }
  if (
    (row.readiness_error_category === null) !==
    (row.readiness_error_message === null)
  ) {
    throw new Error("Provider readiness error fields are inconsistent");
  }
  switch (row.readiness_state) {
    case "unknown":
      if (
        row.readiness_last_tested_at !== null ||
        row.readiness_error_category !== null
      ) {
        throw new Error("Unknown provider readiness must not retain test data");
      }
      return { state: "unknown", lastTestedAt: null, lastError: null };
    case "testing":
      if (row.readiness_error_category !== null) {
        throw new Error("Testing provider readiness must not retain an error");
      }
      return {
        state: "testing",
        lastTestedAt: row.readiness_last_tested_at,
        lastError: null
      };
    case "ready":
      if (
        row.readiness_last_tested_at === null ||
        row.readiness_error_category !== null
      ) {
        throw new Error(
          "Ready provider readiness requires a timestamp without an error"
        );
      }
      return {
        state: "ready",
        lastTestedAt: row.readiness_last_tested_at,
        lastError: null
      };
    case "failed":
      if (
        row.readiness_last_tested_at === null ||
        row.readiness_error_category === null ||
        row.readiness_error_message === null
      ) {
        throw new Error(
          "Failed provider readiness requires a timestamp and safe error"
        );
      }
      return {
        state: "failed",
        lastTestedAt: row.readiness_last_tested_at,
        lastError: {
          category: row.readiness_error_category,
          message: row.readiness_error_message
        }
      };
  }
}

function isReadinessState(value: string): value is ProviderReadiness["state"] {
  return (
    value === "unknown" ||
    value === "testing" ||
    value === "ready" ||
    value === "failed"
  );
}

function isReadinessErrorCategory(
  value: string
): value is ProviderReadinessErrorCategory {
  return (
    value === "authentication" ||
    value === "quota" ||
    value === "timeout" ||
    value === "invalid-response" ||
    value === "configuration" ||
    value === "cancelled" ||
    value === "provider"
  );
}

function routeInputFromRow(row: RuntimeRouteRow): NormalizedRuntimeRouteInput {
  return {
    displayName: row.display_name,
    mode: row.mode,
    sttModelDeploymentId: row.stt_model_deployment_id,
    chatModelDeploymentId: row.chat_model_deployment_id,
    ttsModelDeploymentId: row.tts_model_deployment_id,
    nativeModelDeploymentId: row.native_model_deployment_id,
    fallbackRouteId: row.fallback_route_id,
    sttStreamingEnabled: row.stt_streaming_enabled === 1,
    chatStreamingEnabled: row.chat_streaming_enabled === 1,
    ttsStreamingEnabled: row.tts_streaming_enabled === 1,
    enabled: row.enabled === 1
  };
}

function normalizeRouteInput(
  input: NormalizedRuntimeRouteInput
): NormalizedRuntimeRouteInput {
  return {
    ...input,
    sttModelDeploymentId: input.sttModelDeploymentId || null,
    chatModelDeploymentId: input.chatModelDeploymentId || null,
    ttsModelDeploymentId: input.ttsModelDeploymentId || null,
    nativeModelDeploymentId: input.nativeModelDeploymentId || null,
    fallbackRouteId: input.fallbackRouteId || null,
    sttStreamingEnabled: input.mode === "composed" && input.sttStreamingEnabled,
    chatStreamingEnabled:
      input.mode === "composed" && input.chatStreamingEnabled,
    ttsStreamingEnabled: input.mode === "composed" && input.ttsStreamingEnabled
  };
}

function routeAssignments(
  route: RuntimeRouteRow
): Array<{ role: RuntimeRouteRole; modelId: string }> {
  if (route.mode === "composed") {
    const assignments = [
      { role: "stt" as const, modelId: route.stt_model_deployment_id },
      { role: "chat" as const, modelId: route.chat_model_deployment_id },
      { role: "tts" as const, modelId: route.tts_model_deployment_id }
    ];
    if (assignments.some((assignment) => !assignment.modelId)) {
      throw new Error(`Runtime route ${route.id} has incomplete assignments`);
    }
    return assignments as Array<{
      role: RuntimeRouteRole;
      modelId: string;
    }>;
  }
  if (!route.native_model_deployment_id) {
    throw new Error(`Runtime route ${route.id} has no Native model assignment`);
  }
  return [{ role: "native", modelId: route.native_model_deployment_id }];
}

function connectionIdForRole(
  snapshot: RuntimeRouteVerificationSnapshot,
  role: RuntimeRouteRole
): string {
  const assignment = snapshot.assignments.find(
    (candidate) => candidate.role === role
  );
  if (!assignment) {
    throw new Error(`Runtime route readiness test has no ${role} assignment`);
  }
  return assignment.connectionId;
}

function routeModelId(
  route: RuntimeRouteRow,
  role: RuntimeRouteRole
): string | null {
  switch (role) {
    case "stt":
      return route.stt_model_deployment_id;
    case "chat":
      return route.chat_model_deployment_id;
    case "tts":
      return route.tts_model_deployment_id;
    case "native":
      return route.native_model_deployment_id;
  }
}

function routeVerificationSignature(route: RuntimeRouteRow): string {
  return routeVerificationSignatureFromInput(
    route.id,
    routeInputFromRow(route)
  );
}

function routeVerificationSignatureFromInput(
  id: string,
  input: NormalizedRuntimeRouteInput
): string {
  return configurationFingerprint([
    id,
    input.mode,
    input.sttModelDeploymentId,
    input.chatModelDeploymentId,
    input.ttsModelDeploymentId,
    input.nativeModelDeploymentId,
    input.fallbackRouteId,
    input.sttStreamingEnabled,
    input.chatStreamingEnabled,
    input.ttsStreamingEnabled,
    input.enabled
  ]);
}

function modelRuntimeSignature(model: ModelDeploymentRow): string {
  return configurationFingerprint([
    model.connection_id,
    model.model_name,
    model.api_version,
    [...parseCapabilities(model.declared_capabilities)].sort(),
    sortedProviderOptions(parseProviderOptions(model.provider_options)),
    model.enabled
  ]);
}

function modelRuntimeSignatureFromInput(input: ModelDeploymentInput): string {
  return configurationFingerprint([
    input.connectionId,
    input.modelName,
    input.apiVersion,
    [...input.declaredCapabilities].sort(),
    sortedProviderOptions(input.providerOptions),
    input.enabled ? 1 : 0
  ]);
}

function modelFingerprintValues(
  connection: ProviderConnectionRow,
  input: ModelDeploymentInput
): unknown[] {
  return [
    connection.provider_id,
    connection.endpoint,
    connection.api_key,
    input.connectionId,
    input.modelName,
    input.apiVersion,
    [...input.declaredCapabilities].sort(),
    sortedProviderOptions(input.providerOptions)
  ];
}

function sortedProviderOptions(
  options: Record<string, string | number | boolean>
): Array<[string, string | number | boolean]> {
  return Object.entries(options).sort(([left], [right]) =>
    left.localeCompare(right)
  );
}

function verifiedCapabilitiesForRole(
  role: RuntimeRouteRole
): ModelCapability[] {
  switch (role) {
    case "stt":
      return ["audio-input", "text-output", "transcription", "non-streaming"];
    case "chat":
      return ["text-input", "text-output", "tool-calling", "non-streaming"];
    case "tts":
      return [
        "text-input",
        "audio-output",
        "speech-synthesis",
        "non-streaming"
      ];
    case "native":
      return [
        "audio-input",
        "audio-output",
        "text-output",
        "tool-calling",
        "native-multimodal",
        "non-streaming"
      ];
  }
}

function parseCapabilities(value: string): ModelCapability[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(isModelCapability)) {
    throw new Error("Stored model capabilities are invalid");
  }
  return parsed;
}

function parseProviderOptions(
  value: string
): Record<string, string | number | boolean> {
  const parsed: unknown = JSON.parse(value);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every(
      (entry) =>
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
    )
  ) {
    throw new Error("Stored provider options are invalid");
  }
  return parsed as Record<string, string | number | boolean>;
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
    value === "native-multimodal" ||
    value === "streaming" ||
    value === "non-streaming"
  );
}

function configurationFingerprint(values: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function validateConnectionInput(input: ProviderConnectionInput): void {
  if (!SUPPORTED_PROVIDER_IDS.has(input.providerId)) {
    throw badRequest(`Unsupported provider: ${input.providerId}`);
  }
  if (isMockProvider(input.providerId)) {
    if (input.endpoint) {
      throw badRequest("Mock provider connections must not define an endpoint");
    }
    return;
  }
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch {
    throw badRequest("Provider connection endpoint must be a valid URL");
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "wss:") {
    throw badRequest("Provider connection endpoint must use HTTPS or WSS");
  }
}

function validateModelInput(
  input: ModelDeploymentInput,
  connection: ProviderConnectionRow
): void {
  if (connection.enabled !== 1 && input.enabled) {
    throw badRequest("Enabled model requires an enabled connection");
  }
}

function isMockProvider(providerId: string): boolean {
  return providerId === "mock" || providerId === "mock-native";
}

function llmMode(providerId: string): LlmMode {
  if (
    providerId === "mock" ||
    providerId === "azure-openai" ||
    providerId === "openai-compatible"
  ) {
    return providerId;
  }
  throw badRequest(`Provider ${providerId} does not support Chat`);
}

function speechMode(providerId: string): SpeechProviderMode {
  if (
    providerId === "mock" ||
    providerId === "azure-openai" ||
    providerId === "openai-compatible" ||
    providerId === "alibaba-model-studio"
  ) {
    return providerId;
  }
  throw badRequest(`Provider ${providerId} does not support speech`);
}

function stringOption(
  value: string | number | boolean | undefined,
  fallback: string,
  name: string
): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string") {
    throw new Error(`Stored provider option ${name} must be a string`);
  }
  return value;
}

function numberOption(
  value: string | number | boolean | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Stored provider option ${name} must be a number`);
  }
  return value;
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function notFound(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 404 });
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
const SUPPORTED_PROVIDER_IDS = new Set([
  "mock",
  "mock-native",
  "azure-openai",
  "openai-compatible",
  "alibaba-model-studio"
]);
