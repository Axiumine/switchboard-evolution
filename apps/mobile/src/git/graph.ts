// The Git Graph's lines, row by row. Lanes come from the desktop's own layout
// (git-graph-layout.js); each row of the list draws its node and the part of
// every line that crosses it, so the list can stay virtualized.

import { computeGitGraphLayout } from '@/shared/vendor/git-graph-layout';

export const LANE_WIDTH = 14;
export const ROW_HEIGHT = 44;
/** The colour index of the Uncommitted Changes node and its line: grey, never a lane colour (as on the desktop). */
export const UNCOMMITTED = -1;
const UNCOMMITTED_COLOUR = '#808094';

/** A lane's colour from the palette, or the grey of the Uncommitted Changes. */
export function laneColour(palette: string[], index: number): string {
  return index === UNCOMMITTED ? UNCOMMITTED_COLOUR : palette[index % palette.length];
}

export type Segment = { d: string; colorIndex: number };
/** A line leaving the bottom of a row, straight down: what a panel opened under the row draws beside it. */
export type Passing = { x: number; colorIndex: number };
export type GraphRow = { hash: string; node: { x: number; colorIndex: number }; segments: Segment[]; below: Passing[] };

const x = (lane: number) => LANE_WIDTH / 2 + lane * LANE_WIDTH;
const MID = ROW_HEIGHT / 2;

/** From one point to another lower down: straight in one lane, a curve between two. */
function link(x1: number, y1: number, x2: number, y2: number): string {
  return x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${y2} ${x2} ${y1} ${x2} ${y2}`;
}

export function graphRows(commits: { hash: string; parents: string[]; kind?: string }[], options: { firstParentOnly?: boolean } = {}) {
  const layout = computeGitGraphLayout(commits, 'date', options);
  const index = new Map(layout.map((row, i) => [row.hash, i]));
  const uncommitted = new Set(commits.filter((c) => c.kind === 'uncommitted').map((c) => c.hash));
  const rows: GraphRow[] = layout.map((row) => ({ hash: row.hash, node: { x: x(row.lane), colorIndex: uncommitted.has(row.hash) ? UNCOMMITTED : row.colorIndex }, segments: [], below: [] }));
  const pass = (k: number, at: number, colorIndex: number) => {
    if (!rows[k].below.some((line) => line.x === at)) rows[k].below.push({ x: at, colorIndex });
  };
  let lanes = 0;
  layout.forEach((row, i) => {
    lanes = Math.max(lanes, row.lane + 1);
    for (const edge of row.edges) {
      lanes = Math.max(lanes, edge.viaLane + 1, edge.toLane + 1);
      const j = index.get(edge.parentHash);
      const colorIndex = uncommitted.has(row.hash) ? UNCOMMITTED
        : edge.style === 'same-lane' ? row.colorIndex : j !== undefined ? layout[j].colorIndex : row.colorIndex;
      rows[i].segments.push({ d: link(x(row.lane), MID, x(edge.viaLane), ROW_HEIGHT), colorIndex });
      const last = j === undefined ? layout.length : j;
      for (let k = i + 1; k < last; k++) rows[k].segments.push({ d: `M${x(edge.viaLane)} 0 L${x(edge.viaLane)} ${ROW_HEIGHT}`, colorIndex });
      for (let k = i; k < last; k++) pass(k, x(edge.viaLane), colorIndex);
      if (j !== undefined) rows[j].segments.push({ d: link(x(edge.viaLane), 0, x(edge.toLane), MID), colorIndex });
    }
  });
  return { rows, lanes };
}

/** The room the panel opened under a row keeps from the screen's edges. */
export const PANEL_EDGE = 12;
// Narrower than this beside the lines, the files are cramped: the panel takes the screen's width instead.
const PANEL_MIN_BESIDE = 280;

/** Where the panel opened under a row goes sideways, in the list's coordinates (it scrolls with the list). */
export type PanelPlace = {
  left: number; width: number;
  /** How far the list scrolls before the panel stops at the screen's left edge and stays there. */
  stick: number;
};

/**
 * The panel opened under a row starts just after the last line that passes
 * beside it (`below`; `start` is where the row's graph starts, `gap` the room
 * after the line), not after the whole graph: a wide graph with few lines at
 * that row leaves the panel its room. Where that room is narrow it is as wide
 * as the screen (`viewport`), and the list scrolls to show it all; scrolled
 * further, it stays at the left edge, in sight however far the subjects go.
 */
export function detailsPanel(below: readonly Passing[], start: number, gap: number, viewport: number): PanelPlace {
  const left = below.length ? start + Math.max(...below.map((line) => line.x)) + LANE_WIDTH / 2 + gap : PANEL_EDGE;
  const full = viewport - 2 * PANEL_EDGE;
  const beside = viewport - left - PANEL_EDGE;
  const width = Math.max(0, beside >= Math.min(full, PANEL_MIN_BESIDE) ? beside : full);
  return { left, width, stick: Math.max(0, left - PANEL_EDGE) };
}
