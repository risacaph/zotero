function runHandler(url) {
	var [_, extension] = url.match(/^trellis:\/\/([a-z]+)\//);
	var handler = Services.io.getProtocolHandler('trellis').wrappedJSObject;
	var uri = Services.io.newURI(url, null, null);
	return handler._extensions['trellis://' + extension].newChannel(uri);
}

describe("Protocol Handler", function () {
	var win;
	var zp;
	
	before(async function () {
		win = await loadTrellisPane();
		zp = win.TrellisPane;
	});
	
	after(function () {
		win.close();
	});
	
	describe("trellis://select", function () {
		async function waitForItemSelect(items) {
			if (items instanceof Trellis.Item) {
				items = [items];
			}
			while (true) {
				let selected = zp.getSelectedItems();
				if (selected.every(item => items.includes(item))) {
					return;
				}
				await Trellis.Promise.delay(20);
			}
		}
		
		it("should select an item", async function () {
			var item1 = await createDataObject('item', { title: 'A' });
			var item2 = await createDataObject('item', { title: 'B' });
			runHandler(`trellis://select/library/items/${item1.key}`);
			await waitForItemSelect(item1);
		});
		
		it("should select multiple items", async function () {
			var item1 = await createDataObject('item', { title: 'A' });
			var item2 = await createDataObject('item', { title: 'B' });
			var item3 = await createDataObject('item', { title: 'C' });
			runHandler(`trellis://select/library/items?itemKey=${item1.key},${item2.key}`);
			await waitForItemSelect([item1, item2]);
		});
	});
});