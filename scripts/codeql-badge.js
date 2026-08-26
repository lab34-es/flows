#!/usr/bin/env node
/**
 * Turn the number of open CodeQL alerts into an SVG badge for the README.
 *
 * CodeQL runs through GitHub's default setup, which has no workflow file and
 * therefore no hosted badge — so, like the coverage badge, this one is
 * generated and committed by a workflow (.github/workflows/codeql-badge.yml).
 * That workflow counts the open code scanning alerts on master and hands the
 * number in through CODEQL_OPEN_ALERTS.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { badgeSvg } = require('./badge-svg');

const root = path.join(__dirname, '..');
const outputPath = path.join(root, '.github', 'badges', 'codeql.svg');

const count = Number(process.env.CODEQL_OPEN_ALERTS);

if (!Number.isInteger(count) || count < 0) {
  console.error('codeql-badge: set CODEQL_OPEN_ALERTS to the number of open alerts.');
  process.exit(1);
}

// Shields' own palette: green for a clean scan, red for open alerts.
const value = count === 0 ? 'no alerts' : `${count} alert${count === 1 ? '' : 's'}`;
const colour = count === 0 ? '#4c1' : '#e05d44';

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, badgeSvg('codeql', value, colour), 'utf8');

console.log(`codeql-badge: ${value} -> ${path.relative(root, outputPath)}`);
