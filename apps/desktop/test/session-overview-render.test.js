const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// How the Session Overview (session-overview.js drawOverviewCards) puts its
// groups and cards in place on each render. Chromium blurs the focused element
// when one of its ancestors is moved with insertBefore, and keeps it with
// moveBefore: a render that moves the card the user is typing into (its group
// changed, a group above it went away) must not take the keys from its
// terminal. The DOM here is a small fake that does the same.

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'session-overview.js'), 'utf8');

function fakeDocument({ moveBefore = true } = {}) {
  const doc = { activeElement: null, moves: [] };
  const blurIfInside = node => { if (doc.activeElement && node.contains(doc.activeElement)) doc.activeElement = doc.body; };
  const classesOf = el => el.className.split(/\s+/).filter(Boolean);
  const matches = (el, selector) => classesOf(el).includes(selector.slice(1));

  function element(tag) {
    const el = {
      tagName: tag.toUpperCase(), className: '', textContent: '', title: '', hidden: false,
      dataset: {}, style: {}, children: [], parentNode: null, listeners: {},
      classList: {
        add: (...names) => { el.className = [...new Set([...classesOf(el), ...names])].join(' '); },
        remove: (...names) => { el.className = classesOf(el).filter(n => !names.includes(n)).join(' '); },
        contains: name => classesOf(el).includes(name),
        toggle: (name, on = !classesOf(el).includes(name)) => { (on ? el.classList.add : el.classList.remove)(name); return on; },
      },
      get isConnected() {
        let node = el;
        while (node.parentNode) node = node.parentNode;
        return node === doc.documentElement;
      },
      set innerHTML(html) {
        el.children.forEach(child => { child.parentNode = null; });
        el.children = [];
        for (const [, name, className, text] of html.matchAll(/<(\w+) class="([^"]*)">([^<]*)<\/\1>/g)) {
          const child = element(name);
          child.className = className;
          child.textContent = text;
          el.appendChild(child);
        }
      },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      contains(other) {
        for (let node = other; node; node = node.parentNode) if (node === el) return true;
        return false;
      },
      closest(selector) {
        for (let node = el; node; node = node.parentNode) if (node.className !== undefined && matches(node, selector)) return node;
        return null;
      },
      querySelector(selector) { return el.querySelectorAll(selector)[0] || null; },
      querySelectorAll(selector) {
        const found = [];
        const walk = node => node.children.forEach(child => { if (matches(child, selector)) found.push(child); walk(child); });
        walk(el);
        return found;
      },
      detach(node) {
        if (!node.parentNode) return;
        node.parentNode.children = node.parentNode.children.filter(child => child !== node);
        node.parentNode = null;
      },
      insertBefore(node, ref) {
        blurIfInside(node);
        doc.moves.push(['insertBefore', node.dataset.id || node.dataset.groupKey]);
        el.detach(node);
        const at = ref ? el.children.indexOf(ref) : el.children.length;
        el.children.splice(at === -1 ? el.children.length : at, 0, node);
        node.parentNode = el;
        return node;
      },
      appendChild(node) { return el.insertBefore(node, null); },
      append(...nodes) { nodes.forEach(node => el.appendChild(node)); },
      remove() {
        blurIfInside(el);
        el.parentNode?.detach(el);
      },
      focus() { doc.activeElement = el; },
    };
    if (moveBefore) {
      el.moveBefore = (node, ref) => {
        if (!node.isConnected || !el.isConnected) throw new Error('HierarchyRequestError');
        doc.moves.push(['moveBefore', node.dataset.id || node.dataset.groupKey]);
        el.detach(node);
        const at = ref ? el.children.indexOf(ref) : el.children.length;
        el.children.splice(at === -1 ? el.children.length : at, 0, node);
        node.parentNode = el;
      };
    }
    return el;
  }

  doc.createElement = element;
  doc.documentElement = element('html');
  doc.body = element('body');
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  doc.addEventListener = () => {};
  return doc;
}

function harness(options) {
  const document = fakeDocument(options);
  const cards = new Map();
  const context = vm.createContext({
    console, Map, Set, WeakSet, JSON, document,
    gridCards: new Map(), activeSessionId: null, openSessions: new Map(),
    // Closed cards (session-overview-closed.js): one element per session, with a field to type into.
    drawOverviewClosedCard: card => {
      if (!cards.has(card.id)) {
        const el = document.createElement('div');
        el.className = 'ov-card ov-closed-card';
        el.dataset.id = card.id;
        const field = document.createElement('textarea');
        field.dataset.id = `${card.id}:field`;
        el.appendChild(field);
        cards.set(card.id, el);
      }
      return cards.get(card.id);
    },
  });
  context.window = context;
  vm.runInContext(source, context);
  const root = document.createElement('div');
  const cardsEl = document.createElement('div');
  root.appendChild(cardsEl);
  document.body.appendChild(root);
  vm.runInContext('(root, cardsEl) => { ovState.root = root; ovState.cardsEl = cardsEl; }', context)(root, cardsEl);
  const prefs = { layout: { mode: 'grid-scroll' }, group: { axis: 'across', fit: false } };
  const draw = groups => {
    document.moves.length = 0;
    const shown = groups.map(([key, ids]) => {
      const cards = ids.map(id => ({ id, live: false, session: { sessionId: id } }));
      return { group: { key, label: key, cards }, cards, collapsed: false };
    });
    context.drawOverviewCards(shown, { grouped: true, carousels: false, prefs });
  };
  const layout = () => cardsEl.children.map(group => [
    group.dataset.groupKey, group.querySelector('.ov-group-cards').children.map(card => card.dataset.id),
  ]);
  return { document, cards, draw, layout };
}

for (const moveBefore of [true, false]) {
  const how = moveBefore ? 'moveBefore' : 'insertBefore alone';

  test(`a card that changes group keeps the keyboard (${how})`, () => {
    const { document, cards, draw, layout } = harness({ moveBefore });
    draw([['working', ['a']], ['idle', ['b', 'c']]]);
    const field = cards.get('b').children[0];
    field.focus();
    // Enter made b Working: its card moves to the other group.
    draw([['working', ['b', 'a']], ['idle', ['c']]]);
    assert.deepEqual(layout(), [['working', ['b', 'a']], ['idle', ['c']]]);
    assert.equal(document.activeElement, field);
  });

  test(`a group above the focused card going away keeps the keyboard (${how})`, () => {
    const { document, cards, draw, layout } = harness({ moveBefore });
    draw([['one', ['a']], ['two', ['b']]]);
    const field = cards.get('b').children[0];
    field.focus();
    draw([['two', ['b']]]);
    assert.deepEqual(layout(), [['two', ['b']]]);
    assert.equal(document.activeElement, field);
    // The group that stays was not moved at all.
    assert.ok(!document.moves.some(([, id]) => id === 'two'), JSON.stringify(document.moves));
  });
}

test('a card that leaves gives its place to the one that comes, and the others stay put', () => {
  const { document, draw, layout } = harness();
  draw([['g', ['a', 'b', 'c']]]);
  // b's closed card goes; d (say, b resumed: a live card) takes its slot.
  draw([['g', ['a', 'd', 'c']]]);
  assert.deepEqual(layout(), [['g', ['a', 'd', 'c']]]);
  const placed = document.moves.filter(([, id]) => !String(id).endsWith(':field'));
  assert.deepEqual(placed, [['insertBefore', 'd']], 'only the new card is placed');
});

test('a card taken off the page does not get the keyboard back', () => {
  const { document, cards, draw } = harness();
  draw([['g', ['a', 'b']]]);
  const field = cards.get('b').children[0];
  field.focus();
  draw([['g', ['a']]]);
  assert.notEqual(document.activeElement, field);
});
