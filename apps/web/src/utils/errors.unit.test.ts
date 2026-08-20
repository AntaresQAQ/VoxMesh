import { describe, expect, it } from "vitest";

import { ApiClientError } from "../api.js";
import { en } from "../i18n/en.js";
import { localizedError } from "./errors.js";

describe("localizedError", () => {
  it("preserves safe server validation details", () => {
    expect(
      localizedError(
        new ApiClientError(
          "REQUEST_ERROR",
          "Streaming routes cannot be activated"
        ),
        (key) => en[key],
        "common.requestFailed"
      )
    ).toBe("Streaming routes cannot be activated");
  });
});
