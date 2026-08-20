import { Type, type Static } from "@sinclair/typebox";

export const ApiErrorSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.Optional(Type.String())
  })
});

export const HealthSchema = Type.Object({
  status: Type.Literal("ok"),
  timestamp: Type.String({ format: "date-time" })
});

export const SetupStatusSchema = Type.Object({
  setupRequired: Type.Boolean()
});

export const PasswordSchema = Type.Object({
  password: Type.String({ minLength: 10, maxLength: 256 })
});

export const PasswordChangeSchema = Type.Object({
  currentPassword: Type.String({ minLength: 10, maxLength: 256 }),
  newPassword: Type.String({ minLength: 10, maxLength: 256 })
});

export const SessionSchema = Type.Object({
  authenticated: Type.Literal(true),
  expiresAt: Type.String({ format: "date-time" })
});

export const DashboardSchema = Type.Object({
  status: Type.Literal("online"),
  mode: Type.Literal("mock"),
  uptimeSeconds: Type.Number({ minimum: 0 }),
  conversationCount: Type.Integer({ minimum: 0 }),
  mcp: Type.Object({
    name: Type.String(),
    status: Type.Literal("connected"),
    enabledTools: Type.Array(Type.String())
  }),
  providers: Type.Object({
    llm: Type.Union([
      Type.Literal("mock"),
      Type.Literal("azure-openai"),
      Type.Literal("openai-compatible")
    ]),
    stt: Type.Union([
      Type.Literal("mock"),
      Type.Literal("azure-openai"),
      Type.Literal("openai-compatible"),
      Type.Literal("alibaba-model-studio")
    ]),
    tts: Type.Union([
      Type.Literal("mock"),
      Type.Literal("azure-openai"),
      Type.Literal("openai-compatible"),
      Type.Literal("alibaba-model-studio")
    ])
  })
});

export const ChatRequestSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 8_000 })
});

export const ChatResponseSchema = Type.Object({
  conversationId: Type.String({ minLength: 1 }),
  response: Type.String(),
  usedTools: Type.Array(Type.String())
});

export const MessageSchema = Type.Object({
  id: Type.String(),
  role: Type.Union([
    Type.Literal("user"),
    Type.Literal("assistant"),
    Type.Literal("tool")
  ]),
  content: Type.String(),
  createdAt: Type.String({ format: "date-time" })
});

export const ConversationSummarySchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  messageCount: Type.Integer({ minimum: 0 }),
  createdAt: Type.String({ format: "date-time" }),
  updatedAt: Type.String({ format: "date-time" })
});

export const ConversationListSchema = Type.Object({
  conversations: Type.Array(ConversationSummarySchema)
});

export const PipelineEventSchema = Type.Object({
  id: Type.String(),
  stage: Type.Union([
    Type.Literal("STT"),
    Type.Literal("AGENT"),
    Type.Literal("MCP"),
    Type.Literal("TTS")
  ]),
  status: Type.Union([Type.Literal("completed"), Type.Literal("failed")]),
  message: Type.String(),
  createdAt: Type.String({ format: "date-time" })
});

export const ConversationDetailSchema = Type.Intersect([
  ConversationSummarySchema,
  Type.Object({
    messages: Type.Array(MessageSchema),
    events: Type.Array(PipelineEventSchema)
  })
]);

export const VoiceResponseSchema = Type.Object({
  conversationId: Type.String(),
  transcript: Type.String(),
  response: Type.String(),
  usedTools: Type.Array(Type.String()),
  audio: Type.Object({
    base64: Type.String(),
    mimeType: Type.String(),
    sampleRate: Type.Optional(Type.Integer({ minimum: 1 })),
    channels: Type.Optional(Type.Integer({ minimum: 1 }))
  })
});

export const LogEntrySchema = Type.Object({
  id: Type.String(),
  category: Type.Union([
    Type.Literal("AGENT"),
    Type.Literal("MCP"),
    Type.Literal("AUTH"),
    Type.Literal("SYSTEM"),
    Type.Literal("ERROR")
  ]),
  level: Type.Union([
    Type.Literal("INFO"),
    Type.Literal("WARN"),
    Type.Literal("ERROR")
  ]),
  message: Type.String(),
  conversationId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: "date-time" })
});

export const LogListSchema = Type.Object({
  logs: Type.Array(LogEntrySchema)
});

export const LlmModeSchema = Type.Union([
  Type.Literal("mock"),
  Type.Literal("azure-openai"),
  Type.Literal("openai-compatible")
]);

export const LlmConfigurationSchema = Type.Object({
  mode: LlmModeSchema,
  endpoint: Type.String(),
  deployment: Type.String(),
  apiVersion: Type.String(),
  baseUrl: Type.String(),
  model: Type.String(),
  timeoutMs: Type.Integer({ minimum: 1 }),
  maxOutputTokens: Type.Integer({ minimum: 1 }),
  apiKeyConfigured: Type.Boolean()
});

export const LlmConfigurationUpdateSchema = Type.Object({
  mode: LlmModeSchema,
  endpoint: Type.String({ maxLength: 2_048 }),
  deployment: Type.String({ maxLength: 256 }),
  apiVersion: Type.String({ maxLength: 64 }),
  baseUrl: Type.String({ maxLength: 2_048 }),
  model: Type.String({ maxLength: 256 }),
  timeoutMs: Type.Integer({ minimum: 1, maximum: 300_000 }),
  maxOutputTokens: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  apiKey: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  clearApiKey: Type.Optional(Type.Boolean())
});

export const LlmConnectionTestSchema = Type.Object({
  success: Type.Boolean(),
  response: Type.String()
});

export const SpeechProviderModeSchema = Type.Union([
  Type.Literal("mock"),
  Type.Literal("azure-openai"),
  Type.Literal("openai-compatible"),
  Type.Literal("alibaba-model-studio")
]);

export const SpeechConfigurationSchema = Type.Object({
  sttMode: SpeechProviderModeSchema,
  ttsMode: SpeechProviderModeSchema,
  sttEndpoint: Type.String(),
  sttDeployment: Type.String(),
  sttApiVersion: Type.String(),
  sttLanguage: Type.String(),
  sttApiKeyConfigured: Type.Boolean(),
  ttsEndpoint: Type.String(),
  ttsDeployment: Type.String(),
  ttsApiVersion: Type.String(),
  ttsVoice: Type.String(),
  ttsInstructions: Type.String(),
  ttsApiKeyConfigured: Type.Boolean()
});

export const SpeechConfigurationUpdateSchema = Type.Object({
  sttMode: SpeechProviderModeSchema,
  ttsMode: SpeechProviderModeSchema,
  sttEndpoint: Type.String({ maxLength: 2_048 }),
  sttDeployment: Type.String({ maxLength: 256 }),
  sttApiVersion: Type.String({ maxLength: 64 }),
  sttLanguage: Type.String({ maxLength: 32 }),
  sttApiKey: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  clearSttApiKey: Type.Optional(Type.Boolean()),
  ttsEndpoint: Type.String({ maxLength: 2_048 }),
  ttsDeployment: Type.String({ maxLength: 256 }),
  ttsApiVersion: Type.String({ maxLength: 64 }),
  ttsVoice: Type.String({ maxLength: 64 }),
  ttsInstructions: Type.String({ maxLength: 2_000 }),
  ttsApiKey: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  clearTtsApiKey: Type.Optional(Type.Boolean())
});

export const SpeechConnectionTestSchema = Type.Object({
  success: Type.Boolean(),
  transcript: Type.String(),
  audioMimeType: Type.String()
});

export const ProviderCapabilitySchema = Type.Union([
  Type.Literal("llm"),
  Type.Literal("stt"),
  Type.Literal("tts"),
  Type.Literal("audio-input"),
  Type.Literal("audio-output"),
  Type.Literal("tool-calling"),
  Type.Literal("native-multimodal")
]);

export const ProviderDescriptorSchema = Type.Object({
  id: Type.String(),
  displayName: Type.String(),
  capabilities: Type.Array(ProviderCapabilitySchema)
});

export const ProviderCatalogSchema = Type.Object({
  providers: Type.Array(ProviderDescriptorSchema)
});

export const VoicePipelineModeSchema = Type.Union([
  Type.Literal("composed"),
  Type.Literal("native-multimodal")
]);

export const VoicePipelineConfigurationSchema = Type.Object({
  mode: VoicePipelineModeSchema,
  nativeProviderId: Type.String()
});

export const VoicePipelineConfigurationUpdateSchema = Type.Object({
  mode: VoicePipelineModeSchema,
  nativeProviderId: Type.String({ maxLength: 128 })
});

export const ModelCapabilitySchema = Type.Union([
  Type.Literal("text-input"),
  Type.Literal("text-output"),
  Type.Literal("audio-input"),
  Type.Literal("audio-output"),
  Type.Literal("transcription"),
  Type.Literal("speech-synthesis"),
  Type.Literal("tool-calling"),
  Type.Literal("native-multimodal")
]);

export const ProviderConnectionSummarySchema = Type.Object({
  id: Type.String(),
  providerId: Type.String(),
  displayName: Type.String(),
  endpoint: Type.String(),
  apiKeyConfigured: Type.Boolean()
});

export const ModelDeploymentSummarySchema = Type.Object({
  id: Type.String(),
  connectionId: Type.String(),
  displayName: Type.String(),
  modelName: Type.String(),
  apiVersion: Type.String(),
  declaredCapabilities: Type.Array(ModelCapabilitySchema),
  verifiedCapabilities: Type.Array(ModelCapabilitySchema)
});

export const RuntimeRouteSummarySchema = Type.Object({
  id: Type.String(),
  displayName: Type.String(),
  mode: VoicePipelineModeSchema,
  sttModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  chatModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  ttsModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  nativeModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  fallbackRouteId: Type.Union([Type.String(), Type.Null()])
});

export const RuntimeRoutingSummarySchema = Type.Object({
  connections: Type.Array(ProviderConnectionSummarySchema),
  models: Type.Array(ModelDeploymentSummarySchema),
  routes: Type.Array(RuntimeRouteSummarySchema),
  activeRouteId: Type.String()
});

export type ApiError = Static<typeof ApiErrorSchema>;
export type Health = Static<typeof HealthSchema>;
export type SetupStatus = Static<typeof SetupStatusSchema>;
export type PasswordInput = Static<typeof PasswordSchema>;
export type PasswordChange = Static<typeof PasswordChangeSchema>;
export type Session = Static<typeof SessionSchema>;
export type Dashboard = Static<typeof DashboardSchema>;
export type ChatRequest = Static<typeof ChatRequestSchema>;
export type ChatResponse = Static<typeof ChatResponseSchema>;
export type Message = Static<typeof MessageSchema>;
export type ConversationSummary = Static<typeof ConversationSummarySchema>;
export type ConversationDetail = Static<typeof ConversationDetailSchema>;
export type PipelineEvent = Static<typeof PipelineEventSchema>;
export type VoiceResponse = Static<typeof VoiceResponseSchema>;
export type LogEntry = Static<typeof LogEntrySchema>;
export type LlmMode = Static<typeof LlmModeSchema>;
export type LlmConfiguration = Static<typeof LlmConfigurationSchema>;
export type LlmConfigurationUpdate = Static<
  typeof LlmConfigurationUpdateSchema
>;
export type LlmConnectionTest = Static<typeof LlmConnectionTestSchema>;
export type SpeechProviderMode = Static<typeof SpeechProviderModeSchema>;
export type SpeechConfiguration = Static<typeof SpeechConfigurationSchema>;
export type SpeechConfigurationUpdate = Static<
  typeof SpeechConfigurationUpdateSchema
>;
export type SpeechConnectionTest = Static<typeof SpeechConnectionTestSchema>;
export type ProviderCatalog = Static<typeof ProviderCatalogSchema>;
export type VoicePipelineMode = Static<typeof VoicePipelineModeSchema>;
export type VoicePipelineConfiguration = Static<
  typeof VoicePipelineConfigurationSchema
>;
export type VoicePipelineConfigurationUpdate = Static<
  typeof VoicePipelineConfigurationUpdateSchema
>;
export type ModelCapability = Static<typeof ModelCapabilitySchema>;
export type ProviderConnectionSummary = Static<
  typeof ProviderConnectionSummarySchema
>;
export type ModelDeploymentSummary = Static<
  typeof ModelDeploymentSummarySchema
>;
export type RuntimeRouteSummary = Static<typeof RuntimeRouteSummarySchema>;
export type RuntimeRoutingSummary = Static<typeof RuntimeRoutingSummarySchema>;
