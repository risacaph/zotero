"use strict";

describe("Trellis.ItemFields", function () {
	describe("#getBaseIDFromTypeAndField()", function () {
		it("should return the base field id for an item type and base-mapped field", async function () {
			assert.equal(
				Trellis.ItemFields.getBaseIDFromTypeAndField('audioRecording', 'label'),
				Trellis.ItemFields.getID('publisher')
			);
			
			// Accept ids too
			assert.equal(
				Trellis.ItemFields.getBaseIDFromTypeAndField(
					Trellis.ItemTypes.getID('audioRecording'),
					Trellis.ItemFields.getID('label')
				),
				Trellis.ItemFields.getID('publisher')
			);
		})
		
		it("should return the base field id for an item type and base field", async function () {
			assert.equal(
				Trellis.ItemFields.getBaseIDFromTypeAndField('book', 'publisher'),
				Trellis.ItemFields.getID('publisher')
			);
		});
		
		it("should return the base field id for an item type and base field when type has a base-mapped field", function () {
			assert.equal(
				Trellis.ItemFields.getBaseIDFromTypeAndField('hearing', 'number'),
				Trellis.ItemFields.getID('number')
			);
		});
		
		it("should return false for an item type and non-base-mapped field", async function () {
			assert.isFalse(
				Trellis.ItemFields.getBaseIDFromTypeAndField('audioRecording', 'runningTime')
			);
		});
		
		it("should return false for invalid type-field combination", function () {
			assert.isFalse(
				Trellis.ItemFields.getBaseIDFromTypeAndField('note', 'runningTime')
			);
		});
	});
	
	describe("#getDirection()", function () {
		it("should follow app locale for primary field", function () {
			assert.equal(Trellis.ItemFields.getDirection('book', 'dateAdded', ''), Trellis.dir)
		});
		
		it("should use item language for non-field", function () {
			assert.equal(Trellis.ItemFields.getDirection('book', 'creator-0-lastName', 'ar'), 'rtl');
		});
	});
})
