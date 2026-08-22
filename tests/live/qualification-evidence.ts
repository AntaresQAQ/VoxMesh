import type { ProviderReadinessErrorCategory } from "../../packages/shared/src/schemas.js";
import {
  LiveTestRequestError,
  sanitizeLiveTestError
} from "./provider-test-harness.js";

export interface QualificationEvidence {
  providerFamily: string;
  capability: string;
  regionCategory: "operator-configured";
  modelFamily: "operator-configured";
  testedAt: string;
  outcome: "passed" | "failed";
  durationMs: number;
  errorCategory: ProviderReadinessErrorCategory | null;
}

interface QualificationEvidenceDependencies {
  now: () => Date;
  write: (line: string) => void;
}

const defaultDependencies: QualificationEvidenceDependencies = {
  now: () => new Date(),
  write: (line) => process.stdout.write(`${line}\n`)
};

/**
 * Emits only allow-listed qualification metadata. Provider inputs, outputs,
 * deployment names, endpoints, and error messages are deliberately excluded.
 */
export async function recordQualificationEvidence<T>(
  providerFamily: string,
  capability: string,
  operation: () => Promise<T>,
  dependencies: QualificationEvidenceDependencies = defaultDependencies
): Promise<T> {
  const startedAt = dependencies.now();
  try {
    const result = await operation();
    emitEvidence(
      providerFamily,
      capability,
      startedAt,
      "passed",
      null,
      dependencies
    );
    return result;
  } catch (error) {
    const category =
      error instanceof LiveTestRequestError
        ? error.category
        : sanitizeLiveTestError(error).category;
    emitEvidence(
      providerFamily,
      capability,
      startedAt,
      "failed",
      category,
      dependencies
    );
    throw error;
  }
}

function emitEvidence(
  providerFamily: string,
  capability: string,
  startedAt: Date,
  outcome: QualificationEvidence["outcome"],
  errorCategory: ProviderReadinessErrorCategory | null,
  dependencies: QualificationEvidenceDependencies
): void {
  const completedAt = dependencies.now();
  const evidence: QualificationEvidence = {
    providerFamily,
    capability,
    regionCategory: "operator-configured",
    modelFamily: "operator-configured",
    testedAt: completedAt.toISOString(),
    outcome,
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    errorCategory
  };
  dependencies.write(`VOXMESH_LIVE_EVIDENCE ${JSON.stringify(evidence)}`);
}
