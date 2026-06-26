"use strict";

describe("Note Editor", function () {
	var win, zp;
	
	before(function* () {
		win = yield loadTrellisPane();
		zp = win.TrellisPane;
	});
	
	after(function () {
		win.close();
	});
	
	var waitForNoteEditor = async function (item) {
		var noteEditor = win.document.getElementById('trellis-note-editor');
		while (noteEditor.item != item) {
			Trellis.debug("Waiting for note editor");
			await Trellis.Promise.delay(50);
			noteEditor = win.document.getElementById('trellis-note-editor');
		}
		return new Trellis.Promise((resolve, reject) => {
			noteEditor.onInit(() => resolve(noteEditor));
		});
	};
});
