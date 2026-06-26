describe("Trellis.Schema", function () {
	describe("#initializeSchema()", function () {
		it("should set last client version", async function () {
			await resetDB({
				thisArg: this,
				skipBundledFiles: true
			});
			
			var sql = "SELECT value FROM settings WHERE setting='client' AND key='lastVersion'";
			var lastVersion = await Trellis.DB.valueQueryAsync(sql);
			assert.equal(await Trellis.DB.valueQueryAsync(sql), Trellis.version);
		});
	});
	
	describe("#updateSchema()", function () {
		it("should set last client version", async function () {
			var sql = "REPLACE INTO settings (setting, key, value) VALUES ('client', 'lastVersion', ?)";
			await Trellis.DB.queryAsync(sql, "5.0old");
			
			await Trellis.Schema.updateSchema();
			
			var sql = "SELECT value FROM settings WHERE setting='client' AND key='lastVersion'";
			var lastVersion = await Trellis.DB.valueQueryAsync(sql);
			assert.equal(await Trellis.DB.valueQueryAsync(sql), Trellis.version);
		});
	});
	
	describe("Global Schema", function () {
		var schemaJSON, schema;
		
		before(async function () {
			schemaJSON = await Trellis.File.getResourceAsync('resource://trellis/schema/global/schema.json');
		});
		
		beforeEach(async function () {
			await resetDB({
				thisArg: this,
				skipBundledFiles: true
			});
			schema = JSON.parse(schemaJSON);
		});
		
		after(async function () {
			await resetDB({
				thisArg: this,
				skipBundledFiles: true
			});
		});
		
		describe("#migrateExtraFields()", function () {
			async function migrate() {
				schema.version++;
				schema.itemTypes.find(x => x.itemType == 'book').fields.splice(0, 1, { field: 'fooBar' })
				var newLocales = {};
				Object.keys(schema.locales).forEach((locale) => {
					var o = schema.locales[locale];
					o.fields.fooBar = 'Foo Bar';
					newLocales[locale] = o;
				});
				await Trellis.Schema._updateGlobalSchemaForTest(schema);
				await Trellis.Schema.migrateExtraFields();
			}
			
			it("should add a new field and migrate values from Extra", async function () {
				var item = await createDataObject('item', { itemType: 'book' });
				item.setField('numPages', "10");
				item.setField('extra', 'Foo Bar: This is a value.\nnumber-of-pages: 11\nThis is another line.');
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				assert.isNumber(Trellis.ItemFields.getID('fooBar'));
				assert.equal(Trellis.ItemFields.getLocalizedString('fooBar'), 'Foo Bar');
				assert.equal(item.getField('fooBar'), 'This is a value.');
				// Existing fields shouldn't be overwritten and should be left in Extra
				assert.equal(item.getField('numPages'), '10');
				assert.equal(item.getField('extra'), 'number-of-pages: 11\nThis is another line.');
				assert.isFalse(item.synced);
			});
			
			it("should migrate valid creator", async function () {
				var item = await createDataObject('item', { itemType: 'book' });
				item.setCreators([
					{
						firstName: 'Abc',
						lastName: 'Def',
						creatorType: 'author',
						fieldMode: 0
					}
				]);
				item.setField('extra', 'editor: Last || First\nFoo: Bar');
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				var creators = item.getCreators();
				assert.lengthOf(creators, 2);
				assert.propertyVal(creators[0], 'firstName', 'Abc');
				assert.propertyVal(creators[0], 'lastName', 'Def');
				assert.propertyVal(creators[0], 'creatorTypeID', Trellis.CreatorTypes.getID('author'));
				assert.propertyVal(creators[1], 'firstName', 'First');
				assert.propertyVal(creators[1], 'lastName', 'Last');
				assert.propertyVal(creators[1], 'creatorTypeID', Trellis.CreatorTypes.getID('editor'));
				assert.equal(item.getField('extra'), 'Foo: Bar');
				assert.isFalse(item.synced);
			});
			
			it("shouldn't migrate creator not valid for item type", async function () {
				var item = await createDataObject('item', { itemType: 'book' });
				item.setCreators([
					{
						firstName: 'Abc',
						lastName: 'Def',
						creatorType: 'author',
						fieldMode: 0
					}
				]);
				item.setField('extra', 'container-author: Last || First\nFoo: Bar');
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				var creators = item.getCreators();
				assert.lengthOf(creators, 1);
				assert.propertyVal(creators[0], 'firstName', 'Abc');
				assert.propertyVal(creators[0], 'lastName', 'Def');
				assert.propertyVal(creators[0], 'creatorTypeID', Trellis.CreatorTypes.getID('author'));
				assert.equal(item.getField('extra'), 'container-author: Last || First\nFoo: Bar');
				assert.isTrue(item.synced);
			});
			
			it("shouldn't migrate fields in read-only library", async function () {
				var library = await createGroup({ editable: false, filesEditable: false });
				var item = createUnsavedDataObject('item', { libraryID: library.libraryID, itemType: 'book' });
				item.setField('extra', 'Foo Bar: This is a value.');
				item.synced = true;
				await item.saveTx({
					skipEditCheck: true
				});
				
				await migrate();
				
				assert.isNumber(Trellis.ItemFields.getID('fooBar'));
				assert.equal(item.getField('fooBar'), '');
				assert.equal(item.getField('extra'), 'Foo Bar: This is a value.');
				assert.isTrue(item.synced);
			});
			
			it("should change item type if 'type:' is defined", async function () {
				var item = await createDataObject('item', { itemType: 'document' });
				item.setField('extra', 'type: personal_communication');
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				assert.equal(item.itemTypeID, Trellis.ItemTypes.getID('letter'));
				assert.equal(item.getField('extra'), '');
				assert.isFalse(item.synced);
			});
			
			it("should remove 'type:' line for CSL type if item is the first mapped Trellis type", async function () {
				var item = await createDataObject('item', { itemType: 'letter' });
				item.setField('extra', 'type: personal_communication');
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				assert.equal(item.itemTypeID, Trellis.ItemTypes.getID('letter'));
				assert.equal(item.getField('extra'), '');
				assert.isFalse(item.synced);
			});
			
			it("should remove 'type:' line for CSL type if item is a non-primary mapped Trellis type", async function () {
				var item = await createDataObject('item', { itemType: 'instantMessage' });
				item.setField('extra', 'type: personal_communication');
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				assert.equal(item.itemTypeID, Trellis.ItemTypes.getID('instantMessage'));
				assert.equal(item.getField('extra'), '');
				assert.isFalse(item.synced);
			});
			
			it("should move existing fields that would be invalid in the new 'type:' type to Extra", async function () {
				var item = await createDataObject('item', { itemType: 'book' });
				item.setField('numPages', '123');
				item.setField('extra', 'type: article-journal\nJournal Abbreviation: abc.\nnumPages: 234');
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				assert.equal(item.itemTypeID, Trellis.ItemTypes.getID('journalArticle'));
				assert.equal(item.getField('journalAbbreviation'), 'abc.');
				// Migrated real field should be placed at beginning, followed by unused line from Extra
				assert.equal(item.getField('extra'), 'Num Pages: 123\nnumPages: 234');
				assert.isFalse(item.synced);
			});
			
			it("shouldn't migrate invalid item type", async function () {
				var item = await createDataObject('item', { itemType: 'book' });
				item.setField('numPages', 30);
				item.setCreators(
					[
						{
							firstName: 'Abc',
							lastName: 'Def',
							creatorType: 'author',
							fieldMode: 0
						},
						{
							firstName: 'Ghi',
							lastName: 'Jkl',
							creatorType: 'author',
							fieldMode: 0
						}
					]
				);
				item.setField('extra', 'type: invalid');
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				assert.equal(item.getField('numPages'), 30);
				var creators = item.getCreators();
				assert.lengthOf(creators, 2);
				assert.equal(item.itemTypeID, Trellis.ItemTypes.getID('book'));
				assert.equal(item.getField('extra'), 'type: invalid');
				assert.isTrue(item.synced);
			});
			
			it("shouldn't migrate certain fields temporarily", async function () {
				var item = await createDataObject('item', { itemType: 'book' });
				var extra = 'event-place: Event Place\npublisher-place: Publisher Place\nIssued: 2020/2023';
				item.setField('extra', extra);
				item.synced = true;
				await item.saveTx();
				
				await migrate();
				
				assert.equal(item.getField('place'), '');
				assert.equal(item.getField('date'), '');
				assert.equal(item.getField('extra'), extra);
			});
		});
	});
	
	
	describe("Repository Check", function () {
		describe("Notices", function () {
			var win;
			var server;
			
			before(async function () {
				// We need bundled files
				await resetDB({
					thisArg: this
				});
				
				win = await loadTrellisPane();
			});
			
			beforeEach(function () {
				Trellis.HTTP.mock = sinon.FakeXMLHttpRequest;
				server = sinon.fakeServer.create();
				server.autoRespond = true;
			});
			
			afterEach(function () {
				Trellis.Prefs.clear('hiddenNotices');
			});
			
			after(function () {
				win.close();
				Trellis.HTTP.mock = null;
			});
			
			function createResponseWithMessage(message) {
				server.respond(function (req) {
					if (req.method != "POST" || !req.url.includes('/repo/updated')) {
						return;
					}
					req.respond(
						200,
						{
							"Content-Type": "application/xml"
						},
						'<xml>'
							+ '<currentTime>1630219842</currentTime>'
							+ message
							+ '</xml>'
					);
				});
			}
			
			it("should show dialog if repo returns a message", async function () {
				createResponseWithMessage(
					`<message infoURL="https://example.com">This is a warning</message>`
				);
				
				var promise = waitForDialog(function (dialog) {
					var html = dialog.document.documentElement.outerHTML;
					assert.include(html, "This is a warning");
				});
				await Trellis.Schema.updateFromRepository(3);
				await promise;
				
				// Don't show id-less message again for a day
				var spy = sinon.spy(Trellis, 'debug');
				await Trellis.Schema.updateFromRepository(3);
				assert.notEqual(spy.args.findIndex(x => {
					return typeof x[0] == 'string' && x[0].startsWith("Not showing hidden");
				}), -1);
				spy.restore();
			});
			
			it("shouldn't show message with id again for 1 day even if not hidden", async function () {
				var id = Trellis.Utilities.randomString();
				createResponseWithMessage(
					`<message id="${id}" infoURL="https://example.com">This is a warning</message>`
				);
				
				var promise = waitForDialog();
				await Trellis.Schema.updateFromRepository(3);
				await promise;
				
				// Make sure notice is hidden for 1 day
				var hiddenNotices;
				var tries = 0;
				var ttl = 86400;
				while (tries < 100) {
					tries++;
					hiddenNotices = Trellis.Prefs.get('hiddenNotices');
					if (!hiddenNotices) {
						await Trellis.Promise.delay(10);
						continue;
					}
					hiddenNotices = JSON.parse(hiddenNotices);
					assert.property(hiddenNotices, id);
					assert.approximately(hiddenNotices[id], Math.round(Date.now() / 1000) + ttl, 10);
					break;
				}
			});
			
			it("shouldn't show message with id again for 30 days", async function () {
				var id = Trellis.Utilities.randomString();
				createResponseWithMessage(
					`<message id="${id}" infoURL="https://example.com">This is a warning</message>`
				);
				
				var promise = waitForDialog(function (dialog) {
					var doc = dialog.document;
					var innerHTML = doc.documentElement.innerHTML;
					assert.include(innerHTML, "This is a warning");
					assert.include(innerHTML, Trellis.getString('general.dontShowAgainFor', 30, 30));
					// Check "Don't show again"
					doc.getElementById('checkbox').click();
				});
				await Trellis.Schema.updateFromRepository(3);
				await promise;
				
				// Make sure notice is hidden for 30 days
				var hiddenNotices;
				var tries = 0;
				var ttl = 30 * 86400;
				while (tries < 100) {
					tries++;
					hiddenNotices = Trellis.Prefs.get('hiddenNotices');
					if (!hiddenNotices) {
						await Trellis.Promise.delay(10);
						continue;
					}
					hiddenNotices = JSON.parse(hiddenNotices);
					assert.property(hiddenNotices, id);
					assert.approximately(hiddenNotices[id], Math.round(Date.now() / 1000) + ttl, 10);
					break;
				}
			});
			
			it("shouldn't show message with id if before expiration", async function () {
				var id = Trellis.Utilities.randomString();
				createResponseWithMessage(
					`<message id="${id}" infoURL="https://example.com">This is a warning</message>`
				);
				
				// Set expiration for 30 days from now
				var ttl = 30 * 86400;
				Trellis.Prefs.set(
					'hiddenNotices',
					JSON.stringify({
						[id]: Math.round(Date.now() / 1000) + ttl
					})
				);
				
				// Message should be hidden
				var spy = sinon.spy(Trellis, 'debug');
				await Trellis.Schema.updateFromRepository(3);
				assert.notEqual(spy.args.findIndex(x => {
					return typeof x[0] == 'string' && x[0].startsWith("Not showing hidden");
				}), -1);
				spy.restore();
			});
		});
	});
	
	
	describe("#integrityCheck()", function () {
		before(function* () {
			yield resetDB({
				thisArg: this,
				skipBundledFiles: true
			});
		})
		
		it("should create missing tables unless 'skipReconcile' is true", async function () {
			await Trellis.DB.queryAsync("DROP TABLE retractedItems");
			assert.isFalse(await Trellis.DB.tableExists('retractedItems'));
			assert.isTrue(await Trellis.Schema.integrityCheck(false, { skipReconcile: true }));
			
			assert.isFalse(await Trellis.Schema.integrityCheck());
			assert.isTrue(await Trellis.Schema.integrityCheck(true));
			assert.isTrue(await Trellis.DB.tableExists('retractedItems'));
		});
		
		it("should repair a foreign key violation", async function () {
			assert.isTrue(await Trellis.Schema.integrityCheck());
			
			await Trellis.DB.queryAsync("PRAGMA foreign_keys = OFF");
			await Trellis.DB.queryAsync("INSERT INTO itemTags VALUES (1234,1234,0)");
			await Trellis.DB.queryAsync("PRAGMA foreign_keys = ON");
			
			assert.isFalse(await Trellis.Schema.integrityCheck());
			assert.isTrue(await Trellis.Schema.integrityCheck(true));
			assert.isTrue(await Trellis.Schema.integrityCheck());
		})
		
		it("should repair invalid nesting between two collections", async function () {
			var c1 = await createDataObject('collection');
			var c2 = await createDataObject('collection', { parentID: c1.id });
			await Trellis.DB.queryAsync(
				"UPDATE collections SET parentCollectionID=? WHERE collectionID=?",
				[c2.id, c1.id]
			);
			
			await assert.isFalse(await Trellis.Schema.integrityCheck());
			await assert.isTrue(await Trellis.Schema.integrityCheck(true));
			await assert.isTrue(await Trellis.Schema.integrityCheck());
		});
		
		it("should repair invalid nesting between three collections", async function () {
			var c1 = await createDataObject('collection');
			var c2 = await createDataObject('collection', { parentID: c1.id });
			var c3 = await createDataObject('collection', { parentID: c2.id });
			await Trellis.DB.queryAsync(
				"UPDATE collections SET parentCollectionID=? WHERE collectionID=?",
				[c3.id, c2.id]
			);
			
			await assert.isFalse(await Trellis.Schema.integrityCheck());
			await assert.isTrue(await Trellis.Schema.integrityCheck(true));
			await assert.isTrue(await Trellis.Schema.integrityCheck());
		});
		
		it("should allow embedded-image attachments under notes", async function () {
			var item = await createDataObject('item', { itemType: 'note' });
			await createEmbeddedImage(item);
			await assert.isTrue(await Trellis.Schema.integrityCheck());
		});
	})
	
	describe("Database Upgrades", function () {
		after(async function () {
			await resetDB({
				thisArg: this,
				skipBundledFiles: true,
			});
		});
		
		it("should upgrade 4.0 database", async function () {
			await resetDB({
				thisArg: this,
				skipBundledFiles: true,
				dbFile: OS.Path.join(getTestDataDirectory().path, 'trellis-4.0.sqlite.zip')
			});
			// Make sure we can open the Trellis pane without errors
			win = await loadTrellisPane();
			win.close();
		});
	});
})
