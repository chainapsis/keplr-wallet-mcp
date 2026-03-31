/**
 * Static tip pool for contextual "Did you know?" hints in tool responses.
 *
 * Tips are keyed by tool name. One tip is randomly selected per invocation.
 * Each tip should be: concise (1 sentence), actionable, and reference a specific tool.
 */

const tipPool: Readonly<Record<string, string[]>> = {
  "get-cosmos-address": [
    "get-balances로 해당 주소의 잔액을 바로 확인할 수 있어요",
  ],
  "get-balances": [
    "모든 체인 자산과 USD 가치를 한번에 보려면 get-portfolio를 사용하세요",
  ],
  "get-staking-info": [
    "get-portfolio로 모든 체인의 스테이킹 현황과 유동 자산을 한눈에 볼 수 있어요",
    "list-validators로 수수료와 투표율을 비교해 최적의 검증자를 찾아보세요",
  ],
  "get-portfolio": [
    "USD 가격 없이 더 빠르게 조회하려면 includePrices: false로 설정하세요",
    'chains 파라미터로 특정 체인만 조회할 수 있어요 (예: ["osmosis-1"])',
  ],
  "list-validators": [
    "여러 검증자에 분산 위임하면 슬래싱 리스크를 줄이고 네트워크 탈중앙화에 기여해요",
  ],
  "send-tokens": ["get-balances로 전송 전에 잔액을 먼저 확인하세요"],
  "ibc-transfer": [
    "IBC 전송은 보통 30초~2분 내에 완료돼요. get-transaction-status로 진행 상황을 추적하세요",
  ],
  delegate: [
    "언본딩 기간(보통 21일) 없이 검증자를 바꾸려면 redelegate를 사용하세요",
    "여러 검증자에 분산 위임하면 슬래싱 리스크를 줄일 수 있어요",
  ],
  undelegate: [
    "검증자를 바꾸는 것이라면 redelegate를 쓰면 언본딩 기간 없이 즉시 이동할 수 있어요",
  ],
  redelegate: [
    "여러 검증자에 분산 위임하면 네트워크 탈중앙화에 기여하고 리스크를 줄일 수 있어요",
  ],
  "claim-rewards": [
    "모든 검증자의 리워드를 한번에 청구하려면 claim-all-rewards를 사용하세요",
  ],
  "claim-all-rewards": [
    "청구한 리워드를 바로 재스테이킹하면 복리 효과를 얻을 수 있어요",
  ],
  "vote-governance": [
    "아직 투표하지 않은 활성 제안을 모두 보려면 list-proposals를 사용하세요",
  ],
  "cosmwasm-execute": [
    "cosmwasm-query로 실행 전에 계약 상태를 미리 확인하세요",
  ],
  "cosmwasm-query": [
    "cosmwasm-contract-info로 계약의 코드 ID와 관리자 주소를 확인할 수 있어요",
  ],
  "osmosis-swap": [
    "스왑 전에 osmosis-quote로 예상 금액과 슬리피지를 먼저 확인하세요",
    "큰 금액을 스왑할 때 여러 번으로 나누면 가격 영향(price impact)을 줄일 수 있어요",
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
