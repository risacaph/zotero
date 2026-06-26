"use strict";

describe("Trellis.Sync.EventListeners", function () {
	describe("ChangeListener", function () {
		it("should add items to sync delete log", async function () {
			var item = await createDataObject('item');
			await item.eraseTx();
			assert.ok(
				await Trellis.Sync.Data.Local.getDateDeleted('item', item.libraryID, item.key)
			);
		});
		
		it("shouldn't add items with `skipDeleteLog: true`", async function () {
			var item = await createDataObject('item');
			await item.eraseTx({
				skipDeleteLog: true
			});
			assert.isFalse(
				await Trellis.Sync.Data.Local.getDateDeleted('item', item.libraryID, item.key)
			);
		});
		
		// Technically skipped in Trellis.DataObject._finalizeErase(), which sets skipDeleteLog
		// based on the result of Sync.Data.Local.isSyncItem()
		it("shouldn't add non-syncing items to sync delete log", async function () {
			var attachment = await importFileAttachment('test.pdf');
			var annotation = await createAnnotation('image', attachment, { isExternal: true });
			await annotation.eraseTx();
			assert.isFalse(
				await Trellis.Sync.Data.Local.getDateDeleted(
					'item', attachment.libraryID, annotation.key
				)
			);
		});
	});
	
	describe("AutoSyncListener", function () {
		var originalTimeout;
		
		before(function () {
			originalTimeout = Trellis.Sync.EventListeners.AutoSyncListener._editTimeout;
			assert.ok(originalTimeout);
			// Set timeout to 1ms
			Trellis.Sync.EventListeners.AutoSyncListener._editTimeout = 0.001;
		});
		
		beforeEach(function () {
			Trellis.Prefs.set('sync.autoSync', true);
		});
		
		
		after(function () {
			Trellis.Sync.EventListeners.AutoSyncListener._editTimeout = originalTimeout;
			Trellis.Prefs.set('sync.autoSync', false);
			Trellis.Prefs.clear('sync.librariesToSkip');
		});
		
		
		it("should sync only changed library", async function () {
			var mock = sinon.mock(Trellis.Sync.Runner);
			var expectation = mock.expects("setSyncTimeout").once();
			
			var group = await createGroup();
			await createDataObject('item', { libraryID: group.libraryID });
			
			await Trellis.Promise.delay(10);
			mock.verify();
			assert.sameMembers(expectation.getCall(0).args[2].libraries, [group.libraryID]);
		});
		
		
		it("shouldn't sync skipped library", async function () {
			var mock = sinon.mock(Trellis.Sync.Runner);
			var expectation = mock.expects("setSyncTimeout").never();
			
			var group = await createGroup();
			Trellis.Prefs.set('sync.librariesToSkip', JSON.stringify(["G" + group.groupID]));
			await createDataObject('item', { libraryID: group.libraryID });
			
			await Trellis.Promise.delay(10);
			mock.verify();
		});
		
		it("should auto-sync after settings change", async function () {
			Trellis.Prefs.set('sync.autoSync', false);
			var attachment = await importFileAttachment('test.pdf');
			Trellis.Prefs.set('sync.autoSync', true);
			
			var mock = sinon.mock(Trellis.Sync.Runner);
			var expectation = mock.expects("setSyncTimeout").once();
			
			// Create setting (e.g., lastPageIndex_u_ABCD2345)
			await attachment.setAttachmentLastPageIndex(1);
			
			await Trellis.Promise.delay(10);
			mock.verify();
			assert.sameMembers(expectation.getCall(0).args[2].libraries, [Trellis.Libraries.userLibraryID]);
		});
		
		it("should auto-sync after item deletion", async function () {
			Trellis.Prefs.set('sync.autoSync', false);
			var item = await createDataObject('item');
			Trellis.Prefs.set('sync.autoSync', true);
			
			var mock = sinon.mock(Trellis.Sync.Runner);
			var expectation = mock.expects("setSyncTimeout").once();
			
			await item.eraseTx();
			
			await Trellis.Promise.delay(10);
			mock.verify();
			assert.sameMembers(expectation.getCall(0).args[2].libraries, [Trellis.Libraries.userLibraryID]);
		});
		
		it("should auto-sync after attachment reindex", async function () {
			Trellis.Prefs.set('sync.autoSync', false);
			var attachment = await importFileAttachment('test.pdf');
			Trellis.Prefs.set('sync.autoSync', true);
			
			var mock = sinon.mock(Trellis.Sync.Runner);
			var expectation = mock.expects("setSyncTimeout").once();
			
			await Trellis.Fulltext.indexItems(attachment.id);
			
			await Trellis.Promise.delay(10);
			mock.verify();
			assert.sameMembers(
				expectation.getCall(0).args[2].fullTextLibraries,
				[Trellis.Libraries.userLibraryID]
			);
		});
	});
});
