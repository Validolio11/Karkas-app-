import React from 'react';

/** A small Markdown subset rendered as escaped React text, never HTML. */
function inlineText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    nodes.push(match[1] !== undefined
      ? <strong key={match.index}>{match[1]}</strong>
      : <code key={match.index}>{match[2]}</code>);
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

const listItem = (line: string) => line.match(/^\s{0,3}(?:([-*+])|(\d{1,6})[.)])\s+(.+)$/);
const heading = (line: string) => line.match(/^(#{1,3})\s+(.+)$/);
const fence = (line: string) => /^\s{0,3}```/.test(line);

export function AIChatText({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const key = index;
    if (!line.trim()) { index++; continue; }
    if (fence(line)) {
      index++;
      const code: string[] = [];
      while (index < lines.length && !fence(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<pre key={key}><code>{code.join('\n')}</code></pre>);
      continue;
    }
    const title = heading(line);
    if (title) {
      blocks.push(<div key={key} className="karkas-ai-chat-heading" role="heading" aria-level={title[1].length + 2}>{inlineText(title[2].replace(/\s+#+\s*$/, ''))}</div>);
      index++;
      continue;
    }
    const first = listItem(line);
    if (first) {
      const ordered = first[2] !== undefined;
      const items: React.ReactNode[] = [];
      while (index < lines.length) {
        const item = listItem(lines[index]);
        if (!item || (item[2] !== undefined) !== ordered) break;
        items.push(<li key={index}>{inlineText(item[3])}</li>);
        index++;
      }
      blocks.push(ordered
        ? <ol key={key} start={Number(first[2])}>{items}</ol>
        : <ul key={key}>{items}</ul>);
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !heading(lines[index]) && !listItem(lines[index]) && !fence(lines[index])) {
      paragraph.push(lines[index++]);
    }
    blocks.push(<p key={key}>{inlineText(paragraph.join('\n'))}</p>);
  }
  return <div className="karkas-ai-chat-text">{blocks}</div>;
}
