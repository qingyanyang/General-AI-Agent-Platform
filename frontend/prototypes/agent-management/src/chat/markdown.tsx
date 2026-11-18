/**
 * PROTOTYPE assistant Markdown (#53). Uses the production `react-markdown`
 * (raw HTML is never rendered; unsafe link protocols are dropped). GFM tables
 * are split out and rendered here because `remark-gfm` isn't a dependency;
 * production would add that plugin instead.
 */
import type { ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'

import { cn } from '@/lib/utils'

type Align = 'left' | 'right' | 'center'

type Block = { kind: 'markdown'; text: string } | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] }

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

function alignment(cell: string): Align {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) {
    return 'center'
  }
  return right ? 'right' : 'left'
}

function splitBlocks(content: string): Block[] {
  const lines = content.split('\n')
  const blocks: Block[] = []
  let buffer: string[] = []
  let inFence = false
  const flush = () => {
    if (buffer.length > 0) {
      blocks.push({ kind: 'markdown', text: buffer.join('\n') })
      buffer = []
    }
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
    }
    const next = lines[index + 1]
    if (!inFence && line.includes('|') && next !== undefined && SEPARATOR.test(next)) {
      flush()
      const header = cells(line)
      const align = cells(next).map(alignment)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        rows.push(cells(lines[index]))
        index += 1
      }
      index -= 1
      blocks.push({ kind: 'table', header, align, rows })
      continue
    }
    buffer.push(line)
  }
  flush()
  return blocks
}

const blockComponents: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary underline underline-offset-4">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-xl border border-border bg-muted p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code className={cn(className, 'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [pre_&]:bg-transparent [pre_&]:p-0')}>
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-muted-foreground">{children}</blockquote>
  ),
  h1: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
}

const inlineComponents: Components = { ...blockComponents, p: ({ children }) => <>{children}</> }

function Inline({ text }: { text: string }): ReactNode {
  return <Markdown components={inlineComponents}>{text}</Markdown>
}

const ALIGN_CLASS: Record<Align, string> = { left: 'text-left', right: 'text-right', center: 'text-center' }

function Table({ block }: { block: Extract<Block, { kind: 'table' }> }) {
  return (
    <div className="my-3 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted">
          <tr>
            {block.header.map((cell, index) => (
              <th
                key={index}
                scope="col"
                className={cn('px-3 py-2 font-medium whitespace-nowrap', ALIGN_CLASS[block.align[index] ?? 'left'])}
              >
                <Inline text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-border">
              {block.header.map((_, index) => (
                <td key={index} className={cn('px-3 py-2 align-top', ALIGN_CLASS[block.align[index] ?? 'left'])}>
                  <Inline text={row[index] ?? ''} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="min-w-0 text-sm leading-relaxed break-words">
      {splitBlocks(content).map((block, index) =>
        block.kind === 'table' ? (
          <Table key={index} block={block} />
        ) : (
          <Markdown key={index} components={blockComponents}>
            {block.text}
          </Markdown>
        ),
      )}
    </div>
  )
}
