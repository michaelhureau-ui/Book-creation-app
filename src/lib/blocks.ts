/**
 * The editor stores chapter bodies as TipTap HTML. Every exporter (PDF, DOCX,
 * EPUB, Markdown) needs the same content as structured blocks rather than
 * markup, so parsing happens once here and each writer renders from the result.
 */

export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'quote'; runs: Run[] }
  | { type: 'code'; text: string }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'rule' }

type Marks = Omit<Run, 'text'>

const MARK_BY_TAG: Record<string, keyof Marks> = {
  STRONG: 'bold', B: 'bold',
  EM: 'italic', I: 'italic',
  U: 'underline',
  S: 'strike', DEL: 'strike', STRIKE: 'strike',
  CODE: 'code',
}

/** Elements that never carry prose, and must not leak into an imported book. */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'LINK', 'META', 'HEAD'])

function collectRuns(node: Node, inherited: Marks, out: Run[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? ''
      if (!text) continue
      const last = out[out.length - 1]
      // Merge adjacent runs that carry identical formatting so exporters emit
      // one span instead of one per text node — but never merge across a hard
      // break, which consumers detect by its own "\n" run.
      if (last && last.text !== '\n' && sameMarks(last, inherited)) last.text += text
      else out.push({ text, ...inherited })
      continue
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    if (SKIP_TAGS.has(el.tagName)) continue
    if (el.tagName === 'BR') {
      out.push({ text: '\n', ...inherited })
      continue
    }
    const mark = MARK_BY_TAG[el.tagName]
    collectRuns(el, mark ? { ...inherited, [mark]: true } : inherited, out)
  }
}

function sameMarks(a: Run, b: Marks): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline
    && !!a.strike === !!b.strike && !!a.code === !!b.code
}

function runsOf(el: Element): Run[] {
  const out: Run[] = []
  collectRuns(el, {}, out)
  const runs = out.filter((r) => r.text.length > 0)
  // A paragraph holding only whitespace would print as a stray blank line.
  return runs.some((r) => r.text.trim().length > 0) ? runs : []
}

function listItems(el: Element): Run[][] {
  return Array.from(el.children)
    .filter((li) => li.tagName === 'LI')
    .map((li) => runsOf(li))
}

/** Parse a chapter's stored HTML into exporter-ready blocks. */
export function parseBlocks(html: string): Block[] {
  if (!html || !html.trim()) return []
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return []

  const blocks: Block[] = []
  for (const el of Array.from(root.children)) {
    switch (el.tagName) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const level = Math.min(3, Number(el.tagName[1])) as 1 | 2 | 3
        const runs = runsOf(el)
        if (runs.length) blocks.push({ type: 'heading', level, runs })
        break
      }
      case 'BLOCKQUOTE': {
        // TipTap nests paragraphs inside a blockquote; flatten them into one quote.
        const runs = runsOf(el)
        if (runs.length) blocks.push({ type: 'quote', runs })
        break
      }
      case 'PRE': {
        const text = el.textContent ?? ''
        if (text.trim()) blocks.push({ type: 'code', text: text.replace(/\n$/, '') })
        break
      }
      case 'UL': case 'OL': {
        const items = listItems(el).filter((i) => i.length > 0)
        if (items.length) blocks.push({ type: 'list', ordered: el.tagName === 'OL', items })
        break
      }
      case 'HR':
        blocks.push({ type: 'rule' })
        break
      default: {
        const runs = runsOf(el)
        if (runs.length) blocks.push({ type: 'paragraph', runs })
      }
    }
  }
  return blocks
}

/** Flatten runs to plain text — used for word counts and EPUB/Markdown fallbacks. */
export function runsText(runs: Run[]): string {
  return runs.map((r) => r.text).join('')
}

/** Plain-text rendering of a whole chapter body. */
export function blocksText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'rule': return '***'
        case 'code': return b.text
        case 'list': return b.items.map((i) => runsText(i)).join('\n')
        default: return runsText(b.runs)
      }
    })
    .join('\n\n')
}
