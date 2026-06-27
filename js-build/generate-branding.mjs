#!/usr/bin/env node
// Generate the derived brand locale files from the single source of truth
// (branding/brand.config.json).
//
//   node js-build/generate-branding.mjs           # write the files
//   node js-build/generate-branding.mjs --check    # fail if any file is out of sync
//
// CI runs --check so that editing a brand file by hand (instead of the config)
// is caught as drift. See INDEPENDENCE.md.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'branding/brand.config.json'), 'utf8'));
const d = config.display;

// brand.dtd is authored with a leading BOM; emit it explicitly rather than
// embedding a literal BOM in this source file.
const BOM = '\uFEFF';

// path -> generated content
const outputs = {
	'app/assets/branding/locale/brand.ftl':
`-brand-shorter-name = ${d.shorterName}
-brand-short-name = ${d.shortName}
-brand-full-name = ${d.fullName}
-brand-product-name = ${d.productName}
-vendor-short-name = ${d.vendorName}
-app-name = ${d.appName}
-subscription-name = ${d.subscriptionName}
trademarkInfo = ${d.shortName} is a trademark of ${d.legalEntity}.
`,

	'app/assets/branding/locale/brand.dtd':
`${BOM}<!ENTITY  brandShortName        "${d.shortName}">
`,

	'app/assets/branding/locale/brand.properties':
`brandShorterName=${d.shorterName}
brandShortName=${d.shortName}
brandFullName=${d.fullName}
`,
};

const check = process.argv.includes('--check');
let drift = 0;

for (const [relPath, content] of Object.entries(outputs)) {
	const absPath = join(root, relPath);
	if (check) {
		let current = '';
		try {
			current = readFileSync(absPath, 'utf8');
		}
		catch {
			// missing file counts as drift
		}
		if (current !== content) {
			console.error(`DRIFT: ${relPath} does not match branding/brand.config.json`);
			drift++;
		}
	}
	else {
		writeFileSync(absPath, content);
		console.log(`wrote ${relPath}`);
	}
}

if (check) {
	if (drift) {
		console.error(`\n${drift} brand file(s) out of sync. Run: node js-build/generate-branding.mjs`);
		process.exitCode = 1;
	}
	else {
		console.log('Brand files are in sync with branding/brand.config.json.');
	}
}
