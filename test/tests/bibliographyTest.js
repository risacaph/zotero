"use strict";

describe("Create Bibliography Dialog", function () {
	var win, zp;
	
	before(async function () {
		win = await loadTrellisPane();
		await Trellis.Styles.init();
		zp = win.TrellisPane;
	});
	
	after(function () {
		win.close();
	});
	
	it("should remap renamed style IDs to their current IDs", async function () {
		await createDataObject('item');
		
		let styleID;
		
		var deferred = Trellis.Promise.defer();
		waitForWindow("chrome://trellis/content/bibliography.xhtml", function (dialog) {
			(async function () {
				await dialog.isLoadedPromise;
				let styleSelector = dialog.document.getElementById('style-selector');
				// Set the value to an old/renamed style ID
				styleSelector.value = "chicago-fullnote-bibliography";
				// Should be remapped to the current style ID
				styleID = styleSelector.value;
				dialog.close();
				deferred.resolve();
			})();
		});
		await win.Trellis_File_Interface.bibliographyFromItems();
		await deferred.promise;

		assert.equal(styleID, "http://www.trellis.org/styles/chicago-notes-bibliography");
	});
	
	it("should open the Cite prefpane when Manage Styles… is clicked", async function () {
		var item = await createDataObject('item');
		
		var deferred = Trellis.Promise.defer();
		var called = false;
		waitForWindow("chrome://trellis/content/bibliography.xhtml", function (dialog) {
			waitForWindow("chrome://trellis/content/preferences/preferences.xhtml", function (window) {
				// Wait for switch to Cite pane
				(async function () {
					do {
						Trellis.debug("Checking for pane");
						await Trellis.Promise.delay(5);
					}
					while (!window.document.querySelector('[value=trellis-prefpane-cite]').selected);
					called = true;
					window.close();
					deferred.resolve();
				})();
			});
			dialog.document.getElementById('manage-styles').click();
		});
		await win.Trellis_File_Interface.bibliographyFromItems();
		await deferred.promise;
		
		assert.ok(called);
	});
});
