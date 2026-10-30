const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(__dirname + '/../src/lib/schedule.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, Date };
vm.runInNewContext(compiled, sandbox);
const { getSevenDaySchedule } = sandbox.exports;
const job = (id, date, archived = false) => ({ id, install_date: date, archived });
const ids = result => Array.from(result.jobs, j => j.id);
process.env.TZ = 'Europe/London';
test('today and day six included; past, day seven, undated and archived excluded', () => {
  const result = getSevenDaySchedule([
    job('past','2026-10-29'), job('today','2026-10-30'), job('last','2026-11-05'),
    job('later','2026-11-06'), job('undated',null), job('archived','2026-11-01',true)
  ], new Date(2026,9,30,12));
  assert.deepEqual(ids(result), ['today','last']);
  assert.equal(result.startDate,'2026-10-30');
  assert.equal(result.endDate,'2026-11-05');
});
test('today does not hide the rest of the week; results sorted without mutating input', () => {
  const jobs = [job('later','2026-11-02'),job('today','2026-10-30')];
  assert.deepEqual(ids(getSevenDaySchedule(jobs,new Date(2026,9,30,12))),['today','later']);
  assert.equal(jobs[0].id,'later');
});
test('more than ten eligible jobs remain visible', () => {
  const jobs = Array.from({length:15},(_,i)=>job(String(i),'2026-10-31'));
  assert.equal(getSevenDaySchedule(jobs,new Date(2026,9,30,12)).jobs.length,15);
});
test('UK summer midnight uses the local date rather than the previous UTC date', () => {
  const now = new Date('2026-08-18T00:15:00+01:00');
  assert.equal(now.getDate(),18);
  const result=getSevenDaySchedule([job('yesterday','2026-08-17'),job('today','2026-08-18')],now);
  assert.equal(result.startDate,'2026-08-18');
  assert.deepEqual(ids(result),['today']);
});
test('UK clocks changing keeps seven calendar dates', () => {
  const result=getSevenDaySchedule([],new Date('2026-10-23T00:15:00+01:00'));
  assert.equal(result.startDate,'2026-10-23');
  assert.equal(result.endDate,'2026-10-29');
});
test('year and leap-year boundaries', () => {
  assert.equal(getSevenDaySchedule([],new Date(2026,11,29)).endDate,'2027-01-04');
  assert.equal(getSevenDaySchedule([],new Date(2028,1,25)).endDate,'2028-03-02');
});
test('empty result stays empty rather than showing unrelated jobs', () => {
  assert.equal(getSevenDaySchedule([job('later','2027-01-01')],new Date(2026,9,30)).jobs.length,0);
});
