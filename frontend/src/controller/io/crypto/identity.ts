import { fromHex, toHex } from '@mysten/bcs'
import { ristretto255 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2b'

import {
  ChallengePayload,
  UserContext,
  type Call,
  type Esid,
  type Statement,
  type UserPart,
} from '../ech/protocol/transactions'

const Order = ristretto255.Point.Fn.ORDER
const Base = ristretto255.Point.BASE
const encoder = new TextEncoder()

const mod = (value: bigint) => ((value % Order) + Order) % Order

function littleEndian(bytes: Uint8Array): bigint {
  let result = 0n
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    result = (result << 8n) | BigInt(bytes[index])
  }
  return result
}

export function scalarBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32)
  let rest = mod(value)
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return bytes
}

export function randomScalar(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(64))
  return mod(littleEndian(bytes))
}

export function randomTweak(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32))
}

function derive(secret: Uint8Array, domain: string, info: Uint8Array): bigint {
  const data = new Uint8Array([...encoder.encode(domain), ...info])
  return mod(littleEndian(blake2b(data, { dkLen: 64, key: secret })))
}

function challenge(domain: string, payload: Uint8Array): bigint {
  const data = new Uint8Array([...encoder.encode(domain), ...payload])
  return mod(littleEndian(blake2b(data, { dkLen: 64 })))
}

function point(bytes: Uint8Array) {
  return ristretto255.Point.fromBytes(bytes)
}

function encode(p: { toBytes(): Uint8Array }): Uint8Array {
  return p.toBytes()
}

export class Identity {
  readonly master: Uint8Array

  constructor(master: Uint8Array) {
    this.master = master
  }

  static fromHex(value: string): Identity {
    const bytes = fromHex(value.replace(/^0x/, ''))
    if (bytes.length !== 32) throw new Error('invalid master key')
    return new Identity(bytes)
  }

  hex(): string {
    return toHex(this.master)
  }

  secret(root: Uint8Array, tweak: Uint8Array): { scalar: bigint; point: Uint8Array } {
    const scalar = this.encryption(root, tweak)
    return { scalar, point: encode(Base.multiply(scalar)) }
  }

  owns(root: Uint8Array, esid: Esid): boolean {
    const { x, r } = this.scalars(root, esid.tweak)
    if (toHex(encode(Base.multiply(r))) !== toHex(esid.c1)) return false
    return toHex(encode(Base.multiply(x).add(point(root).multiply(r)))) === toHex(esid.c2)
  }

  encryption(root: Uint8Array, tweak: Uint8Array): bigint {
    return this.scalars(root, tweak).r
  }

  private scalars(root: Uint8Array, tweak: Uint8Array): { x: bigint; r: bigint } {
    const x = derive(this.master, 'identity', root)
    const r = derive(this.master, 'encryption', new Uint8Array([...root, ...tweak]))
    return { x, r }
  }

  esid(root: Uint8Array, tweak: Uint8Array): Esid {
    const { x, r } = this.scalars(root, tweak)
    const anchor = point(root)
    const c1 = Base.multiply(r)
    const c2 = Base.multiply(x).add(anchor.multiply(r))
    return { tweak, c1: encode(c1), c2: encode(c2) }
  }

  statement(root: Uint8Array, esid: Esid): Statement {
    const base = encode(Base)
    return {
      equations: [
        { terms: [{ base, response: 1 }], target: esid.c1 },
        {
          terms: [
            { base, response: 0 },
            { base: root, response: 1 },
          ],
          target: esid.c2,
        },
      ],
    }
  }

  sign(root: Uint8Array, ctx: Uint8Array, call: Call, tweak: Uint8Array = randomTweak()): UserPart {
    const { x, r } = this.scalars(root, tweak)
    const esid = this.esid(root, tweak)
    const statement = this.statement(root, esid)
    const context = UserContext.serialize([root, ctx, call]).toBytes()
    const alpha = randomScalar()
    const beta = randomScalar()
    const anchor = point(root)
    const first = Base.multiply(beta)
    const second = Base.multiply(alpha).add(anchor.multiply(beta))
    const commitment = [encode(first), encode(second)]
    const payload = ChallengePayload.serialize([statement, context, commitment]).toBytes()
    const value = challenge('user', payload)
    return {
      ctx,
      call,
      author: {
        $kind: 'User' as const,
        User: {
          esid,
          proof: {
            commitment,
            response: [
              scalarBytes(alpha + value * x),
              scalarBytes(beta + value * r),
            ],
          },
        },
      },
    }
  }
}
