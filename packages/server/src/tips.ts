/**
 * Static tip pool for contextual "Did you know?" hints in tool responses.
 *
 * Tips are keyed by tool name. One tip is randomly selected per invocation.
 * Each tip should be: concise (1 sentence), actionable, and reference a specific tool.
 */

const tipPool: Readonly<Record<string, string[]>> = {
  "get-cosmos-address": [
    "You can check the balance of that address right away with get-balances",
  ],
  "get-balances": [
    "Use get-portfolio to see all chain assets and USD values at once",
  ],
  "get-staking-info": [
    "Use get-portfolio to see staking status and liquid assets across all chains at a glance",
    "Use list-validators to compare fees and uptime to find the best validator",
  ],
  "get-portfolio": [
    "Set includePrices: false for faster queries without USD prices",
    'Use the chains parameter to query specific chains only (e.g., ["osmosis-1"])',
  ],
  "list-validators": [
    "Spreading delegations across multiple validators reduces slashing risk and supports network decentralization",
  ],
  "send-tokens": ["Check your balance with get-balances before sending"],
  "ibc-transfer": [
    "IBC transfers typically complete within 30 seconds to 2 minutes. Track progress with get-transaction-status",
  ],
  delegate: [
    "Use redelegate to switch validators without the unbonding period (usually 21 days)",
    "Spreading delegations across multiple validators reduces slashing risk",
  ],
  undelegate: [
    "If you just want to switch validators, use redelegate to move instantly without the unbonding period",
  ],
  redelegate: [
    "Spreading delegations across multiple validators supports network decentralization and reduces risk",
  ],
  "claim-rewards": [
    "Use claim-all-rewards to claim rewards from all validators at once",
  ],
  "claim-all-rewards": [
    "Restaking claimed rewards immediately gives you the benefit of compound interest",
  ],
  "vote-governance": [
    "Use list-proposals to see all active proposals you haven't voted on yet",
  ],
  "cosmwasm-execute": [
    "Use cosmwasm-query to check the contract state before executing",
  ],
  "cosmwasm-query": [
    "Use cosmwasm-contract-info to check the contract's code ID and admin address",
  ],
  "osmosis-swap": [
    "Check the expected amount and slippage with osmosis-quote before swapping",
    "Splitting large swaps into multiple smaller ones can reduce the price impact",
  ],
};

/**
 * Pick a random tip for the given tool name.
 * Returns undefined if no tips are defined for that tool.
 */
export function pickTip(toolName: string): string | undefined {
  const tips = tipPool[toolName];
  if (!tips?.length) return undefined;
  const text = tips[Math.floor(Math.random() * tips.length)];
  return `💡 ${text}`;
}
