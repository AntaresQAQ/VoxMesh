import type { ReactNode } from "react";

import { useI18n } from "../../i18n/i18n.js";

export function PageHeader(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <>
      <header>
        <p className="eyebrow">{t("common.tagline")}</p>
        <h2 data-route-heading tabIndex={-1}>
          {props.title}
        </h2>
        <p className="muted">{props.description}</p>
      </header>
      {props.children}
    </>
  );
}
