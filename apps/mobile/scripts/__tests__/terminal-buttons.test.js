/** @jest-environment node */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const { readButtons, renderModule } = require('../terminal-buttons.cjs');

const root = join(__dirname, '..', '..');
const yaml = readFileSync(join(root, 'src/terminal/terminal-buttons.yml'), 'utf8');

describe('terminal-buttons.yml', () => {
  it('is what terminal-buttons.generated.ts holds (else run npm run build-terminal-keys)', () => {
    const generated = readFileSync(join(root, 'src/terminal/terminal-buttons.generated.ts'), 'utf8');
    expect(generated).toBe(renderModule(readButtons(yaml)));
  });

  it('turns away a row with a different number of keys', () => {
    const text = `
look: { height: 44, key_text: 13, swipe_text: { size: 9, opacity: 0.4 } }
rows:
  - [{ label: A, action: "a" }, { label: B, action: "b" }]
  - [{ label: C, action: "c" }]
`;
    expect(() => readButtons(text)).toThrow('row 2 has 1 keys, row 1 has 2');
  });

  it('turns away a key without an action, and an up without a label', () => {
    const look = 'look: { height: 44, key_text: 13, swipe_text: { size: 9, opacity: 0.4 } }\n';
    expect(() => readButtons(`${look}rows: [[{ label: A }]]`)).toThrow('row 1, key 1 has no action');
    expect(() => readButtons(`${look}rows: [[{ label: A, action: Esc, up: { action: Tab } }]]`)).toThrow('"up" needs a label and an action');
  });

  it('keeps the opacity between 0 and 1', () => {
    expect(() => readButtons('look: { height: 44, key_text: 13, swipe_text: { size: 9, opacity: 4 } }\nrows: [[{ label: A, action: Esc }]]')).toThrow('opacity');
  });
});
