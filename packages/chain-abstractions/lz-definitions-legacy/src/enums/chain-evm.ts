/**
 * Enum representing different EVM-compatible chains.
 */
export enum EvmChain {
    ETHEREUM = 'ethereum',
    BSC = 'bsc',
    AVALANCHE = 'avalanche',
    POLYGON = 'polygon',
    ZKPOLYGON = 'zkpolygon',
    ARBITRUM = 'arbitrum',
    OPTIMISM = 'optimism',
    FANTOM = 'fantom',
    SWIMMER = 'swimmer',
    DFK = 'dfk',
    HARMONY = 'harmony',
    ARCANA = 'arcana',
    DEXALOT = 'dexalot',
    CASTLECRUSH = 'castlecrush',
    GNOSIS = 'gnosis',
    CELO = 'celo',
    MOONBEAM = 'moonbeam',
    BOBA = 'boba',
    PORTAL = 'portal',
    INTAIN = 'intain',
    FUSE = 'fuse',
    ASTAR = 'astar',
    ZKSYNC = 'zksync',
    SHRAPNEL = 'shrapnel',
    DOS = 'dos',
    KLAYTN = 'klaytn',
    METIS = 'metis',
    COREDAO = 'coredao',
    OKX = 'okx',
    METER = 'meter',
    GOERLI = 'goerli',
    BASE = 'base',
    ZKCONSENSYS = 'zkconsensys',
    SEPOLIA = 'sepolia',
    MOONRIVER = 'moonriver',
    AAVEGOTCHI = 'aavegotchi',
    SCROLL = 'scroll',
    CATHAY = 'cathay',
    KAVA = 'kava',
    TENET = 'tenet',
    CANTO = 'canto',
    ORDERLY = 'orderly',
    NOVA = 'nova',
    BLOCKGEN = 'blockgen',
    MERITCIRCLE = 'meritcircle',
    MANTLE = 'mantle',
    HUBBLE = 'hubble',
    ZORA = 'zora',
    TOMO = 'tomo',
    LOOT = 'loot',
    TELOS = 'telos',
    AURORA = 'aurora',
    OPBNB = 'opbnb',
    SHIMMER = 'shimmer',
    MONAD = 'monad',
    LIF3 = 'lif3',
    SPRUCE = 'spruce',
    PGJJTK = 'pgjjtk',
    ODA = 'oda',
    KIWI = 'kiwi',
    CONFLUX = 'conflux',
    EON = 'eon',
    XPLA = 'xpla',
    HOLESKY = 'holesky',
    INJECTIVE = 'injective',
    IDEX = 'idex',
    ZKATANA = 'zkatana',
    MANTA = 'manta',
    FRAME = 'frame',
    PGN = 'pgn',
    POLYGONCDK = 'polygoncdk',
    ARBSEP = 'arbsep',
    OPTSEP = 'optsep',
    BERA = 'bera',
    VENN = 'venn',
    RARIBLE = 'rarible',
    GUNZILLA = 'gunzilla',

    RC1 = 'rc1',
    ETHERLINK = 'etherlink',
    KIWI2 = 'kiwi2',
    BB1 = 'bb1',
    JOC = 'joc',
    BLAST = 'blast',
    TRON = 'tron',

    TRONDEV = 'trondev',
    XAI = 'xai',
    TANGIBLE = 'tangible',
    BASESEP = 'basesep',
    MANTLESEP = 'mantlesep',
    ZKPOLYGONSEP = 'zkpolygonsep',
    ZKSYNCSEP = 'zksyncsep',
    ZORASEP = 'zorasep',
    EXOCORE = 'exocore',
    REAL = 'real',
    TILTYARD = 'tiltyard',
    SKALE = 'skale',
    FRAXTAL = 'fraxtal',
    SEI = 'sei',
    MODE = 'mode',
    HEDERA = 'hedera',
    UNREAL = 'unreal',
    MASA = 'masa',
    MERLIN = 'merlin',
    HOMEVERSE = 'homeverse',
    ZKASTAR = 'zkastar',
    AMOY = 'amoy',
    DEGEN = 'degen',
    XLAYER = 'xlayer',
    FORM = 'form',
    LL1 = 'll1',
    MANTASEP = 'mantasep',
    TAIKO = 'taiko',
    ZIRCUIT = 'zircuit',
    CAMP = 'camp',
    OLIVE = 'olive',
    SANKO = 'sanko',
    BOB = 'bob',
    CYBER = 'cyber',

    BOTANIX = 'botanix',
    XCHAIN = 'xchain',
    ZKLINK = 'zklink',
    EBI = 'ebi',

    KINTO = 'kinto',
    LINEASEP = 'lineasep',

    IOTA = 'iota',

    BESU1 = 'besu1',
    BOUNCEBIT = 'bouncebit',
    MORPH = 'morph',

    GRAVITY = 'gravity',

    BARTIO = 'bartio',

    METISSEP = 'metissep',
    FLARE = 'flare',
    GLUE = 'glue',

    OPENCAMPUS = 'opencampus',
    VANAR = 'vanar',
    PEAQ = 'peaq',
    FI = 'fi',

    CURTIS = 'curtis',

    LYRA = 'lyra',
    LIGHTLINK = 'lightlink',

    BAHAMUT = 'bahamut',
    CODEX = 'codex',

    OTHERWORLD = 'otherworld',

    ABSTRACT = 'abstract',
    ROOT = 'root',
    STORY = 'story',

    TREASURE = 'treasure',

    REYA = 'reya',

    BITLAYER = 'bitlayer',
    DM2VERSE = 'dm2verse',

    APE = 'ape',

    OZEAN = 'ozean',

    BEVM = 'bevm',

    LISK = 'lisk',
    PLUME2 = 'plume2',
    KEVNET = 'kevnet',

    BLE = 'ble',
    BL2 = 'bl2',

    HYPERLIQUID = 'hyperliquid',
    HYPERLIQUIDBURNED = 'hyperliquidburned',

    UNICHAIN = 'unichain',

    MINATO = 'minato',
    WORLDCOIN = 'worldcoin',

    WORLDCHAIN = 'worldchain',

    SUPERPOSITION = 'superposition',

    HEMI = 'hemi',

    GAMESWIFT = 'gameswift',
    ODYSSEY = 'odyssey',
    SOPHON = 'sophon',

    MOKSHA = 'moksha',

    EDU = 'edu',
    CITREA = 'citrea',
    ISLANDER = 'islander',

    BL3 = 'bl3',
    MP1 = 'mp1',

    SONIC = 'sonic',
    ROOTSTOCK = 'rootstock',
    FLOW = 'flow',
    NIBIRU = 'nibiru',
    NIBIRUBURNED = 'nibiruburned',
    SWELL = 'swell',

    MEMECOREFORMICARIUM = 'memecoreformicarium',
    APEXFUSIONNEXUS = 'apexfusionnexus',
    GOAT = 'goat',

    BL4 = 'bl4',
    BL5 = 'bl5',

    BL6 = 'bl6',
    INK = 'ink',
    SONEIUM = 'soneium',
    SPACE = 'space',

    CRONOSEVM = 'cronosevm',
    CRONOSZKEVM = 'cronoszkevm',

    STABLEDEVNET = 'stabledevnet',

    XDC = 'xdc',

    CONCRETE = 'concrete',
    PLUME = 'plume',
    PLUMEPHOENIX = 'plumephoenix',

    MEGAETH = 'megaeth',

    BEPOLIA = 'bepolia',
    GUNZ = 'gunz',

    ANIMECHAIN = 'animechain',

    LENS = 'lens',

    STABLE = 'stable',
    ONDO = 'ondo',

    SOMNIA = 'somnia',
    CONVERGE = 'converge',

    SUBTENSOREVM = 'subtensorevm',

    KATANA = 'katana',
    TACSPB = 'tacspb',
    TAC = 'tac',

    SOMNIASHANNON = 'somniashannon',
    SILICONSEPOLIA = 'siliconsepolia',
    ETHEREAL = 'ethereal',

    SILICON = 'silicon',

    INJECTIVE1439 = 'injective1439',

    PLASMA = 'plasma',
    PLASMA2 = 'plasma2',
    HUMANITY = 'humanity',

    DINARI = 'dinari',
    OEPNLEDGER = 'oepnledger', // typo'd leaving this constant though
    OPENLEDGER = 'openledger',

    ZKVERIFY = 'zkverify',
    KITE = 'kite',
    XLAYER2 = 'xlayer2',
    PLASMA3 = 'plasma3',
    LZJK = 'lzjk',

    OG = 'og',
    GATE = 'gate',
    ETHEREAL2 = 'ethereal2',
    ETHEREALBURNED = 'etherealburned',
    GATELAYER = 'gatelayer',

    DOMA = 'doma',
    ZAMA = 'zama',

    INJECTIVEEVM = 'injectiveevm',
    NEXERA = 'nexera',

    MEGAETH2 = 'megaeth2',

    OGGALILEO = 'oggalileo',
    REDBELLY = 'redbelly',
    ETHERLINKSHADOWNET = 'etherlinkshadownet',

    TEMPO = 'tempo',
    SAGAEVM = 'sagaevm',

    MOCA = 'moca',
    ARC = 'arc',

    HORIZEN = 'horizen',
    ATLANTICOCEAN = 'atlanticocean',
    SOPHONOS = 'sophonos',
    RISE = 'rise',

    TEMPODEV1 = 'tempodev1',

    CHILIZSPICY = 'chilizspicy',
    VIA = 'via',
    MONAD2 = 'monad2',
    TEMPOFINAL = 'tempofinal',

    PHAROS = 'pharos',

    MODERATO = 'moderato',
    JOVAY = 'jovay',

    RAYLSDEVNET = 'raylsdevnet',

    IRYS = 'irys',
    CHILIZ = 'chiliz',

    BOKUTO = 'bokuto',

    HOODI = 'hoodi',
    PLUME4 = 'plume4',
    ROBINHOOD = 'robinhood',

    AULT = 'ault',

    EDGE = 'edge',
    GENSYN = 'gensyn',

    SEI2 = 'sei2',
    SEISMIC = 'seismic',

    NEOX = 'neox',
    RAYLS = 'rayls',

    MONINET = 'moninet',

    RITUAL = 'ritual',
    ONEMONEY = 'onemoney',

    ADI = 'adi',
    ADIRI = 'adiri',
    OPN = 'opn',

    ANUBIS = 'anubis',
    MEMECORE = 'memecore',
    HASHKEY = 'hashkey',

    ALPEN = 'alpen',

    ZEROINTEROP = 'zerointerop',
}
