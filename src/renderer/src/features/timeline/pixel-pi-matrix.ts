/** 7 行 × 13 列：P | 空 | I；1 = 亮像素 */
export const PIXEL_PI_ROWS = [
  '11111..11111',
  '10001..00100',
  '10001..00100',
  '11111..00100',
  '10000..00100',
  '10000..00100',
  '10000..11111',
] as const

export const PIXEL_PI_COLS = PIXEL_PI_ROWS[0].length
export const PIXEL_PI_ROW_COUNT = PIXEL_PI_ROWS.length

export type PixelCell = { key: string; on: boolean; delayMs: number }

export function buildPixelPiCells(): PixelCell[] {
  const cells: PixelCell[] = []
  let idx = 0
  for (let r = 0; r < PIXEL_PI_ROW_COUNT; r++) {
    const row = PIXEL_PI_ROWS[r]
    for (let c = 0; c < PIXEL_PI_COLS; c++) {
      const on = row[c] === '1'
      cells.push({
        key: `${r}-${c}`,
        on,
        delayMs: on ? idx++ * 26 : 0,
      })
    }
  }
  return cells
}

export function pixelPiAssembleMs(cellCountOn: number): number {
  return cellCountOn * 26 + 380
}