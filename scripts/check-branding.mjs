#!/usr/bin/env node
// Brand-consistency gate. Codifies the manual checks from the Zotero->Trellis
// rebrand so the class of bug that happened there (stray tokens, replacement
// artifacts, mismatched IDs, hand-edited brand files) is caught in CI.
//
//   node scripts/check-branding.mjs
//
// Exits non-zero on any failure. Designed to run without submodules or a build.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let failures = 0;

function fail(msg) {
	console.error(`✗ ${msg}`);
	failures++;
}

function pass(msg) {
	console.log(`✓ ${msg}`);
}

// Lines that may legitimately still contain the old token.
const ALLOW = [
	// third-party npm package (renaming it breaks npm install)
	'@zotero/eslint-config',
	// shorthand for the same package
	'compat.extends("@zotero")',
];

// Files excluded from the stray-token scan (they describe the rule itself).
const SELF = [
	'scripts/check-branding.mjs',
	'INDEPENDENCE.md',
	'branding/brand.config.json',
];

function gitGrep(pattern, flags = '-nI') {
	try {
		let out = execSync(
			`git grep ${flags} ${pattern} -- . ':(exclude)package-lock.json'`,
			{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
		);
		return out.split('\n').filter(Boolean);
	}
	catch (e) {
		// git grep exits 1 when there are no matches
		if (e.status === 1) {
			return [];
		}
		throw e;
	}
}

function readFirst(path, regex) {
	try {
		let m = readFileSync(path, 'utf8').match(regex);
		return m && m[1];
	}
	catch {
		return null;
	}
}

function readAppId() {
	try {
		return JSON.parse(readFileSync('branding/brand.config.json', 'utf8')).identity.appId;
	}
	catch {
		return null;
	}
}

// 1. No stray "zotero" tokens (any case) outside the allowlist.
let strays = gitGrep('-i zotero')
	.filter(line => !ALLOW.some(a => line.includes(a)))
	.filter(line => !SELF.some(f => line.startsWith(f + ':')));
if (strays.length) {
	fail(`${strays.length} stray "zotero" token(s) outside the allowlist:`);
	strays.slice(0, 25).forEach(h => console.error('    ' + h));
	if (strays.length > 25) {
		console.error(`    ...and ${strays.length - 25} more`);
	}
}
else {
	pass('no stray "zotero" tokens');
}

// 2. No replacement artifacts.
let artifactsFound = false;
for (let bad of ['TrellisTrellis', 'trellistrellis', 'ZSCOPE', 'Trelliszotero', 'zoteroTrellis']) {
	let hits = gitGrep(bad).filter(line => !SELF.some(f => line.startsWith(f + ':')));
	if (hits.length) {
		fail(`replacement artifact "${bad}" found (${hits.length})`);
		artifactsFound = true;
	}
}
if (!artifactsFound) {
	pass('no replacement artifacts (doubled/mixed/sentinel tokens)');
}

// 3. App ID consistency across the identity sources.
let ids = {
	'application.ini': readFirst('app/assets/application.ini', /^ID=(.+)$/m),
	'resource/config.mjs': readFirst('resource/config.mjs', /GUID:\s*['"]([^'"]+)['"]/),
	'brand.config.json': readAppId(),
};
let unique = [...new Set(Object.values(ids).filter(Boolean))];
if (unique.length === 1) {
	pass(`app ID consistent across identity sources (${unique[0]})`);
}
else {
	fail('app ID mismatch across identity sources:');
	Object.entries(ids).forEach(([k, v]) => console.error(`    ${k}: ${v}`));
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll brand-consistency checks passed.');
process.exitCode = failures ? 1 : 0;
