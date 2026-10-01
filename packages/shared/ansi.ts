// Terminal escape sequences (colors, cursor moves, OSC hyperlinks) as emitted by CLI tools.
// Pattern follows the widely used `ansi-regex`: CSI/SGR plus OSC terminated by BEL or ST.
const ANSI_PATTERN = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))',
  ].join('|'),
  'g',
)

/** Remove terminal escape sequences so tool output reads as plain text in UI previews. */
export function stripAnsi(text: string): string {
  return text.includes('\u001b') || text.includes('\u009b') ? text.replace(ANSI_PATTERN, '') : text
}
