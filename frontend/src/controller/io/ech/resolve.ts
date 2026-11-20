import { keccak_256 } from '@noble/hashes/sha3'
import { unsNetwork } from '../../../model/content/uns'

const KEY = 'dns.A'
const SIGNATURE = 'get(string,uint256)'

type EvmNetwork = 'base' | 'polygon'

const NETWORKS: Record<EvmNetwork, { rpcs: string[]; registry: string }> = {
  base: {
    rpcs: [
      'https://mainnet.base.org',
      'https://base-rpc.publicnode.com',
      'https://base.drpc.org',
      'https://1rpc.io/base',
      'https://base.gateway.tenderly.co',
      'https://gateway.tenderly.co/public/base',
      'https://base-pokt.nodies.app',
      'https://base-mainnet.public.blastapi.io',
    ],
    registry: '0xF6c1b83977DE3dEffC476f5048A0a84d3375d498',
  },
  polygon: {
    rpcs: [
      'https://polygon-bor-rpc.publicnode.com',
      'https://polygon.drpc.org',
      'https://1rpc.io/matic',
      'https://polygon.gateway.tenderly.co',
      'https://gateway.tenderly.co/public/polygon',
    ],
    registry: '0xa9a6A3626993D487d2Dbda3173cf58cA1a9D9e9f',
  },
}

const encoder = new TextEncoder()
const cache = new Map<string, string>()

const hexOf = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
const word = (value: number) => value.toString(16).padStart(64, '0')

function namehash(name: string): string {
  let node: Uint8Array<ArrayBufferLike> = new Uint8Array(32)
  for (const label of name.split('.').reverse()) {
    const input = new Uint8Array(64)
    input.set(node, 0)
    input.set(keccak_256(encoder.encode(label)), 32)
    node = keccak_256(input)
  }
  return hexOf(node)
}

function calldata(name: string): string {
  const bytes = encoder.encode(KEY)
  const selector = hexOf(keccak_256(encoder.encode(SIGNATURE)).slice(0, 4))
  const key = hexOf(bytes).padEnd(Math.ceil(bytes.length / 32) * 64, '0')
  return `0x${selector}${word(0x40)}${namehash(name)}${word(bytes.length)}${key}`
}

function decode(encoded: string): string[] {
  const raw = encoded.startsWith('0x') ? encoded.slice(2) : encoded
  if (!raw) return []
  const words = raw.match(/.{64}/g) ?? []
  const offset = Number.parseInt(words[0] ?? '', 16)
  const length = Number.parseInt(words[offset / 32] ?? '', 16)
  const data = words.slice(offset / 32 + 1).join('').slice(0, length * 2)
  const bytes = (data.match(/.{2}/g) ?? []).map((byte) => Number.parseInt(byte, 16))
  const values: string[] = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)))
  return values.filter((value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value))
}

async function call(rpc: string, registry: string, data: string): Promise<{ result?: string; error?: unknown }> {
  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: registry, data }, 'latest'] }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function resolve(host: string, network: EvmNetwork): Promise<string> {
  const config = NETWORKS[network]
  const data = calldata(host)
  for (const rpc of config.rpcs) {
    let payload: { result?: string; error?: unknown }
    try {
      payload = await call(rpc, config.registry, data)
    } catch {
      continue
    }
    if (payload.error) continue
    const ip = decode(payload.result ?? '0x')[0]
    if (!ip) throw new Error(`resolve ${host}: no address`)
    return ip
  }
  throw new Error(`resolve ${host}: no rpc responded`)
}

export async function relayEndpoint(relayUrl: string): Promise<string> {
  const parsed = new URL(relayUrl)
  const network = unsNetwork(parsed.host)
  if (!network) return relayUrl
  if (network === 'solana' || network === 'sonic') throw new Error(`resolve ${parsed.host}: ${network} is not supported`)
  let ip = cache.get(parsed.host)
  if (!ip) {
    ip = await resolve(parsed.host, network)
    cache.set(parsed.host, ip)
  }
  parsed.hostname = ip
  return parsed.toString()
}
