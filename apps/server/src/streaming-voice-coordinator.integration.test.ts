import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { MockMcpServer } from "@voxmesh/agent-core";
import type { StreamingAudioChunk } from "@voxmesh/audio";
import { VoxMeshStore } from "@voxmesh/storage";

import {
  StreamingVoiceCoordinator,
  type StreamingVoiceCoordinatorResult
} from "./streaming-voice-coordinator.js";
import { prepareStreamingVoiceRun } from "./streaming-voice-providers.js";

it("completes and recovers a persisted Mock full-chain voice run", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voxmesh-streaming-voice-"));
  const databasePath = join(directory, "voxmesh.sqlite");
  let store: VoxMeshStore | undefined;
  try {
    store = new VoxMeshStore(databasePath);
    const routeId = createFullChainRoute(store);
    const result = await consumeResult(
      new StreamingVoiceCoordinator(store, new MockMcpServer()).run({
        runId: "35353535-3535-4535-8535-353535353535",
        preparation: prepareStreamingVoiceRun(store, routeId),
        format: {
          encoding: "pcm16le",
          sampleRate: 16_000,
          channels: 1
        },
        audio: frames(),
        toolMode: "enabled",
        signal: new AbortController().signal
      })
    );
    store.close();
    store = new VoxMeshStore(databasePath);

    expect(store.getConversationRun(result.runId)).toMatchObject({
      kind: "voice-composed",
      status: "completed"
    });
    expect(
      store
        .getConversation(result.conversationId)
        ?.messages.map(({ role, content }) => ({ role, content }))
    ).toEqual([
      { role: "user", content: "Check the light status" },
      {
        role: "assistant",
        content: "Mock tool reports living-room-light is on."
      }
    ]);
    expect(
      store
        .getVoiceRunRouteSnapshot(result.runId)
        .assignments.map(({ role, streamingEnabled }) => ({
          role,
          streamingEnabled
        }))
    ).toEqual([
      { role: "stt", streamingEnabled: true },
      { role: "chat", streamingEnabled: true },
      { role: "tts", streamingEnabled: true }
    ]);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFullChainRoute(store: VoxMeshStore): string {
  let routing = store.createRuntimeConnection({
    providerId: "mock",
    displayName: "Integration Mock",
    endpoint: "",
    enabled: true
  });
  const connection = routing.connections.find(
    (entry) => entry.displayName === "Integration Mock"
  );
  routing = store.createRuntimeModel({
    connectionId: connection?.id ?? "",
    displayName: "Integration Multi-role",
    modelName: "integration-mock",
    apiVersion: "",
    providerOptions: {},
    declaredCapabilities: [
      "audio-input",
      "audio-output",
      "text-input",
      "text-output",
      "transcription",
      "speech-synthesis",
      "tool-calling",
      "non-streaming",
      "streaming"
    ],
    enabled: true
  });
  const model = routing.models.find(
    (entry) => entry.displayName === "Integration Multi-role"
  );
  routing = store.createRuntimeRoute({
    displayName: "Integration Full Chain",
    mode: "composed",
    sttModelDeploymentId: model?.id ?? null,
    chatModelDeploymentId: model?.id ?? null,
    ttsModelDeploymentId: model?.id ?? null,
    nativeModelDeploymentId: null,
    fallbackRouteId: null,
    sttStreamingEnabled: true,
    chatStreamingEnabled: true,
    ttsStreamingEnabled: true,
    enabled: true
  });
  return (
    routing.routes.find(
      (entry) => entry.displayName === "Integration Full Chain"
    )?.id ?? ""
  );
}

async function* frames(): AsyncGenerator<StreamingAudioChunk> {
  const format = {
    encoding: "pcm16le",
    sampleRate: 16_000,
    channels: 1
  } as const;
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    yield { sequence, format, data: new Uint8Array(640) };
  }
}

async function consumeResult(
  run: AsyncGenerator<unknown, StreamingVoiceCoordinatorResult>
): Promise<StreamingVoiceCoordinatorResult> {
  while (true) {
    const next = await run.next();
    if (next.done) return next.value;
  }
}
