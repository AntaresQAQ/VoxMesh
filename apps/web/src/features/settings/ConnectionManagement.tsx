import { useState } from "react";

import type {
  ProviderConnectionInput,
  ProviderConnectionSummary,
  RuntimeRoutingSummary
} from "@voxmesh/shared";

import { useI18n } from "../../i18n/i18n.js";
import { ConnectionEditor } from "./ConnectionEditor.js";
import { ConnectionList } from "./ConnectionList.js";
import type { RuntimeRoutingOperation } from "./useRuntimeRoutingMutations.js";

export function ConnectionManagement(props: {
  routing: RuntimeRoutingSummary;
  pending: boolean;
  execute: (operation: RuntimeRoutingOperation) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<ProviderConnectionSummary | null>(
    null
  );
  const [creating, setCreating] = useState(false);
  const save = async (input: ProviderConnectionInput) => {
    await props.execute(
      editing
        ? { type: "update-connection", id: editing.id, input }
        : { type: "create-connection", input }
    );
    setEditing(null);
    setCreating(false);
  };
  return (
    <section>
      <ConnectionList
        connections={props.routing.connections}
        models={props.routing.models}
        pending={props.pending}
        editingId={editing?.id}
        renderEditor={(connection) =>
          editing?.id === connection.id ? (
            <ConnectionEditor
              connection={editing}
              pending={props.pending}
              onSave={save}
              onCancel={() => setEditing(null)}
            />
          ) : null
        }
        onEdit={(connection) => {
          setCreating(false);
          setEditing((current) =>
            current?.id === connection.id ? null : connection
          );
        }}
        onDelete={async (id) => {
          await props.execute({ type: "delete-connection", id });
        }}
      />
      {creating ? (
        <ConnectionEditor
          connection={null}
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
          {t("settings.addConnection")}
        </button>
      )}
    </section>
  );
}
