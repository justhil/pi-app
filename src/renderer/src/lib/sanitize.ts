import DOMPurify from 'dompurify'

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'span', 'div', 'p', 'pre', 'code', 'math', 'semantics', 'annotation',
    'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'msqrt', 'mroot',
    'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'mstyle', 'merror',
    'svg', 'path', 'g', 'rect', 'line', 'circle', 'ellipse', 'polygon',
    'polyline', 'text', 'tspan', 'defs', 'use', 'clippath', 'mask',
    'a', 'br', 'em', 'strong', 'sub', 'sup', 'mark', 'del', 'ins',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col',
    'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption',
  ],
  ALLOWED_ATTR: [
    'class', 'style', 'id', 'href', 'title', 'role',
    'viewBox', 'd', 'fill', 'stroke', 'stroke-width',
    'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height',
    'points', 'transform', 'encoding', 'mathvariant',
    'stretchy', 'fence', 'separator', 'accent', 'accentunder',
    'columnalign', 'rowalign', 'columnspacing', 'rowspacing',
    'columnlines', 'rowlines', 'frame', 'framespacing', 'equalrows',
    'equalcolumns', 'displaystyle', 'scriptlevel', 'lspace', 'rspace',
    'movablelimits', 'maxsize', 'minsize', 'symmetric', 'align',
    'notation', 'src', 'alt', 'colspan', 'rowspan', 'dir', 'lang',
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
}

export function sanitizeHtml(html: string): string {
  return String(DOMPurify.sanitize(html, SANITIZE_CONFIG))
}
