import { existsSync } from "node:fs";

import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { Type } from "@fastify/type-provider-typebox";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";

import {
  MockMcpServer,
  type LlmProvider,
  type McpServer
} from "@voxmesh/agent-core";
import {
  ApiErrorSchema,
  ActiveRuntimeRouteUpdateSchema,
  ChatRetryRequestSchema,
  ChatRequestSchema,
  ChatResponseSchema,
  ConversationRunSchema,
  ConversationDetailSchema,
  ConversationListSchema,
  DashboardSchema,
  DeviceStatusSchema,
  HealthSchema,
  LogListSchema,
  ModelDeploymentInputSchema,
  PasswordChangeSchema,
  PasswordSchema,
  ProviderConnectionInputSchema,
  RuntimeRoutingSummarySchema,
  RuntimeRouteInputSchema,
  SessionSchema,
  SetupStatusSchema,
  VoiceResponseSchema
} from "@voxmesh/shared";
import type {
  ConversationRun,
  NormalizedRuntimeRouteInput,
  RuntimeRouteInput
} from "@voxmesh/shared";
import { VoxMeshStore } from "@voxmesh/storage";

import type { ServerConfig } from "./config.js";
import { ActiveRunRegistry } from "./active-run-registry.js";
import { ConversationService } from "./conversation-service.js";
import {
  UnavailableDeviceStatusProvider,
  type DeviceStatusProvider
} from "./device-status.js";
import { createLlmProvider } from "./llm-providers.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import { createNativeVoiceProvider } from "./native-voice-providers.js";
import { RealtimeEventHub } from "./realtime-event-hub.js";
import { registerRealtimeEventStream } from "./realtime-event-stream.js";
import { RuntimeRouteTester } from "./runtime-route-tester.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword
} from "./security.js";
import {
  createSpeechToTextProvider,
  createTextToSpeechProvider
} from "./speech-providers.js";
import { streamingRuntimeAvailability } from "./streaming-voice-providers.js";
import type { StreamingVoiceRunPreparation } from "./streaming-voice-coordinator.js";
import { registerVoiceStreamTransport } from "./voice-stream-transport.js";
import { registerWebSocketUpgradeFallback } from "./websocket-security.js";

const SESSION_COOKIE = "voxmesh_session";

export interface AppDependencies {
  config: ServerConfig;
  store?: VoxMeshStore;
  eventBufferCapacity?: number;
  eventHeartbeatMs?: number;
  eventMaxClients?: number;
  eventMaxBufferedBytes?: number;
  voiceMaxClients?: number;
  voiceMaxClientsPerAdministrator?: number;
  voiceMaxBufferedBytes?: number;
  voiceHeartbeatMs?: number;
  voiceSetupTimeoutMs?: number;
  voiceSessionTimeoutMs?: number;
  prepareStreamingVoiceRun?: () => StreamingVoiceRunPreparation;
  mcp?: McpServer;
  createLlm?: (routeId?: string) => LlmProvider;
  deviceStatusProvider?: DeviceStatusProvider;
}

export async function buildServer(
  dependencies: AppDependencies
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
      redact: ["req.headers.authorization", `req.cookies.${SESSION_COOKIE}`]
    }
  }).withTypeProvider<TypeBoxTypeProvider>();
  const store =
    dependencies.store ??
    new VoxMeshStore(
      dependencies.config.databasePath,
      streamingRuntimeAvailability
    );
  const mcp = dependencies.mcp ?? new MockMcpServer();
  const deviceStatusProvider =
    dependencies.deviceStatusProvider ?? new UnavailableDeviceStatusProvider();
  const createLlm =
    dependencies.createLlm ??
    ((routeId?: string) =>
      createLlmProvider(store.getRuntimeLlmConfiguration(routeId)));
  const conversationService = new ConversationService(
    store,
    mcp,
    createLlm,
    (routeId) =>
      createSpeechToTextProvider(store.getRuntimeSpeechConfiguration(routeId)),
    (routeId) =>
      createTextToSpeechProvider(store.getRuntimeSpeechConfiguration(routeId)),
    createNativeVoiceProvider
  );
  const runtimeRouteTester = new RuntimeRouteTester(store, mcp, createLlm);
  const loginRateLimiter = new LoginRateLimiter();
  const activeRuns = new ActiveRunRegistry();
  const startedAt = Date.now();
  const eventHub = new RealtimeEventHub(dependencies.eventBufferCapacity);
  const unsubscribeObservability = store.subscribeObservability((event) =>
    eventHub.publish(event)
  );

  await app.register(fastifyCookie);
  const eventStream = registerRealtimeEventStream({
    app,
    store,
    hub: eventHub,
    ...(dependencies.eventHeartbeatMs
      ? { heartbeatMs: dependencies.eventHeartbeatMs }
      : {}),
    ...(dependencies.eventMaxClients
      ? { maxClients: dependencies.eventMaxClients }
      : {}),
    ...(dependencies.eventMaxBufferedBytes
      ? { maxBufferedBytes: dependencies.eventMaxBufferedBytes }
      : {})
  });
  const voiceStream = registerVoiceStreamTransport({
    app,
    store,
    mcp,
    ...(dependencies.prepareStreamingVoiceRun
      ? { prepare: dependencies.prepareStreamingVoiceRun }
      : {}),
    ...(dependencies.voiceMaxClients
      ? { maxClients: dependencies.voiceMaxClients }
      : {}),
    ...(dependencies.voiceMaxClientsPerAdministrator
      ? {
          maxClientsPerAdministrator:
            dependencies.voiceMaxClientsPerAdministrator
        }
      : {}),
    ...(dependencies.voiceMaxBufferedBytes
      ? { maxBufferedBytes: dependencies.voiceMaxBufferedBytes }
      : {}),
    ...(dependencies.voiceHeartbeatMs
      ? { heartbeatMs: dependencies.voiceHeartbeatMs }
      : {}),
    ...(dependencies.voiceSetupTimeoutMs
      ? { setupTimeoutMs: dependencies.voiceSetupTimeoutMs }
      : {}),
    ...(dependencies.voiceSessionTimeoutMs
      ? { sessionTimeoutMs: dependencies.voiceSessionTimeoutMs }
      : {})
  });
  const webSocketFallback = registerWebSocketUpgradeFallback(
    app,
    new Set(["/api/events", "/api/voice-stream"])
  );
  app.addContentTypeParser(
    /^audio\/.+/,
    { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 },
    (_request, body, done) => done(null, body)
  );
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 },
    (_request, body, done) => done(null, body)
  );

  app.addHook("preClose", async () => {
    eventStream.close();
    await voiceStream.close();
    webSocketFallback.close();
    unsubscribeObservability();
  });
  app.addHook("onClose", async () => {
    if (!dependencies.store) {
      store.close();
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const normalizedError =
      error instanceof Error ? error : new Error("Unknown request error");
    request.log.error({ err: normalizedError }, "Request failed");
    const statusCode =
      "statusCode" in normalizedError &&
      typeof normalizedError.statusCode === "number"
        ? normalizedError.statusCode
        : 500;
    void reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message:
          statusCode >= 500
            ? "The request could not be completed"
            : normalizedError.message,
        requestId: request.id
      }
    });
  });

  app.get(
    "/api/health",
    {
      schema: {
        response: {
          200: HealthSchema
        }
      }
    },
    async () => ({
      status: "ok" as const,
      timestamp: new Date().toISOString()
    })
  );

  app.get(
    "/api/setup/status",
    {
      schema: {
        response: {
          200: SetupStatusSchema
        }
      }
    },
    async () => ({ setupRequired: !store.hasAdmin() })
  );

  app.post(
    "/api/setup",
    {
      schema: {
        body: PasswordSchema,
        response: {
          201: SetupStatusSchema,
          409: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const created = store.createAdmin(
        await hashPassword(request.body.password)
      );
      if (!created) {
        return reply.status(409).send({
          error: {
            code: "SETUP_ALREADY_COMPLETED",
            message: "Administrator setup has already been completed",
            requestId: request.id
          }
        });
      }
      store.addLog({
        category: "AUTH",
        level: "INFO",
        message: "Administrator setup completed"
      });
      return reply.status(201).send({ setupRequired: false });
    }
  );

  app.post(
    "/api/auth/login",
    {
      schema: {
        body: PasswordSchema,
        response: {
          200: SessionSchema,
          401: ApiErrorSchema,
          429: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const now = Date.now();
      if (loginRateLimiter.isBlocked(request.ip)) {
        return reply.status(429).send({
          error: {
            code: "LOGIN_RATE_LIMITED",
            message: "Too many login attempts. Try again later.",
            requestId: request.id
          }
        });
      }

      const passwordHash = store.getAdminPasswordHash();
      const valid =
        passwordHash !== null &&
        (await verifyPassword(request.body.password, passwordHash));
      if (!valid) {
        loginRateLimiter.recordFailure(request.ip);
        return reply.status(401).send({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "Invalid administrator credentials",
            requestId: request.id
          }
        });
      }

      loginRateLimiter.reset(request.ip);
      const token = createSessionToken();
      const expiresAt = new Date(
        now + dependencies.config.sessionTtlSeconds * 1000
      ).toISOString();
      store.createSession(hashSessionToken(token), expiresAt);
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: dependencies.config.cookieSecure,
        path: "/",
        maxAge: dependencies.config.sessionTtlSeconds
      });
      store.addLog({
        category: "AUTH",
        level: "INFO",
        message: "Administrator signed in"
      });
      return { authenticated: true as const, expiresAt };
    }
  );

  const authenticate = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply | undefined> => {
    const token = request.cookies[SESSION_COOKIE];
    const expiresAt = token
      ? store.getSessionExpiry(hashSessionToken(token))
      : null;
    if (!expiresAt) {
      return reply.status(401).send({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication is required",
          requestId: request.id
        }
      });
    }
    return undefined;
  };

  app.get(
    "/api/auth/session",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: SessionSchema,
          401: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      const expiresAt = token
        ? store.getSessionExpiry(hashSessionToken(token))
        : null;
      if (!expiresAt) {
        return reply.status(401).send({
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "Authentication is required",
            requestId: request.id
          }
        });
      }
      return { authenticated: true as const, expiresAt };
    }
  );

  app.post(
    "/api/auth/logout",
    {
      preHandler: authenticate,
      schema: {
        response: {
          204: Type.Null(),
          401: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) {
        store.deleteSession(hashSessionToken(token));
      }
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      store.addLog({
        category: "AUTH",
        level: "INFO",
        message: "Administrator signed out"
      });
      return reply.status(204).send(null);
    }
  );

  app.post(
    "/api/auth/password",
    {
      preHandler: authenticate,
      schema: {
        body: PasswordChangeSchema,
        response: {
          204: Type.Null(),
          400: ApiErrorSchema,
          401: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const passwordHash = store.getAdminPasswordHash();
      const valid =
        passwordHash !== null &&
        (await verifyPassword(request.body.currentPassword, passwordHash));
      if (!valid) {
        return reply.status(401).send({
          error: {
            code: "INVALID_CREDENTIALS",
            message: "The current administrator password is incorrect",
            requestId: request.id
          }
        });
      }
      if (request.body.currentPassword === request.body.newPassword) {
        return reply.status(400).send({
          error: {
            code: "PASSWORD_UNCHANGED",
            message: "The new password must be different",
            requestId: request.id
          }
        });
      }
      store.updateAdminPassword(await hashPassword(request.body.newPassword));
      store.deleteAllSessions();
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      store.addLog({
        category: "AUTH",
        level: "INFO",
        message: "Administrator password changed; all sessions revoked"
      });
      return reply.status(204).send(null);
    }
  );

  app.get(
    "/api/runtime-routing",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: RuntimeRoutingSummarySchema,
          401: ApiErrorSchema
        }
      }
    },
    async () => store.getRuntimeRoutingSummary()
  );

  app.post(
    "/api/runtime-routing/connections",
    {
      preHandler: authenticate,
      schema: {
        body: ProviderConnectionInputSchema,
        response: {
          201: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const result = store.createRuntimeConnection(request.body);
      return reply.code(201).send(result);
    }
  );

  app.put(
    "/api/runtime-routing/connections/:id",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: ProviderConnectionInputSchema,
        response: {
          200: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) =>
      store.updateRuntimeConnection(request.params.id, request.body)
  );

  app.delete(
    "/api/runtime-routing/connections/:id",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          200: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) => store.deleteRuntimeConnection(request.params.id)
  );

  app.post(
    "/api/runtime-routing/models",
    {
      preHandler: authenticate,
      schema: {
        body: ModelDeploymentInputSchema,
        response: {
          201: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const result = store.createRuntimeModel(request.body);
      return reply.code(201).send(result);
    }
  );

  app.put(
    "/api/runtime-routing/models/:id",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: ModelDeploymentInputSchema,
        response: {
          200: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) => store.updateRuntimeModel(request.params.id, request.body)
  );

  app.delete(
    "/api/runtime-routing/models/:id",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          200: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) => store.deleteRuntimeModel(request.params.id)
  );

  app.post(
    "/api/runtime-routing/routes",
    {
      preHandler: authenticate,
      schema: {
        body: RuntimeRouteInputSchema,
        response: {
          201: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const result = store.createRuntimeRoute(
        normalizeRuntimeRouteRequest(request.body)
      );
      return reply.code(201).send(result);
    }
  );

  app.put(
    "/api/runtime-routing/routes/:id",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: RuntimeRouteInputSchema,
        response: {
          200: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) =>
      store.updateRuntimeRoute(
        request.params.id,
        normalizeRuntimeRouteRequest(request.body)
      )
  );

  app.delete(
    "/api/runtime-routing/routes/:id",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          200: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) => store.deleteRuntimeRoute(request.params.id)
  );

  app.post(
    "/api/runtime-routing/routes/:id/test",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          200: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) => runtimeRouteTester.test(request.params.id)
  );

  app.put(
    "/api/runtime-routing/active",
    {
      preHandler: authenticate,
      schema: {
        body: ActiveRuntimeRouteUpdateSchema,
        response: {
          200: RuntimeRoutingSummarySchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) => store.activateRuntimeRoute(request.body.routeId)
  );

  app.get(
    "/api/device",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: DeviceStatusSchema,
          401: ApiErrorSchema
        }
      }
    },
    async () => deviceStatusProvider.getStatus()
  );

  app.get(
    "/api/dashboard",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: DashboardSchema,
          401: ApiErrorSchema
        }
      }
    },
    async () => {
      return {
        status: "online" as const,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        conversationCount: store.conversationCount(),
        mcp: {
          name: mcp.name,
          status: "connected" as const,
          enabledTools: (await mcp.listTools()).map((tool) => tool.name)
        },
        routing: store.getRuntimeRoutingSummary()
      };
    }
  );

  app.post(
    "/api/chat",
    {
      preHandler: authenticate,
      schema: {
        body: ChatRequestSchema,
        response: {
          200: ChatResponseSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const run = conversationService.startTextRun(
        request.body.runId,
        request.body.message,
        request.body.conversationId
      );
      return executeActiveTextRun(run, request, reply);
    }
  );

  async function executeActiveTextRun(
    run: ConversationRun,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const controller = activeRuns.start(run.id);
    if (store.getConversationRun(run.id).status !== "in_progress") {
      activeRuns.cancel(run.id);
    }
    const cancel = () => {
      const cancelled = store.cancelChatRun(run.id);
      if (cancelled.run.status === "cancelled") activeRuns.cancel(run.id);
    };
    const cancelOnDisconnect = () => {
      if (!reply.raw.writableEnded) cancel();
    };
    reply.raw.once("close", cancelOnDisconnect);
    try {
      return await conversationService.executeTextRun(run, controller.signal);
    } catch (error) {
      if (error instanceof Error && error.name === "AgentRunCancelledError") {
        return reply.status(409).send({
          error: {
            code: "RUN_CANCELLED",
            message: "Conversation run was cancelled",
            requestId: request.id
          }
        });
      }
      throw error;
    } finally {
      reply.raw.off("close", cancelOnDisconnect);
      activeRuns.finish(run.id, controller);
    }
  }

  app.post(
    "/api/chat/runs/:runId/retry",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({
          runId: Type.String({ format: "uuid" })
        }),
        body: ChatRetryRequestSchema,
        response: {
          200: ChatResponseSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const run = conversationService.startTextRetry(
        request.body.runId,
        request.params.runId
      );
      return executeActiveTextRun(run, request, reply);
    }
  );

  app.get(
    "/api/chat/runs/:runId",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({
          runId: Type.String({ format: "uuid" })
        }),
        response: {
          200: ConversationRunSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) => store.getConversationRun(request.params.runId)
  );

  app.post(
    "/api/chat/runs/:runId/cancel",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({
          runId: Type.String({ format: "uuid" })
        }),
        response: {
          200: ConversationRunSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request) => {
      const result = store.cancelChatRun(request.params.runId);
      if (result.run.status === "cancelled") {
        activeRuns.cancel(request.params.runId);
      }
      return result.run;
    }
  );

  app.post(
    "/api/voice",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: VoiceResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      if (!Buffer.isBuffer(request.body)) {
        return reply.status(400).send({
          error: {
            code: "INVALID_AUDIO_BODY",
            message: "Voice requests require a binary audio body",
            requestId: request.id
          }
        });
      }
      const mimeType =
        request.headers["content-type"]?.split(";")[0] ??
        "application/octet-stream";
      const result = await conversationService.runVoice({
        data: new Uint8Array(request.body),
        mimeType
      });
      return {
        conversationId: result.conversationId,
        transcript: result.transcript,
        response: result.response,
        usedTools: result.usedTools,
        audio: {
          base64: Buffer.from(result.audio.data).toString("base64"),
          mimeType: result.audio.mimeType,
          ...(result.audio.sampleRate === undefined
            ? {}
            : { sampleRate: result.audio.sampleRate }),
          ...(result.audio.channels === undefined
            ? {}
            : { channels: result.audio.channels })
        }
      };
    }
  );

  app.get(
    "/api/conversations",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: ConversationListSchema,
          401: ApiErrorSchema
        }
      }
    },
    async () => ({ conversations: store.listConversations() })
  );

  app.get(
    "/api/conversations/:id",
    {
      preHandler: authenticate,
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          200: ConversationDetailSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema
        }
      }
    },
    async (request, reply) => {
      const conversation = store.getConversation(request.params.id);
      if (!conversation) {
        return reply.status(404).send({
          error: {
            code: "CONVERSATION_NOT_FOUND",
            message: "Conversation not found",
            requestId: request.id
          }
        });
      }
      return conversation;
    }
  );

  app.get(
    "/api/logs",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: LogListSchema,
          401: ApiErrorSchema
        }
      }
    },
    async () => ({ logs: store.listLogs() })
  );

  if (existsSync(dependencies.config.webRoot)) {
    await app.register(fastifyStatic, {
      root: dependencies.config.webRoot,
      wildcard: false
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Route not found",
            requestId: request.id
          }
        });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

function normalizeRuntimeRouteRequest(
  input: RuntimeRouteInput
): NormalizedRuntimeRouteInput {
  return {
    ...input,
    chatStreamingEnabled: input.chatStreamingEnabled ?? false
  };
}
