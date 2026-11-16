// A phone changes a line of the plan by number. The file can move under it
// (a session ticks or adds something), so the phone also sends the text it
// saw there, and the change only happens if that text is still on the line.

/** The item or phase text at a 0-based line of plan-tracker.md ('plan') or todos.md ('todos'). */
function planLineText(data, kind, line) {
  if (kind === 'todos') return (data?.todos || []).find(item => item.line === line)?.text ?? null;
  for (const phase of data?.plan?.phases || []) {
    if (phase.line === line) return phase.title;
    const item = phase.items.find(it => it.line === line);
    if (item) return item.text;
  }
  return null;
}

module.exports = { planLineText };
