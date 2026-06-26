"use strict";

describe("Trellis.Sync.Storage.Request", function () {
	describe("#run()", function () {
		it("should run a request and wait for it to complete", async function () {
			var libraryID = Trellis.Libraries.userLibraryID;
			var count = 0;
			var item = await importFileAttachment('test.png');
			var request = new Trellis.Sync.Storage.Request({
				type: 'download',
				libraryID,
				name: `${item.libraryID}/${item.key}`,
				onStart: async function () {
					await Trellis.Promise.delay(25);
					count++;
					return new Trellis.Sync.Storage.Result;
				}
			});
			var results = await request.start();
			assert.equal(count, 1);
		})
	})
})
