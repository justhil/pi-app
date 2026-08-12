import { errorMessage } from '@shared/error-message'
import type { SdkKind, SdkSelection } from './sdk-loader'

export type ConfirmedSdkSelection = {
  kind: SdkKind
  version: string
  fallbackReason?: string
}

type SelectionTransactionInput = {
  target: SdkKind
  rollbackTarget: SdkSelection
  restartWorker: () => Promise<void>
  verifySelection: (target: SdkKind) => Promise<ConfirmedSdkSelection>
  rollbackSelection: (target: SdkSelection) => Promise<void>
}

function mismatchError(expected: SdkKind, actual: SdkKind): Error {
  return new Error(`预期 ${expected}，实际 ${actual}`)
}

async function verifyTarget(input: SelectionTransactionInput): Promise<ConfirmedSdkSelection> {
  await input.restartWorker()
  const active = await input.verifySelection(input.target)
  if (active.kind !== input.target) throw mismatchError(input.target, active.kind)
  return active
}

async function rollbackTarget(input: SelectionTransactionInput): Promise<void> {
  await input.rollbackSelection(input.rollbackTarget)
  await input.restartWorker()
  const active = await input.verifySelection(input.rollbackTarget.kind)
  if (active.kind !== input.rollbackTarget.kind) throw mismatchError(input.rollbackTarget.kind, active.kind)
}

export async function confirmSdkSelection(
  input: SelectionTransactionInput,
): Promise<ConfirmedSdkSelection> {
  try {
    return await verifyTarget(input)
  } catch (targetError) {
    try {
      await rollbackTarget(input)
    } catch (rollbackError) {
      throw new Error(
        `目标失败: ${errorMessage(targetError)}；回滚失败: ${errorMessage(rollbackError)}`,
      )
    }
    throw new Error(`目标失败: ${errorMessage(targetError)}；已回滚到 ${input.rollbackTarget.kind}`)
  }
}
