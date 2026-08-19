import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "../i18n/i18n.js";
import { createQueryClient } from "../query.js";
import { ThemeProvider } from "../theme/theme.js";

export function renderWithProviders(
  element: ReactElement,
  options?: RenderOptions
) {
  const queryClient = createQueryClient();
  return render(
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          {element}
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>,
    options
  );
}
