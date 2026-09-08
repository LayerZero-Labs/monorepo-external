import { ChainKey, ChainName, Environment } from './enums';

export const CHAIN_KEY_ALIAS_CONFIG = {
    [ChainKey.TON]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TON,
            },
        ],
    },
    [ChainKey.TON_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TON,
            },
        ],
    },
    [ChainKey.TON_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.TON,
            },
        ],
    },
    [ChainKey.AVALANCHE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.AVALANCHE,
            },
        ],
    },
    [ChainKey.FUJI]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.AVALANCHE,
            },
        ],
    },
    [ChainKey.AVALANCHE_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.AVALANCHE,
            },
        ],
    },
    [ChainKey.TRON]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TRON,
            },
        ],
    },
    [ChainKey.SHASTA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TRON,
            },
        ],
    },
    [ChainKey.BSC]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BSC,
            },
        ],
    },
    [ChainKey.BSC_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.BSC,
            },
        ],
    },
    [ChainKey.BSC_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BSC,
            },
        ],
    },
    [ChainKey.TRON_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.TRON,
            },
        ],
    },
    [ChainKey.ETHEREUM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ETHEREUM,
            },
        ],
    },
    [ChainKey.SEPOLIA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SEPOLIA,
            },
            {
                environment: Environment.TESTNET,
                name: ChainName.ETHEREUM,
            },
        ],
    },
    [ChainKey.ETHEREUM_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.ETHEREUM,
            },
        ],
    },
    [ChainKey.SOLANA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SOLANA,
            },
        ],
    },
    [ChainKey.SOLANA_DEVNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SOLANA,
            },
        ],
    },
    [ChainKey.SOLANA_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.SOLANA,
            },
        ],
    },
    [ChainKey.APTOS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.APTOS,
            },
        ],
    },
    [ChainKey.APTOS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.APTOS,
            },
        ],
    },
    [ChainKey.APTOS_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.APTOS,
            },
        ],
    },
    [ChainKey.INTERWOVEN_1]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.INITIA,
            },
        ],
    },
    [ChainKey.INITIATION_2]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.INITIA,
            },
        ],
    },
    [ChainKey.INITIA_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.INITIA,
            },
        ],
    },
    [ChainKey.ARBITRUM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ARBITRUM,
            },
        ],
    },
    [ChainKey.ARBSEP]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ARBSEP,
            },
        ],
    },
    [ChainKey.ARBITRUM_GOERLI]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ARBITRUM,
            },
        ],
    },
    [ChainKey.ARBITRUM_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.ARBITRUM,
            },
        ],
    },
    [ChainKey.STARKNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.STARKNET,
            },
        ],
    },
    [ChainKey.STARKNET_SEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.STARKNET,
            },
        ],
    },
    // Must stay after STARKNET_SEPOLIA — resolveChainKey returns the first match.
    [ChainKey.STARKNET_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.STARKNET,
            },
        ],
    },
    [ChainKey.STARKNET_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.STARKNET,
            },
        ],
    },
    [ChainKey.GOERLI]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ETHEREUM,
            },
        ],
    },
    [ChainKey.POLYGON]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.POLYGON,
            },
        ],
    },
    [ChainKey.MUMBAI]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.POLYGON,
            },
        ],
    },
    [ChainKey.POLYGON_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.POLYGON,
            },
        ],
    },
    [ChainKey.OPTIMISM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.OPTIMISM,
            },
        ],
    },
    [ChainKey.OPTIMISM_GOERLI]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OPTIMISM,
            },
        ],
    },
    [ChainKey.OPTIMISM_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.OPTIMISM,
            },
        ],
    },
    [ChainKey.FANTOM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.FANTOM,
            },
        ],
    },
    [ChainKey.FANTOM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.FANTOM,
            },
        ],
    },
    [ChainKey.DFK]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.DFK,
            },
        ],
    },
    [ChainKey.DFK_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.DFK,
            },
        ],
    },
    [ChainKey.HARMONY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HARMONY,
            },
        ],
    },
    [ChainKey.HARMONY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HARMONY,
            },
        ],
    },
    [ChainKey.DEXALOT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.DEXALOT,
            },
        ],
    },
    [ChainKey.DEXALOT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.DEXALOT,
            },
        ],
    },
    [ChainKey.MOONBASE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MOONBEAM,
            },
        ],
    },
    [ChainKey.MOONBEAM_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MOONBEAM,
            },
        ],
    },
    [ChainKey.MOONBEAM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MOONBEAM,
            },
        ],
    },
    [ChainKey.MOONRIVER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MOONRIVER,
            },
        ],
    },
    [ChainKey.CELO]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CELO,
            },
        ],
    },
    [ChainKey.ALFAJORES]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CELO,
            },
        ],
    },
    [ChainKey.CONVERGE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CONVERGE,
            },
        ],
    },
    [ChainKey.CONVERGE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CONVERGE,
            },
        ],
    },
    [ChainKey.DOS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.DOS,
            },
        ],
    },
    [ChainKey.DOS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.DOS,
            },
        ],
    },
    [ChainKey.FUSE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.FUSE,
            },
        ],
    },
    [ChainKey.FUSESPARK]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.FUSE,
            },
        ],
    },
    [ChainKey.KLAYTN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.KLAYTN,
            },
        ],
    },
    [ChainKey.KLAYTN_BAOBAB]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.KLAYTN,
            },
        ],
    },
    [ChainKey.SHRAPNEL]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SHRAPNEL,
            },
        ],
    },
    [ChainKey.SHRAPNEL_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SHRAPNEL,
            },
        ],
    },
    [ChainKey.METIS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.METIS,
            },
        ],
    },
    [ChainKey.METIS_GOERLI]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.METIS,
            },
        ],
    },
    [ChainKey.COREDAO]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.COREDAO,
            },
        ],
    },
    [ChainKey.COREDAO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.COREDAO,
            },
        ],
    },
    [ChainKey.GNOSIS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GNOSIS,
            },
        ],
    },
    [ChainKey.CHIADO]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.GNOSIS,
            },
        ],
    },
    [ChainKey.ZKSYNC]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZKSYNC,
            },
        ],
    },
    [ChainKey.ZKSYNC_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKSYNC,
            },
        ],
    },
    [ChainKey.ZKSYNC_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.ZKSYNC,
            },
        ],
    },
    [ChainKey.OKX]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.OKX,
            },
        ],
    },
    [ChainKey.OKX_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OKX,
            },
        ],
    },
    [ChainKey.METER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.METER,
            },
        ],
    },
    [ChainKey.METER_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.METER,
            },
        ],
    },
    [ChainKey.GOERLI_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GOERLI,
            },
        ],
    },
    [ChainKey.SWIMMER_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SWIMMER,
            },
        ],
    },
    [ChainKey.INTAIN_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.INTAIN,
            },
        ],
    },
    [ChainKey.SEPOLIA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SEPOLIA,
            },
        ],
    },
    [ChainKey.SOMNIA_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SOMNIA,
            },
        ],
    },
    [ChainKey.SOMNIA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SOMNIA,
            },
        ],
    },
    [ChainKey.SOMNIA_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.SOMNIA,
            },
        ],
    },
    [ChainKey.SOMNIASHANNON_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SOMNIASHANNON,
            },
        ],
    },
    [ChainKey.SILICON_ZKEVM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SILICON,
            },
        ],
    },
    [ChainKey.SILICON_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SILICON,
            },
        ],
    },
    [ChainKey.SILICONSEPOLIA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SILICONSEPOLIA,
            },
        ],
    },
    [ChainKey.ETHEREAL_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ETHEREAL,
            },
        ],
    },
    [ChainKey.BASE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BASE,
            },
        ],
    },
    [ChainKey.BASE_GOERLI]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BASE,
            },
        ],
    },
    [ChainKey.BASE_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.BASE,
            },
        ],
    },
    [ChainKey.LINEA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZKCONSENSYS,
            },
        ],
    },
    [ChainKey.LINEA_GOERLI]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKCONSENSYS,
            },
        ],
    },
    [ChainKey.LINEA_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.ZKCONSENSYS,
            },
        ],
    },
    [ChainKey.ZKEVM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZKPOLYGON,
            },
        ],
    },
    [ChainKey.ZKEVM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKPOLYGON,
            },
        ],
    },
    [ChainKey.SCROLL]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SCROLL,
            },
        ],
    },
    [ChainKey.SCROLL_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SCROLL,
            },
        ],
    },
    [ChainKey.SCROLL_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.SCROLL,
            },
        ],
    },
    [ChainKey.CATHAY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CATHAY,
            },
        ],
    },
    [ChainKey.KAVA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.KAVA,
            },
        ],
    },
    [ChainKey.KAVA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.KAVA,
            },
        ],
    },
    [ChainKey.TENET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TENET,
            },
        ],
    },
    [ChainKey.TENET_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TENET,
            },
        ],
    },
    [ChainKey.TEMPO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TEMPO,
            },
        ],
    },
    [ChainKey.TEMPO_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.TEMPO,
            },
        ],
    },
    [ChainKey.TEMPODEV1_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TEMPODEV1,
            },
        ],
    },
    [ChainKey.ORDERLY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ORDERLY,
            },
        ],
    },
    [ChainKey.ORDERLY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ORDERLY,
            },
        ],
    },
    [ChainKey.CANTO]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CANTO,
            },
        ],
    },
    [ChainKey.CANTO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CANTO,
            },
        ],
    },
    [ChainKey.NOVA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.NOVA,
            },
        ],
    },
    [ChainKey.NOVA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.NOVA,
            },
        ],
    },
    [ChainKey.AAVEGOTCHI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.AAVEGOTCHI,
            },
        ],
    },
    [ChainKey.BLOCKGEN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BLOCKGEN,
            },
        ],
    },
    [ChainKey.BEAM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MERITCIRCLE,
            },
        ],
    },
    [ChainKey.BEAM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MERITCIRCLE,
            },
        ],
    },
    [ChainKey.MANTLE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MANTLE,
            },
        ],
    },
    [ChainKey.MANTLE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MANTLE,
            },
        ],
    },
    [ChainKey.MANTLE_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.MANTLE,
            },
        ],
    },
    [ChainKey.HUBBLE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HUBBLE,
            },
        ],
    },
    [ChainKey.HUBBLE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HUBBLE,
            },
        ],
    },
    [ChainKey.ZORA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZORA,
            },
        ],
    },
    [ChainKey.ZORA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZORA,
            },
        ],
    },
    [ChainKey.TOMO]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TOMO,
            },
        ],
    },
    [ChainKey.TOMO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TOMO,
            },
        ],
    },
    [ChainKey.LOOT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.LOOT,
            },
        ],
    },
    [ChainKey.LOOT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LOOT,
            },
        ],
    },
    [ChainKey.TELOS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TELOS,
            },
        ],
    },
    [ChainKey.TELOS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TELOS,
            },
        ],
    },
    [ChainKey.OPBNB]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.OPBNB,
            },
        ],
    },
    [ChainKey.OPBNB_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OPBNB,
            },
        ],
    },
    [ChainKey.SHIMMER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SHIMMER,
            },
        ],
    },
    [ChainKey.SHIMMER_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SHIMMER,
            },
        ],
    },
    [ChainKey.AURORA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.AURORA,
            },
        ],
    },
    [ChainKey.AURORA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.AURORA,
            },
        ],
    },
    [ChainKey.LIF3]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.LIF3,
            },
        ],
    },
    [ChainKey.LIF3_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LIF3,
            },
        ],
    },
    [ChainKey.SPRUCE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SPRUCE,
            },
        ],
    },
    [ChainKey.ODA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ODA,
            },
        ],
    },
    [ChainKey.KIWI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.KIWI,
            },
        ],
    },
    [ChainKey.KIWI2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.KIWI2,
            },
        ],
    },
    [ChainKey.ASTAR]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ASTAR,
            },
        ],
    },
    [ChainKey.ASTAR_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ASTAR,
            },
        ],
    },
    [ChainKey.CONFLUX]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CONFLUX,
            },
        ],
    },
    [ChainKey.CONFLUX_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CONFLUX,
            },
        ],
    },
    [ChainKey.EON]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.EON,
            },
        ],
    },
    [ChainKey.EON_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.EON,
            },
        ],
    },
    [ChainKey.XPLA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.XPLA,
            },
        ],
    },
    [ChainKey.XPLA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.XPLA,
            },
        ],
    },
    [ChainKey.HOLESKY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HOLESKY,
            },
        ],
    },
    [ChainKey.HOLESKY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HOLESKY,
            },
        ],
    },
    [ChainKey.INJECTIVE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.INJECTIVE,
            },
        ],
    },
    [ChainKey.IDEX_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.IDEX,
            },
        ],
    },
    [ChainKey.MANTA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MANTA,
            },
        ],
    },
    [ChainKey.MANTA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MANTA,
            },
        ],
    },
    [ChainKey.ZKATANA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZKATANA,
            },
        ],
    },
    [ChainKey.ZKATANA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKATANA,
            },
        ],
    },
    [ChainKey.FRAME]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.FRAME,
            },
        ],
    },
    [ChainKey.FRAME_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.FRAME,
            },
        ],
    },
    [ChainKey.POLYGONCDK_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.POLYGONCDK,
            },
        ],
    },
    [ChainKey.OPTIMISM_SEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OPTSEP,
            },
        ],
    },
    [ChainKey.VENN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.VENN,
            },
        ],
    },
    [ChainKey.RARIBLE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.RARIBLE,
            },
        ],
    },
    [ChainKey.RARIBLE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.RARIBLE,
            },
        ],
    },
    [ChainKey.GUNZILLA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GUNZILLA,
            },
        ],
    },
    [ChainKey.GUNZILLA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.GUNZILLA,
            },
        ],
    },
    [ChainKey.RC1]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.RC1,
            },
        ],
    },
    [ChainKey.RC1_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.RC1,
            },
        ],
    },
    [ChainKey.BERA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BERA,
            },
        ],
    },
    [ChainKey.BERA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BERA,
            },
        ],
    },
    [ChainKey.BERA_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.BERA,
            },
        ],
    },
    [ChainKey.BB1]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BB1,
            },
        ],
    },
    [ChainKey.BB1_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BB1,
            },
        ],
    },
    [ChainKey.XCHAIN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.XCHAIN,
            },
        ],
    },
    [ChainKey.XCHAIN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.XCHAIN,
            },
        ],
    },
    [ChainKey.JOC]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.JOC,
            },
        ],
    },
    [ChainKey.JOC_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.JOC,
            },
        ],
    },
    [ChainKey.BLAST]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BLAST,
            },
        ],
    },
    [ChainKey.BLAST_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BLAST,
            },
        ],
    },
    [ChainKey.XAI]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.XAI,
            },
        ],
    },
    [ChainKey.XAI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.XAI,
            },
        ],
    },
    [ChainKey.TANGIBLE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TANGIBLE,
            },
        ],
    },
    [ChainKey.TANGIBLE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TANGIBLE,
            },
        ],
    },
    [ChainKey.ZKPOLYGON_SEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKPOLYGONSEP,
            },
        ],
    },
    [ChainKey.BASE_SEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BASESEP,
            },
        ],
    },
    [ChainKey.ZORA_SEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZORASEP,
            },
        ],
    },
    [ChainKey.ETHERLINK]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ETHERLINK,
            },
        ],
    },
    [ChainKey.ETHERLINK_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ETHERLINK,
            },
        ],
    },
    [ChainKey.ETHERLINKSHADOWNET_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ETHERLINKSHADOWNET,
            },
        ],
    },
    [ChainKey.EXOCORE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.EXOCORE,
            },
        ],
    },
    [ChainKey.FRAXTAL]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.FRAXTAL,
            },
        ],
    },
    [ChainKey.FRAXTAL_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.FRAXTAL,
            },
        ],
    },
    [ChainKey.TILTYARD]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TILTYARD,
            },
        ],
    },
    [ChainKey.SKALE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SKALE,
            },
        ],
    },
    [ChainKey.SKALE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SKALE,
            },
        ],
    },
    [ChainKey.MODE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MODE,
            },
        ],
    },
    [ChainKey.MODE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MODE,
            },
        ],
    },
    [ChainKey.SEI]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SEI,
            },
        ],
    },
    [ChainKey.SEI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SEI,
            },
        ],
    },
    [ChainKey.SEI_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.SEI,
            },
        ],
    },
    [ChainKey.MANTLE_SEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MANTLESEP,
            },
        ],
    },
    [ChainKey.HEDERA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HEDERA,
            },
        ],
    },
    [ChainKey.HEDERA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HEDERA,
            },
        ],
    },
    [ChainKey.MASA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MASA,
            },
        ],
    },
    [ChainKey.MASA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MASA,
            },
        ],
    },
    [ChainKey.UNREAL_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.UNREAL,
            },
        ],
    },
    [ChainKey.MERLIN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MERLIN,
            },
        ],
    },
    [ChainKey.MERLIN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MERLIN,
            },
        ],
    },
    [ChainKey.MOCA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MOCA,
            },
        ],
    },
    [ChainKey.MOCA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MOCA,
            },
        ],
    },
    [ChainKey.REAL]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.REAL,
            },
        ],
    },
    [ChainKey.HOMEVERSE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HOMEVERSE,
            },
        ],
    },
    [ChainKey.HOMEVERSE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HOMEVERSE,
            },
        ],
    },
    [ChainKey.HORIZEN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HORIZEN,
            },
        ],
    },
    [ChainKey.HORIZEN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HORIZEN,
            },
        ],
    },
    [ChainKey.ZKASTAR_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKASTAR,
            },
        ],
    },
    [ChainKey.AMOY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.AMOY,
            },
        ],
    },
    [ChainKey.XLAYER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.XLAYER,
            },
        ],
    },
    [ChainKey.XLAYER_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.XLAYER,
            },
        ],
    },
    [ChainKey.FORM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.FORM,
            },
        ],
    },
    [ChainKey.LL1_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LL1,
            },
        ],
    },
    [ChainKey.BESU1_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BESU1,
            },
        ],
    },
    [ChainKey.MANTASEP_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MANTASEP,
            },
        ],
    },
    [ChainKey.DEGEN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.DEGEN,
            },
        ],
    },
    [ChainKey.ZIRCUIT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZIRCUIT,
            },
        ],
    },
    [ChainKey.ZIRCUIT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZIRCUIT,
            },
        ],
    },
    [ChainKey.CAMP]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CAMP,
            },
        ],
    },
    [ChainKey.CAMP_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CAMP,
            },
        ],
    },
    [ChainKey.TAIKO]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TAIKO,
            },
        ],
    },
    [ChainKey.TAIKO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TAIKO,
            },
        ],
    },
    [ChainKey.OLIVE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OLIVE,
            },
        ],
    },
    [ChainKey.SANKO]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SANKO,
            },
        ],
    },
    [ChainKey.SANKO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SANKO,
            },
        ],
    },
    [ChainKey.SAGAEVM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SAGAEVM,
            },
        ],
    },
    [ChainKey.SAGAEVM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SAGAEVM,
            },
        ],
    },
    [ChainKey.CYBER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CYBER,
            },
        ],
    },
    [ChainKey.CYBER_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CYBER,
            },
        ],
    },
    [ChainKey.BOB]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BOB,
            },
        ],
    },
    [ChainKey.BOB_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BOB,
            },
        ],
    },
    [ChainKey.BOTANIX_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BOTANIX,
            },
        ],
    },
    [ChainKey.EBI]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.EBI,
            },
        ],
    },
    [ChainKey.EBI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.EBI,
            },
        ],
    },
    [ChainKey.LINEA_SEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LINEASEP,
            },
        ],
    },
    [ChainKey.LINEASEP_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LINEASEP,
            },
        ],
    },
    [ChainKey.IOTA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.IOTA,
            },
        ],
    },
    [ChainKey.IOTA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.IOTA,
            },
        ],
    },
    [ChainKey.MORPH]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MORPH,
            },
        ],
    },
    [ChainKey.MORPH_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MORPH,
            },
        ],
    },
    [ChainKey.MORPH_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.MORPH,
            },
        ],
    },
    [ChainKey.BOUNCEBIT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BOUNCEBIT,
            },
        ],
    },
    [ChainKey.BOUNCEBIT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BOUNCEBIT,
            },
        ],
    },
    [ChainKey.GRAVITY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GRAVITY,
            },
        ],
    },
    [ChainKey.BARTIO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BARTIO,
            },
        ],
    },
    [ChainKey.FLARE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.FLARE,
            },
        ],
    },
    [ChainKey.FLARE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.FLARE,
            },
        ],
    },
    [ChainKey.METISSEP_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.METISSEP,
            },
        ],
    },
    [ChainKey.ZKLINK_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKLINK,
            },
        ],
    },
    [ChainKey.GLUE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GLUE,
            },
        ],
    },
    [ChainKey.GLUE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.GLUE,
            },
        ],
    },
    [ChainKey.OPENCAMPUS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OPENCAMPUS,
            },
        ],
    },
    [ChainKey.VANAR_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.VANAR,
            },
        ],
    },
    [ChainKey.PEAQ]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.PEAQ,
            },
        ],
    },
    [ChainKey.PEAQ_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PEAQ,
            },
        ],
    },
    [ChainKey.PEAQ_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.PEAQ,
            },
        ],
    },
    [ChainKey.FI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.FI,
            },
        ],
    },
    [ChainKey.CURTIS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CURTIS,
            },
        ],
    },
    [ChainKey.APE_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.APE,
            },
        ],
    },
    [ChainKey.ARC]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ARC,
            },
        ],
    },
    [ChainKey.ARC_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ARC,
            },
        ],
    },
    [ChainKey.PLUME_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.PLUME,
            },
        ],
    },
    [ChainKey.PLUME_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PLUME,
            },
        ],
    },
    [ChainKey.ZKSYNCSEP_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKSYNCSEP,
            },
        ],
    },
    [ChainKey.LYRA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.LYRA,
            },
        ],
    },
    [ChainKey.LYRA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LYRA,
            },
        ],
    },
    [ChainKey.LIGHTLINK_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.LIGHTLINK,
            },
        ],
    },
    [ChainKey.LIGHTLINK_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LIGHTLINK,
            },
        ],
    },
    [ChainKey.BAHAMUT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BAHAMUT,
            },
        ],
    },
    [ChainKey.CODEX]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CODEX,
            },
        ],
    },
    [ChainKey.CODEX_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CODEX,
            },
        ],
    },
    [ChainKey.ROOT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ROOT,
            },
        ],
    },
    [ChainKey.RISE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.RISE,
            },
        ],
    },
    [ChainKey.ABSTRACT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ABSTRACT,
            },
        ],
    },
    [ChainKey.ABSTRACT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ABSTRACT,
            },
        ],
    },
    [ChainKey.ABSTRACT_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.ABSTRACT,
            },
        ],
    },
    [ChainKey.ATLANTICOCEAN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ATLANTICOCEAN,
            },
        ],
    },
    [ChainKey.TREASURE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TREASURE,
            },
        ],
    },
    [ChainKey.OTHERWORLD_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OTHERWORLD,
            },
        ],
    },
    [ChainKey.REYA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.REYA,
            },
        ],
    },
    [ChainKey.REDBELLY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.REDBELLY,
            },
        ],
    },
    [ChainKey.REDBELLY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.REDBELLY,
            },
        ],
    },
    [ChainKey.PGN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.PGN,
            },
        ],
    },
    [ChainKey.PGN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PGN,
            },
        ],
    },
    [ChainKey.BITLAYER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BITLAYER,
            },
        ],
    },
    [ChainKey.BITLAYER_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BITLAYER,
            },
        ],
    },
    [ChainKey.DM2VERSE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.DM2VERSE,
            },
        ],
    },
    [ChainKey.DM2VERSE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.DM2VERSE,
            },
        ],
    },
    [ChainKey.STORY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.STORY,
            },
        ],
    },
    [ChainKey.STORY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.STORY,
            },
        ],
    },
    [ChainKey.OZEAN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OZEAN,
            },
        ],
    },
    [ChainKey.BEVM_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BEVM,
            },
        ],
    },
    [ChainKey.BEVM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BEVM,
            },
        ],
    },
    [ChainKey.INITIA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.INITIA,
            },
        ],
    },
    [ChainKey.INITIA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.INITIA,
            },
        ],
    },
    [ChainKey.LISK]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.LISK,
            },
        ],
    },
    [ChainKey.LISK_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LISK,
            },
        ],
    },
    [ChainKey.KEVNET_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.KEVNET,
            },
        ],
    },
    [ChainKey.BL2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BL2,
            },
        ],
    },
    [ChainKey.PLUME2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PLUME2,
            },
        ],
    },
    [ChainKey.BLE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BLE,
            },
        ],
    },
    [ChainKey.UNICHAIN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.UNICHAIN,
            },
        ],
    },
    [ChainKey.UNICHAIN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.UNICHAIN,
            },
        ],
    },
    [ChainKey.UNICHAIN_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.UNICHAIN,
            },
        ],
    },
    [ChainKey.HYPERLIQUID]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HYPERLIQUID,
            },
        ],
    },
    [ChainKey.HYPERLIQUID_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HYPERLIQUID,
            },
        ],
    },
    [ChainKey.HYPERLIQUID_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.HYPERLIQUID,
            },
        ],
    },
    [ChainKey.MINATO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MINATO,
            },
        ],
    },
    [ChainKey.WORLDCOIN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.WORLDCOIN,
            },
        ],
    },
    [ChainKey.WORLDCHAIN_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.WORLDCHAIN,
            },
        ],
    },
    [ChainKey.WORLDCHAIN_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.WORLDCHAIN,
            },
        ],
    },
    [ChainKey.SUPERPOSITION]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SUPERPOSITION,
            },
        ],
    },
    [ChainKey.SUPERPOSITION_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SUPERPOSITION,
            },
        ],
    },
    [ChainKey.HEMI]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HEMI,
            },
        ],
    },
    [ChainKey.HEMI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HEMI,
            },
        ],
    },
    [ChainKey.HEMI_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.HEMI,
            },
        ],
    },
    [ChainKey.MOKSHA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MOKSHA,
            },
        ],
    },
    [ChainKey.SOPHON]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SOPHON,
            },
        ],
    },
    [ChainKey.SOPHON_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SOPHON,
            },
        ],
    },
    [ChainKey.SOPHONOS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SOPHONOS,
            },
        ],
    },
    [ChainKey.GAMESWIFT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.GAMESWIFT,
            },
        ],
    },
    [ChainKey.ODYSSEY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ODYSSEY,
            },
        ],
    },
    [ChainKey.CITREA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CITREA,
            },
        ],
    },
    [ChainKey.CITREA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CITREA,
            },
        ],
    },
    [ChainKey.CHILIZ]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CHILIZ,
            },
        ],
    },
    [ChainKey.CHILIZSPICY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CHILIZSPICY,
            },
        ],
    },
    [ChainKey.EDU]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.EDU,
            },
        ],
    },
    [ChainKey.ISLANDER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ISLANDER,
            },
        ],
    },
    [ChainKey.ISLANDER_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ISLANDER,
            },
        ],
    },
    [ChainKey.MP1]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MP1,
            },
        ],
    },
    [ChainKey.MP1_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MP1,
            },
        ],
    },
    [ChainKey.BL3_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BL3,
            },
        ],
    },
    [ChainKey.BL3_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BL3,
            },
        ],
    },
    [ChainKey.FLOW]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.FLOW,
            },
        ],
    },
    [ChainKey.FLOW_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.FLOW,
            },
        ],
    },
    [ChainKey.ROOTSTOCK]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ROOTSTOCK,
            },
        ],
    },
    [ChainKey.ROOTSTOCK_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ROOTSTOCK,
            },
        ],
    },
    [ChainKey.SWELL]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SWELL,
            },
        ],
    },
    [ChainKey.SWELL_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SWELL,
            },
        ],
    },
    [ChainKey.SONIC]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SONIC,
            },
        ],
    },
    [ChainKey.SONIC_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SONIC,
            },
        ],
    },
    [ChainKey.SONIC_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.SONIC,
            },
        ],
    },
    [ChainKey.NIBIRU]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.NIBIRU,
            },
        ],
    },
    [ChainKey.NIBIRU_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.NIBIRU,
            },
        ],
    },
    [ChainKey.GOAT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GOAT,
            },
        ],
    },
    [ChainKey.GOAT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.GOAT,
            },
        ],
    },
    [ChainKey.APEXFUSIONNEXUS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.APEXFUSIONNEXUS,
            },
        ],
    },
    [ChainKey.INK]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.INK,
            },
        ],
    },
    [ChainKey.INK_SEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.INK,
            },
        ],
    },
    [ChainKey.INK_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.INK,
            },
        ],
    },
    [ChainKey.MEMECOREFORMICARIUM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MEMECOREFORMICARIUM,
            },
        ],
    },
    [ChainKey.BL6_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BL6,
            },
        ],
    },
    [ChainKey.SPACE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SPACE,
            },
        ],
    },
    [ChainKey.SONEIUM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SONEIUM,
            },
        ],
    },
    [ChainKey.SONEIUM_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.SONEIUM,
            },
        ],
    },
    [ChainKey.CRONOSEVM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CRONOSEVM,
            },
        ],
    },
    [ChainKey.CRONOSEVM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CRONOSEVM,
            },
        ],
    },
    [ChainKey.CRONOSZKEVM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CRONOSZKEVM,
            },
        ],
    },
    [ChainKey.CRONOSZKEVM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CRONOSZKEVM,
            },
        ],
    },
    [ChainKey.STABLEDEVNET_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.STABLEDEVNET,
            },
        ],
    },
    [ChainKey.MONAD_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MONAD,
            },
        ],
    },
    [ChainKey.MONAD_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.MONAD,
            },
        ],
    },
    [ChainKey.MONAD2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MONAD2,
            },
        ],
    },
    [ChainKey.XDC]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.XDC,
            },
        ],
    },
    [ChainKey.XDC_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.XDC,
            },
        ],
    },
    [ChainKey.CONCRETE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CONCRETE,
            },
        ],
    },
    [ChainKey.PLUMEPHOENIX]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.PLUMEPHOENIX,
            },
        ],
    },
    [ChainKey.PLUMEPHOENIX_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PLUMEPHOENIX,
            },
        ],
    },
    [ChainKey.PLUMEPHOENIX_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.PLUMEPHOENIX,
            },
        ],
    },
    [ChainKey.MEGAETH]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MEGAETH,
            },
        ],
    },
    [ChainKey.MEGAETH_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MEGAETH,
            },
        ],
    },
    [ChainKey.BEPOLIA]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BEPOLIA,
            },
        ],
    },
    [ChainKey.BEPOLIA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BEPOLIA,
            },
        ],
    },
    [ChainKey.GUNZ]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GUNZ,
            },
        ],
    },
    [ChainKey.ANIMECHAIN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ANIMECHAIN,
            },
        ],
    },
    [ChainKey.ANIMECHAIN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ANIMECHAIN,
            },
        ],
    },
    [ChainKey.LENS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.LENS,
            },
        ],
    },
    [ChainKey.LENS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LENS,
            },
        ],
    },
    [ChainKey.STABLE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.STABLE,
            },
        ],
    },
    [ChainKey.STABLE_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.STABLE,
            },
        ],
    },
    [ChainKey.ONDO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ONDO,
            },
        ],
    },
    [ChainKey.SUBTENSOREVM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SUBTENSOREVM,
            },
        ],
    },
    [ChainKey.SUBTENSOREVM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SUBTENSOREVM,
            },
        ],
    },
    [ChainKey.KATANA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.KATANA,
            },
        ],
    },
    [ChainKey.TAC]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TAC,
            },
        ],
    },
    [ChainKey.TACSPB_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.TACSPB,
            },
        ],
    },
    [ChainKey.INJECTIVE1439_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.INJECTIVE1439,
            },
        ],
    },
    [ChainKey.PLASMA3]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.PLASMA3,
            },
        ],
    },
    [ChainKey.PLASMA3_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PLASMA3,
            },
        ],
    },
    [ChainKey.PLASMA_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.PLASMA,
            },
        ],
    },
    [ChainKey.PLASMA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PLASMA,
            },
        ],
    },
    [ChainKey.PLASMA_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.PLASMA,
            },
        ],
    },
    [ChainKey.SUI]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.SUI,
            },
        ],
    },
    [ChainKey.SUI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SUI,
            },
        ],
    },
    [ChainKey.SUI_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.SUI,
            },
        ],
    },
    [ChainKey.IOTAL1]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.IOTAL1,
            },
        ],
    },
    [ChainKey.IOTAL1_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.IOTAL1,
            },
        ],
    },
    [ChainKey.ZKLINK]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZKLINK,
            },
        ],
    },
    [ChainKey.REYA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.REYA,
            },
        ],
    },
    [ChainKey.BAHAMUT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BAHAMUT,
            },
        ],
    },
    [ChainKey.MOVEMENT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MOVEMENT,
            },
        ],
    },
    [ChainKey.MOVEMENT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MOVEMENT,
            },
        ],
    },
    [ChainKey.MOVEMENT_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.MOVEMENT,
            },
        ],
    },
    [ChainKey.BOTANIX]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.BOTANIX,
            },
        ],
    },
    [ChainKey.KATANA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.KATANA,
            },
        ],
    },
    [ChainKey.HUMANITY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HUMANITY,
            },
        ],
    },
    [ChainKey.HUMANITY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HUMANITY,
            },
        ],
    },
    [ChainKey.APEXFUSIONNEXUS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.APEXFUSIONNEXUS,
            },
        ],
    },
    [ChainKey.DINARI]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.DINARI,
            },
        ],
    },
    [ChainKey.DINARI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.DINARI,
            },
        ],
    },
    [ChainKey.OG]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.OG,
            },
        ],
    },
    [ChainKey.OG_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OG,
            },
        ],
    },
    [ChainKey.ETHEREAL]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ETHEREAL,
            },
        ],
    },
    [ChainKey.ETHEREAL2]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ETHEREAL2,
            },
        ],
    },
    [ChainKey.ETHEREAL2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ETHEREAL2,
            },
        ],
    },
    [ChainKey.ZKVERIFY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZKVERIFY,
            },
        ],
    },
    [ChainKey.ZKVERIFY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZKVERIFY,
            },
        ],
    },
    [ChainKey.GATELAYER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GATELAYER,
            },
        ],
    },
    [ChainKey.GATELAYER_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.GATELAYER,
            },
        ],
    },
    [ChainKey.MONAD]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MONAD,
            },
        ],
    },
    [ChainKey.OPENLEDGER]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.OPENLEDGER,
            },
        ],
    },
    [ChainKey.OPENLEDGER_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OPENLEDGER,
            },
        ],
    },
    [ChainKey.DOMA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.DOMA,
            },
        ],
    },
    [ChainKey.DOMA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.DOMA,
            },
        ],
    },
    [ChainKey.DOMA_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.DOMA,
            },
        ],
    },
    [ChainKey.INJECTIVEEVM]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.INJECTIVEEVM,
            },
        ],
    },
    [ChainKey.INJECTIVEEVM_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.INJECTIVEEVM,
            },
        ],
    },
    [ChainKey.STABLE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.STABLE,
            },
        ],
    },
    [ChainKey.NEXERA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.NEXERA,
            },
        ],
    },
    [ChainKey.NEXERA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.NEXERA,
            },
        ],
    },
    [ChainKey.PLASMA2]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.PLASMA2,
            },
        ],
    },
    [ChainKey.PLASMA2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PLASMA2,
            },
        ],
    },
    [ChainKey.KITE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.KITE,
            },
        ],
    },
    [ChainKey.KITE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.KITE,
            },
        ],
    },
    [ChainKey.LZJK]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.LZJK,
            },
        ],
    },
    [ChainKey.LZJK_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.LZJK,
            },
        ],
    },
    [ChainKey.XLAYER2]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.XLAYER2,
            },
        ],
    },
    [ChainKey.XLAYER2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.XLAYER2,
            },
        ],
    },
    [ChainKey.MEGAETH2]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MEGAETH2,
            },
        ],
    },
    [ChainKey.MEGAETH2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MEGAETH2,
            },
        ],
    },
    [ChainKey.OGGALILEO]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.OGGALILEO,
            },
        ],
    },
    [ChainKey.OGGALILEO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OGGALILEO,
            },
        ],
    },
    [ChainKey.GATE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GATE,
            },
        ],
    },
    [ChainKey.GATE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.GATE,
            },
        ],
    },
    [ChainKey.ZAMA]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ZAMA,
            },
        ],
    },
    [ChainKey.ZAMA_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ZAMA,
            },
        ],
    },
    [ChainKey.CANTON_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.CANTON,
            },
        ],
    },
    [ChainKey.CANTON_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.CANTON,
            },
        ],
    },
    [ChainKey.CANTON]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.CANTON,
            },
        ],
    },
    [ChainKey.STELLAR_SANDBOX]: {
        aliases: [
            {
                environment: Environment.SANDBOX,
                name: ChainName.STELLAR,
            },
        ],
    },
    [ChainKey.STELLAR_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.STELLAR,
            },
        ],
    },
    [ChainKey.STELLAR]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.STELLAR,
            },
        ],
    },
    [ChainKey.RISE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.RISE,
            },
        ],
    },
    [ChainKey.TEMPO]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.TEMPO,
            },
        ],
    },
    [ChainKey.PHAROS_MAINNET]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.PHAROS,
            },
        ],
    },
    [ChainKey.IRYS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.IRYS,
            },
        ],
    },
    [ChainKey.IRYS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.IRYS,
            },
        ],
    },
    [ChainKey.BOKUTO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.BOKUTO,
            },
        ],
    },
    [ChainKey.MODERATO_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MODERATO,
            },
        ],
    },
    [ChainKey.RAYLSDEVNET_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.RAYLSDEVNET,
            },
        ],
    },
    [ChainKey.JOVAY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.JOVAY,
            },
        ],
    },
    [ChainKey.PLUME4_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.PLUME4,
            },
        ],
    },
    [ChainKey.ROBINHOOD]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ROBINHOOD,
            },
        ],
    },
    [ChainKey.ROBINHOOD_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ROBINHOOD,
            },
        ],
    },
    [ChainKey.HOODI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HOODI,
            },
        ],
    },
    [ChainKey.AULT]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.AULT,
            },
        ],
    },
    [ChainKey.AULT_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.AULT,
            },
        ],
    },
    [ChainKey.GENSYN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.GENSYN,
            },
        ],
    },
    [ChainKey.GENSYN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.GENSYN,
            },
        ],
    },
    [ChainKey.SEI2_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SEI2,
            },
        ],
    },
    [ChainKey.SEISMIC_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.SEISMIC,
            },
        ],
    },
    [ChainKey.NEOX]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.NEOX,
            },
        ],
    },
    [ChainKey.NEOX_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.NEOX,
            },
        ],
    },
    [ChainKey.RAYLS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.RAYLS,
            },
        ],
    },
    [ChainKey.RAYLS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.RAYLS,
            },
        ],
    },
    [ChainKey.ADI]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ADI,
            },
        ],
    },
    [ChainKey.ADI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ADI,
            },
        ],
    },
    [ChainKey.ADIRI]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ADIRI,
            },
        ],
    },
    [ChainKey.ADIRI_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ADIRI,
            },
        ],
    },
    [ChainKey.MONINET_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MONINET,
            },
        ],
    },
    [ChainKey.ONEMONEY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ONEMONEY,
            },
        ],
    },
    [ChainKey.RITUAL_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.RITUAL,
            },
        ],
    },
    [ChainKey.ANUBIS]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.ANUBIS,
            },
        ],
    },
    [ChainKey.ANUBIS_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.ANUBIS,
            },
        ],
    },
    [ChainKey.HASHKEY]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.HASHKEY,
            },
        ],
    },
    [ChainKey.HASHKEY_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.HASHKEY,
            },
        ],
    },
    [ChainKey.MEMECORE]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.MEMECORE,
            },
        ],
    },
    [ChainKey.MEMECORE_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.MEMECORE,
            },
        ],
    },
    [ChainKey.OPN]: {
        aliases: [
            {
                environment: Environment.MAINNET,
                name: ChainName.OPN,
            },
        ],
    },
    [ChainKey.OPN_TESTNET]: {
        aliases: [
            {
                environment: Environment.TESTNET,
                name: ChainName.OPN,
            },
        ],
    },
} as const satisfies Record<ChainKey, { aliases: { name: ChainName; environment: Environment }[] }>;

export const resolveChainKey = (chainName: ChainName, environment: Environment): ChainKey => {
    const chainKey = Object.entries(CHAIN_KEY_ALIAS_CONFIG).find(([_, { aliases }]) =>
        aliases.some((alias) => alias.name === chainName && alias.environment === environment),
    )?.[0];
    if (!chainKey) {
        throw new Error(
            `No alias matches { chainName: ${chainName}, environment: ${environment} }`,
        );
    }
    return chainKey as ChainKey;
};

export const getChainNamesByEnvironment = (environment: Environment): ChainName[] => {
    return Object.entries(CHAIN_KEY_ALIAS_CONFIG)
        .filter(([_, { aliases }]) => aliases.some((alias) => alias.environment === environment))
        .map(([_, { aliases }]) => aliases.map((alias) => alias.name))
        .flat();
};
