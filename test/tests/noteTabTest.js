describe("Note Tab", function () {
	var win, doc, TrellisPane, Trellis_Tabs, TrellisContextPane;

	before(async function () {
		win = await loadTrellisPane();
		doc = win.document;
		TrellisPane = win.TrellisPane;
		Trellis_Tabs = win.Trellis_Tabs;
		TrellisContextPane = win.TrellisContextPane;
	});
	
	after(function () {
		Trellis_Tabs.closeAll();
		win.close();
	});

	describe("Note Tab Operations", function () {
		beforeEach(function () {
			// Reset the state before each test
			Trellis_Tabs.closeAll();
		});

		it("should open note in tab", async function () {
			let item = new Trellis.Item('note');
			item.setNote('This is a test note.');
			await item.saveTx();

			let editorInstance = await Trellis.Notes.open(item.id);

			assert.isNotNull(editorInstance, "Note editor should be opened");
			assert.equal(editorInstance.itemID, item.id, "Note editor should be associated with the correct item");

			let sameNoteEditor = await Trellis.Notes.open(item.id, undefined, {
				tabID: Trellis_Tabs.selectedID,
			});
			assert.equal(editorInstance, sameNoteEditor, "Opening the same note should return the existing editor");

			let duplicateEditorInstance = await Trellis.Notes.open(item.id, undefined, {
				allowDuplicate: true,
			});

			assert.isNotNull(duplicateEditorInstance, "Duplicate note editor should be opened");
			assert.notEqual(editorInstance, duplicateEditorInstance, "Duplicate note editor should be a new instance");
			assert.equal(duplicateEditorInstance.itemID, item.id, "Duplicate note editor should be associated with the correct item");

			Trellis_Tabs.closeAll();

			await waitForCallback(
				() => !Trellis.Notes._editorInstances.find(e => e.tabID),
				100, 10);

			await Trellis.Notes.open(item.id, undefined, {
				openInBackground: true,
			});

			assert.equal(Trellis_Tabs.selectedType, 'library', "Tab should be opened in background");
		});

		it("should open unloaded note tab", async function () {
			// https://forums.trellis.org/discussion/128954/
			let item = new Trellis.Item("note");
			item.setNote("This is a test note.");
			await item.saveTx();

			let editorInstance = await Trellis.Notes.open(item.id);
			let tabID = editorInstance.tabID;
			Trellis_Tabs.unload(tabID);

			let editor2 = await TrellisPane.openNote(item.id);

			assert.equal(editorInstance, editor2, "Unloaded note tab should be reloaded");
		});

		it("should select opened note tab", async function () {
			// https://forums.trellis.org/discussion/128917/
			let item = new Trellis.Item("note");
			item.setNote("This is a test note.");
			await item.saveTx();

			let editorInstance = await Trellis.Notes.open(item.id);
			let tabID = editorInstance.tabID;

			let promise = waitForNotifierEvent("select", "tab");
			
			Trellis_Tabs.select("trellis-pane");
			await promise;

			promise = waitForNotifierEvent("select", "tab");

			let editor2 = await TrellisPane.openNote(item.id);
			await promise;

			assert.equal(Trellis_Tabs.selectedID, tabID, "Should select the opened note tab");
			assert.equal(editor2, editorInstance, "Should return the same editor instance");
		});
	});
});
