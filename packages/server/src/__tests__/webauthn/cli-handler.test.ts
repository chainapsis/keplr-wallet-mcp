import { describe, expect, it } from "vitest";
import {
  CLIWebAuthnHandler,
  createCLIWebAuthnHandler,
  isWebAuthnAvailable,
} from "../../webauthn/cli-handler.js";

describe("CLIWebAuthnHandler", () => {
  describe("construction", () => {
    it("should create handler", () => {
      const handler = new CLIWebAuthnHandler();
      expect(handler).toBeInstanceOf(CLIWebAuthnHandler);
    });
  });

  describe("createCLIWebAuthnHandler", () => {
    it("should create handler via factory", () => {
      const handler = createCLIWebAuthnHandler();
      expect(handler).toBeInstanceOf(CLIWebAuthnHandler);
    });
  });

  describe("isAvailable", () => {
    it("should return boolean", async () => {
      const handler = new CLIWebAuthnHandler();
      const available = await handler.isAvailable();
      expect(typeof available).toBe("boolean");
    });
  });

  describe("isWebAuthnAvailable", () => {
    it("should return boolean", async () => {
      const available = await isWebAuthnAvailable();
      expect(typeof available).toBe("boolean");
    });
  });

  describe("requestAssertion", () => {
    it("should throw if not available", async () => {
      const handler = new CLIWebAuthnHandler();
      const available = await handler.isAvailable();

      if (!available) {
        await expect(
          handler.requestAssertion({
            challenge: new Uint8Array(32),
            credentialId: new Uint8Array(16),
          }),
        ).rejects.toThrow();
      }
    });
  });

  describe("register", () => {
    it("should throw if not available", async () => {
      const handler = new CLIWebAuthnHandler();
      const available = await handler.isAvailable();

      if (!available) {
        await expect(
          handler.register({
            rpId: "example.com",
            rpName: "Example",
            userId: new Uint8Array(16),
            userName: "test",
            challenge: new Uint8Array(32),
          }),
        ).rejects.toThrow();
      }
    });
  });
});
