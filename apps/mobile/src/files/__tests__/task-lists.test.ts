import { describe, expect, it } from '@jest/globals';
import MarkdownIt from 'markdown-it';

import { taskLists } from '../task-lists';

const md = MarkdownIt().use(taskLists);

/** Each list item of `source`: its task state and the text it shows. */
function items(source: string) {
  const tokens = md.parse(source, {});
  return tokens.flatMap((token, i) => {
    if (token.type !== 'list_item_open') return [];
    const inline = tokens.slice(i).find((t) => t.type === 'inline')!;
    return [{ task: token.attrGet('task'), text: inline.children!.map((c) => c.content).join('') }];
  });
}

describe('task lists', () => {
  it('turns "[ ]" and "[x]" at the start of a list item into its state', () => {
    expect(items('- [ ] to do\n- [x] done\n- [X] done too\n- plain')).toEqual([
      { task: 'todo', text: 'to do' },
      { task: 'done', text: 'done' },
      { task: 'done', text: 'done too' },
      { task: null, text: 'plain' },
    ]);
  });

  it('works in numbered lists and in lists inside lists', () => {
    expect(items('1. [x] first\n   - [ ] inner')).toEqual([
      { task: 'done', text: 'first' },
      { task: 'todo', text: 'inner' },
    ]);
  });

  it('keeps the rest of the item as it was, links and code included', () => {
    const tokens = md.parse('- [ ] see `plan.md` and [docs](https://example.com)\n  on two lines', {});
    const inline = tokens.find((t) => t.type === 'inline')!;
    expect(inline.children!.map((c) => c.type)).toEqual(['text', 'code_inline', 'text', 'link_open', 'text', 'link_close', 'softbreak', 'text']);
    expect(inline.children![0].content).toBe('see ');
  });

  it('leaves brackets alone outside a list item, or not at its start', () => {
    expect(md.render('[ ] not in a list')).toBe('<p>[ ] not in a list</p>\n');
    expect(items('- a [ ] in the middle\n- [ ]\n- [y] other')).toEqual([
      { task: null, text: 'a [ ] in the middle' },
      { task: null, text: '[ ]' },
      { task: null, text: '[y] other' },
    ]);
  });
});
