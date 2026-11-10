/**
 * Enum representing different chain keys.
 */
// APPEND ONLY LIST
// verify twice that the value is correct
export enum ChainKey {
    ETHEREUM = 'ethereum',
    GOERLI = 'goerli',
    SEPOLIA = 'sepolia',
    BSC = 'bsc',
    BSC_TESTNET = 'bsc-testnet',
    AVALANCHE = 'avalanche',
    FUJI = 'fuji',
    POLYGON = 'polygon',
    MUMBAI = 'mumbai',
    ARBITRUM = 'arbitrum',
    ARBITURM_GOERLI = 'arbitrum-goerli',
    OPTIMISM = 'optimism',
    OPTIMISM_GOERLI = 'optimism-goerli',
    FANTOM = 'fantom',
    FANTOM_TESTNET = 'fantom-testnet',
    SWIMMER = 'swimmer',
    SWIMMER_TESTNET = 'swimmer-testnet',
    DFK = 'dfk',
    DFK_TESTNET = 'dfk-testnet',
    HARMONY = 'harmony',
    HARMONY_TESTNET = 'harmony-testnet',
    DEXALOT = 'dexalot',
    DEVALOT_TESTNET = 'dexalot-testnet',
    CELO = 'celo',
    ALFAJORES = 'alfajores',
    MOONBEAM = 'moonbeam',
    MOONBASE = 'moonbase',
    MOONRIVER = 'moonriver',
    INTAIN = 'intain',
    INTAIN_TESTNET = 'intain-testnet',
    FUSE = 'fuse',
    FUSESPARK = 'fusespark',
    GNOSIS = 'gnosis',
    CHIADO = 'chiado',
    APTOS = 'aptos',
    APTOS_TESTNET = 'aptos-testnet',
    INITIA = 'initia',
    INITIA_TESTNET = 'initia-testnet',
    MOVEMENT = 'movement',
    MOVEMENT_TESTNET = 'movement-testnet',
    KLAYTN = 'klaytn',
    KLAYTN_BAOBAB = 'klaytn-baobab',
    METIS = 'metis',
    METIS_GOERLI = 'metis-goerli',
    COREDAO = 'coredao',
    COREDAO_TESTNET = 'coredao-testnet',
    METER = 'meter',
    METER_TESTNET = 'meter-testnet',
    OKX = 'okx',
    OKX_TESTNET = 'okx-testnet',
    ZKSYNC = 'zksync',
    ZKSYNC_TESTNET = 'zksync-testnet',
    SHRAPNEL = 'shrapnel',
    SHRAPNEL_TESTNET = 'shrapnel-testnet',
    DOS = 'dos',
    DOS_TESTNET = 'dos-testnet',
    ZKEVM = 'zkevm',
    ZKEVM_TESTNET = 'zkevm-testnet',
    NOVA = 'nova',
    TENET = 'tenet',
    TENET_TESTNET = 'tenet-testnet',
    CANTO = 'canto',
    CANTO_TESTNET = 'canto-testnet',
    KAVA = 'kava',
    KAVA_TESTNET = 'kava-testnet',
    SOLANA = 'solana',
    SOLANA_TESTNET = 'solana-testnet',
    LINEA_GOERLI = 'linea-goerli',
    BASE_GOERLI = 'base-goerli',
    AAVEGOTCHI_TESTNET = 'aavegotchi-testnet',

    SCROLL = 'scroll',
    SCROLL_TESTNET = 'scroll-testnet',

    CATHAY_TESTNET = 'cathay-testnet',

    ORDERLY = 'orderly',
    ORDERLY_TESTNET = 'orderly-testnet',

    BLOCKGEN_TESTNET = 'blockgen-testnet',
    BEAM_TESTNET = 'beam-testnet',
    BEAM = 'beam',
    MANTLE = 'mantle',
    MANTLE_TESTNET = 'mantle-testnet',
    HUBBLE = 'hubble',
    HUBBLE_TESTNET = 'hubble-testnet',
    LINEA = 'linea',
    BASE = 'base',
    ZORA_TESTNET = 'zora-testnet',
    ZORA = 'zora',
    TOMO_TESTNET = 'tomo-testnet',
    TOMO = 'tomo',
    LOOT_TESTNET = 'loot-testnet',
    LOOT = 'loot',
    TELOS_TESTNET = 'telos-testnet',
    TELOS = 'telos',

    AURORA = 'aurora',
    AURORA_TESTNET = 'aurora-testnet',

    OPBNB = 'opbnb',
    OPBNB_TESTNET = 'opbnb-testnet',

    SHIMMER = 'shimmer',
    SHIMMER_TESTNET = 'shimmer-testnet',

    MONAD_TESTNET = 'monad-testnet',

    LIF3 = 'lif3',
    LIF3_TESTNET = 'lif3-testnet',

    SPRUCE_TESTNET = 'spruce-testnet',
    PGJJTK_TESTNET = 'pgjjtk-testnet',
    ODA_TESTNET = 'oda-testnet',

    KIWI_TESTNET = 'kiwi-testnet',
    ASTAR = 'astar',
    ASTAR_TESTNET = 'astar-testnet',

    CONFLUX = 'conflux',
    CONFLUX_TESTNET = 'conflux-testnet',

    EON = 'eon',
    EON_TESTNET = 'eon-testnet',

    XPLA = 'xpla',
    XPLA_TESTNET = 'xpla-testnet',

    HOLESKY = 'holesky',

    INJECTIVE_TESTNET = 'injective-testnet',

    IDEX_TESTNET = 'idex-testnet',

    ZKATANA_TESTNET = 'zkatana-testnet',
    ZKATANA = 'zkatana',

    MANTA = 'manta',
    MANTA_TESTNET = 'manta-testnet',

    FRAME_TESTNET = 'frame-testnet',

    PGN = 'pgn',
    PGN_TESTNET = 'pgn-testnet',

    POLYGONCDK_TESTNET = 'polygoncdk-testnet',

    ARBITRUM_SEPOLIA = 'arbitrum-sepolia',
    OPTIMISM_SEPOLIA = 'optimism-sepolia',

    BERA_TESTNET = 'bera-testnet',
    VENN_TESTNET = 'venn-testnet',

    RARIBLE_TESTNET = 'rarible-testnet',

    GUNZILLA_TESTNET = 'gunzilla-testnet',

    RC1_TESTNET = 'rc1-testnet',

    KIWI2_TESTNET = 'kiwi2-testnet',

    BB1 = 'bb1',
    RARIBLE = 'rarible',

    BLAST_TESTNET = 'blast-testnet',
    BLAST = 'blast',

    XAI_TESTNET = 'xai-testnet',
    XAI = 'xai',
    TANGIBLE_TESTNET = 'tangible-testnet',

    BASE_SEPOLIA = 'base-sepolia',
    MANTLE_SEPOLIA = 'mantle-sepolia',
    ZKPOLYGON_SEPOLIA = 'zkpolygon-sepolia',
    ZKSYNC_SEPOLIA = 'zksync-sepolia',
    ZORA_SEPOLIA = 'zora-sepolia',

    EXOCORE_TESTNET = 'exocore-testnet',

    TILTYARD = 'tiltyard',

    FRAXTAL_TESTNET = 'fraxtal-testnet',
    FRAXTAL = 'fraxtal',

    MODE_TESTNET = 'mode-testnet',
    MODE = 'mode',

    REAL = 'real',
    UNREAL_TESTNET = 'unreal-testnet',

    MASA = 'masa',
    MASA_TESTNET = 'masa-testnet',

    MERLIN_TESTNET = 'merlin-testnet',
    MERLIN = 'merlin',

    HOMEVERSE = 'homeverse',
    HOMEVERSE_TESTNET = 'homeverse-testnet',

    ZKASTAR_TESTNET = 'zkastar-testnet',

    AMOY_TESTNET = 'amoy-testnet',

    DEGEN_TESTNET = 'degen-testnet',
    DEGEN = 'degen',

    XLAYER_TESTNET = 'xlayer-testnet',
    XLAYER = 'xlayer',

    FORM_TESTNET = 'form-testnet',
    LL1_TESTNET = 'll1-testnet',
    MANTASEP_TESTNET = 'mantasep-testnet',

    SKALE_TESTNET = 'skale-testnet',
    SKALE = 'skale',

    CAMP_TESTNET = 'camp-testnet',
    OLIVE_TESTNET = 'olive-testnet',
    SANKO_TESTNET = 'sanko-testnet',
    SANKO = 'sanko',

    BOB_TESTNET = 'bob-testnet',
    BOB = 'bob',

    // sandbox
    ETHEREUM_SANDBOX = 'ethereum-sandbox',
    BSC_SANDBOX = 'bsc-sandbox',
    AVALANCHE_SANDBOX = 'avalanche-sandbox',
    POLYGON_SANDBOX = 'polygon-sandbox',
    APTOS_SANDBOX = 'aptos-sandbox',
    INITIA_SANDBOX = 'initia-sandbox',
    MOVEMENT_SANDBOX = 'movement-sandbox',
    OPTIMISM_SANDBOX = 'optimism-sandbox',
    TRON_SANDBOX = 'tron-sandbox',
    ARBITRUM_SANDBOX = 'arbitrum-sandbox',
    FANTOM_SANDBOX = 'fantom-sandbox',
    METIS_SANDBOX = 'metis-sandbox',
    SOLANA_SANDBOX = 'solana-sandbox',
    TON_SANDBOX = 'ton-sandbox',
    ZKSYNC_SANDBOX = 'zksync-sandbox',
    SUI_SANDBOX = 'sui-sandbox',
    IOTAL1_SANDBOX = 'iotal1-sandbox',

    BOTANIX_TESTNET = 'botanix-testnet',

    EBI_TESTNET = 'ebi-testnet',

    TRONDEV = 'tron-dev',
    TRON_TESTNET = 'tron-testnet',
    TRON = 'tron',

    SEI = 'sei',
    SEI_TESTNET = 'sei-testnet',

    EBI = 'ebi',

    LINEASEP_TESTNET = 'lineasep-testnet',

    IOTA = 'iota',
    IOTA_TESTNET = 'iota-testnet',

    CYBER = 'cyber',
    CYBER_TESTNET = 'cyber-testnet',

    JOC = 'joc',
    JOC_TESTNET = 'joc-testnet',

    BESU1_TESTNET = 'besu1-testnet',

    MORPH_TESTNET = 'morph-testnet',

    XCHAIN_TESTNET = 'xchain-testnet',
    XCHAIN = 'xchain',

    TAIKO_TESTNET = 'taiko-testnet',
    TAIKO = 'taiko',

    KINTO = 'kinto',

    ETHERLINK_TESTNET = 'etherlink-testnet',
    ETHERLINK = 'etherlink',

    BOUNCEBIT_TESTNET = 'bouncebit-testnet',
    BOUNCEBIT = 'bouncebit',

    GRAVITY = 'gravity',

    BARTIO_TESTNET = 'bartio', // bera testnet

    METISSEP_TESTNET = 'metissep-testnet',
    FLARE_TESTNET = 'flare-testnet',
    FLARE = 'flare',

    GLUE_TESTNET = 'glue-testnet',

    OPENCAMPUS_TESTNET = 'opencampus-testnet',
    VANAR_TESTNET = 'vanguard-testnet',

    PEAQ_TESTNET = 'peaq-testnet',
    PEAQ = 'peaq',

    ZIRCUIT_TESTNET = 'zircuit-testnet',
    ZIRCUIT = 'zircuit',

    ZKLINK_TESTNET = 'zklink-testnet',
    ZKLINK = 'zklink',

    FI_TESTNET = 'fi-testnet',

    PLUME_TESTNET = 'plume-testnet',
    CURTIS_TESTNET = 'curtis-testnet',

    LYRA = 'lyra',
    LYRA_TESTNET = 'lyra-testnet',

    BAHAMUT_TESTNET = 'bahamut-testnet',

    CODEX = 'codex',
    CODEX_TESTNET = 'codex-testnet',

    OTHERWORLD_TESTNET = 'otherworld-testnet',

    ROOT_TESTNET = 'root-testnet',
    STORY_TESTNET = 'story-testnet',

    LIGHTLINK = 'lightlink',
    LIGHTLINK_TESTNET = 'lightlink-testnet',

    TREASURE_TESTNET = 'treasure-testnet',

    REYA_TESTNET = 'reya-testnet',

    APE = 'ape',

    REYA = 'reya',

    OZEAN_TESTNET = 'ozean-testnet',

    BITLAYER = 'bitlayer',
    BITLAYER_TESTNET = 'bitlayer-testnet',
    DM2VERSE = 'dm2verse',
    DM2VERSE_TESTNET = 'dm2verse-testnet',

    BEVM = 'bevm',
    BEVM_TESTNET = 'bevm-testnet',

    HEDERA_TESTNET = 'hedera-testnet',
    HEDERA = 'hedera',

    LISK_TESTNET = 'lisk-testnet',
    PLUME2_TESTNET = 'plume2-testnet',
    KEVNET_TESTNET = 'kevnet-testnet',

    BLE_TESTNET = 'ble-testnet',
    BL2_TESTNET = 'bl2-testnet',

    PLUME = 'plume',

    HYPERLIQUIDBURNED_TESTNET = 'hyperliquidburned-testnet',
    HYPERLIQUID_TESTNET = 'hyperliquid-testnet',
    UNICHAIN_TESTNET = 'unichain-testnet',

    MINATO_TESTNET = 'minato-testnet',
    WORLDCOIN_TESTNET = 'worldcoin-testnet',

    WORLDCHAIN = 'worldchain',
    UNICHAIN = 'unichain',
    LISK = 'lisk',
    MORPH = 'morph',

    ABSTRACT_TESTNET = 'abstract-testnet',
    ABSTRACT = 'abstract',

    GAMESWIFT_TESTNET = 'gameswift-testnet',
    ODYSSEY_TESTNET = 'odyssey-testnet',
    SOPHON_TESTNET = 'sophon-testnet',

    SUPERPOSITION_TESTNET = 'superposition-testnet',
    SUPERPOSITION = 'superposition',

    MOKSHA_TESTNET = 'moksha-testnet',

    EDU = 'edu',

    TON = 'ton',
    TON_TESTNET = 'ton-testnet',

    HEMI_TESTNET = 'hemi-testnet',
    HEMI = 'hemi',

    CITREA_TESTNET = 'citrea-testnet',

    ISLANDER = 'islander',

    BL3_TESTNET = 'bl3-testnet',
    MP1_TESTNET = 'mp1-testnet',
    MP1 = 'mp1',

    SONIC_TESTNET = 'sonic-testnet',
    ROOTSTOCK_TESTNET = 'rootstock-testnet',
    FLOW_TESTNET = 'flow-testnet',
    NIBIRU_TESTNET = 'nibiru-testnet',
    NIBIRUBURNED_TESTNET = 'nibiruburned-testnet',
    SWELL_TESTNET = 'swell-testnet',

    SONIC = 'sonic',
    SWELL = 'swell',
    SOPHON = 'sophon',
    ROOTSTOCK = 'rootstock',

    MEMECOREFORMICARIUM_TESTNET = 'memecoreformicarium-testnet',

    GOAT_TESTNET = 'goat-testnet',

    FLOW = 'flow',

    BL4 = 'bl4',
    BL5 = 'bl5',

    BL6_TESTNET = 'bl6-testnet',
    INK_TESTNET = 'ink-testnet',

    INK = 'ink',
    SONEIUM = 'soneium',
    SPACE = 'space',
    GLUE = 'glue',

    CRONOSEVM_TESTNET = 'cronosevm-testnet',
    CRONOSZKEVM_TESTNET = 'cronoszkevm-testnet',

    CRONOSEVM = 'cronosevm',
    CRONOSZKEVM = 'cronoszkevm',
    GOAT = 'goat',

    STABLEDEVNET_TESTNET = 'stabledevnet-testnet',

    BERA = 'bera',

    BAHAMUT = 'bahamut',

    STORY = 'story',
    XDC = 'xdc',
    CONCRETE = 'concrete',

    HYPERLIQUID = 'hyperliquid',
    NIBIRU = 'nibiru',
    NIBIRUBURNED = 'nibiruburned',

    PLUMEPHOENIX = 'plumephoenix',

    MEGAETH_TESTNET = 'megaeth-testnet',

    BEPOLIA_TESTNET = 'bepolia-testnet',

    GUNZ = 'gunz',

    ANIMECHAIN_TESTNET = 'animechain-testnet',
    ANIMECHAIN = 'animechain',

    LENS_TESTNET = 'lens-testnet',
    LENS = 'lens',

    STABLE_TESTNET = 'stable-testnet',
    ONDO_TESTNET = 'ondo-testnet',

    SOMNIA_TESTNET = 'somnia-testnet',
    CONVERGEBURNED_TESTNET = 'convergeburned-testnet',
    CONVERGEBURNED2_TESTNET = 'convergeburned2-testnet',
    CONVERGE_TESTNET = 'converge-testnet',

    SUBTENSOREVM_TESTNET = 'subtensorevm-testnet',
    SUBTENSOREVM = 'subtensorevm',
    MERITCIRCLE = 'meritcircle',
    KATANA_TESTNET = 'katana-testnet',
    KATANA = 'katana',
    BOTANIX = 'botanix',

    SUI_TESTNET = 'sui-testnet',
    SUI = 'sui',

    IOTAL1_TESTNET = 'iotal1-testnet',
    IOTAL1 = 'iotal1',

    TACSPB_TESTNET = 'tacspb-testnet',
    TAC = 'tac',

    SOMNIASHANNON_TESTNET = 'somniashannon-testnet',
    SILICONSEPOLIA_TESTNET = 'siliconsepolia-testnet',
    ETHEREAL_TESTNET = 'ethereal-testnet',

    SOMNIA = 'somnia',
    SILICON = 'silicon',

    INJECTIVE1439_TESTNET = 'injective1439-testnet',

    CAMP = 'camp',
    CONVERGE = 'converge',

    PLASMA_TESTNET = 'plasma-testnet',
    PLASMA2_TESTNET = 'plasma2-testnet',

    HUMANITY_TESTNET = 'humanity-testnet',
    HUMANITY = 'humanity',

    DINARI = 'dinari',
    DINARI_TESTNET = 'dinari-testnet',

    OPENLEDGER_TESTNET = 'openledger-testnet',
    OPENLEDGER = 'openledger',

    APEXFUSIONNEXUS_TESTNET = 'apexfusionnexus-testnet',
    APEXFUSIONNEXUS = 'apexfusionnexus',
    PLASMA = 'plasma',

    ZKVERIFY = 'zkverify',
    ZKVERIFY_TESTNET = 'zkverify-testnet',
    KITE_TESTNET = 'kite-testnet',
    XLAYER2_TESTNET = 'xlayer2-testnet',
    PLASMA3_TESTNET = 'plasma3-testnet',
    LZJK_TESTNET = 'lzjk-testnet',

    OG = 'og',
    OG_TESTNET = 'og-testnet',
    GATE_TESTNET = 'gate-testnet',
    ETHEREAL = 'ethereal',
    ETHEREAL2_TESTNET = 'ethereal2-testnet',

    GATELAYER = 'gatelayer',

    MONAD = 'monad',
    DOMA_TESTNET = 'doma-testnet',

    ZAMA = 'zama',
    ZAMA_TESTNET = 'zama-testnet',

    DOMA = 'doma',
    INJECTIVEEVM = 'injectiveevm',

    NEXERA = 'nexera',
    NEXERA_TESTNET = 'nexera-testnet',

    STABLE = 'stable',

    MEGAETH2_TESTNET = 'megaeth2-testnet',
    STARKNET = 'starknet',
    STARKNET_TESTNET = 'starknet-testnet',
    STARKNET_SANDBOX = 'starknet-sandbox',

    OGGALILEO_TESTNET = 'oggalileo-testnet',
    REDBELLY_TESTNET = 'redbelly-testnet',
    ETHERLINKSHADOWNET_TESTNET = 'etherlinkshadownet-testnet',

    TEMPO_TESTNET = 'tempo-testnet',
    SAGAEVM_TESTNET = 'sagaevm-testnet',

    MOCA_TESTNET = 'moca-testnet',
    ARC_TESTNET = 'arc-testnet',

    MEGAETH = 'megaeth',

    HORIZEN_TESTNET = 'horizen-testnet',

    ATLANTICOCEAN_TESTNET = 'atlanticocean-testnet',
    SOPHONOS_TESTNET = 'sophonos-testnet',
    RISE_TESTNET = 'rise-testnet',

    HORIZEN = 'horizen',
    RISE = 'rise',
    REDBELLY = 'redbelly',
    CITREA = 'citrea',
    MOCA = 'moca',
    SAGAEVM = 'sagaevm',
    KITE = 'kite',

    TEMPODEV1_TESTNET = 'tempodev1-testnet',

    CHILIZSPICY_TESTNET = 'chilizspicy-testnet',
    VIA_TESTNET = 'via-testnet',
    MONAD2_TESTNET = 'monad2-testnet',
    TEMPOFINAL_TESTNET = 'tempofinal-testnet',

    PHAROS = 'pharos',

    MODERATO_TESTNET = 'moderato-testnet',

    JOVAY_TESTNET = 'jovay-testnet',

    RAYLSDEVNET_TESTNET = 'raylsdevnet-testnet',

    IRYS_TESTNET = 'irys-testnet',

    IRYS = 'irys',
    CHILIZ = 'chiliz',
    TEMPO = 'tempo',

    BOKUTO_TESTNET = 'bokuto-testnet',

    HOODI_TESTNET = 'hoodi-testnet',
    PLUME4_TESTNET = 'plume4-testnet',
    ROBINHOOD_TESTNET = 'robinhood-testnet',

    AULT = 'ault',
    AULT_TESTNET = 'ault-testnet',

    EDGE_TESTNET = 'edge-testnet',
    GENSYN_TESTNET = 'gensyn-testnet',

    EDGE = 'edge',
    GENSYN = 'gensyn',

    SEI2_TESTNET = 'sei2-testnet',
    SEISMIC_TESTNET = 'seismic-testnet',

    STELLAR = 'stellar',
    STELLAR_TESTNET = 'stellar-testnet',
    STELLAR_SANDBOX = 'stellar-sandbox',
    NEOX_TESTNET = 'neox-testnet',
    RAYLS_TESTNET = 'rayls-testnet',

    MONINET_TESTNET = 'moninet-testnet',
    NEOX = 'neox',

    RITUAL_TESTNET = 'ritual-testnet',
    ONEMONEY_TESTNET = 'onemoney-testnet',

    ADI_TESTNET = 'adi-testnet',
    ADIRI_TESTNET = 'adiri-testnet',

    RAYLS = 'rayls',
    ROBINHOOD = 'robinhood',
    ARC = 'arc',

    ADI = 'adi',

    OPN_TESTNET = 'opn-testnet',
    OPN = 'opn',

    CANTON_TESTNET = 'canton-testnet',
    CANTON_SANDBOX = 'canton-sandbox',
    CANTON = 'canton',
    ANUBIS_TESTNET = 'anubis-testnet',
    MEMECORE_TESTNET = 'memecore-testnet',
    HASHKEY_TESTNET = 'hashkey-testnet',

    ANUBIS = 'anubis',
    MEMECORE = 'memecore',
    HASHKEY = 'hashkey',
    ONEMONEY = 'onemoney',
    RITUAL = 'ritual',
    ZEROINTEROP = 'zerointerop',

    ALPEN_TESTNET = 'alpen-testnet',

    ZEROINTEROP_TESTNET = 'zerointerop-testnet',
}
