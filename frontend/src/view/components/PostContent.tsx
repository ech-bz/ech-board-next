import { cva } from 'class-variance-authority'
import { createMemo, type JSX } from 'solid-js'
import { toHex } from '../../model/content/hex'
import type { PostPart as PostPartInput } from '../../model/content/postPart'
import { replyLabel } from '../../model/content/posts'
import { useForumController, useForumQueries } from '../bindings/forum'

import { useNav } from '../nav'
import { useRoutes, type Route } from '../route'
import { scrollToPost } from '../effects/scroll'
import { Fold } from './Fold'
import { PostRefLink } from './preview/PostRefLink'
import { SecretSpan } from './SecretSpan'

const URL_RE = /https?:\/\/[^\s<>"')\]}]+/g
const URL_TRAIL = /[.,;:!?]+$/

function isExternal(url: string): boolean {
  try {
    return new URL(url, window.location.href).host !== window.location.host
  } catch {
    return true
  }
}

function renderTextWithLinks(text: string): JSX.Element[] {
  const out: JSX.Element[] = []
  let last = 0
  URL_RE.lastIndex = 0
  for (let m = URL_RE.exec(text); m !== null; m = URL_RE.exec(text)) {
    const url = m[0].replace(URL_TRAIL, '')
    const suffix = m[0].slice(url.length)
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      <a href={url} {...(isExternal(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {url}
      </a>,
    )
    if (suffix) out.push(suffix)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function extractCodeText(parts: PostPartInput[]): string {
  let s = ''
  for (const p of parts) {
    if ('Plain' in p) s += p.Plain
    else if ('Code' in p) s += extractCodeText(p.Code)
  }
  return s.replace(/^\n+/, '').replace(/\n+$/, '')
}

function trimPlain(part: PostPartInput, re: RegExp): PostPartInput {
  return 'Plain' in part ? { Plain: part.Plain.replace(re, '') } : part
}

function trimFoldEdges(parts: PostPartInput[]): PostPartInput[] {
  if (!parts.length) return parts
  const out = parts.slice()
  out[0] = trimPlain(out[0], /^\n+/)
  out[out.length - 1] = trimPlain(out[out.length - 1], /\n+$/)
  return out
}

function isReplyRefLine(line: string): boolean {
  if (!line.startsWith('>>')) return false
  let i = 2
  while (i < line.length && /[A-Za-z0-9/:._-]/.test(line[i])) i++
  let raw = line.slice(2, i)
  while (raw.length > 0 && !/[A-Za-z0-9]/.test(raw[raw.length - 1])) raw = raw.slice(0, -1)
  const parts = raw.split('/')
  if (parts.length > 1 && parts[0] === '') parts.shift()
  if (parts.length < 1 || parts.length > 3) return false
  return /^\d+$/.test(parts[parts.length - 1])
}

interface RenderOpts {
  resolvePost: ReturnType<typeof useForumController>['resolvePost']
  postId: ReturnType<typeof useForumQueries>['postId']
  threadPath: ReturnType<typeof useRoutes>['threadPath']
  resolveRelayUrl: (root: string) => string | null
  author: string | null
  hasPost: (id: string) => boolean
  relayUrl: string
  navigate: (route: Route) => void
  forumIdHex: string
  slug: string
  threadNum?: number
}

type RenderNested = (parts: PostPartInput[]) => JSX.Element

function renderPart(p: PostPartInput, opts: RenderOpts, renderNested: RenderNested): JSX.Element {
  if ('Plain' in p) {
    const lines = p.Plain.split('\n')
    return (
      <span>
        {lines.map((line, li) => (
          <>
            {line.startsWith('>') && !isReplyRefLine(line) ? <span class={'text-quote'}>{renderTextWithLinks(line)}</span> : renderTextWithLinks(line)}
            {li < lines.length - 1 ? '\n' : null}
          </>
        ))}
      </span>
    )
  }
  if ('Bold' in p) return <b>{renderParts(p.Bold, opts, renderNested)}</b>
  if ('Italic' in p) return <i>{renderParts(p.Italic, opts, renderNested)}</i>
  if ('Code' in p) return <pre class={'my-1.5 block overflow-x-auto whitespace-pre-wrap break-words rounded-sm bg-panel2 p-2.5 font-mono'}>{extractCodeText(p.Code)}</pre>
  if ('Underline' in p) return <u>{renderParts(p.Underline, opts, renderNested)}</u>
  if ('Overline' in p) return <span class={'overline'}>{renderParts(p.Overline, opts, renderNested)}</span>
  if ('Spoiler' in p) return <span class={'post-spoiler'}>{renderParts(p.Spoiler, opts, renderNested)}</span>
  if ('Strike' in p) return <s>{renderParts(p.Strike, opts, renderNested)}</s>
  if ('Sup' in p) return <sup>{renderParts(p.Sup, opts, renderNested)}</sup>
  if ('Sub' in p) return <sub>{renderParts(p.Sub, opts, renderNested)}</sub>
  if ('Fold' in p) {
    return <Fold title={p.Fold.title}>{renderParts(trimFoldEdges(p.Fold.children), opts, renderNested)}</Fold>
  }
  if ('ReplyTo' in p) {
    const num = p.ReplyTo.post
    const targetForumId = toHex(p.ReplyTo.forum).replace(/^0x/, '')
    const sameForum = targetForumId === opts.forumIdHex
    const sameBoard = p.ReplyTo.board === opts.slug
    const postId = opts.postId(p.ReplyTo.board, num, targetForumId)
    const label = `>>${replyLabel(p.ReplyTo, { forumId: opts.forumIdHex, board: opts.slug })}`
    const target = { board: p.ReplyTo.board, number: num, forumId: targetForumId, relayUrl: sameForum ? opts.relayUrl : opts.resolveRelayUrl(targetForumId) ?? undefined }
    if (sameForum && sameBoard && postId && opts.hasPost(postId)) {
      const localHref = opts.slug && opts.threadNum != null ? opts.threadPath(opts.forumIdHex, opts.slug, opts.threadNum, num) : `#post-${num}`
      return (
        <PostRefLink
          class={'cursor-pointer text-accent'}
          href={localHref}
          label={label}
          target={target}
          onClick={(e) => {
            e.preventDefault()
            if (opts.slug != null && opts.threadNum != null) opts.navigate({ page: 'thread', forumId: opts.forumIdHex, slug: opts.slug, threadNum: opts.threadNum, postNum: num })
            else scrollToPost(num)
          }}
        />
      )
    }
    return (
      <PostRefLink
        class={'cursor-pointer text-accent'}
        label={label}
        target={target}
        onClick={(e) => {
          e.preventDefault()
          void (async () => {
            try {
              const relay = sameForum ? opts.relayUrl : opts.resolveRelayUrl(targetForumId) ?? opts.relayUrl
              const data = await opts.resolvePost(relay, p.ReplyTo.board, num)
              const slug = data.board.slug
              const threadNum = data.thread.number
              opts.navigate({ page: 'thread', forumId: targetForumId, slug, threadNum, postNum: num })
            } catch {
              return
            }
          })()
        }}
      />
    )
  }
  if ('Secret' in p) {
    return (
      <SecretSpan
        secret={p.Secret}
        author={opts.author}
        forumId={opts.forumIdHex}
        renderNested={renderNested}
      />
    )
  }
  return null
}

function renderLink(p: Extract<PostPartInput, { Link: unknown }>, opts: RenderOpts, renderNested: RenderNested): JSX.Element {
  return (
    <a class={'link-card inline-flex h-linkcard w-linkcard cursor-pointer items-center justify-center overflow-hidden break-words rounded-sm bg-panel2 p-1.5 text-center font-semibold text-accent hover:bg-hover'} href={p.Link.url} {...(isExternal(p.Link.url) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {renderParts(p.Link.children, opts, renderNested)}
    </a>
  )
}

function renderParts(parts: PostPartInput[], opts: RenderOpts, renderNested: RenderNested): JSX.Element[] {
  const out: JSX.Element[] = []
  let i = 0
  while (i < parts.length) {
    const p = parts[i]
    if ('Link' in p) {
      let j = i + 1
      while (j < parts.length) {
        const q = parts[j]
        if ('Link' in q || ('Plain' in q && /^\r?\n$/.test(q.Plain))) j++
        else break
      }
      const prev = i > 0 ? parts[i - 1] : null
      const next = j < parts.length ? parts[j] : null
      const breakBefore = i > 0 && !(prev && 'Plain' in prev && /[\r\n]+$/.test(prev.Plain))
      const breakAfter = j < parts.length && !(next && 'Plain' in next && /^[\r\n]+/.test(next.Plain))
      if (breakBefore) out.push('\n')
      out.push(
        <span class={'inline-flex flex-wrap gap-1.5'}>
          {parts
            .slice(i, j)
            .filter((l): l is Extract<PostPartInput, { Link: unknown }> => 'Link' in l)
            .map((l) => renderLink(l, opts, renderNested))}
        </span>,
      )
      if (breakAfter) out.push('\n')
      i = j
    } else {
      out.push(renderPart(p, opts, renderNested))
      i++
    }
  }
  return out
}

export function PostContent(props: {
  parts: PostPartInput[]
  author: string | null
  hasPost: (id: string) => boolean
  relayUrl: string
  forumId: string
  slug: string
  threadNum?: number
}) {
  const nav = useNav()
  const { threadPath } = useRoutes()
  const controller = useForumController()
  const read = useForumQueries()
  const inputs = createMemo(
    () => ({
      parts: props.parts,
      author: props.author,
      hasPost: props.hasPost,
      relayUrl: props.relayUrl,
      forumId: props.forumId,
      slug: props.slug,
      threadNum: props.threadNum,
    }),
    undefined,
    {
      equals: (a, b) =>
        a.parts === b.parts &&
        a.hasPost === b.hasPost &&
        a.author === b.author &&
        a.relayUrl === b.relayUrl &&
        a.forumId === b.forumId &&
        a.slug === b.slug &&
        a.threadNum === b.threadNum,
    },
  )
  const content = createMemo(() => {
    const current = inputs()
    const opts: RenderOpts = {
      resolvePost: controller.resolvePost,
      postId: read.postId,
      threadPath,
      author: current.author,
      resolveRelayUrl: read.relayUrl,
      hasPost: current.hasPost,
      relayUrl: current.relayUrl,
      navigate: nav.navigate,
      forumIdHex: current.forumId,
      slug: current.slug,
      threadNum: current.threadNum,
    }
    const renderNested: RenderNested = (parts) => renderParts(parts, opts, renderNested)
    return renderParts(current.parts, opts, renderNested)
  })
  return <>{content()}</>
}
