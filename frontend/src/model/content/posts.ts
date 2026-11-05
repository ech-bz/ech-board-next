import { toHex } from './hex';
import type { PostPart as PostPartInput } from './postPart';

export interface RefContext {
  forumId: string
  boardId: string
}

export function replyLabel(reply: { forum: Uint8Array; board: Uint8Array; hint: string }, ctx?: RefContext): string {
  const segments = reply.hint.split('/')
  const num = segments[segments.length - 1]
  if (!ctx) return reply.hint
  const forum = toHex(reply.forum).replace(/^0x/, '')
  if (forum === ctx.forumId && toHex(reply.board) === ctx.boardId) return num
  const slug = segments.length >= 2 ? segments[segments.length - 2] : ''
  if (forum === ctx.forumId) return `/${slug}/${num}`
  const root = segments.length >= 3 ? segments[segments.length - 3] : ''
  return `${root}/${slug}/${num}`
}

export function partsToPlainText(parts: PostPartInput[], foldsExpanded: boolean, ctx?: RefContext): string {
  let out = ''
  for (const p of parts) out += partText(p, foldsExpanded, ctx)
  return out
}

export function postLineCount(parts: PostPartInput[], foldsExpanded: boolean): number {
  return partsToPlainText(parts, foldsExpanded).split('\n').length
}

function partText(p: PostPartInput, foldsExpanded: boolean, ctx?: RefContext): string {
  if ('Plain' in p) return p.Plain
  if ('Bold' in p) return partsToPlainText(p.Bold, foldsExpanded, ctx)
  if ('Italic' in p) return partsToPlainText(p.Italic, foldsExpanded, ctx)
  if ('Code' in p) return partsToPlainText(p.Code, foldsExpanded, ctx)
  if ('Underline' in p) return partsToPlainText(p.Underline, foldsExpanded, ctx)
  if ('Overline' in p) return partsToPlainText(p.Overline, foldsExpanded, ctx)
  if ('Spoiler' in p) return partsToPlainText(p.Spoiler, foldsExpanded, ctx)
  if ('Strike' in p) return partsToPlainText(p.Strike, foldsExpanded, ctx)
  if ('Sup' in p) return partsToPlainText(p.Sup, foldsExpanded, ctx)
  if ('Sub' in p) return partsToPlainText(p.Sub, foldsExpanded, ctx)
  if ('Link' in p) return partsToPlainText(p.Link.children, foldsExpanded, ctx)
  if ('Fold' in p) return foldsExpanded ? `${p.Fold.title}\n${partsToPlainText(p.Fold.children, foldsExpanded, ctx)}` : p.Fold.title
  if ('ReplyTo' in p) return `>>${replyLabel(p.ReplyTo, ctx)}`
  if ('Secret' in p) return '[secret]'
  return ''
}

export function partsToEditText(parts: PostPartInput[], ctx?: RefContext): { text: string; secrets: Map<number, PostPartInput> } {
  const secrets = new Map<number, PostPartInput>()
  let n = 0
  const render = (ps: PostPartInput[]): string => {
    let out = ''
    for (const p of ps) {
      if ('Plain' in p) out += p.Plain
      else if ('Bold' in p) out += `[b]${render(p.Bold)}[/b]`
      else if ('Italic' in p) out += `[i]${render(p.Italic)}[/i]`
      else if ('Code' in p) out += `[code]${render(p.Code)}[/code]`
      else if ('Underline' in p) out += `[u]${render(p.Underline)}[/u]`
      else if ('Overline' in p) out += `[o]${render(p.Overline)}[/o]`
      else if ('Spoiler' in p) out += `[spoiler]${render(p.Spoiler)}[/spoiler]`
      else if ('Strike' in p) out += `[s]${render(p.Strike)}[/s]`
      else if ('Sup' in p) out += `[sup]${render(p.Sup)}[/sup]`
      else if ('Sub' in p) out += `[sub]${render(p.Sub)}[/sub]`
      else if ('Link' in p) out += `[url=${p.Link.url}]${render(p.Link.children)}[/url]`
      else if ('Fold' in p) out += `[fold=${p.Fold.title}]${render(p.Fold.children)}[/fold]`
      else if ('ReplyTo' in p) out += `>>${replyLabel(p.ReplyTo, ctx)}`
      else if ('Secret' in p) {
        n += 1
        secrets.set(n, p)
        out += `[secret_${n}]`
      }
    }
    return out
  }
  return { text: render(parts), secrets }
}

