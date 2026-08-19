import type { ReactNode } from "react";

import { LanguageSelector } from "../../i18n/LanguageSelector.js";
import { useI18n } from "../../i18n/i18n.js";

export function CenteredCard(props: { title: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="centered">
      <section className="card">
        <div className="card-toolbar">
          <p className="eyebrow">{t("common.tagline")}</p>
          <LanguageSelector compact />
        </div>
        <h1 data-route-heading tabIndex={-1}>
          {props.title}
        </h1>
        {props.children}
      </section>
    </div>
  );
}
