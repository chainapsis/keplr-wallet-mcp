import { describe, expect, it, vi } from "vitest";
import { registerKeplrGuidePrompt } from "../../prompts/keplr-guide.js";

describe("keplr-guide prompt", () => {
  it("should register a prompt named 'keplr-guide'", () => {
    const registerPrompt = vi.fn();
    const mockServer = { registerPrompt } as any;

    registerKeplrGuidePrompt(mockServer);

    expect(registerPrompt).toHaveBeenCalledTimes(1);
    expect(registerPrompt.mock.calls[0][0]).toBe("keplr-guide");
  });

  it("should have a description in the config", () => {
    const registerPrompt = vi.fn();
    const mockServer = { registerPrompt } as any;

    registerKeplrGuidePrompt(mockServer);

    const config = registerPrompt.mock.calls[0][1];
    expect(config.description).toBeDefined();
    expect(config.description.length).toBeGreaterThan(0);
  });

  it("should return messages with search-tools and describe-tools guidance", async () => {
    const registerPrompt = vi.fn();
    const mockServer = { registerPrompt } as any;

    registerKeplrGuidePrompt(mockServer);

    const handler = registerPrompt.mock.calls[0][2];
    const result = await handler({} as any);

    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);

    const textContent = result.messages
      .map((m: any) =>
        typeof m.content === "string" ? m.content : m.content.text,
      )
      .join("\n");

    expect(textContent).toContain("search-tools");
    expect(textContent).toContain("describe-tools");
  });

  it("should mention available categories in the guide", async () => {
    const registerPrompt = vi.fn();
    const mockServer = { registerPrompt } as any;

    registerKeplrGuidePrompt(mockServer);

    const handler = registerPrompt.mock.calls[0][2];
    const result = await handler({} as any);

    const textContent = result.messages
      .map((m: any) =>
        typeof m.content === "string" ? m.content : m.content.text,
      )
      .join("\n");

    // Should mention key categories
    expect(textContent).toMatch(/cosmos/i);
    expect(textContent).toMatch(/account/i);
  });

  it("should include workflow examples", async () => {
    const registerPrompt = vi.fn();
    const mockServer = { registerPrompt } as any;

    registerKeplrGuidePrompt(mockServer);

    const handler = registerPrompt.mock.calls[0][2];
    const result = await handler({} as any);

    const textContent = result.messages
      .map((m: any) =>
        typeof m.content === "string" ? m.content : m.content.text,
      )
      .join("\n");

    // Should include usage examples
    expect(textContent).toMatch(/search-tools/);
    expect(textContent).toMatch(/describe-tools/);
  });
});
