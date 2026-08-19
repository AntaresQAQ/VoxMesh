import { useState, type FormEvent } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../../api.js";
import { useI18n } from "../../i18n/i18n.js";
import { queryKeys } from "../../query.js";
import { localizedError } from "../../utils/errors.js";

export function PasswordChangeCard({
  onSessionEnded
}: {
  onSessionEnded: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const changePassword = useMutation({
    mutationFn: ({
      currentPassword,
      newPassword
    }: {
      currentPassword: string;
      newPassword: string;
    }) => apiClient.changePassword(currentPassword, newPassword)
  });
  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmation: ""
    },
    onSubmit: async ({ value }) => {
      if (value.newPassword !== value.confirmation) {
        setError(t("settings.passwordMismatch"));
        return;
      }
      setError("");
      try {
        await changePassword.mutateAsync({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword
        });
        queryClient.removeQueries({ queryKey: queryKeys.session });
        onSessionEnded();
      } catch (caught) {
        setError(localizedError(caught, t, "settings.passwordChangeFailed"));
      }
    }
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    void form.handleSubmit();
  };

  return (
    <section className="settings-card">
      <h3>{t("settings.passwordTitle")}</h3>
      <p className="muted">{t("settings.passwordDescription")}</p>
      <form onSubmit={submit}>
        <form.Field name="currentPassword">
          {(field) => (
            <label>
              {t("settings.currentPassword")}
              <input
                aria-label={t("settings.currentPassword")}
                aria-describedby={error ? "password-change-error" : undefined}
                type="password"
                minLength={10}
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
        <form.Field name="newPassword">
          {(field) => (
            <label>
              {t("settings.newPassword")}
              <input
                aria-label={t("settings.newPassword")}
                aria-describedby={error ? "password-change-error" : undefined}
                type="password"
                minLength={10}
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
        <form.Field name="confirmation">
          {(field) => (
            <label>
              {t("settings.confirmPassword")}
              <input
                aria-label={t("settings.confirmPassword")}
                aria-describedby={error ? "password-change-error" : undefined}
                type="password"
                minLength={10}
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </label>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <button disabled={isSubmitting}>
              {isSubmitting
                ? t("settings.changingPassword")
                : t("settings.changePassword")}
            </button>
          )}
        </form.Subscribe>
      </form>
      {error ? (
        <p id="password-change-error" className="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
