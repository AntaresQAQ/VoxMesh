import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { I18nProvider } from "./i18n/i18n.js";
import { ThemeProvider } from "./theme/theme.js";
import "./styles.css";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Application root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>
);
