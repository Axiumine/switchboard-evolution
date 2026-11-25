import { expect, test } from '@jest/globals';

import { detailsPanel, graphRows, laneColour, LANE_WIDTH, PANEL_EDGE, ROW_HEIGHT, UNCOMMITTED } from '../graph';

const x = (lane: number) => LANE_WIDTH / 2 + lane * LANE_WIDTH;
const mid = ROW_HEIGHT / 2;

// A merges C into B; B and C both come from D, the root.
const commits = [
  { hash: 'A', parents: ['B', 'C'] },
  { hash: 'B', parents: ['D'] },
  { hash: 'C', parents: ['D'] },
  { hash: 'D', parents: [] },
];

test('each row gets its node and the lines that cross it', () => {
  const { rows, lanes } = graphRows(commits);
  expect(lanes).toBe(2);
  expect(rows.map((r) => r.node.x)).toEqual([x(0), x(0), x(1), x(0)]);
  // A: down its own lane to B, and a curve out to lane 1 towards C.
  expect(rows[0].segments.map((s) => s.d)).toEqual([
    `M${x(0)} ${mid} L${x(0)} ${ROW_HEIGHT}`,
    `M${x(0)} ${mid} C${x(0)} ${ROW_HEIGHT} ${x(1)} ${mid} ${x(1)} ${ROW_HEIGHT}`,
  ]);
  // B: lane 1 passes by; B's own line goes on down to D.
  expect(rows[1].segments.map((s) => s.d)).toContain(`M${x(1)} 0 L${x(1)} ${ROW_HEIGHT}`);
  // D: both lines arrive at its node.
  expect(rows[3].segments.filter((s) => s.d.endsWith(`${x(0)} ${mid}`)).length).toBe(2);
});

test('a parent outside the loaded commits runs to the bottom of the list', () => {
  const { rows } = graphRows([{ hash: 'A', parents: ['old'] }, { hash: 'B', parents: ['A'] }].reverse());
  // A: B's line arrives from above, A's own leaves at the bottom towards a parent not loaded.
  expect(rows[1].segments.map((s) => s.d)).toEqual([`M${x(0)} 0 L${x(0)} ${mid}`, `M${x(0)} ${mid} L${x(0)} ${ROW_HEIGHT}`]);
  expect(rows).toHaveLength(2);
});

test('lines take the colour of the line of history they belong to', () => {
  const { rows } = graphRows(commits);
  const branchOut = rows[0].segments[1];
  expect(branchOut.colorIndex).toBe(rows[2].node.colorIndex);
  expect(rows[0].segments[0].colorIndex).toBe(rows[0].node.colorIndex);
});

test('each row knows the lines that leave its bottom, for a panel opened under it', () => {
  const { rows } = graphRows(commits);
  const below = rows.map((r) => r.below.map((line) => line.x).sort((a, b) => a - b));
  // A sends lines down lanes 0 and 1; both go on past B and C; nothing leaves the root.
  expect(below).toEqual([[x(0), x(1)], [x(0), x(1)], [x(0), x(1)], []]);
});

test('a line to a parent not loaded yet runs on to the last row', () => {
  const { rows } = graphRows([{ hash: 'A', parents: ['B'] }, { hash: 'X', parents: [] }]);
  expect(rows[1].below.length).toBeGreaterThan(0);
});

test('the Uncommitted Changes node and its line down to the checked-out commit are grey', () => {
  const { rows } = graphRows([
    { hash: '#uncommitted', parents: ['B'], kind: 'uncommitted' },
    { hash: 'A', parents: ['B'] },
    { hash: 'B', parents: [] },
  ]);
  expect(rows[0].node.colorIndex).toBe(UNCOMMITTED);
  expect(rows[0].segments.every((s) => s.colorIndex === UNCOMMITTED)).toBe(true);
  // Beside A the grey line passes by, and it arrives grey at B; B and A keep their lane colour.
  expect(rows[1].below.some((line) => line.colorIndex === UNCOMMITTED)).toBe(true);
  expect(rows[2].segments.some((s) => s.colorIndex === UNCOMMITTED)).toBe(true);
  expect(rows[2].node.colorIndex).not.toBe(UNCOMMITTED);
  expect(laneColour(['#00ff00'], UNCOMMITTED)).not.toBe('#00ff00');
  expect(laneColour(['#00ff00', '#0000ff'], 3)).toBe('#0000ff');
});

test('the panel under a row starts after the lines beside it, not after the whole graph', () => {
  // Three lines pass beside the row; the graph further on does not count.
  const place = detailsPanel([{ x: x(0), colorIndex: 0 }, { x: x(2), colorIndex: 1 }, { x: x(1), colorIndex: 2 }], 8, 8, 400);
  expect(place.left).toBe(8 + 3 * LANE_WIDTH + 8);
  // Room enough beside them: it fills it, and the list need not scroll to show it.
  expect(place.width).toBe(400 - place.left - PANEL_EDGE);
  expect(place.stick).toBe(place.left - PANEL_EDGE);
});

test('a panel with little room beside the lines takes the screen\'s width, and the list scrolls to it', () => {
  const below = Array.from({ length: 12 }, (_, lane) => ({ x: x(lane), colorIndex: lane }));
  const place = detailsPanel(below, 8, 8, 360);
  expect(place.width).toBe(360 - 2 * PANEL_EDGE);
  // Scrolled this far, it is at the left edge, all of it in sight.
  expect(place.left - place.stick).toBe(PANEL_EDGE);
});

test('with no line beside it the panel spans the screen from the start', () => {
  expect(detailsPanel([], 8, 8, 360)).toEqual({ left: PANEL_EDGE, width: 360 - 2 * PANEL_EDGE, stick: 0 });
  // Not laid out yet: never a negative width.
  expect(detailsPanel([], 8, 8, 0).width).toBe(0);
});
