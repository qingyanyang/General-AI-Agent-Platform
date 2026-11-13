import Markdown from 'react-markdown'

export function MarkdownMessage({ content }: { content: string }) {
  return <Markdown>{content}</Markdown>
}
