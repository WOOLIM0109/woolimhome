import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Frozen pre-review baseline: preserve pairs, including the two entries sharing one path.
const BASELINE = [
  ["/api/cron/openchat/attachments", "10,40 23 * * 0-4"],
  ["/api/cron/openchat/attachments", "10 0 * * 1-5"],
  ["/api/cron/columns", "17 1 * * 2,4,6"],
  ["/api/cron/content-operations", "7 * * * *"],
  ["/api/cron/openchat/morning-collect", "0 23 * * 0-4"],
  ["/api/cron/openchat/morning-draft-notify", "0 0 * * 1-5"],
  ["/api/cron/openchat/morning-approval-reminder", "0 1 * * 1-5"],
  ["/api/cron/openchat/morning-cutoff", "15 1 * * 1-5"],
  ["/api/cron/openchat/morning-ready", "0 2 * * 1-5"],
  ["/api/cron/openchat/afternoon-draft", "0 6 * * *"],
  ["/api/cron/openchat/afternoon-cutoff", "30 8 * * *"],
  ["/api/cron/openchat/afternoon-ready", "0 9 * * *"],
  ["/api/cron/retention", "40 20 * * *"],
];
const REVIEW_PATH = "/api/cron/program-review";
const REVIEW_SCHEDULES = ["*/2 23 * * 0-4", "*/2 0 * * 1-5"];
const pairKey = ([path, schedule]) => JSON.stringify([path, schedule]);

function fieldValues(field, minimum, maximum) {
  const values = new Set();
  for (const token of field.split(",")) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(token);
    assert.ok(match, "Invalid cron field");
    const step = match[2] ? Number(match[2]) : 1;
    assert.ok(Number.isSafeInteger(step) && step > 0, "Invalid cron step");
    const range = match[1] === "*" ? [minimum, maximum] : match[1].split("-").map(Number);
    const start = range[0], end = range[1] ?? (match[2] ? maximum : start);
    assert.ok(start >= minimum && end <= maximum && start <= end, "Cron field out of range");
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

/** Standard five-field UTC cron matcher, independent of the expected KST window. */
export function compileCron(expression) {
  const fields = expression.trim().split(/\s+/);
  assert.equal(fields.length, 5, "Expected five cron fields");
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  const values = fields.map((field, index) => fieldValues(field, ...bounds[index]));
  return (date) => {
    const current = [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()];
    if (![0, 1, 3].every(index => values[index].has(current[index]))) return false;
    const dayOfMonth = values[2].has(current[2]), dayOfWeek = values[4].has(current[4]);
    // Restricted DOM and DOW use traditional cron OR semantics; Vercel expressions use one wildcard.
    return fields[2] === "*" ? dayOfWeek : fields[4] === "*" ? dayOfMonth : dayOfMonth || dayOfWeek;
  };
}

export function verifyReviewCrons(config) {
  assert.ok(config && Array.isArray(config.crons), "Missing cron configuration");
  assert.equal(config.crons.length, 15, "Expected thirteen preserved jobs plus two review jobs");
  for (const cron of config.crons) {
    assert.equal(typeof cron.path, "string");
    assert.equal(typeof cron.schedule, "string");
    compileCron(cron.schedule);
  }
  const original = config.crons.filter(cron => cron.path !== REVIEW_PATH);
  assert.deepEqual(original.map(cron => pairKey([cron.path, cron.schedule])).sort(), BASELINE.map(pairKey).sort(),
    "An existing cron path or schedule changed");
  const review = config.crons.filter(cron => cron.path === REVIEW_PATH);
  assert.deepEqual(review.map(cron => cron.schedule).sort(), [...REVIEW_SCHEDULES].sort(), "Unexpected review schedules");
  const matches = review.map(cron => compileCron(cron.schedule));
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const start = Date.parse("2026-10-18T00:00:00Z"), end = start + 14 * 24 * 60 * 60_000;
  const days = new Map();
  let checkedMinutes = 0, totalInvocations = 0;
  for (let timestamp = start; timestamp < end; timestamp += 60_000) {
    const utc = new Date(timestamp);
    const seoul = Object.fromEntries(formatter.formatToParts(utc).map(part => [part.type, part.value]));
    const weekday = !["Sat", "Sun"].includes(seoul.weekday);
    const hour = Number(seoul.hour), minute = Number(seoul.minute);
    const expected = weekday && hour >= 8 && hour < 10 && minute % 2 === 0;
    const occurrences = matches.filter(match => match(utc)).length;
    assert.equal(occurrences, expected ? 1 : 0, "UTC expressions differ from the KST weekday morning window");
    const key = `${seoul.year}-${seoul.month}-${seoul.day}`;
    const day = days.get(key) ?? { weekday, invocations: 0 };
    day.invocations += occurrences;
    days.set(key, day);
    totalInvocations += occurrences;
    checkedMinutes++;
  }
  let verifiedWeekdays = 0, weekendInvocations = 0;
  for (const day of days.values()) {
    assert.ok(day.invocations <= 60, "More than sixty daily invocations");
    if (day.weekday) { assert.equal(day.invocations, 60); verifiedWeekdays++; }
    else { assert.equal(day.invocations, 0); weekendInvocations += day.invocations; }
  }
  assert.equal(verifiedWeekdays, 10);
  assert.equal(totalInvocations, 600);
  return { existingCronsPreserved: original.length, reviewCrons: review.length, totalCrons: config.crons.length,
    checkedUtcDays: 14, checkedMinutes, verifiedKstWeekdays: verifiedWeekdays,
    invocationsPerWeekday: 60, weekendInvocations, totalInvocations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse(await readFile(process.argv[2] ?? "vercel.json", "utf8"));
    console.log(JSON.stringify(verifyReviewCrons(config)));
  } catch {
    console.error("REVIEW_CRON_CONFIG_INVALID");
    process.exitCode = 1;
  }
}
