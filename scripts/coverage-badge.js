#!/usr/bin/env node
/**
 * Turn the coverage summary jest writes into an SVG badge for the README.
 *
 * The number shown is the statement coverage of src/ as measured by the run
 * that produced coverage/coverage-summary.json, so the badge cannot drift from
 * what CI actually enforces: the same run fails when any metric drops below
 * the threshold in jest.config.js.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { badgeSvg } = require('./badge-svg');

const THRESHOLD = 80;

const root = path.join(__dirname, '..');
const summaryPath = path.join(root, 'coverage', 'coverage-summary.json');
const outputPath = path.join(root, '.github', 'badges', 'coverage.svg');

if (!fs.existsSync(summaryPath)) {
  console.error(`coverage-badge: ${summaryPath} not found. Run "npm run test:coverage" first.`);
  process.exit(1);
}

const total = JSON.parse(fs.readFileSync(summaryPath, 'utf8')).total;
const pct = Math.round(total.statements.pct * 10) / 10;

// Shields' own palette, so the badge sits naturally next to other ones.
const colour = pct >= 90 ? '#4c1' : pct >= THRESHOLD ? '#97ca00' : pct >= 60 ? '#dfb317' : '#e05d44';

const value = `${pct}%`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, badgeSvg('coverage', value, colour), 'utf8');

console.log(`coverage-badge: ${value} statements -> ${path.relative(root, outputPath)}`);

if (pct < THRESHOLD) {
  console.error(`coverage-badge: ${value} is below the ${THRESHOLD}% threshold`);
  process.exitCode = 1;
}
