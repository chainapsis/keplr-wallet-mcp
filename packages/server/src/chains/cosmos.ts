import { Bech32Address } from "@keplr-wallet/cosmos";
import type { ChainInfo, FeeCurrency } from "@keplr-wallet/types";

/**
 * Built-in chain registry using @keplr-wallet/types ChainInfo format.
 *
 * Chain data is sourced from Keplr Wallet's official config:
 * https://github.com/chainapsis/keplr-wallet/blob/master/apps/extension/src/config.ts
 */
export const BUILTIN_CHAINS: Record<string, ChainInfo> = {
  "cosmoshub-4": {
    rpc: "https://cosmos-rpc.polkachu.com",
    rest: "https://cosmos-rest.publicnode.com",
    chainId: "cosmoshub-4",
    chainName: "Cosmos Hub",
    stakeCurrency: {
      coinDenom: "ATOM",
      coinMinimalDenom: "uatom",
      coinDecimals: 6,
      coinGeckoId: "cosmos",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("cosmos"),
    currencies: [
      {
        coinDenom: "ATOM",
        coinMinimalDenom: "uatom",
        coinDecimals: 6,
        coinGeckoId: "cosmos",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "ATOM",
        coinMinimalDenom: "uatom",
        coinDecimals: 6,
        coinGeckoId: "cosmos",
        gasPriceStep: {
          low: 0.005,
          average: 0.025,
          high: 0.03,
        },
      },
    ],
    features: ["ibc-v2"],
  },
  "osmosis-1": {
    rpc: "https://rpc.osmosis.zone",
    rest: "https://lcd.osmosis.zone",
    chainId: "osmosis-1",
    chainName: "Osmosis",
    stakeCurrency: {
      coinDenom: "OSMO",
      coinMinimalDenom: "uosmo",
      coinDecimals: 6,
      coinGeckoId: "osmosis",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("osmo"),
    currencies: [
      {
        coinDenom: "OSMO",
        coinMinimalDenom: "uosmo",
        coinDecimals: 6,
        coinGeckoId: "osmosis",
      },
      {
        coinDenom: "ION",
        coinMinimalDenom: "uion",
        coinDecimals: 6,
        coinGeckoId: "ion",
      },
      {
        coinDenom: "USDC",
        coinMinimalDenom:
          "ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4",
        coinDecimals: 6,
        coinGeckoId: "usd-coin",
      },
      {
        coinDenom: "ATOM",
        coinMinimalDenom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
        coinDecimals: 6,
        coinGeckoId: "cosmos",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "OSMO",
        coinMinimalDenom: "uosmo",
        coinDecimals: 6,
        coinGeckoId: "osmosis",
        gasPriceStep: {
          low: 0.03,
          average: 0.1,
          high: 0.16,
        },
      },
    ],
    features: ["cosmwasm", "osmosis-txfees", "osmosis-base-fee-beta"],
  },
  "dydx-mainnet-1": {
    rpc: "https://dydx-rpc.polkachu.com",
    rest: "https://dydx-api.polkachu.com",
    chainId: "dydx-mainnet-1",
    chainName: "dYdX",
    stakeCurrency: {
      coinDenom: "DYDX",
      coinDecimals: 18,
      coinMinimalDenom: "adydx",
      coinGeckoId: "dydx-chain",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("dydx"),
    currencies: [
      {
        coinDenom: "DYDX",
        coinDecimals: 18,
        coinMinimalDenom: "adydx",
        coinGeckoId: "dydx-chain",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "DYDX",
        coinDecimals: 18,
        coinMinimalDenom: "adydx",
        coinGeckoId: "dydx-chain",
        gasPriceStep: {
          low: 12500000000,
          average: 12500000000,
          high: 20000000000,
        },
      },
      {
        coinDenom: "USDC",
        coinMinimalDenom:
          "ibc/8E27BA2D5493AF5636760E354E46004562C46AB7EC0CC4C1CA14E9E20E2545B5",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.025,
          average: 0.025,
          high: 0.03,
        },
      },
    ],
    features: [],
  },
  celestia: {
    rpc: "https://public-celestia-rpc.numia.xyz",
    rest: "https://public-celestia-lcd.numia.xyz",
    chainId: "celestia",
    chainName: "Celestia",
    stakeCurrency: {
      coinDenom: "TIA",
      coinDecimals: 6,
      coinMinimalDenom: "utia",
      coinGeckoId: "celestia",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("celestia"),
    currencies: [
      {
        coinDenom: "TIA",
        coinDecimals: 6,
        coinMinimalDenom: "utia",
        coinGeckoId: "celestia",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "TIA",
        coinDecimals: 6,
        coinMinimalDenom: "utia",
        coinGeckoId: "celestia",
        gasPriceStep: {
          low: 0.01,
          average: 0.02,
          high: 0.1,
        },
      },
    ],
    features: [],
  },
  "stargaze-1": {
    rpc: "https://rpc.stargaze-apis.com",
    rest: "https://rest.stargaze-apis.com",
    chainId: "stargaze-1",
    chainName: "Stargaze",
    stakeCurrency: {
      coinDenom: "STARS",
      coinMinimalDenom: "ustars",
      coinDecimals: 6,
      coinGeckoId: "stargaze",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("stars"),
    currencies: [
      {
        coinDenom: "STARS",
        coinMinimalDenom: "ustars",
        coinDecimals: 6,
        coinGeckoId: "stargaze",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "STARS",
        coinMinimalDenom: "ustars",
        coinDecimals: 6,
        coinGeckoId: "stargaze",
        gasPriceStep: {
          low: 1.0,
          average: 1.1,
          high: 1.2,
        },
      },
    ],
    features: [],
  },
  "juno-1": {
    rpc: "https://juno-rpc.polkachu.com",
    rest: "https://juno-api.polkachu.com",
    chainId: "juno-1",
    chainName: "Juno",
    stakeCurrency: {
      coinDenom: "JUNO",
      coinMinimalDenom: "ujuno",
      coinDecimals: 6,
      coinGeckoId: "juno-network",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("juno"),
    currencies: [
      {
        coinDenom: "JUNO",
        coinMinimalDenom: "ujuno",
        coinDecimals: 6,
        coinGeckoId: "juno-network",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "JUNO",
        coinMinimalDenom: "ujuno",
        coinDecimals: 6,
        coinGeckoId: "juno-network",
        gasPriceStep: {
          low: 0.075,
          average: 0.075,
          high: 0.075,
        },
      },
      {
        coinDenom: "ATOM",
        coinMinimalDenom:
          "ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.003,
          average: 0.003,
          high: 0.003,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "noble-1": {
    rpc: "https://noble-rpc.polkachu.com",
    rest: "https://noble-api.polkachu.com",
    chainId: "noble-1",
    chainName: "Noble",
    // Noble is not a staking chain - use USDC as primary currency
    stakeCurrency: {
      coinDenom: "USDC",
      coinMinimalDenom: "uusdc",
      coinDecimals: 6,
      coinGeckoId: "usd-coin",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("noble"),
    currencies: [
      {
        coinDenom: "USDC",
        coinMinimalDenom: "uusdc",
        coinDecimals: 6,
        coinGeckoId: "usd-coin",
      },
      {
        coinDenom: "USDN",
        coinMinimalDenom: "uusdn",
        coinDecimals: 6,
        coinGeckoId: "usd-coin",
      },
      {
        coinDenom: "USDY",
        coinMinimalDenom: "ausdy",
        coinDecimals: 18,
        coinGeckoId: "ondo-us-dollar-yield",
      },
      {
        coinDenom: "USYC",
        coinMinimalDenom: "uusyc",
        coinDecimals: 6,
      },
      {
        coinDenom: "EURe",
        coinMinimalDenom: "ueure",
        coinDecimals: 6,
        coinGeckoId: "monerium-eur-money",
      },
      {
        coinDenom: "FRNZ",
        coinMinimalDenom: "ufrienzies",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "USDC",
        coinMinimalDenom: "uusdc",
        coinDecimals: 6,
        coinGeckoId: "usd-coin",
        gasPriceStep: {
          low: 0.1,
          average: 0.1,
          high: 0.1,
        },
      },
      {
        coinDenom: "USDN",
        coinMinimalDenom: "uusdn",
        coinDecimals: 6,
        coinGeckoId: "usd-coin",
        gasPriceStep: {
          low: 0.1,
          average: 0.1,
          high: 0.1,
        },
      },
      {
        coinDenom: "EURe",
        coinMinimalDenom: "ueure",
        coinDecimals: 6,
        coinGeckoId: "monerium-eur-money",
        gasPriceStep: {
          low: 0.09,
          average: 0.09,
          high: 0.09,
        },
      },
      {
        coinDenom: "ATOM",
        coinMinimalDenom:
          "ibc/EF48E6B1A1A19F47ECAEA62F5670C37C0580E86A9E88498B7E393EB6F49F33C0",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.02,
          average: 0.02,
          high: 0.02,
        },
      },
    ],
    features: [],
  },
  "stride-1": {
    rpc: "https://stride-rpc.polkachu.com",
    rest: "https://stride-api.polkachu.com",
    chainId: "stride-1",
    chainName: "Stride",
    stakeCurrency: {
      coinDenom: "STRD",
      coinMinimalDenom: "ustrd",
      coinDecimals: 6,
      coinGeckoId: "stride",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("stride"),
    currencies: [
      {
        coinDenom: "STRD",
        coinMinimalDenom: "ustrd",
        coinDecimals: 6,
        coinGeckoId: "stride",
      },
      {
        coinDenom: "stATOM",
        coinMinimalDenom: "stuatom",
        coinDecimals: 6,
        coinGeckoId: "stride-staked-atom",
      },
      {
        coinDenom: "stOSMO",
        coinMinimalDenom: "stuosmo",
        coinDecimals: 6,
        coinGeckoId: "stride-staked-osmo",
      },
      {
        coinDenom: "stTIA",
        coinMinimalDenom: "stutia",
        coinDecimals: 6,
        coinGeckoId: "stride-staked-tia",
      },
      {
        coinDenom: "stDYDX",
        coinMinimalDenom: "stadydx",
        coinDecimals: 18,
        coinGeckoId: "stride-staked-dydx",
      },
      {
        coinDenom: "stINJ",
        coinMinimalDenom: "stinj",
        coinDecimals: 18,
        coinGeckoId: "stride-staked-injective",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "STRD",
        coinMinimalDenom: "ustrd",
        coinDecimals: 6,
        coinGeckoId: "stride",
        gasPriceStep: {
          low: 0.005,
          average: 0.005,
          high: 0.05,
        },
      },
      {
        coinDenom: "ATOM",
        coinMinimalDenom:
          "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2",
        coinDecimals: 6,
        coinGeckoId: "cosmos",
        gasPriceStep: {
          low: 0.0001,
          average: 0.001,
          high: 0.01,
        },
      },
      {
        coinDenom: "TIA",
        coinMinimalDenom:
          "ibc/BF3B4F53F3694B66E13C23107C84B6485BD2B96296BB7EC680EA77BBA75B4801",
        coinDecimals: 6,
        coinGeckoId: "celestia",
        gasPriceStep: {
          low: 0.01,
          average: 0.01,
          high: 0.01,
        },
      },
    ],
    features: [],
  },
  "akashnet-2": {
    rpc: "https://akash-rpc.polkachu.com",
    rest: "https://akash-api.polkachu.com",
    chainId: "akashnet-2",
    chainName: "Akash",
    stakeCurrency: {
      coinDenom: "AKT",
      coinMinimalDenom: "uakt",
      coinDecimals: 6,
      coinGeckoId: "akash-network",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("akash"),
    currencies: [
      {
        coinDenom: "AKT",
        coinMinimalDenom: "uakt",
        coinDecimals: 6,
        coinGeckoId: "akash-network",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "AKT",
        coinMinimalDenom: "uakt",
        coinDecimals: 6,
        coinGeckoId: "akash-network",
        gasPriceStep: {
          low: 0.0025,
          average: 0.025,
          high: 0.25,
        },
      },
    ],
    features: [],
  },
  "injective-1": {
    rpc: "https://injective-rpc.polkachu.com",
    rest: "https://injective-api.polkachu.com",
    chainId: "injective-1",
    chainName: "Injective",
    stakeCurrency: {
      coinDenom: "INJ",
      coinMinimalDenom: "inj",
      coinDecimals: 18,
      coinGeckoId: "injective-protocol",
    },
    bip44: { coinType: 60 },
    bech32Config: Bech32Address.defaultBech32Config("inj"),
    currencies: [
      {
        coinDenom: "INJ",
        coinMinimalDenom: "inj",
        coinDecimals: 18,
        coinGeckoId: "injective-protocol",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "INJ",
        coinMinimalDenom: "inj",
        coinDecimals: 18,
        coinGeckoId: "injective-protocol",
        gasPriceStep: {
          low: 500000000,
          average: 1000000000,
          high: 1500000000,
        },
      },
    ],
    features: ["eth-address-gen", "eth-key-sign", "cosmwasm"],
  },
  "agoric-3": {
    rpc: "https://agoric-rpc.polkachu.com",
    rest: "https://agoric-api.polkachu.com",
    chainId: "agoric-3",
    chainName: "Agoric",
    stakeCurrency: {
      coinDenom: "BLD",
      coinMinimalDenom: "ubld",
      coinDecimals: 6,
      coinGeckoId: "agoric",
    },
    bip44: { coinType: 564 },
    bech32Config: Bech32Address.defaultBech32Config("agoric"),
    currencies: [
      {
        coinDenom: "BLD",
        coinMinimalDenom: "ubld",
        coinDecimals: 6,
        coinGeckoId: "agoric",
      },
      {
        coinDenom: "IST",
        coinMinimalDenom: "uist",
        coinDecimals: 6,
        coinGeckoId: "inter-stable-token",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "BLD",
        coinMinimalDenom: "ubld",
        coinDecimals: 6,
        coinGeckoId: "agoric",
        gasPriceStep: {
          low: 0.03,
          average: 0.05,
          high: 0.07,
        },
      },
      {
        coinDenom: "IST",
        coinMinimalDenom: "uist",
        coinDecimals: 6,
        coinGeckoId: "inter-stable-token",
        gasPriceStep: {
          low: 0.0034,
          average: 0.007,
          high: 0.02,
        },
      },
    ],
    features: [],
  },
  "columbus-5": {
    rpc: "https://terra-classic-rpc.publicnode.com",
    rest: "https://terra-classic-lcd.publicnode.com",
    chainId: "columbus-5",
    chainName: "Terra Classic",
    stakeCurrency: {
      coinDenom: "LUNC",
      coinMinimalDenom: "uluna",
      coinDecimals: 6,
      coinGeckoId: "terra-luna",
    },
    bip44: { coinType: 330 },
    bech32Config: Bech32Address.defaultBech32Config("terra"),
    currencies: [
      {
        coinDenom: "LUNC",
        coinMinimalDenom: "uluna",
        coinDecimals: 6,
        coinGeckoId: "terra-luna",
      },
      {
        coinDenom: "USTC",
        coinMinimalDenom: "uusd",
        coinDecimals: 6,
        coinGeckoId: "terrausd",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "LUNC",
        coinMinimalDenom: "uluna",
        coinDecimals: 6,
        coinGeckoId: "terra-luna",
        gasPriceStep: {
          low: 28.325,
          average: 28.325,
          high: 28.325,
        },
      },
      {
        coinDenom: "USTC",
        coinMinimalDenom: "uusd",
        coinDecimals: 6,
        coinGeckoId: "terrausd",
        gasPriceStep: {
          low: 0.75,
          average: 0.75,
          high: 0.75,
        },
      },
    ],
    features: ["terra-classic-fee"],
  },
  "secret-4": {
    rpc: "https://rpc-secret.keplr.app",
    rest: "https://lcd-secret.keplr.app",
    chainId: "secret-4",
    chainName: "Secret Network",
    stakeCurrency: {
      coinDenom: "SCRT",
      coinMinimalDenom: "uscrt",
      coinDecimals: 6,
      coinGeckoId: "secret",
    },
    bip44: { coinType: 529 },
    bech32Config: Bech32Address.defaultBech32Config("secret"),
    currencies: [
      {
        coinDenom: "SCRT",
        coinMinimalDenom: "uscrt",
        coinDecimals: 6,
        coinGeckoId: "secret",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "SCRT",
        coinMinimalDenom: "uscrt",
        coinDecimals: 6,
        coinGeckoId: "secret",
        gasPriceStep: {
          low: 0.05,
          average: 0.1,
          high: 0.25,
        },
      },
    ],
    features: ["secretwasm", "ibc-go", "ibc-transfer"],
  },
  "crypto-org-chain-mainnet-1": {
    rpc: "https://rpc.cosmos.directory/cryptoorgchain",
    rest: "https://rest.cosmos.directory/cryptoorgchain",
    chainId: "crypto-org-chain-mainnet-1",
    chainName: "Crypto.org",
    stakeCurrency: {
      coinDenom: "CRO",
      coinMinimalDenom: "basecro",
      coinDecimals: 8,
      coinGeckoId: "crypto-com-chain",
    },
    bip44: { coinType: 394 },
    bech32Config: {
      bech32PrefixAccAddr: "cro",
      bech32PrefixAccPub: "cropub",
      bech32PrefixValAddr: "crocncl",
      bech32PrefixValPub: "crocnclpub",
      bech32PrefixConsAddr: "crocnclcons",
      bech32PrefixConsPub: "crocnclconspub",
    },
    currencies: [
      {
        coinDenom: "CRO",
        coinMinimalDenom: "basecro",
        coinDecimals: 8,
        coinGeckoId: "crypto-com-chain",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "CRO",
        coinMinimalDenom: "basecro",
        coinDecimals: 8,
        coinGeckoId: "crypto-com-chain",
        gasPriceStep: {
          low: 0.025,
          average: 0.03,
          high: 0.04,
        },
      },
    ],
    features: [],
  },
  "irishub-1": {
    rpc: "https://rpc.cosmos.directory/irisnet",
    rest: "https://rest.cosmos.directory/irisnet",
    chainId: "irishub-1",
    chainName: "IRISnet",
    stakeCurrency: {
      coinDenom: "IRIS",
      coinMinimalDenom: "uiris",
      coinDecimals: 6,
      coinGeckoId: "iris-network",
    },
    bip44: { coinType: 118 },
    bech32Config: {
      bech32PrefixAccAddr: "iaa",
      bech32PrefixAccPub: "iap",
      bech32PrefixValAddr: "iva",
      bech32PrefixValPub: "ivp",
      bech32PrefixConsAddr: "ica",
      bech32PrefixConsPub: "icp",
    },
    currencies: [
      {
        coinDenom: "IRIS",
        coinMinimalDenom: "uiris",
        coinDecimals: 6,
        coinGeckoId: "iris-network",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "IRIS",
        coinMinimalDenom: "uiris",
        coinDecimals: 6,
        coinGeckoId: "iris-network",
        gasPriceStep: {
          low: 0.2,
          average: 0.3,
          high: 0.4,
        },
      },
    ],
    features: [],
  },
  "regen-1": {
    rpc: "https://regen-rpc.polkachu.com",
    rest: "https://regen-api.polkachu.com",
    chainId: "regen-1",
    chainName: "Regen",
    stakeCurrency: {
      coinDenom: "REGEN",
      coinMinimalDenom: "uregen",
      coinDecimals: 6,
      coinGeckoId: "regen",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("regen"),
    currencies: [
      {
        coinDenom: "REGEN",
        coinMinimalDenom: "uregen",
        coinDecimals: 6,
        coinGeckoId: "regen",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "REGEN",
        coinMinimalDenom: "uregen",
        coinDecimals: 6,
        coinGeckoId: "regen",
        gasPriceStep: {
          low: 0.015,
          average: 0.025,
          high: 0.04,
        },
      },
    ],
    features: [],
  },
  "core-1": {
    rpc: "https://persistence-rpc.polkachu.com",
    rest: "https://persistence-api.polkachu.com",
    chainId: "core-1",
    chainName: "Persistence",
    stakeCurrency: {
      coinDenom: "XPRT",
      coinMinimalDenom: "uxprt",
      coinDecimals: 6,
      coinGeckoId: "persistence",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("persistence"),
    currencies: [
      {
        coinDenom: "XPRT",
        coinMinimalDenom: "uxprt",
        coinDecimals: 6,
        coinGeckoId: "persistence",
      },
      {
        coinDenom: "STKATOM",
        coinMinimalDenom: "stk/uatom",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "XPRT",
        coinMinimalDenom: "uxprt",
        coinDecimals: 6,
        coinGeckoId: "persistence",
        gasPriceStep: {
          low: 0,
          average: 0.025,
          high: 0.04,
        },
      },
    ],
    features: [],
  },
  "sentinelhub-2": {
    rpc: "https://sentinel-rpc.polkachu.com",
    rest: "https://sentinel-api.polkachu.com",
    chainId: "sentinelhub-2",
    chainName: "Sentinel",
    stakeCurrency: {
      coinDenom: "P2P",
      coinMinimalDenom: "udvpn",
      coinDecimals: 6,
      coinGeckoId: "sentinel",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("sent"),
    currencies: [
      {
        coinDenom: "P2P",
        coinMinimalDenom: "udvpn",
        coinDecimals: 6,
        coinGeckoId: "sentinel",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "P2P",
        coinMinimalDenom: "udvpn",
        coinDecimals: 6,
        coinGeckoId: "sentinel",
        gasPriceStep: {
          low: 0.1,
          average: 0.25,
          high: 0.4,
        },
      },
    ],
    features: [],
  },
  bostrom: {
    rpc: "https://rpc.cosmos.directory/bostrom",
    rest: "https://rest.cosmos.directory/bostrom",
    chainId: "bostrom",
    chainName: "Bostrom",
    stakeCurrency: {
      coinDenom: "BOOT",
      coinMinimalDenom: "boot",
      coinDecimals: 0,
      coinGeckoId: "bostrom",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("bostrom"),
    currencies: [
      {
        coinDenom: "BOOT",
        coinMinimalDenom: "boot",
        coinDecimals: 0,
      },
      {
        coinDenom: "H",
        coinMinimalDenom: "hydrogen",
        coinDecimals: 0,
      },
      {
        coinDenom: "V",
        coinMinimalDenom: "millivolt",
        coinDecimals: 3,
      },
      {
        coinDenom: "A",
        coinMinimalDenom: "milliampere",
        coinDecimals: 3,
      },
      {
        coinDenom: "TOCYB",
        coinMinimalDenom: "tocyb",
        coinDecimals: 0,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "BOOT",
        coinMinimalDenom: "boot",
        coinDecimals: 0,
        gasPriceStep: {
          low: 0,
          average: 0,
          high: 0.01,
        },
      },
    ],
    features: ["ibc-transfer", "cosmwasm", "ibc-go"],
  },
  "axelar-dojo-1": {
    rpc: "https://axelar-rpc.polkachu.com",
    rest: "https://axelar-api.polkachu.com",
    chainId: "axelar-dojo-1",
    chainName: "Axelar",
    stakeCurrency: {
      coinDenom: "AXL",
      coinMinimalDenom: "uaxl",
      coinDecimals: 6,
      coinGeckoId: "axelar",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("axelar"),
    currencies: [
      {
        coinDenom: "AXL",
        coinMinimalDenom: "uaxl",
        coinDecimals: 6,
        coinGeckoId: "axelar",
      },
      {
        coinDenom: "WETH",
        coinMinimalDenom: "weth-wei",
        coinDecimals: 18,
        coinGeckoId: "weth",
      },
      {
        coinDenom: "USDC",
        coinMinimalDenom: "uusdc",
        coinDecimals: 6,
        coinGeckoId: "usd-coin",
      },
      {
        coinDenom: "FRAX",
        coinMinimalDenom: "frax-wei",
        coinDecimals: 18,
        coinGeckoId: "frax",
      },
      {
        coinDenom: "DAI",
        coinMinimalDenom: "dai-wei",
        coinDecimals: 18,
        coinGeckoId: "dai",
      },
      {
        coinDenom: "USDT",
        coinMinimalDenom: "uusdt",
        coinDecimals: 6,
        coinGeckoId: "tether",
      },
      {
        coinDenom: "WBTC",
        coinMinimalDenom: "wbtc-satoshi",
        coinDecimals: 8,
        coinGeckoId: "wrapped-bitcoin",
      },
      {
        coinDenom: "LINK",
        coinMinimalDenom: "link-wei",
        coinDecimals: 18,
        coinGeckoId: "chainlink",
      },
      {
        coinDenom: "AAVE",
        coinMinimalDenom: "aave-wei",
        coinDecimals: 18,
        coinGeckoId: "aave",
      },
      {
        coinDenom: "APE",
        coinMinimalDenom: "ape-wei",
        coinDecimals: 18,
        coinGeckoId: "apecoin",
      },
      {
        coinDenom: "AXS",
        coinMinimalDenom: "axs-wei",
        coinDecimals: 18,
        coinGeckoId: "axie-infinity",
      },
      {
        coinDenom: "MKR",
        coinMinimalDenom: "mkr-wei",
        coinDecimals: 18,
        coinGeckoId: "maker",
      },
      {
        coinDenom: "RAI",
        coinMinimalDenom: "rai-wei",
        coinDecimals: 18,
        coinGeckoId: "rai",
      },
      {
        coinDenom: "SHIB",
        coinMinimalDenom: "shib-wei",
        coinDecimals: 18,
        coinGeckoId: "shiba-inu",
      },
      {
        coinDenom: "stETH",
        coinMinimalDenom: "steth-wei",
        coinDecimals: 18,
        coinGeckoId: "staked-ether",
      },
      {
        coinDenom: "UNI",
        coinMinimalDenom: "uni-wei",
        coinDecimals: 18,
        coinGeckoId: "uniswap",
      },
      {
        coinDenom: "XCN",
        coinMinimalDenom: "xcn-wei",
        coinDecimals: 18,
        coinGeckoId: "chain-2",
      },
      {
        coinDenom: "WGLMR",
        coinMinimalDenom: "wglmr-wei",
        coinDecimals: 18,
        coinGeckoId: "wrapped-moonbeam",
      },
      {
        coinDenom: "DOT",
        coinMinimalDenom: "dot-planck",
        coinDecimals: 10,
        coinGeckoId: "polkadot",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "AXL",
        coinMinimalDenom: "uaxl",
        coinDecimals: 6,
        coinGeckoId: "axelar",
        gasPriceStep: {
          low: 0.007,
          average: 0.007,
          high: 0.01,
        },
      },
    ],
    features: ["ibc-transfer", "ibc-go", "axelar-evm-bridge"],
  },
  "sommelier-3": {
    rpc: "https://sommelier-rpc.polkachu.com",
    rest: "https://sommelier-api.polkachu.com",
    chainId: "sommelier-3",
    chainName: "Sommelier",
    stakeCurrency: {
      coinDenom: "SOMM",
      coinMinimalDenom: "usomm",
      coinDecimals: 6,
      coinGeckoId: "sommelier",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("somm"),
    currencies: [
      {
        coinDenom: "SOMM",
        coinMinimalDenom: "usomm",
        coinDecimals: 6,
        coinGeckoId: "sommelier",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "SOMM",
        coinMinimalDenom: "usomm",
        coinDecimals: 6,
        coinGeckoId: "sommelier",
      },
    ],
    features: [],
  },
  "umee-1": {
    rpc: "https://umee-rpc.polkachu.com",
    rest: "https://umee-api.polkachu.com",
    chainId: "umee-1",
    chainName: "UX Chain",
    stakeCurrency: {
      coinDenom: "UX",
      coinMinimalDenom: "uumee",
      coinDecimals: 6,
      coinGeckoId: "umee",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("umee"),
    currencies: [
      {
        coinDenom: "UX",
        coinMinimalDenom: "uumee",
        coinDecimals: 6,
        coinGeckoId: "umee",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "UX",
        coinMinimalDenom: "uumee",
        coinDecimals: 6,
        coinGeckoId: "umee",
        gasPriceStep: {
          low: 0.1,
          average: 0.12,
          high: 0.2,
        },
      },
    ],
    features: [],
  },
  "kava_2222-10": {
    rpc: "https://kava-rpc.polkachu.com",
    rest: "https://kava-api.polkachu.com",
    chainId: "kava_2222-10",
    chainName: "Kava",
    stakeCurrency: {
      coinDenom: "KAVA",
      coinMinimalDenom: "ukava",
      coinDecimals: 6,
      coinGeckoId: "kava",
    },
    bip44: { coinType: 459 },
    bech32Config: Bech32Address.defaultBech32Config("kava"),
    currencies: [
      {
        coinDenom: "KAVA",
        coinMinimalDenom: "ukava",
        coinDecimals: 6,
        coinGeckoId: "kava",
      },
      {
        coinDenom: "SWP",
        coinMinimalDenom: "swp",
        coinDecimals: 6,
        coinGeckoId: "kava-swap",
      },
      {
        coinDenom: "USDX",
        coinMinimalDenom: "usdx",
        coinDecimals: 6,
        coinGeckoId: "usdx",
      },
      {
        coinDenom: "HARD",
        coinMinimalDenom: "hard",
        coinDecimals: 6,
      },
      {
        coinDenom: "BNB",
        coinMinimalDenom: "bnb",
        coinDecimals: 8,
      },
      {
        coinDenom: "BTCB",
        coinMinimalDenom: "btcb",
        coinDecimals: 8,
      },
      {
        coinDenom: "BUSD",
        coinMinimalDenom: "busd",
        coinDecimals: 8,
      },
      {
        coinDenom: "XRPB",
        coinMinimalDenom: "xrpb",
        coinDecimals: 8,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "KAVA",
        coinMinimalDenom: "ukava",
        coinDecimals: 6,
        coinGeckoId: "kava",
        gasPriceStep: {
          low: 0.05,
          average: 0.1,
          high: 0.25,
        },
      },
    ],
    features: [],
  },
  "quicksilver-2": {
    rpc: "https://quicksilver-rpc.polkachu.com",
    rest: "https://quicksilver-api.polkachu.com",
    chainId: "quicksilver-2",
    chainName: "Quicksilver",
    stakeCurrency: {
      coinDenom: "QCK",
      coinMinimalDenom: "uqck",
      coinDecimals: 6,
      coinGeckoId: "quicksilver",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("quick"),
    currencies: [
      {
        coinDenom: "QCK",
        coinMinimalDenom: "uqck",
        coinDecimals: 6,
        coinGeckoId: "quicksilver",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "QCK",
        coinMinimalDenom: "uqck",
        coinDecimals: 6,
        coinGeckoId: "quicksilver",
        gasPriceStep: {
          low: 0.0001,
          average: 0.0001,
          high: 0.00025,
        },
      },
    ],
    features: [],
  },
  "phoenix-1": {
    rpc: "https://terra-rpc.polkachu.com",
    rest: "https://terra-api.polkachu.com",
    chainId: "phoenix-1",
    chainName: "Terra",
    stakeCurrency: {
      coinDenom: "LUNA",
      coinMinimalDenom: "uluna",
      coinDecimals: 6,
      coinGeckoId: "terra-luna-2",
    },
    bip44: { coinType: 330 },
    bech32Config: Bech32Address.defaultBech32Config("terra"),
    currencies: [
      {
        coinDenom: "LUNA",
        coinMinimalDenom: "uluna",
        coinDecimals: 6,
        coinGeckoId: "terra-luna-2",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "LUNA",
        coinMinimalDenom: "uluna",
        coinDecimals: 6,
        coinGeckoId: "terra-luna-2",
        gasPriceStep: {
          low: 0.02,
          average: 0.02,
          high: 0.04,
        },
      },
    ],
    features: [],
  },
  "kyve-1": {
    rpc: "https://kyve-rpc.polkachu.com",
    rest: "https://kyve-api.polkachu.com",
    chainId: "kyve-1",
    chainName: "KYVE",
    stakeCurrency: {
      coinDenom: "KYVE",
      coinMinimalDenom: "ukyve",
      coinDecimals: 6,
      coinGeckoId: "kyve-network",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("kyve"),
    currencies: [
      {
        coinDenom: "KYVE",
        coinMinimalDenom: "ukyve",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "KYVE",
        coinMinimalDenom: "ukyve",
        coinDecimals: 6,
        gasPriceStep: {
          low: 62.5,
          average: 80,
          high: 125,
        },
      },
    ],
    features: [],
  },
  "neutron-1": {
    rpc: "https://neutron-rpc.polkachu.com",
    rest: "https://neutron-api.polkachu.com",
    chainId: "neutron-1",
    chainName: "Neutron",
    stakeCurrency: {
      coinDenom: "NTRN",
      coinMinimalDenom: "untrn",
      coinDecimals: 6,
      coinGeckoId: "neutron-3",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("neutron"),
    currencies: [
      {
        coinDenom: "NTRN",
        coinMinimalDenom: "untrn",
        coinDecimals: 6,
        coinGeckoId: "neutron-3",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "NTRN",
        coinMinimalDenom: "untrn",
        coinDecimals: 6,
        coinGeckoId: "neutron-3",
        gasPriceStep: {
          low: 0.0053,
          average: 0.0053,
          high: 0.0053,
        },
      },
    ],
    features: [],
  },
  "passage-2": {
    rpc: "https://passage-rpc.polkachu.com",
    rest: "https://passage-api.polkachu.com",
    chainId: "passage-2",
    chainName: "Passage",
    stakeCurrency: {
      coinDenom: "PASG",
      coinMinimalDenom: "upasg",
      coinDecimals: 6,
      coinGeckoId: "passage",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("pasg"),
    currencies: [
      {
        coinDenom: "PASG",
        coinMinimalDenom: "upasg",
        coinDecimals: 6,
        coinGeckoId: "passage",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "PASG",
        coinMinimalDenom: "upasg",
        coinDecimals: 6,
        coinGeckoId: "passage",
        gasPriceStep: {
          low: 12.5,
          average: 12.5,
          high: 12.5,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "dymension_1100-1": {
    rpc: "https://dymension-rpc.polkachu.com",
    rest: "https://dymension-api.polkachu.com",
    chainId: "dymension_1100-1",
    chainName: "Dymension",
    stakeCurrency: {
      coinDenom: "DYM",
      coinMinimalDenom: "adym",
      coinDecimals: 18,
      coinGeckoId: "dymension",
    },
    bip44: { coinType: 60 },
    bech32Config: Bech32Address.defaultBech32Config("dym"),
    currencies: [
      {
        coinDenom: "DYM",
        coinMinimalDenom: "adym",
        coinDecimals: 18,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "DYM",
        coinMinimalDenom: "adym",
        coinDecimals: 18,
        gasPriceStep: {
          low: 20000000000,
          average: 20000000000,
          high: 20000000000,
        },
      },
    ],
    features: ["eth-address-gen", "eth-key-sign"],
  },
  "chihuahua-1": {
    rpc: "https://chihuahua-rpc.polkachu.com",
    rest: "https://chihuahua-api.polkachu.com",
    chainId: "chihuahua-1",
    chainName: "Chihuahua",
    stakeCurrency: {
      coinDenom: "HUAHUA",
      coinMinimalDenom: "uhuahua",
      coinDecimals: 6,
      coinGeckoId: "chihuahua-token",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("chihuahua"),
    currencies: [
      {
        coinDenom: "HUAHUA",
        coinMinimalDenom: "uhuahua",
        coinDecimals: 6,
        coinGeckoId: "chihuahua-token",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "HUAHUA",
        coinMinimalDenom: "uhuahua",
        coinDecimals: 6,
        coinGeckoId: "chihuahua-token",
        gasPriceStep: {
          low: 500,
          average: 1250,
          high: 2000,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "ssc-1": {
    rpc: "https://saga-rpc.polkachu.com",
    rest: "https://saga-api.polkachu.com",
    chainId: "ssc-1",
    chainName: "Saga",
    stakeCurrency: {
      coinDenom: "SAGA",
      coinMinimalDenom: "usaga",
      coinDecimals: 6,
      coinGeckoId: "saga-2",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("saga"),
    currencies: [
      {
        coinDenom: "SAGA",
        coinMinimalDenom: "usaga",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "SAGA",
        coinMinimalDenom: "usaga",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.01,
          average: 0.025,
          high: 0.04,
        },
      },
    ],
    features: [],
  },
  "seda-1": {
    rpc: "https://seda-rpc.polkachu.com",
    rest: "https://seda-api.polkachu.com",
    chainId: "seda-1",
    chainName: "SEDA",
    stakeCurrency: {
      coinDenom: "SEDA",
      coinMinimalDenom: "aseda",
      coinDecimals: 18,
      coinGeckoId: "seda-2",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("seda"),
    currencies: [
      {
        coinDenom: "SEDA",
        coinMinimalDenom: "aseda",
        coinDecimals: 18,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "SEDA",
        coinMinimalDenom: "aseda",
        coinDecimals: 18,
        gasPriceStep: {
          low: 10000000000,
          average: 15000000000,
          high: 20000000000,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "dimension_37-1": {
    rpc: "https://xpla-rpc.polkachu.com",
    rest: "https://xpla-api.polkachu.com",
    chainId: "dimension_37-1",
    chainName: "XPLA",
    stakeCurrency: {
      coinDenom: "XPLA",
      coinMinimalDenom: "axpla",
      coinDecimals: 18,
      coinGeckoId: "xpla",
    },
    bip44: { coinType: 60 },
    bech32Config: Bech32Address.defaultBech32Config("xpla"),
    currencies: [
      {
        coinDenom: "XPLA",
        coinMinimalDenom: "axpla",
        coinDecimals: 18,
        coinGeckoId: "xpla",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "XPLA",
        coinMinimalDenom: "axpla",
        coinDecimals: 18,
        coinGeckoId: "xpla",
        gasPriceStep: {
          low: 280000000000,
          average: 280000000000,
          high: 280000000000,
        },
      },
    ],
    features: ["eth-address-gen", "eth-key-sign", "cosmwasm"],
  },
  "zetachain_7000-1": {
    rpc: "https://zetachain-rpc.polkachu.com",
    rest: "https://zetachain-api.polkachu.com",
    chainId: "zetachain_7000-1",
    chainName: "ZetaChain",
    stakeCurrency: {
      coinDenom: "ZETA",
      coinMinimalDenom: "azeta",
      coinDecimals: 18,
      coinGeckoId: "zetachain",
    },
    bip44: { coinType: 60 },
    bech32Config: {
      bech32PrefixAccAddr: "zeta",
      bech32PrefixAccPub: "zetapub",
      bech32PrefixValAddr: "zetavaloper",
      bech32PrefixValPub: "zetavaloperpub",
      bech32PrefixConsAddr: "ezetaalcons",
      bech32PrefixConsPub: "zetavalconspub",
    },
    currencies: [
      {
        coinDenom: "ZETA",
        coinMinimalDenom: "azeta",
        coinDecimals: 18,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "ZETA",
        coinMinimalDenom: "azeta",
        coinDecimals: 18,
        gasPriceStep: {
          low: 80000000000,
          average: 80000000000,
          high: 80000000000,
        },
      },
    ],
    features: ["eth-address-gen", "eth-key-sign"],
  },
  "lava-mainnet-1": {
    rpc: "https://lava.tendermintrpc.lava.build",
    rest: "https://lava.rest.lava.build",
    chainId: "lava-mainnet-1",
    chainName: "Lava",
    stakeCurrency: {
      coinDenom: "LAVA",
      coinMinimalDenom: "ulava",
      coinDecimals: 6,
      coinGeckoId: "lava-network",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("lava@"),
    currencies: [
      {
        coinDenom: "LAVA",
        coinMinimalDenom: "ulava",
        coinDecimals: 6,
        coinGeckoId: "lava-network",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "LAVA",
        coinMinimalDenom: "ulava",
        coinDecimals: 6,
        coinGeckoId: "lava-network",
        gasPriceStep: {
          low: 0.00002,
          average: 0.025,
          high: 0.05,
        },
      },
    ],
    features: [],
  },
  // TODO: Need a mechanism to dynamically sync chain config (currency, fee denom, etc.) from an external registry.
  // Currently hardcoded, so denom migrations (e.g., uom → amantra) require manual updates.
  "mantra-1": {
    rpc: "https://mantra-rpc.polkachu.com",
    rest: "https://mantra-api.polkachu.com",
    chainId: "mantra-1",
    chainName: "MANTRA",
    stakeCurrency: {
      coinDenom: "MANTRA",
      coinMinimalDenom: "amantra",
      coinDecimals: 18,
      coinGeckoId: "mantra",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("mantra"),
    currencies: [
      {
        coinDenom: "MANTRA",
        coinMinimalDenom: "amantra",
        coinDecimals: 18,
        coinGeckoId: "mantra",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "MANTRA",
        coinMinimalDenom: "amantra",
        coinDecimals: 18,
        coinGeckoId: "mantra",
        gasPriceStep: {
          low: 40000000000,
          average: 80000000000,
          high: 120000000000,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "pirin-1": {
    rpc: "https://nolus-rpc.polkachu.com",
    rest: "https://nolus-api.polkachu.com",
    chainId: "pirin-1",
    chainName: "Nolus",
    stakeCurrency: {
      coinDenom: "NLS",
      coinMinimalDenom: "unls",
      coinDecimals: 6,
      coinGeckoId: "nolus",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("nolus"),
    currencies: [
      {
        coinDenom: "NLS",
        coinMinimalDenom: "unls",
        coinDecimals: 6,
        coinGeckoId: "nolus",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "NLS",
        coinMinimalDenom: "unls",
        coinDecimals: 6,
        coinGeckoId: "nolus",
        gasPriceStep: {
          low: 0.025,
          average: 0.05,
          high: 0.075,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "xion-mainnet-1": {
    rpc: "https://xion-rpc.polkachu.com",
    rest: "https://xion-api.polkachu.com",
    chainId: "xion-mainnet-1",
    chainName: "XION",
    stakeCurrency: {
      coinDenom: "XION",
      coinMinimalDenom: "uxion",
      coinDecimals: 6,
      coinGeckoId: "xion-2",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("xion"),
    currencies: [
      {
        coinDenom: "XION",
        coinMinimalDenom: "uxion",
        coinDecimals: 6,
        coinGeckoId: "xion-2",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "XION",
        coinMinimalDenom: "uxion",
        coinDecimals: 6,
        coinGeckoId: "xion-2",
        gasPriceStep: {
          low: 0.001,
          average: 0.001,
          high: 0.002,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "jackal-1": {
    rpc: "https://jackal-rpc.polkachu.com",
    rest: "https://jackal-api.polkachu.com",
    chainId: "jackal-1",
    chainName: "Jackal",
    stakeCurrency: {
      coinDenom: "JKL",
      coinMinimalDenom: "ujkl",
      coinDecimals: 6,
      coinGeckoId: "jackal-protocol",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("jkl"),
    currencies: [
      {
        coinDenom: "JKL",
        coinMinimalDenom: "ujkl",
        coinDecimals: 6,
        coinGeckoId: "jackal-protocol",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "JKL",
        coinMinimalDenom: "ujkl",
        coinDecimals: 6,
        coinGeckoId: "jackal-protocol",
        gasPriceStep: {
          low: 0.002,
          average: 0.004,
          high: 0.02,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "thorchain-1": {
    rpc: "https://rpc-v1.ninerealms.com",
    rest: "https://thornode.ninerealms.com",
    chainId: "thorchain-1",
    chainName: "THORChain",
    stakeCurrency: {
      coinDenom: "RUNE",
      coinMinimalDenom: "rune",
      coinDecimals: 8,
      coinGeckoId: "thorchain",
    },
    bip44: { coinType: 931 },
    bech32Config: Bech32Address.defaultBech32Config("thor"),
    currencies: [
      {
        coinDenom: "RUNE",
        coinMinimalDenom: "rune",
        coinDecimals: 8,
        coinGeckoId: "thorchain",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "RUNE",
        coinMinimalDenom: "rune",
        coinDecimals: 8,
        coinGeckoId: "thorchain",
        gasPriceStep: {
          low: 0,
          average: 0.02,
          high: 0.03,
        },
      },
    ],
    features: [],
  },
  "bbn-1": {
    rpc: "https://babylon-rpc.polkachu.com",
    rest: "https://babylon-api.polkachu.com",
    chainId: "bbn-1",
    chainName: "Babylon Genesis",
    stakeCurrency: {
      coinDenom: "BABY",
      coinMinimalDenom: "ubbn",
      coinDecimals: 6,
      coinGeckoId: "babylon",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("bbn"),
    currencies: [
      {
        coinDenom: "BABY",
        coinMinimalDenom: "ubbn",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "BABY",
        coinMinimalDenom: "ubbn",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.007,
          average: 0.007,
          high: 0.01,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "interwoven-1": {
    rpc: "https://rpc.initia.xyz",
    rest: "https://rest.initia.xyz",
    chainId: "interwoven-1",
    chainName: "Initia",
    stakeCurrency: {
      coinDenom: "INIT",
      coinMinimalDenom: "uinit",
      coinDecimals: 6,
      coinGeckoId: "initia",
    },
    bip44: { coinType: 60 },
    bech32Config: Bech32Address.defaultBech32Config("init"),
    currencies: [
      {
        coinDenom: "INIT",
        coinMinimalDenom: "uinit",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "INIT",
        coinMinimalDenom: "uinit",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.015,
          average: 0.015,
          high: 0.04,
        },
      },
    ],
    features: ["eth-address-gen", "eth-key-sign"],
  },
  "atomone-1": {
    rpc: "https://atomone-rpc.polkachu.com",
    rest: "https://atomone-api.polkachu.com",
    chainId: "atomone-1",
    chainName: "AtomOne",
    stakeCurrency: {
      coinDenom: "ATONE",
      coinMinimalDenom: "uatone",
      coinDecimals: 6,
      coinGeckoId: "atomone",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("atone"),
    currencies: [
      {
        coinDenom: "ATONE",
        coinMinimalDenom: "uatone",
        coinDecimals: 6,
        coinGeckoId: "atomone",
      },
      {
        coinDenom: "PHOTON",
        coinMinimalDenom: "uphoton",
        coinDecimals: 6,
        coinGeckoId: "photon-2",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "PHOTON",
        coinMinimalDenom: "uphoton",
        coinDecimals: 6,
        coinGeckoId: "photon-2",
        gasPriceStep: {
          low: 0.225,
          average: 0.36,
          high: 0.72,
        },
      },
      {
        coinDenom: "ATONE",
        coinMinimalDenom: "uatone",
        coinDecimals: 6,
        coinGeckoId: "atomone",
        gasPriceStep: {
          low: 0.025,
          average: 0.04,
          high: 0.08,
        },
      },
    ],
    features: [],
  },
  pocket: {
    rpc: "https://pocket-rpc.polkachu.com",
    rest: "https://pocket-api.polkachu.com",
    chainId: "pocket",
    chainName: "Pocket Network",
    stakeCurrency: {
      coinDenom: "POKT",
      coinMinimalDenom: "upokt",
      coinDecimals: 6,
      coinGeckoId: "pocket-network",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("pokt"),
    currencies: [
      {
        coinDenom: "POKT",
        coinMinimalDenom: "upokt",
        coinDecimals: 6,
        coinGeckoId: "pocket-network",
      },
      {
        coinDenom: "MACT",
        coinMinimalDenom: "umact",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "POKT",
        coinMinimalDenom: "upokt",
        coinDecimals: 6,
        coinGeckoId: "pocket-network",
        gasPriceStep: {
          low: 0.01,
          average: 0.01,
          high: 0.01,
        },
      },
      {
        coinDenom: "MACT",
        coinMinimalDenom: "umact",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.01,
          average: 0.01,
          high: 0.01,
        },
      },
    ],
    features: [],
  },
  "xrplevm_1440000-1": {
    rpc: "https://rpc-xrplevm.keplr.app",
    rest: "https://lcd-xrplevm.keplr.app",
    chainId: "xrplevm_1440000-1",
    chainName: "XRPL EVM",
    stakeCurrency: {
      coinDenom: "XRP",
      coinMinimalDenom: "axrp",
      coinDecimals: 18,
      coinGeckoId: "ripple",
    },
    bip44: { coinType: 60 },
    bech32Config: {
      bech32PrefixAccAddr: "ethm",
      bech32PrefixAccPub: "ethmpub",
      bech32PrefixValAddr: "ethmvaloper",
      bech32PrefixValPub: "ethmvaloperpub",
      bech32PrefixConsAddr: "ethmvalcons",
      bech32PrefixConsPub: "ethmvalcons",
    },
    currencies: [
      {
        coinDenom: "XRP",
        coinMinimalDenom: "axrp",
        coinDecimals: 18,
        coinGeckoId: "ripple",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "XRP",
        coinMinimalDenom: "axrp",
        coinDecimals: 18,
        coinGeckoId: "ripple",
        gasPriceStep: {
          low: 200000000000,
          average: 250000000000,
          high: 400000000000,
        },
      },
    ],
    features: ["eth-address-gen", "eth-key-sign", "axelar-evm-bridge"],
  },
  "union-1": {
    rpc: "https://union-rpc.polkachu.com",
    rest: "https://union-api.polkachu.com",
    chainId: "union-1",
    chainName: "Union",
    stakeCurrency: {
      coinDenom: "U",
      coinMinimalDenom: "au",
      coinDecimals: 18,
      coinGeckoId: "union-2",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("union"),
    currencies: [
      {
        coinDenom: "U",
        coinMinimalDenom: "au",
        coinDecimals: 18,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "U",
        coinMinimalDenom: "au",
        coinDecimals: 18,
        gasPriceStep: {
          low: 100000000,
          average: 100000000,
          high: 200000000,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "lumera-mainnet-1": {
    rpc: "https://lumera-rpc.polkachu.com",
    rest: "https://lumera-api.polkachu.com",
    chainId: "lumera-mainnet-1",
    chainName: "Lumera",
    stakeCurrency: {
      coinDenom: "LUME",
      coinMinimalDenom: "ulume",
      coinDecimals: 6,
      coinGeckoId: "lumera",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("lumera"),
    currencies: [
      {
        coinDenom: "LUME",
        coinMinimalDenom: "ulume",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "LUME",
        coinMinimalDenom: "ulume",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.025,
          average: 0.025,
          high: 0.025,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "zigchain-1": {
    rpc: "https://zigchain-rpc.polkachu.com",
    rest: "https://zigchain-api.polkachu.com",
    chainId: "zigchain-1",
    chainName: "ZIGChain",
    stakeCurrency: {
      coinDenom: "ZIG",
      coinMinimalDenom: "uzig",
      coinDecimals: 6,
      coinGeckoId: "zignaly",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("zig"),
    currencies: [
      {
        coinDenom: "ZIG",
        coinMinimalDenom: "uzig",
        coinDecimals: 6,
        coinGeckoId: "zignaly",
      },
      {
        coinDenom: "stzig",
        coinMinimalDenom:
          "coin.zig109f7g2rzl2aqee7z6gffn8kfe9cpqx0mjkk7ethmx8m2hq4xpe9snmaam2.stzig",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "ZIG",
        coinMinimalDenom: "uzig",
        coinDecimals: 6,
        coinGeckoId: "zignaly",
        gasPriceStep: {
          low: 0.0025,
          average: 0.025,
          high: 0.05,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "pio-mainnet-1": {
    rpc: "https://provenance-rpc.polkachu.com",
    rest: "https://provenance-api.polkachu.com",
    chainId: "pio-mainnet-1",
    chainName: "Provenance",
    stakeCurrency: {
      coinDenom: "HASH",
      coinMinimalDenom: "nhash",
      coinDecimals: 9,
      coinGeckoId: "hash-2",
    },
    bip44: { coinType: 505 },
    bech32Config: Bech32Address.defaultBech32Config("pb"),
    currencies: [
      {
        coinDenom: "HASH",
        coinMinimalDenom: "nhash",
        coinDecimals: 9,
        coinGeckoId: "hash-2",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "HASH",
        coinMinimalDenom: "nhash",
        coinDecimals: 9,
        coinGeckoId: "hash-2",
        gasPriceStep: {
          low: 1,
          average: 1,
          high: 1,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  nyx: {
    rpc: "https://rpc.cosmos.directory/nyx",
    rest: "https://rest.cosmos.directory/nyx",
    chainId: "nyx",
    chainName: "Nym",
    stakeCurrency: {
      coinDenom: "NYM",
      coinMinimalDenom: "unym",
      coinDecimals: 6,
      coinGeckoId: "nym",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("n"),
    currencies: [
      {
        coinDenom: "NYM",
        coinMinimalDenom: "unym",
        coinDecimals: 6,
        coinGeckoId: "nym",
      },
      {
        coinDenom: "NYX",
        coinMinimalDenom: "unyx",
        coinDecimals: 6,
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "NYM",
        coinMinimalDenom: "unym",
        coinDecimals: 6,
        coinGeckoId: "nym",
        gasPriceStep: {
          low: 0.025,
          average: 0.025,
          high: 0.04,
        },
      },
      {
        coinDenom: "NYX",
        coinMinimalDenom: "unyx",
        coinDecimals: 6,
        gasPriceStep: {
          low: 0.025,
          average: 0.025,
          high: 0.04,
        },
      },
    ],
    features: ["cosmwasm"],
  },
  "archway-1": {
    rpc: "https://rpc.mainnet.archway.io",
    rest: "https://api.mainnet.archway.io",
    chainId: "archway-1",
    chainName: "Archway",
    stakeCurrency: {
      coinDenom: "ARCH",
      coinMinimalDenom: "aarch",
      coinDecimals: 18,
      coinGeckoId: "archway",
    },
    bip44: { coinType: 118 },
    bech32Config: Bech32Address.defaultBech32Config("archway"),
    currencies: [
      {
        coinDenom: "ARCH",
        coinMinimalDenom: "aarch",
        coinDecimals: 18,
        coinGeckoId: "archway",
      },
    ],
    feeCurrencies: [
      {
        coinDenom: "ARCH",
        coinMinimalDenom: "aarch",
        coinDecimals: 18,
        coinGeckoId: "archway",
        gasPriceStep: {
          low: 140000000000,
          average: 196000000000,
          high: 225400000000,
        },
      },
    ],
    features: ["cosmwasm"],
  },
};

/**
 * Get a chain config by ID.
 */
export function getChainConfig(chainId: string): ChainInfo | undefined {
  return BUILTIN_CHAINS[chainId];
}

/**
 * Find a chain by bech32 prefix.
 * Used for IBC auto-resolve where the recipient address prefix is the only hint.
 *
 * Throws when multiple chains share the same prefix (e.g. terra)
 * to prevent silently routing to the wrong chain.
 */
export const findChainByBech32Prefix = (
  prefix: string,
): ChainInfo | undefined => {
  const lower = prefix.toLowerCase();
  const byPrefix = (c: ChainInfo): boolean =>
    c.bech32Config?.bech32PrefixAccAddr.toLowerCase() === lower;

  const matches = Object.values(BUILTIN_CHAINS).filter(byPrefix);
  if (matches.length > 1) {
    const names = matches
      .map((c) => `${c.chainName} (${c.chainId})`)
      .join(", ");
    throw new Error(
      `Multiple chains share bech32 prefix '${prefix}': ${names}. Specify destChain or sourceChannel explicitly.`,
    );
  }

  return matches[0];
};

/**
 * Find a chain by name, ID, or bech32 prefix.
 */
export function findChainByName(name: string): ChainInfo | undefined {
  const lower = name.toLowerCase();
  return Object.values(BUILTIN_CHAINS).find(
    (c) =>
      c.chainName.toLowerCase() === lower ||
      c.chainId.toLowerCase() === lower ||
      c.bech32Config?.bech32PrefixAccAddr.toLowerCase() === lower,
  );
}

export const findAllChainsByName = (name: string): ChainInfo[] => {
  const lower = name.toLowerCase();
  const isMatch = (c: ChainInfo): boolean =>
    c.chainName.toLowerCase() === lower ||
    c.chainId.toLowerCase() === lower ||
    c.bech32Config?.bech32PrefixAccAddr.toLowerCase() === lower;

  return Object.values(BUILTIN_CHAINS).filter(isMatch);
};

/**
 * List all supported chains.
 */
export function listChains(): ChainInfo[] {
  return Object.values(BUILTIN_CHAINS);
}

// ============================================
// Convenience helpers for ChainInfo access
// ============================================

/**
 * Get the bech32 prefix from ChainInfo.
 */
export function getBech32Prefix(chain: ChainInfo): string {
  return chain.bech32Config?.bech32PrefixAccAddr ?? "";
}

/**
 * Get the stake currency denom from ChainInfo.
 */
export function getStakeDenom(chain: ChainInfo): string {
  return chain.stakeCurrency?.coinDenom ?? "";
}

/**
 * Get the stake currency minimal denom from ChainInfo.
 */
export function getStakeMinimalDenom(chain: ChainInfo): string {
  return chain.stakeCurrency?.coinMinimalDenom ?? "";
}

/**
 * Get the stake currency decimals from ChainInfo.
 */
export function getStakeDecimals(chain: ChainInfo): number {
  return chain.stakeCurrency?.coinDecimals ?? 6;
}

/**
 * Get the default gas price from ChainInfo.
 */
export function getGasPrice(chain: ChainInfo): string {
  const feeCurrency = chain.feeCurrencies[0];
  if (!feeCurrency) return "0.025uatom";

  const price = feeCurrency.gasPriceStep?.average ?? 0.025;
  return `${price}${feeCurrency.coinMinimalDenom}`;
}

/**
 * Get all fee currencies supported by the chain.
 */
export function getFeeCurrencies(chain: ChainInfo): typeof chain.feeCurrencies {
  return chain.feeCurrencies ?? [];
}

/**
 * Get gas price for a specific fee denomination.
 * Returns undefined if the denom is not a valid fee currency for this chain.
 */
export function getGasPriceForDenom(
  chain: ChainInfo,
  denom: string,
): string | undefined {
  const feeCurrency = chain.feeCurrencies.find(
    (fc: FeeCurrency) => fc.coinMinimalDenom === denom,
  );
  if (!feeCurrency) return undefined;

  const price = feeCurrency.gasPriceStep?.average ?? 0.025;
  return `${price}${feeCurrency.coinMinimalDenom}`;
}

/**
 * Check if a denomination is a valid fee currency for the chain.
 */
export function isValidFeeDenom(chain: ChainInfo, denom: string): boolean {
  return chain.feeCurrencies.some(
    (fc: FeeCurrency) => fc.coinMinimalDenom === denom,
  );
}

/**
 * Get the coinGeckoId from ChainInfo.
 */
export function getCoinGeckoId(chain: ChainInfo): string | undefined {
  return chain.stakeCurrency?.coinGeckoId;
}

/**
 * Resolved metadata for a denomination.
 */
export interface DenomMetadata {
  displayDenom: string;
  decimals: number;
  coinGeckoId?: string;
}

/**
 * Resolve a minimal denom (including IBC hash) to display metadata.
 * Searches chain's currencies first, then feeCurrencies.
 * Returns null if not found in chain config.
 */
export function resolveChainDenom(
  chain: ChainInfo,
  minimalDenom: string,
): DenomMetadata | null {
  for (const c of chain.currencies ?? []) {
    if (c.coinMinimalDenom === minimalDenom) {
      return {
        displayDenom: c.coinDenom,
        decimals: c.coinDecimals,
        coinGeckoId: c.coinGeckoId,
      };
    }
  }
  for (const fc of chain.feeCurrencies ?? []) {
    if (fc.coinMinimalDenom === minimalDenom) {
      return {
        displayDenom: fc.coinDenom,
        decimals: fc.coinDecimals,
        coinGeckoId: fc.coinGeckoId,
      };
    }
  }
  return null;
}
