import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./security.js";

describe("password security", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(hash).not.toContain("correct horse battery staple");
    await expect(
      verifyPassword("correct horse battery staple", hash)
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });
});
