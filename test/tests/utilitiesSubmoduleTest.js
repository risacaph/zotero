describe("Trellis.Utilities.Item", function () {
	describe("itemToCSLJSON()", async function () {
		it("should accept Trellis.Item and Trellis export item format", async function () {
			let data = await populateDBWithSampleData(loadSampleData('journalArticle'));
			let item = await Trellis.Items.getAsync(data.journalArticle.id);
	
			let fromTrellisItem;
			try {
				fromTrellisItem = Trellis.Utilities.Item.itemToCSLJSON(item);
			}
			catch (e) {
				assert.fail(e, null, 'accepts Trellis Item');
			}
			assert.isObject(fromTrellisItem, 'converts Trellis Item to object');
			assert.isNotNull(fromTrellisItem, 'converts Trellis Item to non-null object');
	
	
			let fromExportItem;
			try {
				fromExportItem = Trellis.Utilities.Item.itemToCSLJSON(
					Trellis.Utilities.Internal.itemToExportFormat(item)
				);
			}
			catch (e) {
				assert.fail(e, null, 'accepts Trellis export item');
			}
			assert.isObject(fromExportItem, 'converts Trellis export item to object');
			assert.isNotNull(fromExportItem, 'converts Trellis export item to non-null object');
	
			assert.deepEqual(fromTrellisItem, fromExportItem, 'conversion from Trellis Item and from export item are the same');
		});
	});
});
