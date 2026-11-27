const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');

const {
  PRESETS, dueThisMinute, nextDueAt, missedRun, describeTiming, presetFromCron, describeNextRun,
} = require('../public/schedule-time');

// Local-time dates, because a schedule's "9:00" is the user's 9:00.
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0);
const WED_0900 = at(2026, 9, 9, 9, 0);   // Wednesday

// Dates and times follow the computer's regional settings ("Mon 9:00 AM" in
// English, "lun 9:00" in Italian), so the expected text uses the same format.
const clock = d => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const dayName = d => d.toLocaleDateString(undefined, { weekday: 'short' });
const monthDay = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

test('every preset the dialog offers has a description and a next run', () => {
  for (const p of PRESETS) {
    const s = { every: p.every, atHour: 9, atMinute: 0, weekday: 1 };
    assert.ok(describeTiming(s), `${p.every} describes itself`);
    assert.ok(nextDueAt(s, WED_0900.getTime()) !== null, `${p.every} has a next run`);
  }
});

test('dueThisMinute: interval presets fire on the minute boundary', () => {
  assert.equal(dueThisMinute({ every: '15m' }, at(2026, 9, 9, 10, 15)), true);
  assert.equal(dueThisMinute({ every: '15m' }, at(2026, 9, 9, 10, 16)), false);
  assert.equal(dueThisMinute({ every: '30m' }, at(2026, 9, 9, 10, 30)), true);
  assert.equal(dueThisMinute({ every: '30m' }, at(2026, 9, 9, 10, 15)), false);
  assert.equal(dueThisMinute({ every: 'hour', atMinute: 30 }, at(2026, 9, 9, 10, 30)), true);
  assert.equal(dueThisMinute({ every: 'hour', atMinute: 30 }, at(2026, 9, 9, 10, 0)), false);
  assert.equal(dueThisMinute({ every: 'hour' }, at(2026, 9, 9, 10, 0)), true, 'atMinute defaults to 0');
});

test('dueThisMinute: daily, weekdays and weekly respect the clock and the calendar', () => {
  const daily = { every: 'day', atHour: 9, atMinute: 0 };
  assert.equal(dueThisMinute(daily, WED_0900), true);
  assert.equal(dueThisMinute(daily, at(2026, 9, 9, 9, 1)), false);
  assert.equal(dueThisMinute(daily, at(2026, 9, 12, 9, 0)), true, 'Saturday too');
  const weekdays = { every: 'weekdays', atHour: 9, atMinute: 0 };
  assert.equal(dueThisMinute(weekdays, WED_0900), true);
  assert.equal(dueThisMinute(weekdays, at(2026, 9, 12, 9, 0)), false, 'not on Saturday');
  const weekly = { every: 'week', atHour: 9, atMinute: 0, weekday: 1 };
  assert.equal(dueThisMinute(weekly, at(2026, 9, 14, 9, 0)), true, 'Monday');
  assert.equal(dueThisMinute(weekly, WED_0900), false);
});

test('dueThisMinute: an imported cron keeps firing as the file said', () => {
  assert.equal(dueThisMinute({ every: 'cron', cron: '*/5 * * * *' }, at(2026, 9, 9, 10, 25)), true);
  assert.equal(dueThisMinute({ every: 'cron', cron: '*/5 * * * *' }, at(2026, 9, 9, 10, 26)), false);
  assert.equal(dueThisMinute({ every: 'cron', cron: '0 * * * *' }, at(2026, 9, 9, 10, 0)), true);
  assert.equal(dueThisMinute({ every: 'cron', cron: 'bad' }, at(2026, 9, 9, 10, 0)), false);
  assert.equal(dueThisMinute({ every: 'nope' }, at(2026, 9, 9, 10, 0)), false);
});

test('nextDueAt is strictly after "from" and agrees with dueThisMinute', () => {
  const daily = { every: 'day', atHour: 9, atMinute: 0 };
  const fromExactly = WED_0900.getTime();
  const next = nextDueAt(daily, fromExactly);
  assert.equal(next, at(2026, 9, 10, 9, 0).getTime(), 'due right now counts as done; next is tomorrow');
  assert.equal(dueThisMinute(daily, new Date(next)), true);
  const weekly = { every: 'week', atHour: 9, atMinute: 0, weekday: 1 };
  assert.equal(nextDueAt(weekly, WED_0900.getTime()), at(2026, 9, 14, 9, 0).getTime());
  assert.equal(nextDueAt({ every: '15m' }, at(2026, 9, 9, 10, 1, 0).getTime()), at(2026, 9, 9, 10, 15).getTime());
  assert.equal(nextDueAt({ every: 'cron', cron: '0 0 31 2 *' }, WED_0900.getTime()), null, 'never fires, never found');
});

test('nextDueAt survives the DST change without skipping a day', () => {
  // US DST ends 2026-11-01. A 9:00 daily schedule still fires at 9:00 the next day.
  const daily = { every: 'day', atHour: 9, atMinute: 0 };
  const next = nextDueAt(daily, at(2026, 10, 31, 9, 0).getTime());
  const d = new Date(next);
  assert.deepEqual([d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()], [11, 1, 9, 0]);
});

test('missedRun: only with catchUp, and only when a due minute passed since the last run', () => {
  const daily = { every: 'day', atHour: 9, atMinute: 0, catchUp: true, lastRunAt: at(2026, 9, 8, 9, 0).toISOString() };
  assert.equal(missedRun(daily, at(2026, 9, 9, 12, 0).getTime()), true, 'yesterday ran, today 9:00 went by');
  assert.equal(missedRun(daily, at(2026, 9, 9, 8, 0).getTime()), false, 'today has not come yet');
  assert.equal(missedRun({ ...daily, catchUp: false }, at(2026, 9, 9, 12, 0).getTime()), false);
  const fresh = { every: 'day', atHour: 9, atMinute: 0, catchUp: true, created: at(2026, 9, 9, 10, 0).toISOString() };
  assert.equal(missedRun(fresh, at(2026, 9, 9, 12, 0).getTime()), false, 'created after today\'s time: nothing missed');
  assert.equal(missedRun({ every: 'day', catchUp: true }, Date.now()), false, 'no dates at all, no miss');
});

test('presetFromCron maps the crons a schedule file is likely to have', () => {
  assert.deepEqual(presetFromCron('*/15 * * * *'), { every: '15m' });
  assert.deepEqual(presetFromCron('*/30 * * * *'), { every: '30m' });
  assert.deepEqual(presetFromCron('0 * * * *'), { every: 'hour', atMinute: 0 });
  assert.deepEqual(presetFromCron('30 * * * *'), { every: 'hour', atMinute: 30 });
  assert.deepEqual(presetFromCron('0 9 * * *'), { every: 'day', atHour: 9, atMinute: 0 });
  assert.deepEqual(presetFromCron('0 9 * * 1-5'), { every: 'weekdays', atHour: 9, atMinute: 0 });
  assert.deepEqual(presetFromCron('0 9 * * 1'), { every: 'week', atHour: 9, atMinute: 0, weekday: 1 });
  assert.equal(presetFromCron('*/5 * * * *'), null, 'no preset for every 5 minutes');
  assert.equal(presetFromCron('0 9 1 * *'), null, 'monthly has no preset');
  assert.equal(presetFromCron('garbage'), null);
});

test('describeTiming says it in words, and an imported cron says where it came from', () => {
  assert.equal(describeTiming({ every: '15m' }), 'every 15 minutes');
  assert.equal(describeTiming({ every: 'hour', atMinute: 0 }), 'every hour');
  assert.equal(describeTiming({ every: 'hour', atMinute: 5 }), 'every hour at :05');
  assert.match(describeTiming({ every: 'day', atHour: 9, atMinute: 0 }), /^every day at /);
  assert.match(describeTiming({ every: 'weekdays', atHour: 9, atMinute: 0 }), /^weekdays at /);
  assert.match(describeTiming({ every: 'week', atHour: 9, atMinute: 0, weekday: 1 }), /^Mondays at /);
  assert.equal(describeTiming({ every: 'cron', cron: '*/5 * * * *' }), 'every 5 minutes (from file)');
  assert.match(describeTiming({ every: 'cron', cron: '0 * * * *' }), /^every hour \(from file\)$/);
  assert.equal(describeTiming({ every: 'cron', cron: '0 9 1 * *' }), 'cron 0 9 1 * * (from file)');
});

test('describeNextRun: minutes soon, then today / tomorrow / weekday / date', () => {
  const now = WED_0900.getTime();
  assert.equal(describeNextRun(now + 30 * 1000, now), 'in a minute');
  assert.equal(describeNextRun(now + 12 * 60 * 1000, now), 'in 12 min');
  const later = at(2026, 9, 9, 15, 0), tomorrow = at(2026, 9, 10, 9, 0), monday = at(2026, 9, 14, 9, 0), sep30 = at(2026, 9, 30, 9, 0);
  assert.equal(describeNextRun(later.getTime(), now), `today ${clock(later)}`);
  assert.equal(describeNextRun(tomorrow.getTime(), now), `tomorrow ${clock(tomorrow)}`);
  assert.equal(describeNextRun(monday.getTime(), now), `${dayName(monday)} ${clock(monday)}`);
  assert.equal(describeNextRun(sep30.getTime(), now), `${monthDay(sep30)}, ${clock(sep30)}`);
  assert.equal(describeNextRun(NaN, now), '');
});

test('describeNextRun follows the regional settings: English or Italian', {
  skip: new Intl.DateTimeFormat('it-IT').resolvedOptions().locale !== 'it-IT' && 'this Node has no Italian locale data',
}, () => {
  const script = `const { describeNextRun } = require(${JSON.stringify(require.resolve('../public/schedule-time'))});
    const at = (d, h) => new Date(2026, 8, d, h, 0, 0, 0).getTime(), now = at(9, 9);
    console.log(JSON.stringify([at(9, 15), at(10, 9), at(14, 9), at(30, 9)].map(due => describeNextRun(due, now))));`;
  const inLocale = locale => JSON.parse(cp.execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, LC_ALL: locale, LANG: locale, LANGUAGE: '' }, encoding: 'utf8',
  })).map(text => text.replace(/\s/g, ' ')); // ICU puts a narrow no-break space before AM
  assert.deepEqual(inLocale('en_US.UTF-8'), ['today 3:00 PM', 'tomorrow 9:00 AM', 'Mon 9:00 AM', 'Sep 30, 9:00 AM']);
  assert.deepEqual(inLocale('it_IT.UTF-8'), ['today 15:00', 'tomorrow 9:00', 'lun 9:00', '30 set, 9:00']);
});
