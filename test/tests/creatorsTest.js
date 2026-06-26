"use strict";

describe("Trellis.Creators", function () {
	describe("#getIDFromData()", function () {
		it("should create creator and cache data", async function () {
			var data1 = {
				firstName: "First",
				lastName: "Last"
			};
			var creatorID;
			await Trellis.DB.executeTransaction(async function () {
				creatorID = await Trellis.Creators.getIDFromData(data1, true);
			});
			assert.typeOf(creatorID, 'number');
			var data2 = Trellis.Creators.get(creatorID);
			assert.isObject(data2);
			assert.propertyVal(data2, "firstName", data1.firstName);
			assert.propertyVal(data2, "lastName", data1.lastName);
		});
	});
	
	describe("#cleanData()", function () {
		it("should allow firstName to be null for fieldMode 1", async function () {
			var data = Trellis.Creators.cleanData({
				firstName: null,
				lastName: "Test",
				fieldMode: 1
			});
			assert.propertyVal(data, 'fieldMode', 1);
			assert.propertyVal(data, 'firstName', '');
			assert.propertyVal(data, 'lastName', 'Test');
		});
	});
});
