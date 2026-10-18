#!/usr/bin/env node
/**
 * What the reviewer keeps saying no to. Reads the decisions every served review logs
 * (~/.claude/feature-review/decisions.jsonl) and prints the patterns worth asking about:
 * a kind of recommendation, or one citing a principle, declined in at least 70% of 5 or more.
 *
 *   node decision-patterns.cjs            # print patterns not yet asked about
 *   node decision-patterns.cjs --ack KEY  # the reviewer was asked; hold it back until 5 more decisions
 *
 * The agent asks the reviewer about each pattern and only then edits their preferences; nothing here
 * writes to the preferences file.
 */
const { patterns, ackPattern, read, LOG } = require('./lib/decisions.cjs');

const args = process.argv.slice(2);
const i = args.indexOf('--ack');
if (i !== -1) {
  const key = args[i + 1];
  if (!key) { console.error('--ack needs a pattern key'); process.exit(2); }
  console.log('acknowledged ' + key + ' at ' + ackPattern(key) + ' decision(s)');
  process.exit(0);
}
const list = patterns();
list.forEach((p) => {
  console.log('pattern: ' + p.label + ': declined ' + p.no + ' of ' + p.n + ' (last ' + p.last.slice(0, 10) + ')');
  console.log('  key: ' + p.key);
  if (p.declined.length) console.log('  declined: ' + p.declined.map((t) => '"' + t + '"').join('; '));
  if (p.kept.length) console.log('  kept: ' + p.kept.map((t) => '"' + t + '"').join('; '));
});
console.error('decisions: ' + read().length + ' logged in ' + LOG + '; ' + (list.length ? list.length + ' pattern(s) to ask about' : 'no patterns to ask about'));
