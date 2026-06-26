describe("Trellis_Tabs", function() {
	var win, doc, zp;

	before(async function () {
		win = await loadTrellisPane();
		doc = win.document;
		zp = win.TrellisPane;
	});

	after(function () {
		win.close();
	});

	describe("Title rendering", function () {
		it("should render citeproc.js markup in a tab title", async function () {
			let item = await createDataObject('item', {
				title: 'Not italic, <i>italic</i>'
			});
			let attachment = await importPDFAttachment(item);
			let reader = await Trellis.Reader.open(attachment.id);
			let tab;
			while (!tab?.textContent.includes('Not italic, italic')) {
				await Trellis.Promise.delay(10);
				tab = doc.querySelector(`#tab-bar-container .tab[data-id="${reader.tabID}"]`);
			}
			assert.include(tab.querySelector('i').textContent, 'italic');
		});
		
		it("should not render unknown markup in a tab title", async function () {
			let item = await createDataObject('item', {
				title: 'Something bad <img src="missing.jpg" onerror="alert(1)">'
			});
			let attachment = await importPDFAttachment(item);
			let reader = await Trellis.Reader.open(attachment.id);
			let tab;
			while (!tab?.textContent.includes('Something bad <img src="missing.jpg" onerror="alert(1)">')) {
				await Trellis.Promise.delay(10);
				tab = doc.querySelector(`#tab-bar-container .tab[data-id="${reader.tabID}"]`);
			}
			assert.notOk(tab.querySelector('img'));
		});
	});
});
