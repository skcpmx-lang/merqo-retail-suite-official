/**
 * Minimal Code128-B barcode → inline SVG.
 * Used for price labels; scanners treat it like any Code128 symbology.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
]
const START_B = 104
const STOP = 106

export function code128Svg(raw: string, opts?: { height?: number; moduleWidth?: number; showText?: boolean }): string {
  const text = (raw || '').replace(/[^\x20-\x7e]/g, '')
  const height = opts?.height ?? 42
  const mw = opts?.moduleWidth ?? 2
  const showText = opts?.showText ?? true

  const codes: number[] = [START_B]
  for (let i = 0; i < text.length; i++) codes.push(text.charCodeAt(i) - 32)
  let sum = START_B
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i
  codes.push(sum % 103, STOP)

  // build bar sequence
  let x = 0
  const rects: string[] = []
  for (const c of codes) {
    const pat = PATTERNS[c] ?? PATTERNS[0]
    for (let i = 0; i < pat.length; i++) {
      const w = Number(pat[i]) * mw
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`)
      x += w
    }
  }
  const totalW = x
  const textH = showText ? 14 : 0
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${height + textH}" viewBox="0 0 ${totalW} ${height + textH}">` +
    `<rect width="${totalW}" height="${height + textH}" fill="#fff"/>` +
    rects.join('') +
    (showText ? `<text x="${totalW / 2}" y="${height + 11}" text-anchor="middle" font-family="monospace" font-size="11" fill="#000">${text}</text>` : '') +
    `</svg>`
}
