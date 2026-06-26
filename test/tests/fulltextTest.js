describe("Trellis.FullText", function () {
	describe("Indexing", function () {
		beforeEach(function () {
			Trellis.Prefs.clear('fulltext.textMaxLength');
			Trellis.Prefs.clear('fulltext.pdfMaxPages');
		});
		after(function () {
			Trellis.Prefs.clear('fulltext.textMaxLength');
			Trellis.Prefs.clear('fulltext.pdfMaxPages');
		});
		
		describe("#indexItems()", function () {
			it("should index a text file by default", async function () {
				var item = await importFileAttachment('test.txt');
				assert.equal(
					((await Trellis.Fulltext.getIndexedState(item))),
					Trellis.Fulltext.INDEX_STATE_INDEXED
				);
			})
			
			it("should skip indexing of a text file if fulltext.textMaxLength is 0", async function () {
				Trellis.Prefs.set('fulltext.textMaxLength', 0);
				var item = await importFileAttachment('test.txt');
				assert.equal(
					((await Trellis.Fulltext.getIndexedState(item))),
					Trellis.Fulltext.INDEX_STATE_UNINDEXED
				);
			})
			
			it("should index a PDF by default", async function () {
				var item = await importFileAttachment('test.pdf');
				assert.equal(
					((await Trellis.Fulltext.getIndexedState(item))),
					Trellis.Fulltext.INDEX_STATE_INDEXED
				);
			})
			
			it("should skip indexing of a PDF if fulltext.textMaxLength is 0", async function () {
				Trellis.Prefs.set('fulltext.textMaxLength', 0);
				var item = await importFileAttachment('test.pdf');
				assert.equal(
					((await Trellis.Fulltext.getIndexedState(item))),
					Trellis.Fulltext.INDEX_STATE_UNINDEXED
				);
			})
			
			it("should skip indexing of a PDF if fulltext.pdfMaxPages is 0", async function () {
				Trellis.Prefs.set('fulltext.pdfMaxPages', 0);
				var item = await importFileAttachment('test.pdf');
				assert.equal(
					((await Trellis.Fulltext.getIndexedState(item))),
					Trellis.Fulltext.INDEX_STATE_UNINDEXED
				);
			})

			it("should skip indexing of an EPUB if fulltext.textMaxLength is 0", async function () {
				Trellis.Prefs.set('fulltext.textMaxLength', 0);
				var item = await importFileAttachment('recognizeEPUB_test_content.epub');
				assert.equal(
					((await Trellis.Fulltext.getIndexedState(item))),
					Trellis.Fulltext.INDEX_STATE_UNINDEXED
				);
			});

			it("should still work after the DB connection is reopened", async function () {
				var item = await importFileAttachment('test.txt');
				await Trellis.DB.vacuum({ force: true });
				await Trellis.Fulltext.indexItems([item.id]);
				assert.equal(
					((await Trellis.Fulltext.getIndexedState(item))),
					Trellis.Fulltext.INDEX_STATE_INDEXED
				);
			});

			describe("Indexing with HiddenBrowser", () => {
				it("should index attachment as its attachmentContentType when supported", async function () {
					// Firefox would normally load this as text/x-shellscript, but we detect text/plain
					let item = await importFileAttachment('test.sh');
					assert.equal(item.attachmentContentType, 'text/plain');
					assert.equal(await Trellis.Fulltext.getIndexedState(item), Trellis.Fulltext.INDEX_STATE_INDEXED);
				});

				it("should index attachment as text/plain when its text/* attachmentContentType is unsupported", async function () {
					// Now we force text/x-shellscript, which the HiddenBrowser would normally refuse to load
					// It should still load, because we fall back to text/plain from an unsupported text/* content type
					let item = await importFileAttachment('test.sh', { contentType: 'text/x-shellscript' });
					assert.equal(item.attachmentContentType, 'text/x-shellscript');
					assert.equal(await Trellis.Fulltext.getIndexedState(item), Trellis.Fulltext.INDEX_STATE_INDEXED);
				});

				it("should not index attachment with non-text attachmentContentType", async function () {
					let item = await importFileAttachment('test.txt', { contentType: 'image/png' });
					assert.equal(item.attachmentContentType, 'image/png');
					assert.equal(await Trellis.Fulltext.getIndexedState(item), Trellis.Fulltext.INDEX_STATE_UNINDEXED);
				});
			});
		});
		
		describe("#indexPDF()", function () {
			it("should create cache files for linked attachments in storage directory", async function () {
				var filename = 'test.pdf';
				var file = OS.Path.join(getTestDataDirectory().path, filename);
				var tempDir = await getTempDirectory();
				var linkedFile = OS.Path.join(tempDir, filename);
				await OS.File.copy(file, linkedFile);
				
				var item = await Trellis.Attachments.linkFromFile({ file: linkedFile });
				var storageDir = Trellis.Attachments.getStorageDirectory(item).path;
				assert.isTrue(await OS.File.exists(storageDir));
				assert.isTrue(await OS.File.exists(OS.Path.join(storageDir, '.trellis-ft-cache')));
				assert.isFalse(await OS.File.exists(OS.Path.join(storageDir, filename)));
			});

			it("should preserve the SDT cache when reindexing a linked attachment", async function () {
				var file = OS.Path.join(getTestDataDirectory().path, 'test.pdf');
				var linkedFile = OS.Path.join(await getTempDirectory(), 'test.pdf');
				await OS.File.copy(file, linkedFile);
				var item = await Trellis.Attachments.linkFromFile({ file: linkedFile });

				// The full-text cache of a linked file shares the item's
				// storage directory with the SDT cache, so reindexing must
				// not recreate the directory and destroy it
				var storageDir = Trellis.Attachments.getStorageDirectory(item).path;
				var sdtCacheFile = OS.Path.join(storageDir, '.trellis-sdt-cache');
				await Trellis.File.putContentsAsync(sdtCacheFile, 'test');

				assert.isTrue(await Trellis.Fulltext.indexPDF(linkedFile, item.id));
				assert.isTrue(await OS.File.exists(sdtCacheFile));
			});
		});
	});
	
	describe("#getUnsyncedContent()", function () {
		it("should get content that hasn't been uploaded", async function () {
			var toSync = [];
			var group = await getGroup();
			
			var add = async function (options = {}) {
				let item = await createDataObject('item', { libraryID: options.libraryID });
				let attachment = new Trellis.Item('attachment');
				if (options.libraryID) {
					attachment.libraryID = options.libraryID;
				}
				attachment.parentItemID = item.id;
				attachment.attachmentLinkMode = 'imported_file';
				attachment.attachmentContentType = 'text/plain';
				attachment.attachmentCharset = 'utf-8';
				attachment.attachmentFilename = 'test.txt';
				if (options.synced) {
					attachment.synced = true;
				}
				await attachment.saveTx();
				await Trellis.Attachments.createDirectoryForItem(attachment);
				
				let path = attachment.getFilePath();
				let content = new Array(10).fill("").map(x => Trellis.Utilities.randomString()).join(" ");
				await Trellis.File.putContentsAsync(path, content);
				
				if (!options.skip) {
					toSync.push({
						item: attachment,
						content,
						indexedChars: content.length,
						indexedPages: 0
					});
				}
			};
			await add({ synced: true });
			await add({ synced: true });
			// Unsynced attachment shouldn't uploaded
			await add({ skip: true });
			// Attachment in another library shouldn't be uploaded
			await add({ libraryID: group.libraryID, synced: true, skip: true });
			// PDF attachment
			var pdfAttachment = await importFileAttachment('test.pdf');
			pdfAttachment.synced = true;
			await pdfAttachment.saveTx();
			toSync.push({
				item: pdfAttachment,
				content: "Trellis [zoh-TAIR-oh] is a free, easy-to-use tool to help you collect, "
					+ "organize, cite, and share your research sources.",
				indexedChars: 0,
				indexedPages: 1
			});
			
			await Trellis.Fulltext.indexItems(toSync.map(x => x.item.id));
			
			var data = await Trellis.FullText.getUnsyncedContent(Trellis.Libraries.userLibraryID);
			assert.lengthOf(data, 3);
			let contents = toSync.map(x => x.content);
			
			for (let d of data) {
				assert.include(contents, d.content);
				let pos = contents.indexOf(d.content);
				assert.equal(d.indexedChars, toSync[pos].indexedChars);
				assert.equal(d.indexedPages, toSync[pos].indexedPages);
			}
		});
		
		it("should mark PDF attachment content as missing if cache file doesn't exist", async function () {
			var item = await importFileAttachment('test.pdf');
			item.synced = true;
			await item.saveTx();
			
			await Trellis.Fulltext.indexItems([item.id]);
			await OS.File.remove(Trellis.Fulltext.getItemCacheFile(item).path);
			
			var sql = "SELECT synced FROM fulltextItems WHERE itemID=?";
			var synced = await Trellis.DB.valueQueryAsync(sql, item.id);
			assert.equal(synced, Trellis.Fulltext.SYNC_STATE_UNSYNCED);
			var indexed = await Trellis.Fulltext.getIndexedState(item);
			assert.equal(indexed, Trellis.Fulltext.INDEX_STATE_INDEXED);
			
			await Trellis.Fulltext.getUnsyncedContent(item.libraryID);
			
			synced = await Trellis.DB.valueQueryAsync(sql, item.id);
			assert.equal(synced, Trellis.Fulltext.SYNC_STATE_MISSING);
			indexed = await Trellis.Fulltext.getIndexedState(item);
			assert.equal(indexed, Trellis.Fulltext.INDEX_STATE_UNINDEXED);
		});
	})
	
	describe("#setItemContent()", function () {
		before(() => {
			// Disable PDF indexing
			Trellis.Prefs.set('fulltext.pdfMaxPages', 0);
		});
		
		after(() => {
			// Re-enable PDF indexing
			Trellis.Prefs.clear('fulltext.pdfMaxPages');
		});
		
		it("should store data in .trellis-ft-unprocessed file", async function () {
			var item = await importFileAttachment('test.pdf');
			
			var processorCacheFile = Trellis.Fulltext.getItemProcessorCacheFile(item).path;
			
			var version = 5;
			await Trellis.Fulltext.setItemContent(
				item.libraryID,
				item.key,
				{
					content: "Test",
					indexedPages: 4,
					totalPages: 4
				},
				version
			);
			
			assert.equal(await Trellis.Fulltext.getItemVersion(item.id), 0);
			assert.equal(
				await Trellis.DB.valueQueryAsync("SELECT synced FROM fulltextItems WHERE itemID=?", item.id),
				Trellis.FullText.SYNC_STATE_TO_PROCESS
			);
			assert.isTrue(await OS.File.exists(processorCacheFile));
		});
		
		
		it("should update the version if the local version is 0 but the text matches", async function () {
			var item = await importFileAttachment('test.pdf');
			
			await Trellis.DB.queryAsync(
				"REPLACE INTO fulltextItems (itemID, version, indexedPages, totalPages, synced) "
					+ "VALUES (?, 0, 4, 4, ?)",
				[item.id, Trellis.FullText.SYNC_STATE_UNSYNCED]
			);
			
			var processorCacheFile = Trellis.FullText.getItemProcessorCacheFile(item).path;
			var itemCacheFile = Trellis.FullText.getItemCacheFile(item).path;
			await Trellis.File.putContentsAsync(itemCacheFile, "Test");
			
			var version = 5;
			await Trellis.FullText.setItemContent(
				item.libraryID,
				item.key,
				{
					content: "Test",
					indexedPages: 4,
					totalPages: 4
				},
				version
			);
			
			assert.equal(await Trellis.FullText.getItemVersion(item.id), version);
			assert.equal(
				await Trellis.DB.valueQueryAsync("SELECT synced FROM fulltextItems WHERE itemID=?", item.id),
				Trellis.FullText.SYNC_STATE_IN_SYNC
			);
			var { indexedPages, total } = await Trellis.FullText.getPages(item.id);
			assert.equal(indexedPages, 4);
			assert.equal(total, 4);
			assert.isFalse(await OS.File.exists(processorCacheFile));
		});
	});
	
	describe("#rebuildIndex()", function () {
		afterEach(() => {
			// Re-enable PDF indexing
			Trellis.Prefs.clear('fulltext.pdfMaxPages');
		});
		
		it("should process queued full-text content in indexedOnly mode", async function () {
			Trellis.Prefs.set('fulltext.pdfMaxPages', 0);
			var item = await importFileAttachment('test.pdf');
			Trellis.Prefs.clear('fulltext.pdfMaxPages');
			
			var version = 5;
			await Trellis.FullText.setItemContent(
				item.libraryID,
				item.key,
				{
					content: "Test",
					indexedPages: 4,
					totalPages: 4
				},
				version
			);
			
			var processorCacheFile = Trellis.FullText.getItemProcessorCacheFile(item).path;
			var itemCacheFile = Trellis.FullText.getItemCacheFile(item).path;
			
			assert.isTrue(await OS.File.exists(processorCacheFile));
			
			await Trellis.FullText.rebuildIndex(true);
			
			// .trellis-ft-unprocessed should have been deleted
			assert.isFalse(await OS.File.exists(processorCacheFile));
			// .trellis-ft-cache should now exist
			assert.isTrue(await OS.File.exists(itemCacheFile));
			
			assert.equal(await Trellis.FullText.getItemVersion(item.id), version);
			assert.equal(
				await Trellis.DB.valueQueryAsync("SELECT synced FROM fulltextItems WHERE itemID=?", item.id),
				Trellis.FullText.SYNC_STATE_IN_SYNC
			);
			var { indexedPages, total } = await Trellis.FullText.getPages(item.id);
			assert.equal(indexedPages, 4);
			assert.equal(total, 4);
		});
		
		it("should ignore queued full-text content in non-indexedOnly mode", async function () {
			Trellis.Prefs.set('fulltext.pdfMaxPages', 0);
			var item = await importFileAttachment('test.pdf');
			Trellis.Prefs.clear('fulltext.pdfMaxPages');
			
			var version = 5;
			await Trellis.FullText.setItemContent(
				item.libraryID,
				item.key,
				{
					content: "Test",
					indexedPages: 4,
					totalPages: 4
				},
				version
			);
			
			var processorCacheFile = Trellis.FullText.getItemProcessorCacheFile(item).path;
			var itemCacheFile = Trellis.FullText.getItemCacheFile(item).path;
			
			assert.isTrue(await OS.File.exists(processorCacheFile));
			
			await Trellis.FullText.rebuildIndex();
			
			// .trellis-ft-unprocessed should have been deleted
			assert.isFalse(await OS.File.exists(processorCacheFile));
			// .trellis-ft-cache should now exist
			assert.isTrue(await OS.File.exists(itemCacheFile));
			
			// Processor cache file shouldn't have been used, and full text should be marked for
			// syncing
			assert.equal(await Trellis.FullText.getItemVersion(item.id), 0);
			assert.equal(
				await Trellis.DB.valueQueryAsync(
					"SELECT synced FROM fulltextItems WHERE itemID=?",
					item.id
				),
				Trellis.FullText.SYNC_STATE_UNSYNCED
			);
			var { indexedPages, total } = await Trellis.FullText.getPages(item.id);
			assert.equal(indexedPages, 1);
			assert.equal(total, 1);
		});
		
		// This shouldn't happen, but before 5.0.85 items reindexed elsewhere could clear local stats
		it("shouldn't clear indexed items with missing file and no stats", async function () {
			Trellis.Prefs.set('fulltext.pdfMaxPages', 1);
			var item = await importFileAttachment('test.pdf');
			Trellis.Prefs.clear('fulltext.pdfMaxPages');
			
			var itemCacheFile = Trellis.FullText.getItemCacheFile(item).path;
			assert.isTrue(await OS.File.exists(itemCacheFile));
			
			var { indexedPages, total } = await Trellis.FullText.getPages(item.id);
			assert.equal(indexedPages, 1);
			assert.equal(total, 1);
			await Trellis.DB.queryAsync(
				"UPDATE fulltextItems SET indexedPages=NULL, totalPages=NULL WHERE itemID=?",
				item.id
			);
			
			await Trellis.FullText.rebuildIndex();
			
			// .trellis-ft-cache should still exist
			assert.isTrue(await OS.File.exists(itemCacheFile));
			
			assert.equal(
				await Trellis.DB.valueQueryAsync(
					"SELECT COUNT(*) FROM fulltextItems WHERE itemID=?",
					item.id
				),
				1
			);
		});
	});
})
