/**
 * CosmWasm Registry Registration Tests
 *
 * Verifies that CosmWasm message types (MsgExecuteContract, MsgInstantiateContract)
 * can be encoded and decoded through the Registry — proving the signing client
 * registry fix actually enables CosmWasm transactions.
 */

import { Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import {
  MsgExecuteContract,
  MsgInstantiateContract,
} from "cosmjs-types/cosmwasm/wasm/v1/tx.js";
import { describe, expect, it } from "vitest";

/**
 * Replicates the registry setup from CosmosClient.getSigningClient()
 * (cosmos.ts lines 291-299) to verify encode/decode roundtrip.
 */
const createCosmWasmRegistry = () => {
  const registry = new Registry(defaultRegistryTypes);
  registry.register(
    "/cosmwasm.wasm.v1.MsgExecuteContract",
    MsgExecuteContract as any,
  );
  registry.register(
    "/cosmwasm.wasm.v1.MsgInstantiateContract",
    MsgInstantiateContract as any,
  );
  return registry;
};

describe("CosmWasm Registry Registration", () => {
  it("should encode and decode MsgExecuteContract", () => {
    const registry = createCosmWasmRegistry();

    const msg = MsgExecuteContract.fromPartial({
      sender: "neutron1z9naaqhhpsmckzvj7a0w7q4mryf9rzgecu0qz5",
      contract:
        "neutron1suhgf5svhu4usrurvxzlgn54ksxmn8gljarjtxqnapv8kjnp4nrstdxvff",
      msg: new TextEncoder().encode(JSON.stringify({ swap: {} })),
      funds: [{ denom: "untrn", amount: "1000000" }],
    });

    const encoded = registry.encode({
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: msg,
    });
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = registry.decode({
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: encoded,
    });
    expect(decoded.sender).toBe(msg.sender);
    expect(decoded.contract).toBe(msg.contract);
    expect(JSON.parse(new TextDecoder().decode(decoded.msg))).toEqual({
      swap: {},
    });
    expect(decoded.funds).toEqual([{ denom: "untrn", amount: "1000000" }]);
  });

  it("should encode and decode MsgInstantiateContract", () => {
    const registry = createCosmWasmRegistry();

    const msg = MsgInstantiateContract.fromPartial({
      sender: "neutron1z9naaqhhpsmckzvj7a0w7q4mryf9rzgecu0qz5",
      admin: "",
      codeId: BigInt(100),
      label: "test-contract",
      msg: new TextEncoder().encode(JSON.stringify({ count: 0 })),
      funds: [],
    });

    const encoded = registry.encode({
      typeUrl: "/cosmwasm.wasm.v1.MsgInstantiateContract",
      value: msg,
    });
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = registry.decode({
      typeUrl: "/cosmwasm.wasm.v1.MsgInstantiateContract",
      value: encoded,
    });
    expect(decoded.sender).toBe(msg.sender);
    expect(decoded.label).toBe("test-contract");
    expect(JSON.parse(new TextDecoder().decode(decoded.msg))).toEqual({
      count: 0,
    });
  });

  it("should fail to encode MsgExecuteContract without registration", () => {
    const registry = new Registry(defaultRegistryTypes);

    const msg = MsgExecuteContract.fromPartial({
      sender: "neutron1test",
      contract: "neutron1contract",
      msg: new TextEncoder().encode("{}"),
      funds: [],
    });

    expect(() =>
      registry.encode({
        typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
        value: msg,
      }),
    ).toThrow();
  });

  it("should coexist with default Cosmos SDK message types", () => {
    const registry = createCosmWasmRegistry();

    // Standard MsgSend should still work
    const sendEncoded = registry.encode({
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: "cosmos1sender",
        toAddress: "cosmos1receiver",
        amount: [{ denom: "uatom", amount: "1000" }],
      },
    });
    expect(sendEncoded).toBeInstanceOf(Uint8Array);

    // CosmWasm should also work in the same registry
    const cwEncoded = registry.encode({
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: MsgExecuteContract.fromPartial({
        sender: "neutron1test",
        contract: "neutron1contract",
        msg: new TextEncoder().encode("{}"),
        funds: [],
      }),
    });
    expect(cwEncoded).toBeInstanceOf(Uint8Array);
  });
});
