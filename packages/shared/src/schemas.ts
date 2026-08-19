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
    llm: Type.Union([Type.Literal("mock"), Type.Literal("azure-openai")]),
    stt: Type.Literal("mock"),
    tts: Type.Literal("mock")
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
  Type.Literal("azure-openai")
]);

export const LlmConfigurationSchema = Type.Object({
  mode: LlmModeSchema,
  endpoint: Type.String(),
  deployment: Type.String(),
  apiVersion: Type.String(),
  apiKeyConfigured: Type.Boolean()
});

export const LlmConfigurationUpdateSchema = Type.Object({
  mode: LlmModeSchema,
  endpoint: Type.String({ maxLength: 2_048 }),
  deployment: Type.String({ maxLength: 256 }),
  apiVersion: Type.String({ maxLength: 64 }),
  apiKey: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  clearApiKey: Type.Optional(Type.Boolean())
});

export const LlmConnectionTestSchema = Type.Object({
  success: Type.Boolean(),
  response: Type.String()
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
