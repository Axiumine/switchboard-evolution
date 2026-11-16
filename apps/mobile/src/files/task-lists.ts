import type MarkdownIt from 'markdown-it';

const BOX = /^\[([ xX])\]\s+/;

/**
 * A markdown-it plugin for GitHub's task lists, as the desktop shows them: a
 * list item that starts with "[ ]" or "[x]" gets a `task` attribute, "todo"
 * or "done", and loses the brackets. The markdown rules draw the checkbox.
 */
export function taskLists(md: MarkdownIt) {
  md.core.ruler.push('task_lists', (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
      const first = inline.children?.[0];
      const box = first?.type === 'text' ? BOX.exec(first.content) : null;
      if (!first || !box) continue;
      first.content = first.content.slice(box[0].length);
      inline.content = inline.content.replace(BOX, '');
      tokens[i - 2].attrSet('task', box[1] === ' ' ? 'todo' : 'done');
    }
    return true;
  });
}
