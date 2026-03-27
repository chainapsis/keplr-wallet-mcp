import { describe, expect, it } from "vitest";
import { shouldRegisterPlugin } from "../../config/toolset-filter.js";

describe("shouldRegisterPlugin", () => {
  it("should always register meta-tools regardless of toolset config", () => {
    expect(shouldRegisterPlugin("meta-tools", ["cosmos-query"])).toBe(true);
    expect(shouldRegisterPlugin("meta-tools", [])).toBe(true);
  });

  it("should always register core plugins (required for auth flow)", () => {
    expect(shouldRegisterPlugin("accounts", [])).toBe(true);
    expect(shouldRegisterPlugin("confirm", [])).toBe(true);
    expect(shouldRegisterPlugin("auth", [])).toBe(true);
    expect(shouldRegisterPlugin("adapter-info", [])).toBe(true);
  });

  it("should register plugins in the default toolset", () => {
    expect(
      shouldRegisterPlugin("cosmos-query", [
        "cosmos-query",
        "cosmos-transaction",
      ]),
    ).toBe(true);
  });

  it("should skip plugins not in the default toolset", () => {
    expect(shouldRegisterPlugin("cosmwasm", ["cosmos-query"])).toBe(false);
  });

  it("should register everything if toolsets config is undefined", () => {
    expect(shouldRegisterPlugin("cosmwasm", undefined)).toBe(true);
    expect(shouldRegisterPlugin("cosmos-transaction", undefined)).toBe(true);
  });
});
