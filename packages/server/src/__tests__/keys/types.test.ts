import { describe, expect, it } from "vitest";
import {
  KeyProviderError,
  KeyProviderErrorCode,
  type KeyProviderType,
} from "../../keys/types.js";

describe("KeyProvider Types", () => {
  describe("KeyProviderType", () => {
    it("should include expected types", () => {
      const validTypes: KeyProviderType[] = [
        "mnemonic",
        "passkey",
        "smart-account",
      ];

      // Type check passes if this compiles
      expect(validTypes).toHaveLength(3);
    });
  });

  describe("KeyProviderError", () => {
    it("should create error with code", () => {
      const error = new KeyProviderError(
        "Test error",
        KeyProviderErrorCode.NETWORK_ERROR,
      );

      expect(error.message).toBe("Test error");
      expect(error.code).toBe(KeyProviderErrorCode.NETWORK_ERROR);
      expect(error.name).toBe("KeyProviderError");
      expect(error.cause).toBeUndefined();
    });

    it("should create error with cause", () => {
      const cause = new Error("Original error");
      const error = new KeyProviderError(
        "Wrapped error",
        KeyProviderErrorCode.NETWORK_ERROR,
        cause,
      );

      expect(error.message).toBe("Wrapped error");
      expect(error.code).toBe(KeyProviderErrorCode.NETWORK_ERROR);
      expect(error.cause).toBe(cause);
    });

    it("should have all expected error codes", () => {
      expect(KeyProviderErrorCode.USER_REJECTED).toBe("USER_REJECTED");
      expect(KeyProviderErrorCode.UNSUPPORTED_SIGN_TYPE).toBe(
        "UNSUPPORTED_SIGN_TYPE",
      );
      expect(KeyProviderErrorCode.UNSUPPORTED_CHAIN).toBe("UNSUPPORTED_CHAIN");
      expect(KeyProviderErrorCode.NOT_READY).toBe("NOT_READY");
      expect(KeyProviderErrorCode.INVALID_CONFIG).toBe("INVALID_CONFIG");
      expect(KeyProviderErrorCode.NETWORK_ERROR).toBe("NETWORK_ERROR");
      expect(KeyProviderErrorCode.UNKNOWN).toBe("UNKNOWN");
    });
  });
});
