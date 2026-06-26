"use strict";

describe("Trellis.DataObjects", function () {
	var types = ['collection', 'item', 'search'];
	
	describe("#get()", function () {
		it("should return false for nonexistent objects", async function () {
			assert.isFalse(Trellis.Items.get(3464363));
		});
	});
	
	describe("#getAsync()", function () {
		// TEMP: Currently just a warning
		it.skip("show throw if passed an invalid id", function* () {
			var e = yield getPromiseError(Trellis.Items.getAsync("[Object]"));
			assert.ok(e);
			assert.include(e.message, '(string)');
		});
	});
	
	describe("#getLibraryAndKeyFromID()", function () {
		it("should return a libraryID and key within a transaction", async function () {
			for (let type of types) {
				let objectsClass = Trellis.DataObjectUtilities.getObjectsClassForObjectType(type);
				await Trellis.DB.executeTransaction(async function () {
					let obj = createUnsavedDataObject(type);
					await obj.save();
					
					var {libraryID, key} = objectsClass.getLibraryAndKeyFromID(obj.id);
					assert.equal(libraryID, Trellis.Libraries.userLibraryID);
					assert.ok(key);
					assert.typeOf(key, 'string');
					assert.equal(key, obj.key);
					
					await obj.erase();
				});
			}
		});
		
		it("should return false after a save failure", async function () {
			for (let type of types) {
				let objectsClass = Trellis.DataObjectUtilities.getObjectsClassForObjectType(type);
				var obj;
				try {
					await Trellis.DB.executeTransaction(async function () {
						obj = createUnsavedDataObject(type);
						await obj.save();
						throw 'Aborting transaction -- ignore';
					});
				}
				catch (e) {
					if (typeof e != 'string' || !e.startsWith('Aborting transaction')) throw e;
				}
				
				// The registered identifiers should be reset in a rollback handler
				var libraryKey = objectsClass.getLibraryAndKeyFromID(obj.id);
				assert.isFalse(libraryKey);
			}
		});
	})
	
	describe("#exists()", function () {
		it("should return false after object is deleted", async function () {
			for (let type of types) {
				let objectsClass = Trellis.DataObjectUtilities.getObjectsClassForObjectType(type);
				let obj = await createDataObject(type);
				let id = obj.id;
				await obj.eraseTx();
				assert.isFalse(objectsClass.exists(id), type + " does not exist");
			}
		})
	})
	
	
	describe("#sortByLevel()", function () {
		it("should return collections sorted from top-level to deepest", async function () {
			// - A
			//   - B
			//     - C
			//   - D
			// - E
			//   - F
			//     - G
			//       - H
			//     - I
			//
			// Leave out B and G
			//
			// Order should be {A, E}, {D, F}, {C, I}, {H} (internal order is undefined)
			
			var check = function (arr) {
				assert.sameMembers(arr.slice(0, 2), [c1, c5]);
				assert.sameMembers(arr.slice(2, 4), [c4, c6]);
				assert.sameMembers(arr.slice(4, 6), [c3, c9]);
				assert.equal(arr[6], c8);
			};
			
			var c1 = await createDataObject('collection', { "name": "A" });
			var c2 = await createDataObject('collection', { "name": "B", parentID: c1.id });
			var c3 = await createDataObject('collection', { "name": "C", parentID: c2.id });
			var c4 = await createDataObject('collection', { "name": "D", parentID: c1.id });
			var c5 = await createDataObject('collection', { "name": "E" });
			var c6 = await createDataObject('collection', { "name": "F", parentID: c5.id });
			var c7 = await createDataObject('collection', { "name": "G", parentID: c6.id });
			var c8 = await createDataObject('collection', { "name": "H", parentID: c7.id });
			var c9 = await createDataObject('collection', { "name": "I", parentID: c6.id });
			
			var arr = Trellis.Collections.sortByLevel([c1, c3, c4, c5, c6, c8, c9]);
			//Trellis.debug(arr.map(id => Trellis.Collections.get(id).name));
			check(arr);
			
			// Check reverse order
			arr = Trellis.Collections.sortByLevel([c1, c3, c4, c5, c6, c8, c9].reverse());
			//Trellis.debug(arr.map(id => Trellis.Collections.get(id).name));
			check(arr);
		});
	});
	
	
	describe("#sortByParent", function () {
		it("should return items sorted hierarchically", async function () {
			// - A
			//   - B
			//     - C
			//   - D
			// - E
			//   - F
			//     - G
			//       - H
			//     - I
			//
			// Leave out B and G
			//
			// Order should be top-down, with child items included immediately after their parents.
			// The order of items at the same level is undefined.
			
			function check(arr) {
				var str = arr.map(o => title(o)).join('');
				var possibilities = [
					'ACDEFH',
					'ACDEFH',
					
					'ADCEFH',
					'ADCEFH',
					
					'EFHACD',
					'EFHADC',
					
					'EFHACD',
					'EFHADC',
				];
				assert.oneOf(str, possibilities);
			}
			
			function title(o) {
				if (o.isAnnotation()) return o.getTags()[0].tag;
				return o.getDisplayTitle() || o.getTags()[0].tag;
			}
			
			var a = await createDataObject('item', { title: "A" });
			var b = await createDataObject('item', { note: "B", itemType: 'note', parentID: a.id });
			var c = await createEmbeddedImage(b, { tags: [{ tag: 'C' }] });
			var d = await importPDFAttachment(a, { title: 'D' });
			var e = await createDataObject('item', { title: "E" });
			var f = await importPDFAttachment(e, { title: 'F' });
			var g = await createAnnotation('image', f, { tags: [{ tag: 'G' }] });
			var h = await createAnnotation('highlight', f, { tags: [{ tag: 'H' }] });
			
			var arr = Trellis.Items.sortByParent([a, c, d, e, f, h]);
			Trellis.debug(arr.map(o => title(o)));
			check(arr);
			
			// Reverse order
			arr = Trellis.Items.sortByParent([a, c, d, e, f, h].reverse());
			Trellis.debug(arr.map(o => title(o)));
			check(arr);
			
			// Top-level first
			arr = Trellis.Items.sortByParent([a, e, c, d, f, h]);
			Trellis.debug(arr.map(o => title(o)));
			check(arr);
			
			// Child first
			arr = Trellis.Items.sortByParent([c, h, d, f, a, e]);
			Trellis.debug(arr.map(o => title(o)));
			check(arr);
			
			// Random
			arr = Trellis.Items.sortByParent([e, d, h, c, a, f]);
			Trellis.debug(arr.map(o => title(o)));
			check(arr);
		});
	});
	
	
	describe("#_setIdentifier", function () {
		it("should not allow an id change", async function () {
			var item = await createDataObject('item');
			try {
				item.id = item.id + 1;
			}
			catch (e) {
				assert.equal(e.message, "ID cannot be changed");
				return;
			}
			assert.fail("ID change allowed");
		})
		
		it("should not allow a key change", async function () {
			var item = await createDataObject('item');
			try {
				item.key = Trellis.DataObjectUtilities.generateKey();
			}
			catch (e) {
				assert.equal(e.message, "Key cannot be changed");
				return;
			}
			assert.fail("Key change allowed");
		})
		
		it("should not allow key to be set if id is set", async function () {
			var item = createUnsavedDataObject('item');
			item.id = Trellis.Utilities.rand(100000, 1000000);
			try {
				item.libraryID = Trellis.Libraries.userLibraryID;
				item.key = Trellis.DataObjectUtilities.generateKey();
			}
			catch (e) {
				assert.equal(e.message, "Cannot set key if id is already set");
				return;
			}
			assert.fail("ID change allowed");
		})
		
		it("should not allow id to be set if key is set", async function () {
			var item = createUnsavedDataObject('item');
			item.libraryID = Trellis.Libraries.userLibraryID;
			item.key = Trellis.DataObjectUtilities.generateKey();
			try {
				item.id = Trellis.Utilities.rand(100000, 1000000);
			}
			catch (e) {
				assert.equal(e.message, "Cannot set id if key is already set");
				return;
			}
			assert.fail("Key change allowed");
		})
		
		it("should not allow key to be set if library isn't set", async function () {
			var item = createUnsavedDataObject('item');
			try {
				item.key = Trellis.DataObjectUtilities.generateKey();
			}
			catch (e) {
				assert.equal(e.message, "libraryID must be set before key");
				return;
			}
			assert.fail("libraryID change allowed");
		})
	})
})
