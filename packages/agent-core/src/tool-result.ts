import { VOICE_STREAM_LIMITS } from "@voxmesh/shared";

export type McpResultSerializationErrorCode = "INVALID" | "LIMIT_EXCEEDED";

export class McpResultSerializationError extends Error {
  public constructor(
    public readonly code: McpResultSerializationErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "McpResultSerializationError";
  }
}

/** Serializes one MCP result with the shared Agent request-memory bound. */
export function serializeMcpResult(toolName: string, result: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify({ name: toolName, result });
    if (typeof serialized !== "string") throw new Error("No JSON result");
  } catch (error) {
    throw new McpResultSerializationError(
      "INVALID",
      "MCP tool result could not be serialized",
      { cause: error }
    );
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
    VOICE_STREAM_LIMITS.maxMcpResultBytes
  ) {
    throw new McpResultSerializationError(
      "LIMIT_EXCEEDED",
      "MCP tool result exceeded its byte limit"
    );
  }
  return serialized;
}
