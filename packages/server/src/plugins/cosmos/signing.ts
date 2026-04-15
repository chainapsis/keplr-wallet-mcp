/**
 * Cosmos Signing Plugin
 *
 * Provides MCP tools for signing arbitrary messages using ADR-36.
 * ADR-36 is the Cosmos standard for signing arbitrary data to prove
 * address ownership without broadcasting a transaction.
 */

import { Secp256k1Signature } from "@cosmjs/crypto";
import { z } from "zod";
import type { SuggestedAction } from "../../errors.js";
import { makeAdr36SignDoc, serializeAdr36SignDoc } from "../../keys/adr36.js";
import type { KeplrPlugin } from "../types.js";

const cosmosSigningPlugin: KeplrPlugin = {
  name: "cosmos-signing",
  register(server, store) {
    // Sign arbitrary message (ADR-36)
    server.registerTool(
      "cosmos-sign-arbitrary",
      {
        description:
          "Sign an arbitrary message using ADR-36 (Cosmos Arbitrary Message Signing). " +
          "This proves ownership of an address without broadcasting a transaction. " +
          "Commonly used for authentication, message verification, and off-chain signatures.",
        inputSchema: {
          message: z.string().describe("The message to sign"),
          chain: z
            .string()
            .optional()
            .describe(
              "Chain ID or name to determine the signer address prefix (e.g., 'osmosis', 'cosmoshub-4'). Defaults to 'cosmoshub-4'",
            ),
        },
        annotations: {
          title: "Sign Arbitrary Message (ADR-36)",
          readOnlyHint: false,
          destructiveHint: false,
        },
      },
      async ({ message, chain }) => {
        try {
          // Get the key provider for the active account
          const provider = await store.getKeyProvider();

          // Check if the provider supports ADR-36
          if (!provider.capabilities.signTypes.includes("adr36")) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "error",
                      message: `${provider.displayName} does not support ADR-36 signing.`,
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          // Determine bech32 prefix from chain
          const chainId = chain || "cosmoshub-4";
          let bech32Prefix = "cosmos";

          // Map common chain names/IDs to bech32 prefixes
          const chainPrefixMap: Record<string, string> = {
            "cosmoshub-4": "cosmos",
            cosmos: "cosmos",
            "osmosis-1": "osmo",
            osmosis: "osmo",
            "stargaze-1": "stars",
            stargaze: "stars",
            "akashnet-2": "akash",
            akash: "akash",
            "secret-4": "secret",
            secret: "secret",
            "injective-1": "inj",
            injective: "inj",
            celestia: "celestia",
            "dydx-mainnet-1": "dydx",
            dydx: "dydx",
          };

          if (chainPrefixMap[chainId.toLowerCase()]) {
            bech32Prefix = chainPrefixMap[chainId.toLowerCase()];
          }

          // Get the signer address
          const signerAddress = await provider.getAddress({
            ecosystem: "cosmos",
            bech32Prefix,
          });

          // Create the ADR-36 sign doc
          const signDoc = makeAdr36SignDoc(signerAddress, message);
          const signBytes = serializeAdr36SignDoc(signDoc);

          // Sign the message
          const signResponse = await provider.sign({
            ecosystem: "cosmos",
            signType: "adr36",
            data: signBytes,
            signerAddress,
          });

          // Build the result
          const result = {
            status: "success",
            signer: signerAddress,
            message,
            signature: {
              pub_key: {
                type: "tendermint/PubKeySecp256k1",
                value: signResponse.publicKey
                  ? Buffer.from(signResponse.publicKey).toString("base64")
                  : undefined,
              },
              signature: Buffer.from(signResponse.signature).toString("base64"),
            },
            signDoc,
          };

          const suggestedActions: SuggestedAction[] = [
            {
              tool: "cosmos-verify-signature",
              reason: "Verify this signature",
              priority: 1,
            },
          ];

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ...result, suggestedActions }, null, 2),
              },
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          // Check for user rejection
          if (
            errorMessage.includes("rejected") ||
            errorMessage.includes("denied") ||
            errorMessage.includes("cancelled")
          ) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "rejected",
                      message: "Signing was rejected by the user.",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Check for setup required error
          if (
            errorMessage.includes("No active account") ||
            errorMessage.includes("not configured")
          ) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "error",
                      message:
                        "No active account. Please connect a wallet first.",
                      suggestedActions: [
                        {
                          tool: "create-account",
                          reason: "Create a new wallet account",
                          priority: 1,
                        },
                        {
                          tool: "import-account",
                          reason: "Import an existing wallet",
                          priority: 2,
                        },
                      ],
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "error",
                    message: `Failed to sign message: ${errorMessage}`,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      },
    );

    // Verify ADR-36 signature
    server.registerTool(
      "cosmos-verify-signature",
      {
        description:
          "Verify an ADR-36 signature. Checks that a signature was created by " +
          "the owner of a specific Cosmos address for a given message.",
        inputSchema: {
          signer: z
            .string()
            .describe("The bech32 address that supposedly signed the message"),
          message: z.string().describe("The original message that was signed"),
          signature: z
            .string()
            .describe("The base64-encoded signature to verify"),
          pubKey: z
            .string()
            .describe("The base64-encoded public key of the signer"),
        },
        annotations: {
          title: "Verify ADR-36 Signature",
          readOnlyHint: true,
          destructiveHint: false,
        },
      },
      async ({ signer, message, signature, pubKey }) => {
        try {
          // Dynamically import verification utilities
          const { Secp256k1, sha256 } = await import("@cosmjs/crypto");
          const { fromBase64, toBech32, fromBech32 } = await import(
            "@cosmjs/encoding"
          );
          const { rawSecp256k1PubkeyToRawAddress } = await import(
            "@cosmjs/amino"
          );

          // Decode signature and public key
          const signatureBytes = fromBase64(signature);
          const pubKeyBytes = fromBase64(pubKey);

          // Verify the public key matches the signer address
          const rawAddress = rawSecp256k1PubkeyToRawAddress(pubKeyBytes);
          const { prefix } = fromBech32(signer);
          const derivedAddress = toBech32(prefix, rawAddress);

          if (derivedAddress !== signer) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      status: "invalid",
                      valid: false,
                      reason: "Public key does not match signer address",
                      expectedAddress: derivedAddress,
                      providedAddress: signer,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Create the sign doc and hash it
          const signDoc = makeAdr36SignDoc(signer, message);
          const signBytes = serializeAdr36SignDoc(signDoc);
          const messageHash = sha256(signBytes);

          // Verify the signature
          const valid = await Secp256k1.verifySignature(
            Secp256k1Signature.fromFixedLength(signatureBytes),
            messageHash,
            pubKeyBytes,
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: valid ? "valid" : "invalid",
                    valid,
                    signer,
                    message,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "error",
                    message: `Verification failed: ${errorMessage}`,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      },
    );
  },
};

export default cosmosSigningPlugin;
