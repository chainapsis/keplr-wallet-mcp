import { epochingtx } from "@babylonlabs-io/babylon-proto-ts";
import { stringToPath } from "@cosmjs/crypto";
import { toBase64 } from "@cosmjs/encoding";
import {
  DirectSecp256k1HdWallet,
  type EncodeObject,
  type OfflineDirectSigner,
  Registry,
} from "@cosmjs/proto-signing";
import {
  coin,
  defaultRegistryTypes,
  GasPrice,
  type MsgDelegateEncodeObject,
  type MsgSendEncodeObject,
  type MsgTransferEncodeObject,
  type MsgUndelegateEncodeObject,
  type MsgVoteEncodeObject,
  type MsgWithdrawDelegatorRewardEncodeObject,
  QueryClient,
  SigningStargateClient,
  type SigningStargateClientOptions,
  StargateClient,
  setupDistributionExtension,
  setupGovExtension,
  setupStakingExtension,
} from "@cosmjs/stargate";
import { Tendermint37Client } from "@cosmjs/tendermint-rpc";
import type { ChainInfo } from "@keplr-wallet/types";
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx.js";
import {
  MsgExecuteContract,
  MsgInstantiateContract,
} from "cosmjs-types/cosmwasm/wasm/v1/tx.js";
import {
  getBech32Prefix,
  getGasPrice,
  getGasPriceForDenom,
  getStakeDecimals,
  getStakeDenom,
  getStakeMinimalDenom,
} from "../chains/cosmos.js";
import type { EcosystemClient } from "../ecosystem.js";
import { getRpcResolver } from "../rpc/resolver.js";
import { wrapForBabylon } from "../utils/babylon.js";
import { balanceEnricherRegistry } from "../utils/balance-enricher.js";
import { formatBalances } from "../utils/balance-formatter.js";
import { getGasAdjustment, parseGasPrice } from "../utils/format.js";
import { enrichIbcDenoms } from "../utils/ibc-resolver.js";
import { lcdFetch, safeParseJson } from "../utils/lcd-fetch.js";
import { flagHomoglyphs, sanitizeString } from "../utils/sanitize.js";
import {
  EthermintHdWallet,
  ethermintAccountParser,
  getEthermintPubkeyTypeUrl,
  isEthermintLike,
  needsEthermintSigning,
} from "./ethermint/index.js";

/**
 * Resolve RPC endpoint for CosmJS connect().
 * Returns string (no auth) or HttpEndpoint (with auth headers).
 */
const resolveRpc = (
  chain: ChainInfo,
): string | { url: string; headers: Record<string, string> } => {
  const resolved = getRpcResolver().resolveEndpoint(chain.chainId, chain.rpc);
  return resolved.headers
    ? { url: resolved.url, headers: resolved.headers }
    : resolved.url;
};

/** Check if an error is an out-of-gas broadcast failure (code 11) */
const isOutOfGasError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const msg = error.message;
    // CosmJS BroadcastTxError format: "Broadcasting transaction failed with code 11"
    return /code 11\b/.test(msg) && /out of gas/i.test(msg);
  }
  return false;
};

/** Extract gasUsed from CosmJS BroadcastTxError log: "gasWanted: X, gasUsed: Y" */
const parseGasUsedFromError = (error: unknown): number | undefined => {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/gasUsed:\s*(\d+)/);
  if (!match) return undefined;
  const gasUsed = Number(match[1]);
  return gasUsed > 0 ? gasUsed : undefined;
};

export interface BalanceResult {
  readonly denom: string;
  readonly amount: string;
  readonly displayAmount: string;
  readonly displayDenom: string;
}

export interface DelegationResult {
  validatorAddress: string;
  amount: string;
  displayAmount: string;
  denom: string;
}

export interface RewardResult {
  validatorAddress: string;
  rewards: { denom: string; amount: string }[];
}

export interface TxResult {
  transactionHash: string;
  code: number;
  gasUsed: string;
  gasWanted: string;
}

export interface TxStatusResult {
  /** Transaction hash */
  hash: string;
  /** Status: confirmed (code=0), failed (code!=0), or not_found */
  status: "confirmed" | "failed" | "not_found";
  /** Block height where tx was included (if found) */
  height?: number;
  /** Result code (0 = success) */
  code?: number;
  /** Gas used by the transaction */
  gasUsed?: string;
  /** Gas wanted (requested) */
  gasWanted?: string;
  /** Raw log message (useful for errors) */
  rawLog?: string;
  /** Timestamp when tx was included (ISO string) */
  timestamp?: string;
}

export interface ValidatorResult {
  /** Validator operator address (e.g., cosmosvaloper1...) */
  operatorAddress: string;
  /** Human-readable name */
  moniker: string;
  /** Commission rate (0-1, e.g., 0.05 = 5%) */
  commissionRate: string;
  /** Validator status: BONDED, UNBONDING, UNBONDED */
  status: string;
  /** Voting power in tokens */
  tokens: string;
  /** Voting power in display denomination */
  displayTokens: string;
  /** Whether the validator is jailed */
  jailed: boolean;
  /** Validator website (if available) */
  website?: string;
  /** Validator details/description (if available) */
  details?: string;
}

export interface UnbondingDelegationResult {
  /** Validator operator address */
  validatorAddress: string;
  /** Unbonding entries */
  entries: {
    /** Amount being unbonded */
    balance: string;
    /** Display amount */
    displayBalance: string;
    /** Completion time (ISO string) */
    completionTime: string;
    /** Creation height */
    creationHeight: string;
  }[];
}

export interface ProposalResult {
  /** Proposal ID */
  proposalId: string;
  /** Proposal title */
  title: string;
  /** Proposal description (truncated for list view) */
  description: string;
  /** Proposal status: VOTING_PERIOD, PASSED, REJECTED, DEPOSIT_PERIOD, FAILED */
  status: string;
  /** Submit time (ISO string) */
  submitTime?: string;
  /** Deposit end time (ISO string) */
  depositEndTime?: string;
  /** Voting start time (ISO string) */
  votingStartTime?: string;
  /** Voting end time (ISO string) */
  votingEndTime?: string;
  /** Current tally (for active proposals) */
  tally?: {
    yes: string;
    no: string;
    abstain: string;
    noWithVeto: string;
  };
}

export interface FeeEstimate {
  gasEstimate: string;
  feeAmount: string;
  feeDenom: string;
}

export interface IbcChannelResult {
  /** Channel ID (e.g., 'channel-0') */
  channelId: string;
  /** Port ID (usually 'transfer') */
  portId: string;
  /** Channel state: OPEN, CLOSED, INIT, TRYOPEN */
  state: string;
  /** Counterparty chain's channel ID */
  counterpartyChannelId: string;
  /** Counterparty chain's port ID */
  counterpartyPortId: string;
  /** Connection ID on this chain */
  connectionId: string;
  /** Ordering: ORDERED or UNORDERED */
  ordering: string;
  /** Counterparty chain ID (if resolvable) */
  counterpartyChainId?: string;
}

export interface IbcChannelsResponse {
  channels: IbcChannelResult[];
  /** Whether chain ID enrichment completed successfully (false on timeout/error) */
  enrichmentComplete: boolean;
}

export interface ContractInfoResult {
  /** Contract address */
  address: string;
  /** Code ID the contract was instantiated from */
  codeId: string;
  /** Contract creator address */
  creator: string;
  /** Contract admin address (if set) */
  admin?: string;
  /** Contract label */
  label: string;
  /** IBC port ID (if contract has IBC capabilities) */
  ibcPortId?: string;
  /** Contract creation timestamp or height */
  created?: {
    blockHeight: string;
    txIndex?: string;
  };
}

export interface ContractQueryResult {
  /** The raw query result data */
  data: unknown;
}

export interface ContractExecuteResult extends TxResult {
  /** Events emitted by the contract */
  events?: ReadonlyArray<{
    type: string;
    attributes: ReadonlyArray<{ key: string; value: string }>;
  }>;
}

export class CosmosClient implements EcosystemClient {
  private signingClients: Map<string, SigningStargateClient> = new Map();
  private queryClients: Map<string, StargateClient> = new Map();
  private tmClients: Map<string, Tendermint37Client> = new Map();
  private wallets: Map<string, OfflineDirectSigner> = new Map();
  /**
   * BIP39 mnemonic stored in plaintext.
   *
   * JavaScript does not provide a way to securely erase strings from memory
   * (strings are immutable and garbage-collected non-deterministically).
   * The mnemonic will remain in process memory until the GC reclaims it.
   * This is an inherent limitation of the JS runtime, not a fixable bug.
   */
  private mnemonic: string;

  constructor(mnemonic: string) {
    this.mnemonic = mnemonic;
  }

  private async getWallet(chain: ChainInfo): Promise<OfflineDirectSigner> {
    const cached = this.wallets.get(chain.chainId);
    if (cached) return cached;

    const prefix = getBech32Prefix(chain);
    const coinType = chain.bip44?.coinType ?? 118;
    let wallet: OfflineDirectSigner;

    if (isEthermintLike(chain)) {
      wallet = await EthermintHdWallet.fromMnemonic(
        this.mnemonic,
        prefix,
        getEthermintPubkeyTypeUrl(chain),
      );
    } else {
      wallet = await DirectSecp256k1HdWallet.fromMnemonic(this.mnemonic, {
        prefix,
        hdPaths: [stringToPath(`m/44'/${coinType}'/0'/0/0`)],
      });
    }

    this.wallets.set(chain.chainId, wallet);
    return wallet;
  }

  private async getSigningClient(
    chain: ChainInfo,
  ): Promise<SigningStargateClient> {
    const cached = this.signingClients.get(chain.chainId);
    if (cached) return cached;

    const wallet = await this.getWallet(chain);
    const isEthermint = needsEthermintSigning(chain);
    const registry = new Registry([
      ...defaultRegistryTypes,
      ["/cosmwasm.wasm.v1.MsgExecuteContract", MsgExecuteContract as never],
      [
        "/cosmwasm.wasm.v1.MsgInstantiateContract",
        MsgInstantiateContract as never,
      ],
      [
        "/babylon.epoching.v1.MsgWrappedDelegate",
        epochingtx.MsgWrappedDelegate as never,
      ],
      [
        "/babylon.epoching.v1.MsgWrappedUndelegate",
        epochingtx.MsgWrappedUndelegate as never,
      ],
      [
        "/babylon.epoching.v1.MsgWrappedBeginRedelegate",
        epochingtx.MsgWrappedBeginRedelegate as never,
      ],
      [
        "/babylon.epoching.v1.MsgWrappedCancelUnbondingDelegation",
        epochingtx.MsgWrappedCancelUnbondingDelegation as never,
      ],
    ]);
    const options: SigningStargateClientOptions = {
      registry,
      gasPrice: GasPrice.fromString(getGasPrice(chain)),
      ...(isEthermint && { accountParser: ethermintAccountParser }),
    };

    let client: SigningStargateClient;
    if (isEthermint) {
      // Ethermint chains (Injective, Dymension) use CometBFT which returns
      // plain-text event attributes. The Tendermint34 adaptor tries to base64-decode
      // them and fails. Force Tendermint37Client which handles plain text.
      const tmClient = await this.getTmClient(chain);
      client = await SigningStargateClient.createWithSigner(
        tmClient,
        wallet,
        options,
      );
    } else {
      client = await SigningStargateClient.connectWithSigner(
        resolveRpc(chain),
        wallet,
        options,
      );
    }
    this.signingClients.set(chain.chainId, client);
    return client;
  }

  private async getQueryClient(chain: ChainInfo): Promise<StargateClient> {
    const cached = this.queryClients.get(chain.chainId);
    if (cached) return cached;

    const client = await StargateClient.connect(resolveRpc(chain));
    this.queryClients.set(chain.chainId, client);
    return client;
  }

  private async getTmClient(chain: ChainInfo): Promise<Tendermint37Client> {
    const cached = this.tmClients.get(chain.chainId);
    if (cached) return cached;

    const client = await Tendermint37Client.connect(resolveRpc(chain));
    this.tmClients.set(chain.chainId, client);
    return client;
  }

  async getAddress(chain: ChainInfo): Promise<string> {
    const wallet = await this.getWallet(chain);
    const [account] = await wallet.getAccounts();
    return account.address;
  }

  async getBalances(chain: ChainInfo): Promise<BalanceResult[]> {
    const client = await this.getQueryClient(chain);
    const address = await this.getAddress(chain);
    const balances = await client.getAllBalances(address);
    const enriched = await enrichIbcDenoms(
      formatBalances(balances, chain),
      chain,
    );
    return balanceEnricherRegistry.enrich(enriched, chain.chainId);
  }

  /**
   * LCD (REST) based queries — avoid Tendermint RPC concurrent connection issues.
   * Used by portfolio to prevent 503 from Keplr RPC endpoints under parallel load.
   */

  async getBalancesViaLcd(chain: ChainInfo): Promise<BalanceResult[]> {
    const address = await this.getAddress(chain);
    const response = await lcdFetch(
      chain,
      `/cosmos/bank/v1beta1/balances/${address}`,
    );
    if (!response.ok) {
      throw new Error(`Bad status on response: ${response.status}`);
    }
    const data = await safeParseJson<{
      balances: Array<{ denom: string; amount: string }>;
    }>(response, "balances");
    const enriched = await enrichIbcDenoms(
      formatBalances(data.balances ?? [], chain),
      chain,
    );
    return balanceEnricherRegistry.enrich(enriched, chain.chainId);
  }

  async getDelegationsViaLcd(chain: ChainInfo): Promise<DelegationResult[]> {
    const address = await this.getAddress(chain);
    const response = await lcdFetch(
      chain,
      `/cosmos/staking/v1beta1/delegations/${address}`,
    );
    if (!response.ok) {
      throw new Error(`Bad status on response: ${response.status}`);
    }
    const data = await safeParseJson<{
      delegation_responses: Array<{
        delegation: { validator_address: string };
        balance: { denom: string; amount: string };
      }>;
    }>(response, "delegations");

    const decimals = getStakeDecimals(chain);
    const denom = getStakeDenom(chain);

    return (data.delegation_responses ?? []).map((d) => ({
      validatorAddress: d.delegation?.validator_address ?? "",
      amount: d.balance?.amount ?? "0",
      displayAmount: (
        parseInt(d.balance?.amount ?? "0", 10) /
        10 ** decimals
      ).toFixed(decimals),
      denom,
    }));
  }

  async getRewardsViaLcd(chain: ChainInfo): Promise<RewardResult[]> {
    const address = await this.getAddress(chain);
    const response = await lcdFetch(
      chain,
      `/cosmos/distribution/v1beta1/delegators/${address}/rewards`,
    );
    if (!response.ok) {
      throw new Error(`Bad status on response: ${response.status}`);
    }
    const data = await safeParseJson<{
      rewards: Array<{
        validator_address: string;
        reward: Array<{ denom: string; amount: string }> | null;
      }>;
    }>(response, "rewards");

    return (data.rewards ?? []).map((r) => ({
      validatorAddress: r.validator_address,
      rewards: (r.reward ?? []).map((c) => ({
        denom: c.denom,
        // LCD always returns DecCoin as "639327.868541..." (JSON format)
        amount: c.amount.includes(".") ? c.amount.split(".")[0] : c.amount,
      })),
    }));
  }

  /**
   * Simulate a transaction to estimate gas and fee.
   * Uses the chain's gasPrice config to calculate fee from estimated gas.
   */
  async simulateFee(
    chain: ChainInfo,
    messages: EncodeObject[],
  ): Promise<FeeEstimate> {
    const client = await this.getSigningClient(chain);
    const address = await this.getAddress(chain);

    // Simulate to get gas estimate
    const gasEstimate = await client.simulate(address, messages, undefined);

    // Parse gas price using the unified utility
    const parsedGasPrice = parseGasPrice(getGasPrice(chain));

    // Apply gas adjustment matching Keplr Extension (1.4 standard, 1.6 feemarket)
    const gasWithBuffer = Math.ceil(gasEstimate * getGasAdjustment(chain));
    const feeAmount = Math.ceil(gasWithBuffer * parsedGasPrice.amount);

    return {
      gasEstimate: gasEstimate.toString(),
      feeAmount: feeAmount.toString(),
      feeDenom: parsedGasPrice.denom,
    };
  }

  /**
   * Conservative gas estimate for ethermint chains where simulate() fails
   * due to CosmJS's hardcoded secp256k1 pubkey encoding.
   */
  private calculateEthermintFallbackFee(
    chain: ChainInfo,
    messages: EncodeObject[],
    feeDenom?: string,
  ): { amount: { denom: string; amount: string }[]; gas: string } {
    const BASE_GAS = 200_000;
    const PER_MSG_GAS = 100_000;
    const gasEstimate = BASE_GAS + messages.length * PER_MSG_GAS;
    const gasWithBuffer = Math.ceil(gasEstimate * 1.5);

    const customGasPrice = feeDenom
      ? getGasPriceForDenom(chain, feeDenom)
      : undefined;
    const parsedGasPrice = parseGasPrice(customGasPrice ?? getGasPrice(chain));
    const feeAmount = Math.ceil(gasWithBuffer * parsedGasPrice.amount);

    return {
      amount: [
        {
          denom: feeDenom ?? parsedGasPrice.denom,
          amount: feeAmount.toString(),
        },
      ],
      gas: gasWithBuffer.toString(),
    };
  }

  /**
   * Sign and broadcast a transaction, handling ethermint response parsing errors.
   *
   * Injective's CometBFT returns event attributes as UTF-8 strings,
   * but CosmJS v0.32 expects base64. The tx broadcasts successfully
   * but response parsing fails. This method catches that error and
   * falls back to LCD for tx status.
   */
  private async signAndBroadcastSafe(
    chain: ChainInfo,
    address: string,
    messages: EncodeObject[],
    fee: { amount: { denom: string; amount: string }[]; gas: string } | "auto",
  ): Promise<TxResult> {
    const client = await this.getSigningClient(chain);

    if (!needsEthermintSigning(chain)) {
      // Attempt broadcast. Out-of-gas (code 11) can surface in two ways:
      // 1. CheckTx failure: CosmJS throws BroadcastTxError (gasUsed in error message)
      // 2. DeliverTx failure: CosmJS returns result with code=11 (gasUsed in result)
      // Both are retried once with gasUsed × 1.4.

      let gasUsedForRetry: number | undefined;
      try {
        const result = await client.signAndBroadcast(address, messages, fee);

        // DeliverTx out-of-gas: result returned with code 11
        if (result.code === 11 && Number(result.gasUsed) > 0) {
          gasUsedForRetry = Number(result.gasUsed);
        } else {
          return {
            transactionHash: result.transactionHash,
            code: result.code,
            gasUsed: result.gasUsed.toString(),
            gasWanted: result.gasWanted.toString(),
          };
        }
      } catch (error) {
        // CheckTx out-of-gas: CosmJS throws BroadcastTxError
        if (!isOutOfGasError(error)) throw error;
        gasUsedForRetry = parseGasUsedFromError(error);
        if (!gasUsedForRetry) throw error;
      }

      const retryGas = Math.ceil(gasUsedForRetry * 1.4);
      const parsedGasPrice = parseGasPrice(getGasPrice(chain));
      const retryFee = {
        gas: retryGas.toString(),
        amount: [
          {
            denom: parsedGasPrice.denom,
            amount: Math.ceil(retryGas * parsedGasPrice.amount).toString(),
          },
        ],
      };
      const originalGas = fee === "auto" ? "auto" : fee.gas;
      console.error(
        `[gas-retry] ${chain.chainId}: originalGas=${originalGas} gasUsed=${gasUsedForRetry} → retryGas=${retryGas}`,
      );
      const retryResult = await client.signAndBroadcast(
        address,
        messages,
        retryFee,
      );
      return {
        transactionHash: retryResult.transactionHash,
        code: retryResult.code,
        gasUsed: retryResult.gasUsed.toString(),
        gasWanted: retryResult.gasWanted.toString(),
      };
    }

    // For ethermint chains: sign with CosmJS, broadcast via LCD REST API.
    // CosmJS's broadcastTx() fails parsing ethermint event attributes / pubkeys.
    const resolvedFee =
      fee === "auto"
        ? this.calculateEthermintFallbackFee(chain, messages)
        : fee;

    const txRaw = await client.sign(address, messages, resolvedFee, "");
    const txBytes = TxRaw.encode(txRaw).finish();

    const response = await lcdFetch(chain, "/cosmos/tx/v1beta1/txs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_bytes: toBase64(txBytes),
        mode: "BROADCAST_MODE_SYNC",
      }),
    });

    if (!response.ok) {
      throw new Error(`LCD broadcast failed with status ${response.status}`);
    }

    const data = await safeParseJson<{
      tx_response: {
        code: number;
        txhash: string;
        raw_log: string;
        gas_used?: string;
        gas_wanted?: string;
      };
    }>(response, "/cosmos/tx/v1beta1/txs");

    if (data.tx_response.code !== 0) {
      throw new Error(
        data.tx_response.raw_log ||
          `TX failed with code ${data.tx_response.code}`,
      );
    }

    // SYNC only confirms CheckTx (mempool acceptance).
    // Poll LCD for block inclusion to get DeliverTx result.
    const txHash = data.tx_response.txhash;
    const POLL_INTERVAL_MS = 3_000;
    const POLL_TIMEOUT_MS = 60_000;
    const pollStart = Date.now();

    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const txRes = await lcdFetch(chain, `/cosmos/tx/v1beta1/txs/${txHash}`);

      if (!txRes.ok) {
        // tx not yet indexed — keep polling
        if (txRes.status === 404 || txRes.status === 400) {
          continue;
        }
        break;
      }

      const txData = await safeParseJson<{
        tx_response: {
          code: number;
          txhash: string;
          raw_log: string;
          gas_used?: string;
          gas_wanted?: string;
        };
      }>(txRes, `/cosmos/tx/v1beta1/txs/${txHash}`);

      if (txData.tx_response.code !== 0) {
        throw new Error(
          txData.tx_response.raw_log ||
            `TX failed at DeliverTx with code ${txData.tx_response.code}`,
        );
      }

      return {
        transactionHash: txData.tx_response.txhash,
        code: txData.tx_response.code,
        gasUsed: txData.tx_response.gas_used ?? "0",
        gasWanted: txData.tx_response.gas_wanted ?? "0",
      };
    }

    // Polling timed out — return SYNC result as best-effort fallback
    return {
      transactionHash: txHash,
      code: data.tx_response.code,
      gasUsed: data.tx_response.gas_used ?? "0",
      gasWanted: data.tx_response.gas_wanted ?? "0",
    };
  }

  private async calculateFeeForDenom(
    chain: ChainInfo,
    messages: EncodeObject[],
    feeDenom?: string,
  ): Promise<{ amount: { denom: string; amount: string }[]; gas: string }> {
    // Ethermint chains: simulate() fails due to hardcoded pubkey encoding in CosmJS.
    // Use conservative gas estimate instead.
    if (needsEthermintSigning(chain)) {
      // Only pass feeDenom if it's a valid fee token for this chain
      const validFeeDenom =
        feeDenom && getGasPriceForDenom(chain, feeDenom) ? feeDenom : undefined;
      return this.calculateEthermintFallbackFee(chain, messages, validFeeDenom);
    }

    // Resolve gas price: use custom feeDenom if valid, otherwise chain default
    const customGasPrice =
      feeDenom && getGasPriceForDenom(chain, feeDenom)
        ? getGasPriceForDenom(chain, feeDenom)
        : undefined;
    const parsedGasPrice = parseGasPrice(customGasPrice ?? getGasPrice(chain));
    const resolvedDenom =
      customGasPrice && feeDenom ? feeDenom : parsedGasPrice.denom;

    // Simulate to get gas estimate
    const client = await this.getSigningClient(chain);
    const address = await this.getAddress(chain);
    const gasEstimate = await client.simulate(address, messages, undefined);

    // Apply gas adjustment matching Keplr Extension (1.4 standard, 1.6 feemarket)
    const gasWithBuffer = Math.ceil(gasEstimate * getGasAdjustment(chain));
    const feeAmount = Math.ceil(gasWithBuffer * parsedGasPrice.amount);

    return {
      amount: [{ denom: resolvedDenom, amount: feeAmount.toString() }],
      gas: gasWithBuffer.toString(),
    };
  }

  async sendTokens(
    chain: ChainInfo,
    recipientAddress: string,
    amount: string,
    denom?: string,
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);
    const sendDenom = denom ?? getStakeMinimalDenom(chain);

    const msg: MsgSendEncodeObject = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: address,
        toAddress: recipientAddress,
        amount: [coin(amount, sendDenom)],
      },
    };

    // Calculate fee with custom denom if specified
    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    return this.signAndBroadcastSafe(chain, address, [msg], fee);
  }

  async verifyIbcChannel(
    chain: ChainInfo,
    channelId: string,
    portId: string,
  ): Promise<{ exists: boolean; state: string }> {
    const response = await lcdFetch(
      chain,
      `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}`,
    );
    if (!response.ok) {
      return { exists: false, state: "NOT_FOUND" };
    }
    const data = await safeParseJson<{
      channel: { state: string };
    }>(response, `/ibc/core/channel/v1/channels/${channelId}/ports/${portId}`);
    return { exists: true, state: data.channel.state };
  }

  async ibcTransfer(
    chain: ChainInfo,
    recipientAddress: string,
    amount: string,
    denom: string,
    sourcePort: string,
    sourceChannel: string,
    timeoutMinutes: number = 10,
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);

    const timeoutTimestamp = BigInt(
      (Date.now() + timeoutMinutes * 60 * 1000) * 1_000_000,
    );

    const msg: MsgTransferEncodeObject = {
      typeUrl: "/ibc.applications.transfer.v1.MsgTransfer",
      value: {
        sourcePort,
        sourceChannel,
        token: coin(amount, denom),
        sender: address,
        receiver: recipientAddress,
        timeoutHeight: { revisionHeight: BigInt(0), revisionNumber: BigInt(0) },
        timeoutTimestamp,
        memo: "",
      },
    };

    // Calculate fee with custom denom if specified
    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    return this.signAndBroadcastSafe(chain, address, [msg], fee);
  }

  async delegate(
    chain: ChainInfo,
    validatorAddress: string,
    amount: string,
    denom?: string,
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);
    const stakeDenom = denom ?? getStakeMinimalDenom(chain);

    const msg = wrapForBabylon(chain.chainId, {
      typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: {
        delegatorAddress: address,
        validatorAddress,
        amount: coin(amount, stakeDenom),
      },
    } as MsgDelegateEncodeObject);

    // Calculate fee with custom denom if specified
    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    return await this.signAndBroadcastSafe(chain, address, [msg], fee);
  }

  async undelegate(
    chain: ChainInfo,
    validatorAddress: string,
    amount: string,
    denom?: string,
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);
    const stakeDenom = denom ?? getStakeMinimalDenom(chain);

    const msg = wrapForBabylon(chain.chainId, {
      typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
      value: {
        delegatorAddress: address,
        validatorAddress,
        amount: coin(amount, stakeDenom),
      },
    } as MsgUndelegateEncodeObject);

    // Calculate fee with custom denom if specified
    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    return this.signAndBroadcastSafe(chain, address, [msg], fee);
  }

  async redelegate(
    chain: ChainInfo,
    srcValidatorAddress: string,
    dstValidatorAddress: string,
    amount: string,
    denom?: string,
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);
    const stakeDenom = denom ?? getStakeMinimalDenom(chain);

    const msg = wrapForBabylon(chain.chainId, {
      typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
      value: {
        delegatorAddress: address,
        validatorSrcAddress: srcValidatorAddress,
        validatorDstAddress: dstValidatorAddress,
        amount: coin(amount, stakeDenom),
      },
    });

    // Calculate fee with custom denom if specified
    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    return this.signAndBroadcastSafe(chain, address, [msg], fee);
  }

  /**
   * Cancel an unbonding delegation (requires Cosmos SDK v0.46+).
   * This allows you to re-delegate tokens that are currently unbonding.
   */
  async cancelUnbonding(
    chain: ChainInfo,
    validatorAddress: string,
    amount: string,
    creationHeight: string,
    denom?: string,
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);
    const stakeDenom = denom ?? getStakeMinimalDenom(chain);

    const msg = wrapForBabylon(chain.chainId, {
      typeUrl: "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation",
      value: {
        delegatorAddress: address,
        validatorAddress,
        amount: coin(amount, stakeDenom),
        creationHeight: BigInt(creationHeight),
      },
    });

    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);
    return this.signAndBroadcastSafe(chain, address, [msg], fee);
  }

  async claimRewards(
    chain: ChainInfo,
    validatorAddress: string,
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);

    const msg: MsgWithdrawDelegatorRewardEncodeObject = {
      typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
      value: {
        delegatorAddress: address,
        validatorAddress,
      },
    };

    // Calculate fee with custom denom if specified
    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    return this.signAndBroadcastSafe(chain, address, [msg], fee);
  }

  async claimAllRewards(
    chain: ChainInfo,
    validatorAddresses: string[],
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);

    const msgs: MsgWithdrawDelegatorRewardEncodeObject[] =
      validatorAddresses.map((validatorAddress) => ({
        typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        value: {
          delegatorAddress: address,
          validatorAddress,
        },
      }));

    // Calculate fee with custom denom if specified
    const fee = await this.calculateFeeForDenom(chain, msgs, feeDenom);

    return this.signAndBroadcastSafe(chain, address, msgs, fee);
  }

  /**
   * Execute multiple messages in a single transaction.
   * This is the core method for multi-action transactions.
   *
   * @param chain - Chain configuration
   * @param messages - Array of encoded messages to execute
   * @param feeDenom - Optional fee token denomination
   * @returns Transaction result
   */
  async executeMultiAction(
    chain: ChainInfo,
    messages: EncodeObject[],
    feeDenom?: string,
  ): Promise<TxResult> {
    if (messages.length === 0) {
      throw new Error("Cannot execute multi-action with no messages");
    }

    const address = await this.getAddress(chain);

    // Calculate fee for all messages
    const fee = await this.calculateFeeForDenom(chain, messages, feeDenom);

    return this.signAndBroadcastSafe(chain, address, messages, fee);
  }

  /**
   * Simulate multiple messages to estimate gas.
   * Useful for previewing multi-action transactions.
   *
   * @param chain - Chain configuration
   * @param messages - Array of encoded messages to simulate
   * @returns Estimated gas amount
   */
  async simulateMultiAction(
    chain: ChainInfo,
    messages: EncodeObject[],
  ): Promise<{ gasEstimate: string }> {
    if (messages.length === 0) {
      throw new Error("Cannot simulate multi-action with no messages");
    }

    const client = await this.getSigningClient(chain);
    const gasEstimate = await client.simulate(
      await this.getAddress(chain),
      messages,
      undefined,
    );

    return {
      gasEstimate: Math.ceil(gasEstimate * getGasAdjustment(chain)).toString(),
    };
  }

  /**
   * Simulate multiple messages and calculate gas savings vs individual execution.
   * Useful for showing users the benefit of batching transactions.
   *
   * @param chain - Chain configuration
   * @param messages - Array of encoded messages to simulate
   * @returns Estimated gas, individual gas total, and savings percentage
   */
  async simulateMultiActionWithSavings(
    chain: ChainInfo,
    messages: EncodeObject[],
  ): Promise<{
    gasEstimate: string;
    gasEstimateIndividual?: string;
    gasSavingsPercent?: number;
  }> {
    if (messages.length === 0) {
      throw new Error("Cannot simulate multi-action with no messages");
    }

    const client = await this.getSigningClient(chain);
    const address = await this.getAddress(chain);

    // 1. Simulate all messages together (batched)
    const batchedGas = await client.simulate(address, messages, undefined);
    const gasAdj = getGasAdjustment(chain);
    const batchedGasWithBuffer = Math.ceil(batchedGas * gasAdj);

    // 2. If only one message, no savings calculation needed
    if (messages.length === 1) {
      return {
        gasEstimate: batchedGasWithBuffer.toString(),
      };
    }

    // 3. Simulate each message individually and sum the gas
    let individualGasTotal = 0;
    let allSimulationsSucceeded = true;

    for (const msg of messages) {
      try {
        const singleGas = await client.simulate(address, [msg], undefined);
        individualGasTotal += Math.ceil(singleGas * gasAdj);
      } catch {
        // If individual simulation fails (e.g., depends on previous action),
        // skip savings calculation but continue with batched estimate
        allSimulationsSucceeded = false;
        break;
      }
    }

    // 4. Calculate savings percentage
    if (allSimulationsSucceeded && individualGasTotal > 0) {
      const savings = Math.round(
        (1 - batchedGasWithBuffer / individualGasTotal) * 100,
      );

      return {
        gasEstimate: batchedGasWithBuffer.toString(),
        gasEstimateIndividual: individualGasTotal.toString(),
        gasSavingsPercent: savings > 0 ? savings : undefined,
      };
    }

    // Fallback: return batched estimate only
    return {
      gasEstimate: batchedGasWithBuffer.toString(),
    };
  }

  async vote(
    chain: ChainInfo,
    proposalId: string,
    option: "yes" | "no" | "abstain" | "no_with_veto",
    feeDenom?: string,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);

    const voteOptionMap: Record<string, number> = {
      yes: 1,
      abstain: 2,
      no: 3,
      no_with_veto: 4,
    };

    const msg: MsgVoteEncodeObject = {
      typeUrl: "/cosmos.gov.v1beta1.MsgVote",
      value: {
        proposalId: BigInt(proposalId),
        voter: address,
        option: voteOptionMap[option],
      },
    };

    // Calculate fee with custom denom if specified
    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    return this.signAndBroadcastSafe(chain, address, [msg], fee);
  }

  async getDelegations(chain: ChainInfo): Promise<DelegationResult[]> {
    const address = await this.getAddress(chain);
    const decimals = getStakeDecimals(chain);
    const denom = getStakeDenom(chain);

    const toDelegationResults = (
      entries: Array<{
        validatorAddress: string;
        amount: string;
      }>,
    ): DelegationResult[] =>
      entries.map((e) => ({
        validatorAddress: e.validatorAddress,
        amount: e.amount,
        displayAmount: (parseInt(e.amount, 10) / 10 ** decimals).toFixed(
          decimals,
        ),
        denom,
      }));

    try {
      const tmClient = await this.getTmClient(chain);
      const queryClient = QueryClient.withExtensions(
        tmClient,
        setupStakingExtension,
      );
      const response = await queryClient.staking.delegatorDelegations(address);
      return toDelegationResults(
        response.delegationResponses.map((d) => ({
          validatorAddress: d.delegation?.validatorAddress ?? "",
          amount: d.balance?.amount ?? "0",
        })),
      );
    } catch {
      // LCD REST fallback — needed for chains like Neutron where ABCI staking queries fail
      const path = `/cosmos/staking/v1beta1/delegations/${address}`;
      const response = await lcdFetch(chain, path);
      if (!response.ok) {
        throw new Error(`Failed to fetch delegations: ${response.statusText}`);
      }
      const data = await safeParseJson<{
        delegation_responses: Array<{
          delegation: { validator_address: string };
          balance: { denom: string; amount: string };
        }>;
      }>(response, path);
      return toDelegationResults(
        (data.delegation_responses ?? []).map((d) => ({
          validatorAddress: d.delegation?.validator_address ?? "",
          amount: d.balance?.amount ?? "0",
        })),
      );
    }
  }

  async getRewards(chain: ChainInfo): Promise<RewardResult[]> {
    const address = await this.getAddress(chain);

    const parseDecCoinAmount = (raw: string): string =>
      // DecCoin amounts: JSON format = "639327.868541..." (split at "."),
      // binary protobuf format = "639327868541000000000000" (integer * 10^18, divide by 10^18)
      raw.includes(".")
        ? raw.split(".")[0]
        : String(BigInt(raw) / BigInt("1000000000000000000"));

    try {
      const tmClient = await this.getTmClient(chain);
      const queryClient = QueryClient.withExtensions(
        tmClient,
        setupDistributionExtension,
      );
      const response =
        await queryClient.distribution.delegationTotalRewards(address);

      return response.rewards.map((r) => ({
        validatorAddress: r.validatorAddress,
        rewards: r.reward.map((coin) => ({
          denom: coin.denom,
          amount: parseDecCoinAmount(coin.amount),
        })),
      }));
    } catch {
      // LCD REST fallback — needed for chains like Neutron where ABCI distribution queries fail
      const path = `/cosmos/distribution/v1beta1/delegators/${address}/rewards`;
      const response = await lcdFetch(chain, path);
      if (!response.ok) {
        // Distribution module not available (e.g., Neutron 501) — return empty
        // rewards so delegation queries are not blocked
        if (response.status === 501) {
          return [];
        }
        throw new Error(`Failed to fetch rewards: ${response.statusText}`);
      }
      const data = await safeParseJson<{
        rewards: Array<{
          validator_address: string;
          reward: Array<{ denom: string; amount: string }> | null;
        }>;
      }>(response, path);
      return (data.rewards ?? []).map((r) => ({
        validatorAddress: r.validator_address,
        rewards: (r.reward ?? []).map((coin) => ({
          denom: coin.denom,
          amount: parseDecCoinAmount(coin.amount),
        })),
      }));
    }
  }

  /**
   * Sign and broadcast arbitrary messages.
   * Used by protocol plugins (like Osmosis) that need to send custom message types.
   */
  async signAndBroadcastMsgs(
    chain: ChainInfo,
    messages: Array<{ typeUrl: string; value: unknown }>,
  ): Promise<TxResult> {
    const address = await this.getAddress(chain);

    return this.signAndBroadcastSafe(chain, address, messages, "auto");
  }

  /**
   * Get transaction status by hash.
   * Returns detailed information about the transaction if found.
   */
  async getTransactionStatus(
    chain: ChainInfo,
    txHash: string,
  ): Promise<TxStatusResult> {
    const client = await this.getQueryClient(chain);

    try {
      const tx = await client.getTx(txHash);

      if (!tx) {
        return {
          hash: txHash,
          status: "not_found",
        };
      }

      // Get block timestamp if available
      let timestamp: string | undefined;
      try {
        const block = await client.getBlock(tx.height);
        timestamp = block.header.time;
      } catch {
        // Block timestamp not available
      }

      return {
        hash: txHash,
        status: tx.code === 0 ? "confirmed" : "failed",
        height: tx.height,
        code: tx.code,
        gasUsed: tx.gasUsed.toString(),
        gasWanted: tx.gasWanted.toString(),
        rawLog: tx.rawLog,
        timestamp,
      };
    } catch (error) {
      // If getTx throws (e.g., tx not found on some chains), return not_found
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found") || message.includes("does not exist")) {
        return {
          hash: txHash,
          status: "not_found",
        };
      }
      throw error;
    }
  }

  /**
   * Get list of validators on the chain.
   * @param status - Filter by status: "BOND_STATUS_BONDED" (active), "BOND_STATUS_UNBONDING", "BOND_STATUS_UNBONDED"
   */
  async getValidators(
    chain: ChainInfo,
    status?:
      | "BOND_STATUS_BONDED"
      | "BOND_STATUS_UNBONDING"
      | "BOND_STATUS_UNBONDED"
      | "",
  ): Promise<ValidatorResult[]> {
    const tmClient = await this.getTmClient(chain);
    const queryClient = QueryClient.withExtensions(
      tmClient,
      setupStakingExtension,
    );

    const bondStatus = status ?? "BOND_STATUS_BONDED";
    const response = await queryClient.staking.validators(bondStatus);

    const decimals = getStakeDecimals(chain);
    const statusMap: Record<number, string> = {
      0: "UNSPECIFIED",
      1: "UNBONDED",
      2: "UNBONDING",
      3: "BONDED",
    };

    return response.validators.map((v) => ({
      operatorAddress: v.operatorAddress,
      moniker: flagHomoglyphs(sanitizeString(v.description?.moniker ?? "")),
      commissionRate: v.commission?.commissionRates?.rate ?? "0",
      status: statusMap[v.status] ?? `UNKNOWN(${v.status})`,
      tokens: v.tokens,
      displayTokens: (parseInt(v.tokens, 10) / 10 ** decimals).toFixed(0),
      jailed: v.jailed,
      website: sanitizeString(v.description?.website || "") || undefined,
      details: sanitizeString(v.description?.details || "") || undefined,
    }));
  }

  /**
   * Get unbonding delegations for the current wallet.
   */
  async getUnbondingDelegations(
    chain: ChainInfo,
  ): Promise<UnbondingDelegationResult[]> {
    const tmClient = await this.getTmClient(chain);
    const queryClient = QueryClient.withExtensions(
      tmClient,
      setupStakingExtension,
    );
    const address = await this.getAddress(chain);

    const response =
      await queryClient.staking.delegatorUnbondingDelegations(address);

    const decimals = getStakeDecimals(chain);

    return response.unbondingResponses.map((u) => ({
      validatorAddress: u.validatorAddress,
      entries: u.entries.map((e) => ({
        balance: e.balance,
        displayBalance: (parseInt(e.balance, 10) / 10 ** decimals).toFixed(
          decimals,
        ),
        completionTime: e.completionTime
          ? new Date(
              Number(e.completionTime.seconds) * 1000 +
                Number(e.completionTime.nanos) / 1_000_000,
            ).toISOString()
          : "",
        creationHeight: e.creationHeight.toString(),
      })),
    }));
  }

  /**
   * Get governance proposals.
   * @param status - Filter by status: PROPOSAL_STATUS_VOTING_PERIOD, PROPOSAL_STATUS_PASSED, etc.
   */
  async getProposals(
    chain: ChainInfo,
    status?: number,
  ): Promise<ProposalResult[]> {
    const tmClient = await this.getTmClient(chain);
    const queryClient = QueryClient.withExtensions(tmClient, setupGovExtension);

    // Default to voting period proposals (status=2)
    const proposalStatus = status ?? 0; // 0 = all
    const response = await queryClient.gov.proposals(proposalStatus, "", "");

    const statusMap: Record<number, string> = {
      0: "UNSPECIFIED",
      1: "DEPOSIT_PERIOD",
      2: "VOTING_PERIOD",
      3: "PASSED",
      4: "REJECTED",
      5: "FAILED",
    };

    return response.proposals.map((p) => {
      // Parse content - handle both legacy and newer proposal formats
      let title = "";
      let description = "";

      // Try to get title/description from content
      if (p.content) {
        const content = p.content as { title?: string; description?: string };
        title = content.title ?? "";
        description = content.description ?? "";
      }

      // Truncate description for list view
      if (description.length > 200) {
        description = `${description.substring(0, 200)}...`;
      }

      return {
        proposalId: p.proposalId.toString(),
        title,
        description,
        status: statusMap[p.status] ?? `UNKNOWN(${p.status})`,
        submitTime: p.submitTime
          ? new Date(
              Number(p.submitTime.seconds) * 1000 +
                Number(p.submitTime.nanos) / 1_000_000,
            ).toISOString()
          : undefined,
        depositEndTime: p.depositEndTime
          ? new Date(
              Number(p.depositEndTime.seconds) * 1000 +
                Number(p.depositEndTime.nanos) / 1_000_000,
            ).toISOString()
          : undefined,
        votingStartTime: p.votingStartTime
          ? new Date(
              Number(p.votingStartTime.seconds) * 1000 +
                Number(p.votingStartTime.nanos) / 1_000_000,
            ).toISOString()
          : undefined,
        votingEndTime: p.votingEndTime
          ? new Date(
              Number(p.votingEndTime.seconds) * 1000 +
                Number(p.votingEndTime.nanos) / 1_000_000,
            ).toISOString()
          : undefined,
        tally: p.finalTallyResult
          ? {
              yes: p.finalTallyResult.yes,
              no: p.finalTallyResult.no,
              abstain: p.finalTallyResult.abstain,
              noWithVeto: p.finalTallyResult.noWithVeto,
            }
          : undefined,
      };
    });
  }

  /**
   * Get a single proposal by ID with detailed information.
   */
  async getProposal(
    chain: ChainInfo,
    proposalId: string,
  ): Promise<ProposalResult | null> {
    const tmClient = await this.getTmClient(chain);
    const queryClient = QueryClient.withExtensions(tmClient, setupGovExtension);

    try {
      const p = await queryClient.gov.proposal(proposalId);

      const statusMap: Record<number, string> = {
        0: "UNSPECIFIED",
        1: "DEPOSIT_PERIOD",
        2: "VOTING_PERIOD",
        3: "PASSED",
        4: "REJECTED",
        5: "FAILED",
      };

      // Parse content
      let title = "";
      let description = "";

      if (p.proposal?.content) {
        const content = p.proposal.content as {
          title?: string;
          description?: string;
        };
        title = content.title ?? "";
        description = content.description ?? "";
      }

      const proposal = p.proposal;
      if (!proposal) return null;

      // Get current tally for voting period proposals
      let tally = proposal.finalTallyResult
        ? {
            yes: proposal.finalTallyResult.yes,
            no: proposal.finalTallyResult.no,
            abstain: proposal.finalTallyResult.abstain,
            noWithVeto: proposal.finalTallyResult.noWithVeto,
          }
        : undefined;

      // For voting period proposals, fetch live tally
      if (proposal.status === 2) {
        try {
          const tallyResult = await queryClient.gov.tally(proposalId);
          if (tallyResult.tally) {
            tally = {
              yes: tallyResult.tally.yes,
              no: tallyResult.tally.no,
              abstain: tallyResult.tally.abstain,
              noWithVeto: tallyResult.tally.noWithVeto,
            };
          }
        } catch {
          // Tally not available
        }
      }

      return {
        proposalId: proposal.proposalId.toString(),
        title,
        description,
        status: statusMap[proposal.status] ?? `UNKNOWN(${proposal.status})`,
        submitTime: proposal.submitTime
          ? new Date(
              Number(proposal.submitTime.seconds) * 1000 +
                Number(proposal.submitTime.nanos) / 1_000_000,
            ).toISOString()
          : undefined,
        depositEndTime: proposal.depositEndTime
          ? new Date(
              Number(proposal.depositEndTime.seconds) * 1000 +
                Number(proposal.depositEndTime.nanos) / 1_000_000,
            ).toISOString()
          : undefined,
        votingStartTime: proposal.votingStartTime
          ? new Date(
              Number(proposal.votingStartTime.seconds) * 1000 +
                Number(proposal.votingStartTime.nanos) / 1_000_000,
            ).toISOString()
          : undefined,
        votingEndTime: proposal.votingEndTime
          ? new Date(
              Number(proposal.votingEndTime.seconds) * 1000 +
                Number(proposal.votingEndTime.nanos) / 1_000_000,
            ).toISOString()
          : undefined,
        tally,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found") || message.includes("does not exist")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get IBC channels for the chain.
   * Uses REST API to query the IBC module.
   */
  async getIbcChannels(
    chain: ChainInfo,
    options?: { enrichChainIds?: boolean },
  ): Promise<IbcChannelsResponse> {
    const PAGE_LIMIT = 500;
    const MAX_PAGES = 50;
    const LCD_REQUEST_TIMEOUT_MS = 10_000;
    const ENRICHMENT_TIMEOUT_MS = 20_000;
    const enrichChainIds = options?.enrichChainIds ?? false;

    // Paginate through IBC channels, jumping directly to transfer port.
    // Cosmos SDK pagination keys follow `/ports/{port_id}/channels/{channel_id}`,
    // so we skip non-transfer ports (icacontroller, icahost, wasm, etc.)
    // by starting from base64("/ports/transfer/").
    const TRANSFER_PORT_KEY = btoa("/ports/transfer/");

    type ChannelEntry = {
      state: string;
      ordering: string;
      counterparty: { port_id: string; channel_id: string };
      connection_hops: string[];
      version: string;
      port_id: string;
      channel_id: string;
    };

    // Map state codes to human-readable strings
    const stateMap: Record<string, string> = {
      STATE_UNINITIALIZED_UNSPECIFIED: "UNSPECIFIED",
      STATE_INIT: "INIT",
      STATE_TRYOPEN: "TRYOPEN",
      STATE_OPEN: "OPEN",
      STATE_CLOSED: "CLOSED",
    };

    const orderingMap: Record<string, string> = {
      ORDER_NONE_UNSPECIFIED: "UNSPECIFIED",
      ORDER_UNORDERED: "UNORDERED",
      ORDER_ORDERED: "ORDERED",
    };

    // Channel fetching task (paginated)
    const fetchTransferChannels = async (): Promise<ChannelEntry[]> => {
      const channels: ChannelEntry[] = [];
      let nextKey: string | null = TRANSFER_PORT_KEY;
      let pageCount = 0;

      do {
        const params = new URLSearchParams({
          "pagination.limit": String(PAGE_LIMIT),
        });
        if (nextKey) params.set("pagination.key", nextKey);

        let response: Response;
        try {
          response = await lcdFetch(
            chain,
            `/ibc/core/channel/v1/channels?${params.toString()}`,
            { signal: AbortSignal.timeout(LCD_REQUEST_TIMEOUT_MS) },
          );
        } catch {
          // Timeout or network error — return channels accumulated so far
          break;
        }
        if (!response.ok) {
          if (channels.length > 0) break; // Return partial results
          throw new Error(
            `Failed to fetch IBC channels: ${response.statusText}`,
          );
        }
        const data = await safeParseJson<{
          channels: ChannelEntry[];
          pagination?: { next_key: string | null };
        }>(response, "/ibc/core/channel/v1/channels");

        const transferBatch = data.channels.filter(
          (ch) => ch.port_id === "transfer",
        );
        channels.push(...transferBatch);

        if (
          transferBatch.length < data.channels.length &&
          transferBatch.length > 0
        ) {
          break;
        }
        if (transferBatch.length === 0 && pageCount > 0) {
          break;
        }

        nextKey = data.pagination?.next_key ?? null;
        pageCount++;
      } while (nextKey && pageCount < MAX_PAGES);

      return channels;
    };

    // Bulk fetch connection→client_id and client_id→chain_id mappings.
    // Uses paginated bulk endpoints instead of individual lookups to work
    // within the per-host 200ms throttle. Osmosis: 11K connections (23 pages,
    // ~10s) + 3.6K client states (8 pages, ~29s) = ~39s total.
    const fetchBulkConnections = async (): Promise<Map<string, string>> => {
      const connectionClientMap = new Map<string, string>();
      try {
        let nextKey: string | null = null;
        let pageCount = 0;
        do {
          const params = new URLSearchParams({ "pagination.limit": "500" });
          if (nextKey) params.set("pagination.key", nextKey);
          const resp = await lcdFetch(
            chain,
            `/ibc/core/connection/v1/connections?${params.toString()}`,
            { signal: AbortSignal.timeout(LCD_REQUEST_TIMEOUT_MS) },
          );
          if (!resp.ok) break;
          const data = await safeParseJson<{
            connections: Array<{ id: string; client_id: string }>;
            pagination?: { next_key: string | null };
          }>(resp, "/ibc/core/connection/v1/connections");
          for (const conn of data.connections) {
            if (conn.id && conn.client_id) {
              connectionClientMap.set(conn.id, conn.client_id);
            }
          }
          nextKey = data.pagination?.next_key ?? null;
          pageCount++;
        } while (nextKey && pageCount < 50);
      } catch {
        // Best-effort
      }
      return connectionClientMap;
    };

    const fetchBulkClientStates = async (): Promise<Map<string, string>> => {
      const clientChainMap = new Map<string, string>();
      try {
        let nextKey: string | null = null;
        let pageCount = 0;
        do {
          const params = new URLSearchParams({ "pagination.limit": "500" });
          if (nextKey) params.set("pagination.key", nextKey);
          const resp = await lcdFetch(
            chain,
            `/ibc/core/client/v1/client_states?${params.toString()}`,
            { signal: AbortSignal.timeout(LCD_REQUEST_TIMEOUT_MS) },
          );
          if (!resp.ok) break;
          const data = await safeParseJson<{
            client_states: Array<{
              client_id: string;
              client_state: { chain_id?: string };
            }>;
            pagination?: { next_key: string | null };
          }>(resp, "/ibc/core/client/v1/client_states");
          for (const cs of data.client_states) {
            const chainId = cs.client_state?.chain_id;
            if (cs.client_id && chainId) {
              clientChainMap.set(cs.client_id, chainId);
            }
          }
          nextKey = data.pagination?.next_key ?? null;
          pageCount++;
        } while (nextKey && pageCount < 50);
      } catch {
        // Best-effort
      }
      return clientChainMap;
    };

    // Phase 1a: Fetch transfer channels (required)
    const transferChannels = await fetchTransferChannels();

    // Phase 1b: Enrich with chain IDs (best-effort, time-bounded)
    let allConnectionsMap = new Map<string, string>();
    let allClientStatesMap = new Map<string, string>();
    let enrichmentComplete = false;
    if (enrichChainIds) {
      try {
        [allConnectionsMap, allClientStatesMap] = await Promise.race([
          Promise.all([fetchBulkConnections(), fetchBulkClientStates()]),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("IBC enrichment timeout")),
              ENRICHMENT_TIMEOUT_MS,
            ),
          ),
        ]);
        enrichmentComplete =
          allConnectionsMap.size > 0 || allClientStatesMap.size > 0;
      } catch {
        // Enrichment timeout or error — proceed without chain ID enrichment
      }
    }

    // Phase 2: Map transfer channels' connections to chain IDs
    const clientStatesMap = new Map<string, string>();
    if (enrichChainIds) {
      try {
        const neededConnIds = new Set(
          transferChannels.map((ch) => ch.connection_hops[0]).filter(Boolean),
        );

        // Map needed connections to chain IDs
        for (const connId of neededConnIds) {
          const clientId = allConnectionsMap.get(connId);
          const chainId = clientId
            ? allClientStatesMap.get(clientId)
            : undefined;
          if (chainId) {
            clientStatesMap.set(connId, chainId);
          }
        }
      } catch {
        // Best-effort: enrichment failure does not block channel listing
      }
    }

    return {
      channels: transferChannels.map((ch) => ({
        channelId: ch.channel_id,
        portId: ch.port_id,
        state: stateMap[ch.state] ?? ch.state,
        counterpartyChannelId: ch.counterparty.channel_id,
        counterpartyPortId: ch.counterparty.port_id,
        connectionId: ch.connection_hops[0] ?? "",
        ordering: orderingMap[ch.ordering] ?? ch.ordering,
        counterpartyChainId: clientStatesMap.get(ch.connection_hops[0]),
      })),
      enrichmentComplete: !enrichChainIds || enrichmentComplete,
    };
  }

  // ==================== CosmWasm Methods ====================

  /**
   * Query a CosmWasm smart contract.
   * @param chain - Chain info
   * @param contractAddress - Contract address
   * @param queryMsg - Query message (will be JSON stringified and base64 encoded)
   * @returns Query result
   */
  async queryContract(
    chain: ChainInfo,
    contractAddress: string,
    queryMsg: Record<string, unknown>,
  ): Promise<ContractQueryResult> {
    // Encode query message as base64
    const queryData = Buffer.from(JSON.stringify(queryMsg)).toString("base64");

    const response = await lcdFetch(
      chain,
      `/cosmwasm/wasm/v1/contract/${contractAddress}/smart/${queryData}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 400 || errorText.includes("unknown query path")) {
        throw new Error(
          `CosmWasm is not enabled on ${chain.chainId} or query failed: ${errorText}`,
        );
      }
      throw new Error(
        `Contract query failed (${response.status}): ${errorText}`,
      );
    }

    const result = await safeParseJson<{ data: unknown }>(
      response,
      `/cosmwasm/wasm/v1/contract/${contractAddress}/smart/${queryData}`,
    );
    return { data: result.data };
  }

  /**
   * Get CosmWasm contract information.
   * @param chain - Chain info
   * @param contractAddress - Contract address
   * @returns Contract metadata
   */
  async getContractInfo(
    chain: ChainInfo,
    contractAddress: string,
  ): Promise<ContractInfoResult> {
    const response = await lcdFetch(
      chain,
      `/cosmwasm/wasm/v1/contract/${contractAddress}`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      if (errorText.includes("not found") || response.status === 404) {
        throw new Error(
          `Contract ${contractAddress} not found on ${chain.chainId}`,
        );
      }
      if (response.status === 400 || errorText.includes("unknown query path")) {
        throw new Error(`CosmWasm is not enabled on ${chain.chainId}`);
      }
      throw new Error(`Failed to get contract info: ${response.statusText}`);
    }

    const data = await safeParseJson<{
      contract_info: {
        code_id: string;
        creator: string;
        admin?: string;
        label: string;
        ibc_port_id?: string;
        created?: {
          block_height: string;
          tx_index?: string;
        };
      };
    }>(response, `/cosmwasm/wasm/v1/contract/${contractAddress}`);

    const info = data.contract_info;
    return {
      address: contractAddress,
      codeId: info.code_id,
      creator: info.creator,
      admin: info.admin || undefined,
      label: info.label,
      ibcPortId: info.ibc_port_id || undefined,
      created: info.created
        ? {
            blockHeight: info.created.block_height,
            txIndex: info.created.tx_index,
          }
        : undefined,
    };
  }

  /**
   * List contract addresses deployed from a given code ID.
   * @param chain - Chain info
   * @param codeId - Code ID to query
   * @returns Array of contract addresses
   */
  async listContractsByCodeId(
    chain: ChainInfo,
    codeId: string,
  ): Promise<{ contracts: string[]; truncated: boolean }> {
    const PAGE_LIMIT = 100;
    const MAX_PAGES = 10;
    const allContracts: string[] = [];
    let nextKey: string | null = null;
    let pageCount = 0;

    do {
      const params = new URLSearchParams({
        "pagination.limit": String(PAGE_LIMIT),
      });
      if (nextKey) params.set("pagination.key", nextKey);

      const response = await lcdFetch(
        chain,
        `/cosmwasm/wasm/v1/code/${codeId}/contracts?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(
          `Failed to list contracts for code ${codeId}: ${response.statusText}`,
        );
      }
      const data = await safeParseJson<{
        contracts: string[];
        pagination?: { next_key: string | null };
      }>(response, `/cosmwasm/wasm/v1/code/${codeId}/contracts`);

      allContracts.push(...data.contracts);
      nextKey = data.pagination?.next_key ?? null;
      pageCount++;
    } while (nextKey && pageCount < MAX_PAGES);

    const truncated = nextKey !== null && pageCount >= MAX_PAGES;
    return { contracts: allContracts, truncated };
  }

  /**
   * Execute a CosmWasm smart contract.
   * @param chain - Chain info
   * @param contractAddress - Contract address
   * @param executeMsg - Execute message
   * @param funds - Optional funds to send with execution
   * @param feeDenom - Optional fee denomination
   * @returns Transaction result
   */
  async executeContract(
    chain: ChainInfo,
    contractAddress: string,
    executeMsg: Record<string, unknown>,
    funds?: { denom: string; amount: string }[],
    feeDenom?: string,
  ): Promise<ContractExecuteResult> {
    const client = await this.getSigningClient(chain);
    const address = await this.getAddress(chain);

    const msg: EncodeObject = {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: {
        sender: address,
        contract: contractAddress,
        msg: Buffer.from(JSON.stringify(executeMsg)),
        funds: funds || [],
      },
    };

    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    if (needsEthermintSigning(chain)) {
      // Ethermint chains can't parse events from RPC response
      return {
        ...(await this.signAndBroadcastSafe(chain, address, [msg], fee)),
        events: [],
      };
    }

    const result = await client.signAndBroadcast(address, [msg], fee);
    return {
      transactionHash: result.transactionHash,
      code: result.code,
      gasUsed: result.gasUsed.toString(),
      gasWanted: result.gasWanted.toString(),
      events: result.events,
    };
  }

  /**
   * Instantiate a CosmWasm contract from code.
   * @param chain - Chain info
   * @param codeId - Code ID to instantiate
   * @param instantiateMsg - Instantiation message
   * @param label - Human-readable label for the contract
   * @param admin - Optional admin address (for migrations)
   * @param funds - Optional funds to send with instantiation
   * @param feeDenom - Optional fee denomination
   * @returns Transaction result with contract address
   */
  async instantiateContract(
    chain: ChainInfo,
    codeId: string,
    instantiateMsg: Record<string, unknown>,
    label: string,
    admin?: string,
    funds?: { denom: string; amount: string }[],
    feeDenom?: string,
  ): Promise<ContractExecuteResult & { contractAddress?: string }> {
    const client = await this.getSigningClient(chain);
    const address = await this.getAddress(chain);

    const msg: EncodeObject = {
      typeUrl: "/cosmwasm.wasm.v1.MsgInstantiateContract",
      value: {
        sender: address,
        admin: admin || "",
        codeId: BigInt(codeId),
        label,
        msg: Buffer.from(JSON.stringify(instantiateMsg)),
        funds: funds || [],
      },
    };

    const fee = await this.calculateFeeForDenom(chain, [msg], feeDenom);

    if (needsEthermintSigning(chain)) {
      return {
        ...(await this.signAndBroadcastSafe(chain, address, [msg], fee)),
        events: [],
        contractAddress: undefined,
      };
    }

    const result = await client.signAndBroadcast(address, [msg], fee);

    // Try to extract contract address from events
    let contractAddress: string | undefined;
    if (result.events) {
      for (const event of result.events) {
        if (event.type === "instantiate") {
          const addrAttr = event.attributes.find(
            (a) =>
              a.key === "_contract_address" || a.key === "contract_address",
          );
          if (addrAttr) {
            contractAddress = addrAttr.value;
            break;
          }
        }
      }
    }

    return {
      transactionHash: result.transactionHash,
      code: result.code,
      gasUsed: result.gasUsed.toString(),
      gasWanted: result.gasWanted.toString(),
      events: result.events,
      contractAddress,
    };
  }

  async disconnect(): Promise<void> {
    for (const client of this.signingClients.values()) {
      client.disconnect();
    }
    for (const client of this.queryClients.values()) {
      client.disconnect();
    }
    for (const client of this.tmClients.values()) {
      client.disconnect();
    }
    this.signingClients.clear();
    this.queryClients.clear();
    this.tmClients.clear();
    this.wallets.clear();
  }
}
