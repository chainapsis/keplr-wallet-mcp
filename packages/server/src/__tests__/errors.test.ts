import { describe, expect, it } from "vitest";
import {
  classifyError,
  ErrorCategory,
  enhanceWithRetryAction,
  parseCosmWasmMsgError,
} from "../errors.js";

describe("Error Classification", () => {
  describe("classifyError", () => {
    // Timeout errors
    it("should classify timeout errors", () => {
      const result = classifyError("Request timed out");
      expect(result.category).toBe(ErrorCategory.TIMEOUT);
      expect(result.recoverable).toBe(true);
    });

    // Network errors
    it("should classify network errors", () => {
      const result = classifyError("fetch failed: ECONNREFUSED");
      expect(result.category).toBe(ErrorCategory.NETWORK);
      expect(result.recoverable).toBe(true);
    });

    // Insufficient balance
    it("should classify insufficient balance errors", () => {
      const result = classifyError("Insufficient funds for transfer");
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.recoverable).toBe(false);
    });

    // CosmWasm message parsing errors
    it("should classify CosmWasm unknown variant as VALIDATION", () => {
      const result = classifyError(
        "Error parsing into type drop_staking_base::msg::factory::ExecuteMsg: unknown variant `unstake`, expected one of `update_config`, `proxy`, `admin_execute`, `update_ownership`",
      );
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.recoverable).toBe(false);
    });

    it("should not misclassify CosmWasm errors with gas suffix as gas errors", () => {
      const result = classifyError(
        "Error parsing into type drop_staking_base::msg::factory::ExecuteMsg: unknown variant `unstake`, expected one of `update_config`, `proxy`, `admin_execute`, `update_ownership`: query wasm contract failed: unknown request with gas used: '163969'",
      );
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.recoverable).toBe(false);
      expect(result.suggestion).toContain("contract message format");
    });

    // Gas errors
    it("should classify gas errors", () => {
      const result = classifyError("Gas estimation failed");
      expect(result.category).toBe(ErrorCategory.CHAIN);
      expect(result.recoverable).toBe(true);
    });

    it("should classify out of gas errors", () => {
      const result = classifyError("out of gas in location");
      expect(result.category).toBe(ErrorCategory.CHAIN);
      expect(result.recoverable).toBe(true);
    });

    it("should not match generic 'gas' mention as gas error", () => {
      const result = classifyError("some error with gas used: '163969'");
      // Should NOT match the gas pattern (no longer uses /gas/i)
      expect(result.category).not.toBe(ErrorCategory.CHAIN);
    });

    // User rejection
    it("should classify user rejection errors", () => {
      const result = classifyError("User rejected the request");
      expect(result.category).toBe(ErrorCategory.WALLET);
      expect(result.recoverable).toBe(true);
    });

    // Setup required
    it("should classify setup required errors", () => {
      const result = classifyError("No mnemonic configured");
      expect(result.category).toBe(ErrorCategory.SETUP_REQUIRED);
      expect(result.recoverable).toBe(true);
    });

    // EVM: Nonce errors
    it("should classify nonce too low errors", () => {
      const result = classifyError("nonce too low");
      expect(result.category).toBe(ErrorCategory.CHAIN);
      expect(result.recoverable).toBe(true);
    });

    it("should classify replacement transaction underpriced", () => {
      const result = classifyError("replacement transaction underpriced");
      expect(result.category).toBe(ErrorCategory.CHAIN);
      expect(result.recoverable).toBe(true);
    });

    // EVM: Contract execution errors
    it("should classify execution reverted errors", () => {
      const result = classifyError(
        "execution reverted: Ownable: caller is not the owner",
      );
      expect(result.category).toBe(ErrorCategory.CHAIN);
      expect(result.recoverable).toBe(false);
    });

    it("should classify revert errors", () => {
      const result = classifyError("Transaction has been reverted by the EVM");
      expect(result.category).toBe(ErrorCategory.CHAIN);
      expect(result.recoverable).toBe(false);
    });

    // EVM: Contract not found
    it("should classify contract not found errors", () => {
      const result = classifyError("contract does not exist at address");
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.recoverable).toBe(false);
    });

    // EVM: ABI errors
    it("should classify invalid ABI errors", () => {
      const result = classifyError("invalid abi: expected array");
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.recoverable).toBe(false);
    });

    it("should classify function not found errors", () => {
      const result = classifyError("no matching function in the abi");
      expect(result.category).toBe(ErrorCategory.VALIDATION);
      expect(result.recoverable).toBe(false);
    });

    // Unknown errors
    it("should classify unknown errors", () => {
      const result = classifyError("Some completely random error");
      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.recoverable).toBe(false);
    });

    // Error object handling
    it("should handle Error objects", () => {
      const result = classifyError(new Error("nonce too low"));
      expect(result.category).toBe(ErrorCategory.CHAIN);
    });
  });

  describe("parseCosmWasmMsgError", () => {
    it("should parse unknown variant errors", () => {
      const result = parseCosmWasmMsgError(
        "Error parsing into type drop_staking_base::msg::factory::ExecuteMsg: unknown variant `unstake`, expected one of `update_config`, `proxy`, `admin_execute`, `update_ownership`",
      );
      expect(result).not.toBeNull();
      expect(result!.errorType).toBe("unknown_variant");
      expect(result!.targetType).toBe(
        "drop_staking_base::msg::factory::ExecuteMsg",
      );
      expect(result!.sentValue).toBe("unstake");
      expect(result!.availableVariants).toEqual([
        "update_config",
        "proxy",
        "admin_execute",
        "update_ownership",
      ]);
    });

    it("should parse unknown variant errors with gas suffix", () => {
      const result = parseCosmWasmMsgError(
        "Error parsing into type drop_staking_base::msg::factory::ExecuteMsg: unknown variant `unstake`, expected one of `update_config`, `proxy`, `admin_execute`, `update_ownership`: query wasm contract failed: unknown request with gas used: '163969'",
      );
      expect(result).not.toBeNull();
      expect(result!.errorType).toBe("unknown_variant");
      expect(result!.availableVariants).toEqual([
        "update_config",
        "proxy",
        "admin_execute",
        "update_ownership",
      ]);
    });

    it("should parse missing field errors", () => {
      const result = parseCosmWasmMsgError(
        "Error parsing into type cw20::msg::TransferMsg: missing field `recipient`",
      );
      expect(result).not.toBeNull();
      expect(result!.errorType).toBe("missing_field");
      expect(result!.targetType).toBe("cw20::msg::TransferMsg");
      expect(result!.missingField).toBe("recipient");
    });

    it("should parse unknown field errors", () => {
      const result = parseCosmWasmMsgError(
        "Error parsing into type cw20::msg::TransferMsg: unknown field `recipeint`, expected one of `recipient`, `amount`",
      );
      expect(result).not.toBeNull();
      expect(result!.errorType).toBe("unknown_field");
      expect(result!.unknownField).toBe("recipeint");
      expect(result!.expectedFields).toEqual(["recipient", "amount"]);
    });

    it("should return null for non-CosmWasm errors", () => {
      expect(parseCosmWasmMsgError("Gas estimation failed")).toBeNull();
      expect(parseCosmWasmMsgError("Insufficient funds")).toBeNull();
      expect(parseCosmWasmMsgError("nonce too low")).toBeNull();
    });
  });

  describe("enhanceWithRetryAction", () => {
    it("should add retry action for recoverable errors", () => {
      const classified = classifyError("Request timed out");
      const enhanced = enhanceWithRetryAction(classified, "send-tokens", {
        chain: "cosmoshub-4",
        to: "cosmos1...",
        amount: "100",
      });

      expect(enhanced.retryAction).toBeDefined();
      expect(enhanced.retryAction?.tool).toBe("send-tokens");
      expect(enhanced.retryAction?.params).toEqual({
        chain: "cosmoshub-4",
        to: "cosmos1...",
        amount: "100",
      });
      expect(enhanced.retryAction?.autoRetry).toBe(true);
    });

    it("should add delay for rate limiting errors", () => {
      const classified = classifyError("Rate limit exceeded");
      const enhanced = enhanceWithRetryAction(classified, "get-balances");

      expect(enhanced.retryAction?.delayMs).toBe(5000);
    });

    it("should not add retry action for non-recoverable errors", () => {
      const classified = classifyError("Insufficient funds for transfer");
      const enhanced = enhanceWithRetryAction(classified, "send-tokens");

      expect(enhanced.retryAction).toBeUndefined();
    });

    it("should add setup guide for setup required errors", () => {
      const classified = classifyError("No mnemonic configured");
      const enhanced = enhanceWithRetryAction(classified, "send-tokens");

      expect(enhanced.setupGuide).toBeDefined();
      expect(enhanced.setupGuide?.options).toHaveLength(2);
      expect(enhanced.retryAction).toBeUndefined();
    });

    it("should preserve original error properties", () => {
      const classified = classifyError("Network error occurred");
      const enhanced = enhanceWithRetryAction(classified, "delegate");

      expect(enhanced.category).toBe(ErrorCategory.NETWORK);
      expect(enhanced.message).toBe("Network error occurred");
      expect(enhanced.recoverable).toBe(true);
      expect(enhanced.suggestion).toBeDefined();
    });
  });
});
