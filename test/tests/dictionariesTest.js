"use strict";

var sandbox = sinon.createSandbox();

describe("Dictionaries", function () {
	var win;
	var enGBXPIOld, frFRv1XPI, unKNXPI, enGBXPINew, frFRv2XPI;
	
	async function makeFakeDictionary({ id, locale, version }) {
		var dir = await getTempDirectory();
		var extDir = OS.Path.join(dir, 'sub');
		var dictDir = OS.Path.join(extDir, 'dictionaries');
		await OS.File.makeDir(dictDir, { from: dir });
		var manifest = {
			dictionaries: {
				[locale]: `dictionaries/${locale}.dic`,
			},
			version,
			applications: {
				gecko: {
					id
				}
			},
			name,
			manifest_version: 2
		};
		await Trellis.File.putContentsAsync(
			OS.Path.join(extDir, 'manifest.json'),
			JSON.stringify(manifest)
		);
		await Trellis.File.putContentsAsync(
			OS.Path.join(dictDir, locale + '.dic'),
			"1\n0/nm"
		);
		var path = OS.Path.join(dir, id + '.xpi');
		await Trellis.File.zipDirectory(extDir, path);
		return path;
	}
	
	before(async function () {
		// Make fake installed dictionaries
		enGBXPIOld = await makeFakeDictionary({
			id: '@fake-en-GB-dictionary',
			locale: 'en-GB',
			version: 5,
			name: "Fake English UK Dictionary"
		});
		frFRv1XPI = await makeFakeDictionary({
			id: '@fake-fr-FR-dictionary',
			locale: 'fr-FR',
			version: 1,
			name: "Fake French Dictionary"
		});
		unKNXPI = await makeFakeDictionary({
			id: '@fake-unknown-dictionary',
			locale: 'xx-UN',
			version: 5,
			name: "Fake Unknown Dictionary"
		});
		// Make fake updated dictionaries
		enGBXPINew = await makeFakeDictionary({
			id: '@another-fake-en-GB-dictionary',
			locale: 'en-GB',
			version: 1,
			name: "Another Fake English UK Dictionary"
		});
		frFRv2XPI = await makeFakeDictionary({
			id: '@fake-fr-FR-dictionary',
			locale: 'fr-FR',
			version: 2,
			name: "Fake French Dictionary"
		});
	});
	
	beforeEach(async function () {
		for (let id of Trellis.Dictionaries.dictionaries.map(x => x.id)) {
			await Trellis.Dictionaries.remove(id);
		}
		
		sandbox.stub(Trellis.File, 'download').callsFake(async (url, downloadPath) => {
			Trellis.debug("Fake downloading " + url);
			if (url.includes('en-GB')) {
				return OS.File.copy(enGBXPIOld, downloadPath);
			}
			if (url.includes('fr-FR')) {
				return OS.File.copy(frFRv1XPI, downloadPath);
			}
			if (url.includes('xx-UN')) {
				return OS.File.copy(unKNXPI, downloadPath);
			}
			throw new Error("Unexpected URL " + url);
		});
		await Trellis.Dictionaries.install('@fake-en-GB-dictionary', "5");
		await Trellis.Dictionaries.install('@fake-fr-FR-dictionary', "1");
		await Trellis.Dictionaries.install('@fake-xx-UN-dictionary', "5");
		sandbox.restore();
		
		// Create metadata response for available dictionaries
		sandbox.stub(Trellis.Dictionaries, 'fetchDictionariesList')
			.resolves([
				{
					id: '@another-fake-en-GB-dictionary',
					locale: 'en-GB',
					name: "English (UK)",
					version: 1
				},
				{
					id: '@fake-fr-FR-dictionary',
					locale: 'fr-FR',
					name: "Français",
					version: 2
				}
			]);
		
		sandbox.stub(Trellis.File, 'download').callsFake(async (url, downloadPath) => {
			Trellis.debug("Fake downloading " + url);
			if (url.includes('en-GB') && url.includes("-1.xpi")) {
				return OS.File.copy(enGBXPINew, downloadPath);
			}
			if (url.includes('fr-FR') && url.includes("-2.xpi")) {
				return OS.File.copy(frFRv2XPI, downloadPath);
			}
			throw new Error("Unexpected URL " + url);
		});
	});
	
	afterEach(function () {
		sandbox.restore();
	});
	
	describe("Trellis.Dictionaries", function () {
		describe("#update()", function () {
			it("should update outdated dictionary and replace an installed dictionary with a new one with a different id", async function () {
				var numDictionaries = Trellis.Dictionaries.dictionaries.length;
				function updated() {
					return !!(
						!Trellis.Dictionaries.dictionaries.find(x => x.id == '@fake-en-GB-dictionary')
							&& Trellis.Dictionaries.dictionaries.find(x => x.id == '@another-fake-en-GB-dictionary')
							// Version update happens too
							&& !Trellis.Dictionaries.dictionaries.find(x => x.id == '@fake-fr-FR-dictionary' && x.version == 1)
							&& Trellis.Dictionaries.dictionaries.find(x => x.id == '@fake-fr-FR-dictionary' && x.version == 2)
					);
				}
				assert.isFalse(updated());
				await Trellis.Dictionaries.update();
				assert.isTrue(updated());
				assert.lengthOf(Trellis.Dictionaries.dictionaries, numDictionaries);
			});
		});
	});
	
	describe("Dictionary Manager", function () {
		beforeEach(async function () {
			win = Services.ww.openWindow(
				null,
				'chrome://trellis/content/dictionaryManager.xhtml',
				'dictionary-manager',
				'chrome,centerscreen',
				{}
			);
			while (!win.document.querySelectorAll('input[type="checkbox"]').length) {
				await Trellis.Promise.delay(50);
			}
		});
		
		afterEach(function () {
			win.close();
		});
		
		it("should show unknown dictionary as installed", async function () {
			var elems = win.document.querySelectorAll('input[type="checkbox"]');
			var names = [...elems].map(elem => elem.dataset.dictName);
			assert.sameMembers(names, ['English (UK)', 'Français', 'xx (UN)']);
		});
		
		it("should update outdated dictionary and replace an installed dictionary with a new one with a different id", async function () {
			var numDictionaries = Trellis.Dictionaries.dictionaries.length;
			function updated() {
				return !!(
					!Trellis.Dictionaries.dictionaries.find(x => x.id == '@fake-en-GB-dictionary')
						&& Trellis.Dictionaries.dictionaries.find(x => x.id == '@another-fake-en-GB-dictionary')
						// Version update happens too
						&& !Trellis.Dictionaries.dictionaries.find(x => x.id == '@fake-fr-FR-dictionary' && x.version == 1)
						&& Trellis.Dictionaries.dictionaries.find(x => x.id == '@fake-fr-FR-dictionary' && x.version == 2)
				);
			}
			assert.isFalse(updated());
			win.document.querySelector('button[dlgtype="accept"]').click();
			while (!updated()) {
				await Trellis.Promise.delay(50);
			}
			assert.lengthOf(Trellis.Dictionaries.dictionaries, numDictionaries);
		});
	});
});
