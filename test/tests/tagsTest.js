"use strict";

describe("Trellis.Tags", function () {
	describe("#getID()", function () {
		it("should return tag id", async function () {
			var tagName = Trellis.Utilities.randomString();
			var item = createUnsavedDataObject('item');
			item.addTag(tagName);
			await item.saveTx();
			
			assert.typeOf(Trellis.Tags.getID(tagName), "number");
		})

		it("should find a tag stored in a non-normalized form", async function () {
			// Random ASCII prefix + a combining acute accent, so the name is unique
			// per run but stored in a non-normalized (NFD) form
			var nfd = Trellis.Utilities.randomString() + 'e\u0301';
			var nfc = nfd.normalize();
			assert.notEqual(nfd, nfc);

			var item = await createDataObject('item');

			// Write the tag straight to the DB in non-normalized form, bypassing the
			// normalization that Trellis.Tags.create() performs, and attach it to the item
			var tagID = Trellis.ID.get('tags');
			await Trellis.DB.executeTransaction(async function () {
				await Trellis.DB.queryAsync(
					"INSERT INTO tags (tagID, name) VALUES (?, ?)", [tagID, nfd]
				);
				await Trellis.DB.queryAsync(
					"INSERT INTO itemTags (itemID, tagID, type) VALUES (?, ?, 0)",
					[item.id, tagID]
				);
			});

			// Rebuild the tag cache from the DB so it picks up the non-normalized name
			await Trellis.Tags.init();

			// getID() normalizes its lookup, so it should still match the stored tag
			assert.equal(Trellis.Tags.getID(nfc), tagID);
		})
	})

	describe("non-normalized tags", function () {
		// Tags loaded onto an item are normalized (NFC, trimmed), so removing a tag that's
		// stored in a non-normalized form requires getID() to resolve the normalized name.
		// Previously the id cache was keyed by the raw DB name, so getID() returned false,
		// and the false was bound as the tagID parameter -- "Invalid boolean parameter 1
		// 'false' [QUERY: DELETE FROM itemTags WHERE itemID=? AND tagID=? AND type=?]".
		it("should remove a tag stored in a non-normalized form without throwing", async function () {
			// Random ASCII prefix + a combining acute accent, so the name is unique
			// per run but stored in a non-normalized (NFD) form
			var nfd = Trellis.Utilities.randomString() + 'e\u0301';
			var nfc = nfd.normalize();
			assert.notEqual(nfd, nfc);

			var item = await createDataObject('item');

			var tagID = Trellis.ID.get('tags');
			await Trellis.DB.executeTransaction(async function () {
				await Trellis.DB.queryAsync(
					"INSERT INTO tags (tagID, name) VALUES (?, ?)", [tagID, nfd]
				);
				await Trellis.DB.queryAsync(
					"INSERT INTO itemTags (itemID, tagID, type) VALUES (?, ?, 0)",
					[item.id, tagID]
				);
			});

			await Trellis.Tags.init();
			await item.loadDataType('tags', true);

			// The loaded tag is normalized
			assert.sameDeepMembers(item.getTags(), [{ tag: nfc }]);

			item.removeTag(nfc);
			await item.saveTx();

			assert.lengthOf(item.getTags(), 0);
			var count = await Trellis.DB.valueQueryAsync(
				"SELECT COUNT(*) FROM itemTags WHERE itemID=?", item.id
			);
			assert.equal(count, 0);
		})
	})

	describe("#getName()", function () {
		it("should return tag id", async function () {
			var tagName = Trellis.Utilities.randomString();
			var item = createUnsavedDataObject('item');
			item.addTag(tagName);
			await item.saveTx();
			
			var libraryID = Trellis.Libraries.userLibraryID;
			var tagID = Trellis.Tags.getID(tagName);
			assert.equal(Trellis.Tags.getName(tagID), tagName);
		})
	})
	
	describe("#rename()", function () {
		it("should mark items as changed", async function () {
			var item1 = await createDataObject('item', { tags: [{ tag: "A" }], synced: true });
			var item2 = await createDataObject('item', { tags: [{ tag: "A" }, { tag: "B" }], synced: true });
			var item3 = await createDataObject('item', { tags: [{ tag: "B" }, { tag: "C" }], synced: true });
			
			await Trellis.Tags.rename(item1.libraryID, "A", "D");
			assert.isFalse(item1.synced);
			assert.isFalse(item2.synced);
			assert.isTrue(item3.synced);
		});
	});
	
	describe("#removeFromLibrary()", function () {
		it("should delete tags in given library", async function () {
			var libraryID = Trellis.Libraries.userLibraryID;
			var groupLibraryID = (await getGroup()).libraryID;
			
			var item1 = await createDataObject('item', { tags: [{ tag: 'a' }, { tag: 'b', type: 1 }] });
			var item2 = await createDataObject('item', { tags: [{ tag: 'b' }, { tag: 'c', type: 1 }] });
			var item3 = await createDataObject('item', { tags: [{ tag: 'd', type: 1 }] });
			var item4 = await createDataObject('item', { libraryID: groupLibraryID, tags: [{ tag: 'a' }, { tag: 'b', type: 1 }] });
			
			var tagIDs = ['a', 'd'].map(x => Trellis.Tags.getID(x));
			await Trellis.Tags.removeFromLibrary(libraryID, tagIDs);
			
			assert.sameDeepMembers(item1.getTags(), [{ tag: 'b', type: 1 }]);
			assert.sameDeepMembers(item2.getTags(), [{ tag: 'b' }, { tag: 'c', type: 1 }]);
			assert.lengthOf(item3.getTags(), 0);
			assert.equal(Trellis.Tags.getID('a'), tagIDs[0]);
			assert.isFalse(Trellis.Tags.getID('d'));
			
			// Group item should still have all tags
			assert.sameDeepMembers(item4.getTags(), [{ tag: 'a' }, { tag: 'b', type: 1 }]);
			assert.equal(
				await Trellis.DB.valueQueryAsync(
					"SELECT COUNT(*) FROM itemTags WHERE itemID=?",
					item4.id
				),
				2
			);
		});
		
		
		it("should remove tags of a given type", async function () {
			var libraryID = Trellis.Libraries.userLibraryID;
			var groupLibraryID = (await getGroup()).libraryID;
			
			var item1 = await createDataObject('item', { tags: [{ tag: 'a' }, { tag: 'b', type: 1 }] });
			var item2 = await createDataObject('item', { tags: [{ tag: 'b' }, { tag: 'c', type: 1 }] });
			var item3 = await createDataObject('item', { tags: [{ tag: 'd', type: 1 }] });
			var item4 = await createDataObject('item', { libraryID: groupLibraryID, tags: [{ tag: 'a' }, { tag: 'b', type: 1 }] });
			
			var tagIDs = ['a', 'b', 'c', 'd'].map(x => Trellis.Tags.getID(x));
			var tagType = 1;
			await Trellis.Tags.removeFromLibrary(libraryID, tagIDs, null, tagType);
			
			assert.sameDeepMembers(item1.getTags(), [{ tag: 'a' }]);
			assert.sameDeepMembers(item2.getTags(), [{ tag: 'b' }]);
			assert.lengthOf(item3.getTags(), 0);
			assert.isFalse(Trellis.Tags.getID('d'));
			
			// Group item should still have all tags
			assert.sameDeepMembers(item4.getTags(), [{ tag: 'a' }, { tag: 'b', type: 1 }]);
			assert.equal(
				await Trellis.DB.valueQueryAsync(
					"SELECT COUNT(*) FROM itemTags WHERE itemID=?",
					item4.id
				),
				2
			);
		});
		
		
		it("should delete colored tag when removing tag", async function () {
			var libraryID = Trellis.Libraries.userLibraryID;
			
			var tag = Trellis.Utilities.randomString();
			var item = await createDataObject('item', { tags: [{ tag: tag, type: 1 }] });
			await Trellis.Tags.setColor(libraryID, tag, '#ABCDEF', 0);
			
			await Trellis.Tags.removeFromLibrary(libraryID, [Trellis.Tags.getID(tag)]);
			
			assert.lengthOf(item.getTags(), 0);
			assert.isFalse(Trellis.Tags.getColor(libraryID, tag));
		});
		
		it("shouldn't delete colored tag when removing tag of a given type", async function () {
			var libraryID = Trellis.Libraries.userLibraryID;
			
			var tag = Trellis.Utilities.randomString();
			var item = await createDataObject('item', { tags: [{ tag: tag, type: 1 }] });
			await Trellis.Tags.setColor(libraryID, tag, '#ABCDEF', 0);
			
			await Trellis.Tags.removeFromLibrary(libraryID, [Trellis.Tags.getID(tag)], null, 1);
			
			assert.lengthOf(item.getTags(), 0);
			assert.ok(Trellis.Tags.getColor(libraryID, tag));
		});
	})
	
	describe("#purge()", function () {
		it("should remove orphaned tags", async function () {
			var libraryID = Trellis.Libraries.userLibraryID;
			
			var tagName = Trellis.Utilities.randomString();
			var item = createUnsavedDataObject('item');
			item.addTag(tagName);
			await item.saveTx();
			
			var tagID = Trellis.Tags.getID(tagName);
			assert.typeOf(tagID, "number");
			
			await item.eraseTx();
			
			assert.equal(Trellis.Tags.getName(tagID), tagName);
			
			await Trellis.DB.executeTransaction(async function () {
				await Trellis.Tags.purge();
			});
			
			assert.isFalse(Trellis.Tags.getName(tagID));
		})
	})
	
	
	describe("#setColor()", function () {
		var libraryID;
		
		beforeEach(function* () {
			libraryID = Trellis.Libraries.userLibraryID;
			
			// Clear library tag colors
			var colors = Trellis.Tags.getColors(libraryID);
			for (let color of colors.keys()) {
				yield Trellis.Tags.setColor(libraryID, color);
			}
		});
		
		it("should set color for a tag", async function () {
			var aColor = '#ABCDEF';
			var bColor = '#BCDEF0';
			await Trellis.Tags.setColor(libraryID, "A", aColor);
			await Trellis.Tags.setColor(libraryID, "B", bColor);
			
			var o = Trellis.Tags.getColor(libraryID, "A")
			assert.equal(o.color, aColor);
			assert.equal(o.position, 0);
			var o = Trellis.Tags.getColor(libraryID, "B")
			assert.equal(o.color, bColor);
			assert.equal(o.position, 1);
			
			var o = Trellis.SyncedSettings.get(libraryID, 'tagColors');
			assert.isArray(o);
			assert.lengthOf(o, 2);
			assert.sameMembers(o.map(c => c.color), [aColor, bColor]);
		});
		
		it("should clear color for a tag", async function () {
			var aColor = '#ABCDEF';
			await Trellis.Tags.setColor(libraryID, "A", aColor);
			var o = Trellis.Tags.getColor(libraryID, "A")
			assert.equal(o.color, aColor);
			assert.equal(o.position, 0);
			
			await Trellis.Tags.setColor(libraryID, "A", false);
			assert.equal(Trellis.Tags.getColors(libraryID).size, 0);
			assert.isFalse(Trellis.Tags.getColor(libraryID, "A"));
			
			var o = Trellis.SyncedSettings.get(libraryID, 'tagColors');
			assert.isNull(o);
		});
	});
	
	
	describe("#removeColoredTagsFromItems()", function () {
		it("shouldn't remove regular tags", async function () {
			var libraryID = Trellis.Libraries.userLibraryID;
			var item = await createDataObject('item', {
				tags: [
					{ tag: 'A' },
					{ tag: 'B', type: 1 },
					{ tag: 'C' },
					{ tag: 'D', type: 1 }
				]
			});
			await Trellis.Tags.setColor(libraryID, 'C', '#111111', 0);
			await Trellis.Tags.setColor(libraryID, 'D', '#222222', 1);
			
			await Trellis.Tags.removeColoredTagsFromItems([item]);
			
			assert.sameDeepMembers(item.getTags(), [
				{ tag: 'A' },
				{ tag: 'B', type: 1 }
			]);
		});
	});

	describe("#extractEmojiForItemsList()", function () {
		it("should return first emoji span", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("🐩🐩🐩  🐩🐩🐩🐩"), "🐩🐩🐩");
		});
		it("should return first emoji span when string doesn't start with emoji", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("./'!@#$ 🐩🐩🐩  🐩🐩🐩🐩"), "🐩🐩🐩");
		});
		
		it("should return first emoji span for text with an emoji with Variation Selector-16", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("Here are ⭐️⭐️⭐️⭐️⭐️"), "⭐️⭐️⭐️⭐️⭐️");
		});
		
		it("should return first emoji span for text with an emoji made up of multiple characters with ZWJ", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("We are 👨‍🌾👨‍🌾. And I am a 👨‍🏫."), "👨‍🌾👨‍🌾");
		});
		
		it("should return first emoji span that contains RGI country flags", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("Hello country flags 🇱🇺🇮🇪"), "🇱🇺🇮🇪");
		});

		it("should return first emoji span that contains regional flags", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("Hello England and Scotland: 🏴󠁧󠁢󠁥󠁮󠁧󠁿🏴󠁧󠁢󠁳󠁣󠁴󠁿"), "🏴󠁧󠁢󠁥󠁮󠁧󠁿🏴󠁧󠁢󠁳󠁣󠁴󠁿");
		});

		it("should return first symbol span ", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("Hello weather symbols ☼☁☂"), "☼☁☂");
		});
		it("should return first span of mixed symbols, emojis and flags ", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("Hello weather, flags and cats ☼☁☂🇱🇺🏴󠁧󠁢󠁥󠁮󠁧󠁿🐈"), "☼☁☂🇱🇺🏴󠁧󠁢󠁥󠁮󠁧󠁿🐈");
		});
		it("should ignore ©, ®, and ™", function () {
			assert.isNull(Trellis.Tags.extractEmojiForItemsList("Copyright © 2024"));
			assert.isNull(Trellis.Tags.extractEmojiForItemsList("Brand®"));
			assert.isNull(Trellis.Tags.extractEmojiForItemsList("Product™"));
			assert.isNull(Trellis.Tags.extractEmojiForItemsList("All three ©®™ together"));
		});
		it("should still extract ©️, ®️, and ™️ with Variation Selector-16", function () {
			assert.equal(Trellis.Tags.extractEmojiForItemsList("Legal ©️®️™️"), "©️®️™️");
		});
	});

	describe("#compareTagsOrder()", function () {
		it('should order colored tags by position and other tags - alphabetically', async function () {
			var libraryID = Trellis.Libraries.userLibraryID;
			await createDataObject('item', {
				tags: [
					{ tag: 'one' },
					{ tag: 'two', type: 1 },
					{ tag: 'three' },
					{ tag: 'four', type: 1 },
					{ tag: 'five' },
					{ tag: 'six😀' },
					{ tag: 'seven😀' }
				]
			});
			await Trellis.Tags.setColor(libraryID, 'three', '#111111', 0);
			await Trellis.Tags.setColor(libraryID, 'four', '#222222', 1);
			await Trellis.Tags.setColor(libraryID, 'two', '#222222', 2);
 
			assert.equal(Trellis.Tags.compareTagsOrder(libraryID, 'three', 'one'), -1, "colored vs ordinary tag -> -1");
			assert.equal(Trellis.Tags.compareTagsOrder(libraryID, 'one', 'three'), 1, "ordinary vs colored -> 1");

			assert.equal(Trellis.Tags.compareTagsOrder(libraryID, 'three', 'six😀'), -1, "colored vs emoji tag -> -1");
			assert.equal(Trellis.Tags.compareTagsOrder(libraryID, 'six😀', 'three'), 1, "emoji vs colored tag -> 1");

			assert.equal(Trellis.Tags.compareTagsOrder(libraryID, 'two', 'three'), 2, "colored vs colored => compare their positions");
			

			assert.equal(Trellis.Tags.compareTagsOrder(libraryID, 'one', 'six😀'), 1, "ordinary tag vs tag with emoji -> 1");
			assert.equal(Trellis.Tags.compareTagsOrder(libraryID, 'six😀', 'one'), -1, "tag with emoji vs ordinary tag -> -1");

			assert.equal(Trellis.Tags.compareTagsOrder(libraryID, 'six😀', 'seven😀'), 1, "both emoji tags -> alphabetical");
			assert.isAbove(Trellis.Tags.compareTagsOrder(libraryID, 'one', 'five'), 0, "ordinary tag vs ordinary tag -> alphabetical");
		});
	});
});
