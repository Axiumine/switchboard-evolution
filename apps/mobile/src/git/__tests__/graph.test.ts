import { expect, test } from '@jest/globals';

import { graphRows, laneColour, LANE_WIDTH, ROW_HEIGHT, UNCOMMITTED } from '../graph';

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
