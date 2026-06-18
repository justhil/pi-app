// Simple syntax highlight for tool output - adds basic coloring

export function syntaxHighlight(output: string, toolName: string): string {
  if (!output) return ''
  let text = typeof output === 'string' ? output : JSON.stringify(output, null, 2)

  // Escape HTML
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // File paths
  text = text.replace(/([A-Z]:\\[^\s:]+|\/[^\s:]+)/g, '<span style="color:hsl(220,90%,56%)">$1</span>')

  // Numbers
  text = text.replace(/\b(\d+)\b/g, '<span style="color:hsl(280,65%,60%)">$1</span>')

  // Quoted strings
  text = text.replace(/"([^"]*)"/g, '<span style="color:hsl(142,71%,45%)">"$1"</span>')

  // Error indicators
  text = text.replace(/\b(error|Error|ERROR|failed|Failed|FAILED)\b/g, '<span style="color:hsl(0,72%,51%)">$1</span>')

  // Success indicators
  text = text.replace(/\b(success|ok|OK|done|Done|passed)\b/g, '<span style="color:hsl(142,71%,45%)">$1</span>')

  return text
}
