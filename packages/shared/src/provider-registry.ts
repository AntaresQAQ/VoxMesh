export interface ProviderDefinition<TConfig, TProvider> {
  id: string;
  displayName: string;
  capabilities: ProviderCapability[];
  validate: (config: TConfig) => void;
  create: (config: TConfig) => TProvider;
}

export type ProviderCapability =
  | "llm"
  | "stt"
  | "tts"
  | "audio-input"
  | "audio-output"
  | "tool-calling"
  | "native-multimodal";

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  capabilities: ProviderCapability[];
}

/**
 * Resolves configured provider IDs to validated factories.
 *
 * Applications own registration; Agent Core and feature services continue to
 * depend only on provider interfaces.
 */
export class ProviderRegistry<TConfig, TProvider> {
  private readonly definitions = new Map<
    string,
    ProviderDefinition<TConfig, TProvider>
  >();

  public constructor(
    private readonly selectProviderId: (config: TConfig) => string
  ) {}

  public register(definition: ProviderDefinition<TConfig, TProvider>): this {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Provider is already registered: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
    return this;
  }

  public create(config: TConfig): TProvider {
    const id = this.selectProviderId(config);
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new Error(`Unknown provider: ${id}`);
    }
    definition.validate(config);
    return definition.create(config);
  }

  public ids(): string[] {
    return [...this.definitions.keys()];
  }

  public descriptors(): ProviderDescriptor[] {
    return [...this.definitions.values()].map((definition) => ({
      id: definition.id,
      displayName: definition.displayName,
      capabilities: [...definition.capabilities]
    }));
  }
}
