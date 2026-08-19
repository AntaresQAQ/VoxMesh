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
  MockLlmProvider,
  MockMcpServer,
  type LlmProvider
} from "@voxmesh/agent-core";
import { AzureOpenAiProvider } from "@voxmesh/ai";
import {
  MockSpeechToTextProvider,
  MockTextToSpeechProvider
} from "@voxmesh/audio";
import {
  ApiErrorSchema,
  ChatRequestSchema,
  ChatResponseSchema,
  ConversationDetailSchema,
  ConversationListSchema,
  DashboardSchema,
  HealthSchema,
  LlmConfigurationSchema,
  LlmConfigurationUpdateSchema,
  LlmConnectionTestSchema,
  LogListSchema,
  PasswordChangeSchema,
  PasswordSchema,
  SessionSchema,
  SetupStatusSchema,
  VoiceResponseSchema
} from "@voxmesh/shared";
import { VoxMeshStore, type StoredLlmConfiguration } from "@voxmesh/storage";

import type { ServerConfig } from "./config.js";
import { ConversationService } from "./conversation-service.js";
import { LoginRateLimiter } from "./login-rate-limiter.js";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword
} from "./security.js";

const SESSION_COOKIE = "voxmesh_session";

export interface AppDependencies {
  config: ServerConfig;
  store?: VoxMeshStore;
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
    dependencies.store ?? new VoxMeshStore(dependencies.config.databasePath);
  const mcp = new MockMcpServer();
  const conversationService = new ConversationService(
    store,
    mcp,
    () => createLlmProvider(store.getLlmConfiguration()),
    new MockSpeechToTextProvider(),
    new MockTextToSpeechProvider()
  );
  const loginRateLimiter = new LoginRateLimiter();
  const startedAt = Date.now();

  await app.register(fastifyCookie);
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
    "/api/config/llm",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: LlmConfigurationSchema,
          401: ApiErrorSchema
        }
      }
    },
    async () => publicLlmConfiguration(store.getLlmConfiguration())
  );

  app.put(
    "/api/config/llm",
    {
      preHandler: authenticate,
      schema: {
        body: LlmConfigurationUpdateSchema,
        response: {
          200: LlmConfigurationSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema
        }
      }
    },
    async (request) => {
      const current = store.getLlmConfiguration();
      validateLlmConfiguration({
        mode: request.body.mode,
        endpoint: request.body.endpoint,
        deployment: request.body.deployment,
        apiVersion: request.body.apiVersion,
        apiKey:
          request.body.apiKey ??
          (request.body.clearApiKey ? null : current.apiKey)
      });
      const updated = store.updateLlmConfiguration(request.body);
      store.addLog({
        category: "SYSTEM",
        level: "INFO",
        message: `LLM provider configured as ${updated.mode}`
      });
      return publicLlmConfiguration(updated);
    }
  );

  app.post(
    "/api/config/llm/test",
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: LlmConnectionTestSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema
        }
      }
    },
    async () => {
      const provider = createLlmProvider(store.getLlmConfiguration());
      const result = await provider.complete({
        messages: [
          {
            role: "user",
            content:
              "Reply with a short confirmation that the connection works."
          }
        ],
        tools: []
      });
      return {
        success: result.type === "message",
        response:
          result.type === "message"
            ? result.content
            : "Provider returned an unexpected tool call"
      };
    }
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
    async () => ({
      status: "online" as const,
      mode: "mock" as const,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      conversationCount: store.conversationCount(),
      mcp: {
        name: mcp.name,
        status: "connected" as const,
        enabledTools: (await mcp.listTools()).map((tool) => tool.name)
      },
      providers: {
        llm: store.getLlmConfiguration().mode,
        stt: "mock" as const,
        tts: "mock" as const
      }
    })
  );

  app.post(
    "/api/chat",
    {
      preHandler: authenticate,
      schema: {
        body: ChatRequestSchema,
        response: {
          200: ChatResponseSchema,
          401: ApiErrorSchema
        }
      }
    },
    async (request) => conversationService.runText(request.body.message)
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

function createLlmProvider(config: StoredLlmConfiguration): LlmProvider {
  validateLlmConfiguration(config);
  if (config.mode === "mock") {
    return new MockLlmProvider();
  }
  return new AzureOpenAiProvider({
    endpoint: config.endpoint,
    deployment: config.deployment,
    apiVersion: config.apiVersion,
    apiKey: config.apiKey ?? ""
  });
}

function validateLlmConfiguration(config: StoredLlmConfiguration): void {
  if (config.mode === "mock") {
    return;
  }
  if (
    !config.endpoint ||
    !config.deployment ||
    !config.apiVersion ||
    !config.apiKey
  ) {
    throw badRequest(
      "Azure OpenAI requires endpoint, deployment, API version, and API key"
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw badRequest("Azure OpenAI endpoint must be a valid URL");
  }
  if (endpoint.protocol !== "https:") {
    throw badRequest("Azure OpenAI endpoint must use HTTPS");
  }
}

function publicLlmConfiguration(config: StoredLlmConfiguration) {
  return {
    mode: config.mode,
    endpoint: config.endpoint,
    deployment: config.deployment,
    apiVersion: config.apiVersion,
    apiKeyConfigured: config.apiKey !== null
  };
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}
