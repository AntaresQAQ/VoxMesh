import { useState } from "react";

import type {
  RuntimeRouteInput,
  RuntimeRouteSummary,
  RuntimeRoutingSummary
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { RouteEditor } from "./RouteEditor.js";
import { RouteList } from "./RouteList.js";
import type { RuntimeRoutingOperation } from "./useRuntimeRoutingMutations.js";

export function RouteManagement(props: {
  routing: RuntimeRoutingSummary;
  pending: boolean;
  status?: string;
  error?: string;
  execute: (operation: RuntimeRoutingOperation) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<RuntimeRouteSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const save = async (input: RuntimeRouteInput) => {
    await props.execute(
      editing
        ? { type: "update-route", id: editing.id, input }
        : { type: "create-route", input }
    );
    setEditing(null);
    setCreating(false);
  };
  return (
    <section>
      {props.status ? (
        <p className={props.pending ? "muted" : "success"} role="status">
          {props.status}
        </p>
      ) : null}
      {props.error ? (
        <p className="error" role="alert">
          {props.error}
        </p>
      ) : null}
      <RouteList
        routes={props.routing.routes}
        activeRouteId={props.routing.activeRouteId}
        pending={props.pending}
        editingId={editing?.id}
        renderEditor={(route) =>
          editing?.id === route.id ? (
            <RouteEditor
              route={editing}
              models={props.routing.models}
              connections={props.routing.connections}
              routes={props.routing.routes}
              streamingAvailability={props.routing.streamingAvailability}
              pending={props.pending}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : null
        }
        onEdit={(route) => {
          setCreating(false);
          setEditing((current) => (current?.id === route.id ? null : route));
        }}
        onTest={async (id) => {
          await props.execute({ type: "test-route", id });
        }}
        onTestAndActivate={async (id) => {
          await props.execute({ type: "test-and-activate-route", id });
        }}
        onDelete={async (id) => {
          await props.execute({ type: "delete-route", id });
        }}
      />
      {creating ? (
        <RouteEditor
          route={null}
          models={props.routing.models}
          connections={props.routing.connections}
          routes={props.routing.routes}
          streamingAvailability={props.routing.streamingAvailability}
          pending={props.pending}
          onSave={save}
          onCancel={() => {
            setCreating(false);
          }}
        />
      ) : (
        <button
          type="button"
          className="secondary routing-add-button"
          disabled={props.pending}
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          {t("settings.addRoute")}
        </button>
      )}
    </section>
  );
}
