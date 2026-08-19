import { useState, type FormEvent } from "react";

import { CenteredCard } from "../../components/layout/CenteredCard.js";
import { useI18n } from "../../i18n/i18n.js";
import { localizedError } from "../../utils/errors.js";

export function PasswordScreen(props: {
  title: string;
  description: string;
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await props.onSubmit(password);
    } catch (caught) {
      setError(localizedError(caught, t, "common.requestFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CenteredCard title={props.title}>
      <p className="muted">{props.description}</p>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          {t("auth.password")}
          <input
            aria-label={t("auth.password")}
            aria-describedby={error ? "password-screen-error" : undefined}
            type="password"
            minLength={10}
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? (
          <p id="password-screen-error" className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy}>
          {busy ? t("common.working") : props.submitLabel}
        </button>
      </form>
    </CenteredCard>
  );
}
