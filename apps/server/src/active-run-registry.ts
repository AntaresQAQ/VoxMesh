export class ActiveRunRegistry {
  private readonly controllers = new Map<string, AbortController>();

  public start(runId: string): AbortController {
    if (this.controllers.has(runId)) {
      throw Object.assign(new Error("Conversation run is already active"), {
        statusCode: 409
      });
    }
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  public cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  public finish(runId: string, controller: AbortController): void {
    if (this.controllers.get(runId) === controller) {
      this.controllers.delete(runId);
    }
  }
}
