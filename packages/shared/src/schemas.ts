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

export const ChatRequestSchema = Type.Object({
  runId: Type.String({ format: "uuid" }),
  message: Type.String({ minLength: 1, maxLength: 8_000 }),
  conversationId: Type.Optional(Type.String({ minLength: 1 }))
});

export const ChatRetryRequestSchema = Type.Object({
  runId: Type.String({ format: "uuid" })
});

export const ChatResponseSchema = Type.Object({
  runId: Type.String({ format: "uuid" }),
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
  runId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
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

export const ConversationRunKindSchema = Type.Union([
  Type.Literal("chat"),
  Type.Literal("voice-composed"),
  Type.Literal("voice-native")
]);

export const ConversationRunStatusSchema = Type.Union([
  Type.Literal("in_progress"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("cancelled")
]);

export const ConversationRunSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  conversationId: Type.String(),
  kind: ConversationRunKindSchema,
  status: ConversationRunStatusSchema,
  correlationId: Type.String({ format: "uuid" }),
  inputMessageId: Type.Union([Type.String(), Type.Null()]),
  retryOfRunId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  startedAt: Type.String({ format: "date-time" }),
  completedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  errorCode: Type.Union([Type.String(), Type.Null()])
});

export const PipelineEventSchema = Type.Object({
  id: Type.String(),
  runId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  correlationId: Type.Union([Type.String({ format: "uuid" }), Type.Null()]),
  stage: Type.Union([
    Type.Literal("STT"),
    Type.Literal("AGENT"),
    Type.Literal("MCP"),
    Type.Literal("TTS")
  ]),
  status: Type.Union([
    Type.Literal("started"),
    Type.Literal("completed"),
    Type.Literal("failed"),
    Type.Literal("cancelled")
  ]),
  durationMs: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  message: Type.String(),
  createdAt: Type.String({ format: "date-time" })
});

export const ConversationDetailSchema = Type.Intersect([
  ConversationSummarySchema,
  Type.Object({
    messages: Type.Array(MessageSchema),
    events: Type.Array(PipelineEventSchema),
    runs: Type.Array(ConversationRunSchema)
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

export const RealtimeEventSchema = Type.Union([
  Type.Object({
    version: Type.Literal(1),
    streamId: Type.String(),
    sequence: Type.Integer({ minimum: 1 }),
    eventId: Type.String(),
    emittedAt: Type.String({ format: "date-time" }),
    type: Type.Literal("log.created"),
    payload: Type.Object({
      log: LogEntrySchema
    })
  }),
  Type.Object({
    version: Type.Literal(1),
    streamId: Type.String(),
    sequence: Type.Integer({ minimum: 1 }),
    eventId: Type.String(),
    emittedAt: Type.String({ format: "date-time" }),
    type: Type.Literal("run.created"),
    payload: Type.Object({
      run: ConversationRunSchema
    })
  }),
  Type.Object({
    version: Type.Literal(1),
    streamId: Type.String(),
    sequence: Type.Integer({ minimum: 1 }),
    eventId: Type.String(),
    emittedAt: Type.String({ format: "date-time" }),
    type: Type.Literal("run.updated"),
    payload: Type.Object({
      run: ConversationRunSchema
    })
  }),
  Type.Object({
    version: Type.Literal(1),
    streamId: Type.String(),
    sequence: Type.Integer({ minimum: 1 }),
    eventId: Type.String(),
    emittedAt: Type.String({ format: "date-time" }),
    type: Type.Literal("message.created"),
    payload: Type.Object({
      conversationId: Type.String(),
      message: MessageSchema
    })
  }),
  Type.Object({
    version: Type.Literal(1),
    streamId: Type.String(),
    sequence: Type.Integer({ minimum: 1 }),
    eventId: Type.String(),
    emittedAt: Type.String({ format: "date-time" }),
    type: Type.Literal("pipeline.created"),
    payload: Type.Object({
      conversationId: Type.String(),
      event: PipelineEventSchema
    })
  })
]);

export const EventStreamMessageSchema = Type.Union([
  Type.Object({
    version: Type.Literal(1),
    type: Type.Literal("stream.ready"),
    streamId: Type.String(),
    latestSequence: Type.Integer({ minimum: 0 }),
    oldestAvailableSequence: Type.Union([
      Type.Integer({ minimum: 1 }),
      Type.Null()
    ])
  }),
  Type.Object({
    version: Type.Literal(1),
    type: Type.Literal("stream.event"),
    event: RealtimeEventSchema
  }),
  Type.Object({
    version: Type.Literal(1),
    type: Type.Literal("stream.gap"),
    streamId: Type.String(),
    requestedAfter: Type.Integer({ minimum: 0 }),
    oldestAvailableSequence: Type.Integer({ minimum: 1 }),
    latestSequence: Type.Integer({ minimum: 1 })
  }),
  Type.Object({
    version: Type.Literal(1),
    type: Type.Literal("stream.heartbeat"),
    streamId: Type.String(),
    emittedAt: Type.String({ format: "date-time" }),
    latestSequence: Type.Integer({ minimum: 0 })
  }),
  Type.Object({
    version: Type.Literal(1),
    type: Type.Literal("stream.error"),
    code: Type.String(),
    message: Type.String()
  })
]);

export const LlmModeSchema = Type.Union([
  Type.Literal("mock"),
  Type.Literal("azure-openai"),
  Type.Literal("openai-compatible")
]);

export const SpeechProviderModeSchema = Type.Union([
  Type.Literal("mock"),
  Type.Literal("azure-openai"),
  Type.Literal("openai-compatible"),
  Type.Literal("alibaba-model-studio")
]);

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

export const VoicePipelineModeSchema = Type.Union([
  Type.Literal("composed"),
  Type.Literal("native-multimodal")
]);

export const ModelCapabilitySchema = Type.Union([
  Type.Literal("text-input"),
  Type.Literal("text-output"),
  Type.Literal("audio-input"),
  Type.Literal("audio-output"),
  Type.Literal("transcription"),
  Type.Literal("speech-synthesis"),
  Type.Literal("tool-calling"),
  Type.Literal("native-multimodal"),
  Type.Literal("streaming"),
  Type.Literal("non-streaming")
]);

export const ProviderConnectionSummarySchema = Type.Object({
  id: Type.String(),
  providerId: Type.String(),
  displayName: Type.String(),
  endpoint: Type.String(),
  apiKeyConfigured: Type.Boolean(),
  enabled: Type.Boolean()
});

export const ModelDeploymentSummarySchema = Type.Object({
  id: Type.String(),
  connectionId: Type.String(),
  displayName: Type.String(),
  modelName: Type.String(),
  apiVersion: Type.String(),
  providerOptions: Type.Record(
    Type.String(),
    Type.Union([Type.String(), Type.Number(), Type.Boolean()])
  ),
  declaredCapabilities: Type.Array(ModelCapabilitySchema),
  verifiedCapabilities: Type.Array(ModelCapabilitySchema),
  enabled: Type.Boolean()
});

export const RuntimeRouteSummarySchema = Type.Object({
  id: Type.String(),
  displayName: Type.String(),
  mode: VoicePipelineModeSchema,
  sttModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  chatModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  ttsModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  nativeModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  fallbackRouteId: Type.Union([Type.String(), Type.Null()]),
  sttStreamingEnabled: Type.Boolean(),
  ttsStreamingEnabled: Type.Boolean(),
  enabled: Type.Boolean()
});

export const RuntimeRoutingSummarySchema = Type.Object({
  connections: Type.Array(ProviderConnectionSummarySchema),
  models: Type.Array(ModelDeploymentSummarySchema),
  routes: Type.Array(RuntimeRouteSummarySchema),
  activeRouteId: Type.String()
});

export const DashboardSchema = Type.Object({
  status: Type.Literal("online"),
  uptimeSeconds: Type.Number({ minimum: 0 }),
  conversationCount: Type.Integer({ minimum: 0 }),
  mcp: Type.Object({
    name: Type.String(),
    status: Type.Literal("connected"),
    enabledTools: Type.Array(Type.String())
  }),
  routing: RuntimeRoutingSummarySchema
});

export const ProviderConnectionInputSchema = Type.Object({
  providerId: Type.String({ minLength: 1, maxLength: 128 }),
  displayName: Type.String({ minLength: 1, maxLength: 128 }),
  endpoint: Type.String({ maxLength: 2_048 }),
  apiKey: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  clearApiKey: Type.Optional(Type.Boolean()),
  enabled: Type.Boolean()
});

export const ModelDeploymentInputSchema = Type.Object({
  connectionId: Type.String({ minLength: 1, maxLength: 128 }),
  displayName: Type.String({ minLength: 1, maxLength: 128 }),
  modelName: Type.String({ minLength: 1, maxLength: 256 }),
  apiVersion: Type.String({ maxLength: 64 }),
  providerOptions: Type.Record(
    Type.String({ maxLength: 128 }),
    Type.Union([Type.String(), Type.Number(), Type.Boolean()])
  ),
  declaredCapabilities: Type.Array(ModelCapabilitySchema, {
    minItems: 1,
    uniqueItems: true
  }),
  enabled: Type.Boolean()
});

export const RuntimeRouteInputSchema = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 128 }),
  mode: VoicePipelineModeSchema,
  sttModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  chatModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  ttsModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  nativeModelDeploymentId: Type.Union([Type.String(), Type.Null()]),
  fallbackRouteId: Type.Union([Type.String(), Type.Null()]),
  sttStreamingEnabled: Type.Boolean(),
  ttsStreamingEnabled: Type.Boolean(),
  enabled: Type.Boolean()
});

export const ActiveRuntimeRouteUpdateSchema = Type.Object({
  routeId: Type.String({ minLength: 1, maxLength: 128 })
});

export type ApiError = Static<typeof ApiErrorSchema>;
export type Health = Static<typeof HealthSchema>;
export type SetupStatus = Static<typeof SetupStatusSchema>;
export type PasswordInput = Static<typeof PasswordSchema>;
export type PasswordChange = Static<typeof PasswordChangeSchema>;
export type Session = Static<typeof SessionSchema>;
export type Dashboard = Static<typeof DashboardSchema>;
export type ChatRequest = Static<typeof ChatRequestSchema>;
export type ChatRetryRequest = Static<typeof ChatRetryRequestSchema>;
export type ChatResponse = Static<typeof ChatResponseSchema>;
export type Message = Static<typeof MessageSchema>;
export type ConversationSummary = Static<typeof ConversationSummarySchema>;
export type ConversationDetail = Static<typeof ConversationDetailSchema>;
export type ConversationRunKind = Static<typeof ConversationRunKindSchema>;
export type ConversationRunStatus = Static<typeof ConversationRunStatusSchema>;
export type ConversationRun = Static<typeof ConversationRunSchema>;
export type PipelineEvent = Static<typeof PipelineEventSchema>;
export type VoiceResponse = Static<typeof VoiceResponseSchema>;
export type LogEntry = Static<typeof LogEntrySchema>;
export type RealtimeEvent = Static<typeof RealtimeEventSchema>;
export type EventStreamMessage = Static<typeof EventStreamMessageSchema>;
export type LlmMode = Static<typeof LlmModeSchema>;
export type SpeechProviderMode = Static<typeof SpeechProviderModeSchema>;
export type VoicePipelineMode = Static<typeof VoicePipelineModeSchema>;
export type ModelCapability = Static<typeof ModelCapabilitySchema>;
export type ProviderConnectionSummary = Static<
  typeof ProviderConnectionSummarySchema
>;
export type ModelDeploymentSummary = Static<
  typeof ModelDeploymentSummarySchema
>;
export type RuntimeRouteSummary = Static<typeof RuntimeRouteSummarySchema>;
export type RuntimeRoutingSummary = Static<typeof RuntimeRoutingSummarySchema>;
export type ProviderConnectionInput = Static<
  typeof ProviderConnectionInputSchema
>;
export type ModelDeploymentInput = Static<typeof ModelDeploymentInputSchema>;
export type RuntimeRouteInput = Static<typeof RuntimeRouteInputSchema>;
export type ActiveRuntimeRouteUpdate = Static<
  typeof ActiveRuntimeRouteUpdateSchema
>;
