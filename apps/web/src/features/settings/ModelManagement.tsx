import { useState } from "react";

import type {
  ModelDeploymentInput,
  ModelDeploymentSummary,
  RuntimeRoutingSummary
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { ModelEditor } from "./ModelEditor.js";
import { ModelList } from "./ModelList.js";
import type { RuntimeRoutingOperation } from "./useRuntimeRoutingMutations.js";

export function ModelManagement(props: {
  routing: RuntimeRoutingSummary;
  pending: boolean;
  execute: (operation: RuntimeRoutingOperation) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<ModelDeploymentSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const save = async (input: ModelDeploymentInput) => {
    await props.execute(
      editing
        ? { type: "update-model", id: editing.id, input }
        : { type: "create-model", input }
    );
    setEditing(null);
    setCreating(false);
  };
  return (
    <section>
      <ModelList
        models={props.routing.models}
        routes={props.routing.routes}
        pending={props.pending}
        editingId={editing?.id}
        renderEditor={(model) =>
          editing?.id === model.id ? (
            <ModelEditor
              model={editing}
              connections={props.routing.connections}
              pending={props.pending}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : null
        }
        onEdit={(model) => {
          setCreating(false);
          setEditing((current) => (current?.id === model.id ? null : model));
        }}
        onDelete={async (id) => {
          await props.execute({ type: "delete-model", id });
        }}
      />
      {creating ? (
        <ModelEditor
          model={null}
          connections={props.routing.connections}
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
          {t("settings.addModel")}
        </button>
      )}
    </section>
  );
}
