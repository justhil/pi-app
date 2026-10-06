import { z } from 'zod'

/** Decrypted wire envelope. Every WebSocket message after the handshake is one of these. */

export const PROTOCOL_VERSION = 1

export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'not_supported',
  'conflict',
  'busy',
  'internal',
  'timeout',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export const RpcErrorSchema = z
  .object({ code: z.enum(ERROR_CODES), message: z.string(), retryable: z.boolean() })
  .strict()
export type RpcError = z.infer<typeof RpcErrorSchema>

const v = z.literal(PROTOCOL_VERSION)

export const ReqFrameSchema = z.object({ v, k: z.literal('req'), id: z.string().min(1), m: z.string().min(1), p: z.unknown() }).strict()
export const ResOkFrameSchema = z.object({ v, k: z.literal('res'), id: z.string().min(1), ok: z.literal(true), p: z.unknown() }).strict()
export const ResErrFrameSchema = z.object({ v, k: z.literal('res'), id: z.string().min(1), ok: z.literal(false), err: RpcErrorSchema }).strict()
export const EvtFrameSchema = z.object({ v, k: z.literal('evt'), m: z.string().min(1), p: z.unknown() }).strict()
export const PingFrameSchema = z.object({ v, k: z.literal('ping'), id: z.string().min(1) }).strict()
export const PongFrameSchema = z.object({ v, k: z.literal('pong'), id: z.string().min(1) }).strict()

export const FrameSchema = z.union([ReqFrameSchema, ResOkFrameSchema, ResErrFrameSchema, EvtFrameSchema, PingFrameSchema, PongFrameSchema])
export type Frame = z.infer<typeof FrameSchema>
export type ReqFrame = z.infer<typeof ReqFrameSchema>
export type EvtFrame = z.infer<typeof EvtFrameSchema>

export function parseFrame(raw: unknown): Frame | null {
  const r = FrameSchema.safeParse(raw)
  return r.success ? r.data : null
}

export const makeReq = (id: string, m: string, p: unknown): Frame => ({ v: PROTOCOL_VERSION, k: 'req', id, m, p })
export const makeOk = (id: string, p: unknown): Frame => ({ v: PROTOCOL_VERSION, k: 'res', id, ok: true, p })
export const makeErr = (id: string, code: ErrorCode, message: string, retryable = false): Frame => ({
  v: PROTOCOL_VERSION,
  k: 'res',
  id,
  ok: false,
  err: { code, message, retryable },
})
export const makeEvt = (m: string, p: unknown): Frame => ({ v: PROTOCOL_VERSION, k: 'evt', m, p })
export const makePing = (id: string): Frame => ({ v: PROTOCOL_VERSION, k: 'ping', id })
export const makePong = (id: string): Frame => ({ v: PROTOCOL_VERSION, k: 'pong', id })

/** Handshake messages travel as plaintext JSON text frames before the secure channel exists. */
export const HandshakeErrorCodeSchema = z.enum(['unpaired', 'pair_expired', 'pair_used', 'revoked', 'bad'])
export type HandshakeErrorCode = z.infer<typeof HandshakeErrorCodeSchema>

export const Hs1Schema = z.object({ t: z.literal('hs1'), v, e: z.string(), ct: z.string() }).strict()
export const Hs2Schema = z.object({ t: z.literal('hs2'), e: z.string(), ct: z.string() }).strict()
export const HsErrSchema = z.object({ t: z.literal('hs_err'), code: HandshakeErrorCodeSchema }).strict()
export type Hs1 = z.infer<typeof Hs1Schema>
export type Hs2 = z.infer<typeof Hs2Schema>
export type HsErr = z.infer<typeof HsErrSchema>

/** Encrypted inside hs1: who the client is and (first time only) the pairing token. */
export const Hs1PayloadSchema = z
  .object({
    s: z.string(),
    pair: z.string().optional(),
    name: z.string().max(80),
    platform: z.string().max(40),
  })
  .strict()
export type Hs1Payload = z.infer<typeof Hs1PayloadSchema>

/** Encrypted inside hs2. */
export const Hs2PayloadSchema = z
  .object({ deviceId: z.string(), hostId: z.string(), hostName: z.string(), epoch: z.string(), role: z.enum(['viewer', 'operator']) })
  .strict()
export type Hs2Payload = z.infer<typeof Hs2PayloadSchema>
