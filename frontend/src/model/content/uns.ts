export type UnsNetwork = 'base' | 'polygon' | 'solana' | 'sonic'

const BASE_TLDS = [
  'amped', 'anyone', 'ask', 'ath', 'bald', 'basenji', 'bay', 'bch', 'benji', 'bitscrunch', 'boomer', 'bunni',
  'caw', 'chip', 'chomp', 'depin', 'digibyte', 'enigma', 'ethermail', 'goblin', 'gotchi', 'her', 'horizen',
  'learn', 'lunar', 'mooncat', 'mumu', 'mycircle', 'npc', 'ohm', 'onchain', 'pendle', 'podcast', 'pokt',
  'privacy', 'propykeys', 'quantum', 'rad', 'smobler', 'south', 'spend', 'u', 'udtest', 'verge', 'xec', 'xyo',
  'zano'
]

const POLYGON_TLDS = [
  '888', 'agent', 'ai4', 'altimist', 'anime', 'arculus', 'austin', 'awaken', 'binanceus', 'bitcoin', 'bitget',
  'blockchain', 'brave', 'calicoin', 'carbon', 'cashme', 'cgai', 'chipper', 'clay', 'coin', 'collect', 'crypto',
  'dao', 'dejay', 'derad', 'dfz', 'digitalfuture', 'doga', 'donut', 'dream', 'dsci', 'emir', 'farms', 'go',
  'graphics', 'gripe', 'grow', 'guide', 'hi', 'hub', 'imtoken', 'kingdom', 'klever', 'kresus', 'kryptic', 'lfg',
  'ltc', 'manga', 'marketer', 'metropolis', 'miku', 'ministry', 'mobix', 'moon', 'nft', 'nibi', 'og', 'openx',
  'pack', 'pastor', 'pbdx', 'pilot', 'pog', 'polygon', 'presearch', 'pudgy', 'pundi', 'raiin', 'realm',
  'secret', 'shiksha', 'stepn', 'super', 'supernova', 'tball', 'tea', 'travel', 'tribe', 'twin', 'ubu',
  'unstoppable', 'vanity', 'wallet', 'web3', 'wifi', 'witg', 'wrkx', 'x', 'xmr', 'xz1', 'yellow', 'zil'
]

const SOLANA_TLDS = [
  'aura', 'bobi', 'demos', 'hegecoin', 'housecoin', 'mery', 'pengu', 'retardio', 'swamp', 'tigershark', 'troll',
  'undeads', 'wif'
]

const SONIC_TLDS = [
  'sonic'
]

const TLDS: Record<string, UnsNetwork> = Object.fromEntries([
  ...BASE_TLDS.map((tld) => [tld, 'base'] as const),
  ...POLYGON_TLDS.map((tld) => [tld, 'polygon'] as const),
  ...SOLANA_TLDS.map((tld) => [tld, 'solana'] as const),
  ...SONIC_TLDS.map((tld) => [tld, 'sonic'] as const),
])

export function unsNetwork(host: string): UnsNetwork | null {
  const value = host.toLowerCase()
  const index = value.lastIndexOf('.')
  return index < 0 ? null : TLDS[value.slice(index + 1)] ?? null
}

export function isUnsHost(host: string): boolean {
  return unsNetwork(host) !== null
}
