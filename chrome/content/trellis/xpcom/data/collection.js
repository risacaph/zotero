/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://trellis.org
    
    This file is part of Trellis.
    
    Trellis is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Trellis is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Trellis.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

Trellis.Collection = function (params = {}) {
	Trellis.Collection._super.apply(this);
	
	this._name = null;
	
	this._childCollections = new Set();
	this._childItems = new Set();
	
	Trellis.Utilities.Internal.assignProps(this, params, ['name', 'libraryID', 'parentID', 'parentKey']);
}

Trellis.extendClass(Trellis.DataObject, Trellis.Collection);

Trellis.Collection.prototype._objectType = 'collection';
Trellis.Collection.prototype._dataTypes = Trellis.Collection._super.prototype._dataTypes.concat([
	'childCollections',
	'childItems',
	'relations'
]);

Trellis.defineProperty(Trellis.Collection.prototype, 'ChildObjects', {
	get: function () { return Trellis.Items; }
});

Trellis.defineProperty(Trellis.Collection.prototype, 'id', {
	get: function () { return this._get('id'); },
	set: function (val) { return this._set('id', val); }
});
Trellis.defineProperty(Trellis.Collection.prototype, 'libraryID', {
	get: function () { return this._get('libraryID'); },
	set: function (val) { return this._set('libraryID', val); }
});
Trellis.defineProperty(Trellis.Collection.prototype, 'key', {
	get: function () { return this._get('key'); },
	set: function (val) { return this._set('key', val); }
});
Trellis.defineProperty(Trellis.Collection.prototype, 'name', {
	get: function () { return this._get('name'); },
	set: function (val) { return this._set('name', val); }
});
Trellis.defineProperty(Trellis.Collection.prototype, 'version', {
	get: function () { return this._get('version'); },
	set: function (val) { return this._set('version', val); }
});
Trellis.defineProperty(Trellis.Collection.prototype, 'synced', {
	get: function () { return this._get('synced'); },
	set: function (val) { return this._set('synced', val); }
});
Trellis.defineProperty(Trellis.Collection.prototype, 'parent', {
	get: function () {
		Trellis.debug("WARNING: Trellis.Collection.prototype.parent has been deprecated -- use .parentID or .parentKey", 2);
		return this.parentID;
	},
	set: function (val) {
		Trellis.debug("WARNING: Trellis.Collection.prototype.parent has been deprecated -- use .parentID or .parentKey", 2);
		this.parentID = val;
	},
	enumerable: false
});

Trellis.defineProperty(Trellis.Collection.prototype, 'treeViewID', {
	get: function () {
		return "C" + this.id;
	}
});

Trellis.defineProperty(Trellis.Collection.prototype, 'treeViewImage', {
	get: function () {
		// Keep in sync with collectionTreeView::getImageSrc()
		return "chrome://trellis/skin/16/universal/folder.svg";
	}
});

Trellis.Collection.prototype.getID = function () {
	Trellis.debug('Collection.getID() deprecated -- use Collection.id');
	return this.id;
}

Trellis.Collection.prototype.getName = function () {
	Trellis.debug('Collection.getName() deprecated -- use Collection.name');
	return this.name;
}

// Properties for a collection to "pretend" to be an item for trash itemTree
Object.assign(Trellis.Collection.prototype, Trellis.DataObjectUtilities.itemTreeMockProperties);

/*
 * Populate collection data from a database row
 */
Trellis.Collection.prototype.loadFromRow = function (row) {
	var primaryFields = this._ObjectsClass.primaryFields;
	for (let i=0; i<primaryFields.length; i++) {
		let col = primaryFields[i];
		try {
			var val = row[col];
		}
		catch (e) {
			Trellis.debug('Skipping missing ' + this._objectType + ' field ' + col);
			continue;
		}
		
		switch (col) {
		case this._ObjectsClass.idColumn:
			col = 'id';
			break;
		
		// Integer
		case 'libraryID':
			val = parseInt(val);
			break;
		
		// Integer or 0
		case 'version':
			val = val ? parseInt(val) : 0;
			break;
		
		// Value or false
		case 'parentKey':
			val = val || false;
			break;
		
		// Integer or false if falsy
		case 'parentID':
			val = val ? parseInt(val) : false;
			break;
		
		// Boolean
		case 'synced':
		case 'deleted':
		case 'hasChildCollections':
		case 'hasChildItems':
			val = !!val;
			break;
		
		default:
			val = val || '';
		}
		
		this['_' + col] = val;
	}
	
	this._childCollectionsLoaded = false;
	this._childItemsLoaded = false;
	
	this._loaded.primaryData = true;
	this._clearChanged('primaryData');
	this._identified = true;
}


Trellis.Collection.prototype.hasChildCollections = function (includeTrashed) {
	this._requireData('childCollections');
	if (!this._childCollections.size) {
		return false;
	}
	if (includeTrashed) {
		return this._childCollections.size > 0;
	}
	return !this.getChildCollections().every(c => c.deleted);
}

Trellis.Collection.prototype.hasChildItems = function () {
	this._requireData('childItems');
	return this._childItems.size > 0;
}


/**
 * Returns subcollections of this collection
 *
 * @param {Boolean} [asIDs=false] Return as collectionIDs
 * @param {Boolean} [includeTrashed=false] - Include collections in the trash
 * @return {Trellis.Collection[]|Integer[]}
 */
Trellis.Collection.prototype.getChildCollections = function (asIDs, includeTrashed) {
	this._requireData('childCollections');
	
	var collections = [...this._childCollections].map(id => this.ObjectsClass.get(id));
	if (!includeTrashed) {
		collections = collections.filter(c => !c.deleted);
	}
	
	// Return collectionIDs
	if (asIDs) {
		return collections.map(c => c.id);
	}
	
	// Return Trellis.Collection objects
	return collections;
}


/**
 * Returns child items of this collection
 *
 * @param	{Boolean}	asIDs			Return as itemIDs
 * @param	{Boolean}	includeDeleted	Include items in Trash
 * @return {Trellis.Item[]|Integer[]} - Array of Trellis.Item instances or itemIDs
 */
Trellis.Collection.prototype.getChildItems = function (asIDs, includeTrashed) {
	this._requireData('childItems');
	
	if (this._childItems.size == 0) {
		return [];
	}
	
	// Remove deleted items if necessary
	var childItems = [];
	for (let itemID of this._childItems) {
		let item = this.ChildObjects.get(itemID);
		if (includeTrashed || !item.deleted) {
			childItems.push(item);
		}
	}
	
	// Return itemIDs
	if (asIDs) {
		return childItems.map(item => item.id);
	}
	
	// Return Trellis.Item objects
	return childItems.slice();
}

Trellis.Collection.prototype._initSave = async function (env) {
	if (!this.name) {
		throw new Error(this._ObjectType + ' name is empty');
	}
	
	var proceed = await Trellis.Collection._super.prototype._initSave.apply(this, arguments);
	if (!proceed) return false;
	
		// Verify parent
	if (this._parentKey) {
		let newParent = await this.ObjectsClass.getByLibraryAndKeyAsync(
			this.libraryID, this._parentKey
		);
		
		if (!newParent) {
			throw new Error("Cannot set parent to invalid collection " + this._parentKey);
		}
		
		if (newParent.id == this.id) {
			throw new Error('Cannot move collection into itself!');
		}
		
		if (this.id && this.hasDescendent('collection', newParent.id)) {
			throw new Error(`Cannot move collection '${this.name}' into one of its own descendents`);
		}
		
		env.parent = newParent.id;
	}
	else {
		env.parent = null;
	}
	
	return true;
};

Trellis.Collection.prototype._saveData = async function (env) {
	var isNew = env.isNew;
	var options = env.options;

	var collectionID = this._id = this.id ? this.id : Trellis.ID.get('collections');
	
	Trellis.debug("Saving collection " + this.id);
	
	env.sqlColumns.push(
		'collectionName',
		'parentCollectionID'
	);
	env.sqlValues.push(
		{ string: this.name },
		env.parent ? env.parent : null
	);
	
	if (env.sqlColumns.length) {
		if (isNew) {
			env.sqlColumns.unshift('collectionID');
			env.sqlValues.unshift(collectionID ? { int: collectionID } : null);
			
			let placeholders = env.sqlColumns.map(() => '?').join();
			let sql = "INSERT INTO collections (" + env.sqlColumns.join(', ') + ") "
				+ "VALUES (" + placeholders + ")";
			await Trellis.DB.queryAsync(sql, env.sqlValues);
		}
		else {
			let sql = 'UPDATE collections SET '
				+ env.sqlColumns.map(x => x + '=?').join(', ') + ' WHERE collectionID=?';
			env.sqlValues.push(collectionID ? { int: collectionID } : null);
			await Trellis.DB.queryAsync(sql, env.sqlValues);
		}
	}
	
	if (this._changed.parentKey) {
		// Add this item to the parent's cached item lists after commit,
		// if the parent was loaded
		if (this.parentKey) {
			let parentCollectionID = this.ObjectsClass.getIDFromLibraryAndKey(
				this.libraryID, this.parentKey
			);
			Trellis.DB.addCurrentCallback("commit", function () {
				this.ObjectsClass.registerChildCollection(parentCollectionID, collectionID);
			}.bind(this));
		}
		// Remove this from the previous parent's cached collection lists after commit,
		// if the parent was loaded
		if (!isNew && this._previousData.parentKey) {
			let parentCollectionID = this.ObjectsClass.getIDFromLibraryAndKey(
				this.libraryID, this._previousData.parentKey
			);
			Trellis.DB.addCurrentCallback("commit", function () {
				this.ObjectsClass.unregisterChildCollection(parentCollectionID, collectionID);
			}.bind(this));
		}
	}
	
	if (this._changedData.deleted !== undefined) {
		if (this._changedData.deleted) {
			await this.trash({ ...env, isNew: isNew });
		}
		else {
			let sql = "DELETE FROM deletedCollections WHERE collectionID=?";

			await Trellis.DB.queryAsync(sql, collectionID);
		}
		
		this._clearChanged('deleted');
		this._markForReload('primaryData');
	}
};

Trellis.Collection.prototype._finalizeSave = async function (env) {
	if (!env.options.skipNotifier) {
		if (env.isNew) {
			Trellis.Notifier.queue(
				'add', 'collection', this.id, env.notifierData, env.options.notifierQueue
			);
		}
		else {
			Trellis.Notifier.queue(
				'modify', 'collection', this.id, env.notifierData, env.options.notifierQueue
			);
		}
	}
	
	if (!env.skipCache) {
		await this.reload();
		// If new, there's no other data we don't have, so we can mark everything as loaded
		if (env.isNew) {
			this._markAllDataTypeLoadStates(true);
		}
		this._clearChanged();
	}
	
	if (env.isNew) {
		await Trellis.Libraries.get(this.libraryID).updateCollections();
	}
	
	return env.isNew ? this.id : true;
};



/**
 * @param {Number} itemID
 * @return {Promise}
 */
Trellis.Collection.prototype.addItem = function (itemID, options) {
	return this.addItems([itemID], options);
}


/**
 * Add multiple items to the collection in batch
 *
 * Requires a transaction
 * Does not require a separate save()
 *
 * @param {Number[]} itemIDs
 * @return {Promise}
 */
Trellis.Collection.prototype.addItems = async function (itemIDs, options = {}) {
	options.skipDateModifiedUpdate = true;

	if (!itemIDs || !itemIDs.length) {
		return;
	}
	
	var current = this.getChildItems(true);
	
	Trellis.DB.requireTransaction();
	for (let i = 0; i < itemIDs.length; i++) {
		let itemID = itemIDs[i];
		
		if (current && current.indexOf(itemID) != -1) {
			Trellis.debug("Item " + itemID + " already a child of collection " + this.id);
			continue;
		}
		
		let item = this.ChildObjects.get(itemID);
		item.addToCollection(this.id);
		await item.save(options);
	}
	
	await this.loadDataType('childItems');
};

/**
 * Remove a item from the collection. The item is not deleted from the library.
 *
 * Requires a transaction
 * Does not require a separate save()
 *
 * @return {Promise}
 */
Trellis.Collection.prototype.removeItem = function (itemID, options = {}) {
	return this.removeItems([itemID], options);
}


/**
 * Remove multiple items from the collection in batch.
 * The items are not deleted from the library.
 *
 * Does not require a separate save()
 */
Trellis.Collection.prototype.removeItems = async function (itemIDs, options = {}) {
	if (!itemIDs || !itemIDs.length) {
		return;
	}
	
	var current = this.getChildItems(true, true);
	
	Trellis.DB.requireTransaction();
	for (let i=0; i<itemIDs.length; i++) {
		let itemID = itemIDs[i];
		
		if (current.indexOf(itemID) == -1) {
			Trellis.debug("Item " + itemID + " not a child of collection " + this.id);
			continue;
		}
		
		let item = await this.ChildObjects.getAsync(itemID);
		item.removeFromCollection(this.id);
		await item.save({
			skipDateModifiedUpdate: true,
			skipEditCheck: options.skipEditCheck
		})
	}
};


/**
 * Check if an item belongs to the collection
 *
 * @param {Trellis.Item|Number} item - Item or itemID
 */
Trellis.Collection.prototype.hasItem = function (item) {
	this._requireData('childItems');
	if (item instanceof Trellis.Item) {
		item = item.id;
	}
	return this._childItems.has(item);
}


Trellis.Collection.prototype.hasDescendent = function (type, id) {
	var descendents = this.getDescendents();
	for (var i=0, len=descendents.length; i<len; i++) {
		if (descendents[i].type == type && descendents[i].id == id) {
			return true;
		}
	}
	return false;
};


/**
 * Compares this collection to another
 *
 * Returns a two-element array containing two objects with the differing values,
 * or FALSE if no differences
 *
 * @param	{Trellis.Collection}	collection			Trellis.Collection to compare this item to
 * @param	{Boolean}		includeMatches			Include all fields, even those that aren't different
 */
Trellis.Collection.prototype.diff = function (collection, includeMatches) {
	var diff = [];
	var thisData = this.serialize();
	var otherData = collection.serialize();
	var numDiffs = this.ObjectsClass.diff(thisData, otherData, diff, includeMatches);
	
	// For the moment, just compare children and increase numDiffs if any differences
	var d1 = Trellis.Utilities.arrayDiff(
		thisData.childCollections, otherData.childCollections
	);
	var d2 = Trellis.Utilities.arrayDiff(
		otherData.childCollections, thisData.childCollections
	);
	var d3 = Trellis.Utilities.arrayDiff(
		thisData.childItems, otherData.childItems
	);
	var d4 = Trellis.Utilities.arrayDiff(
		otherData.childItems, thisData.childItems
	);
	numDiffs += d1.length + d2.length;
	
	if (d1.length || d2.length) {
		numDiffs += d1.length + d2.length;
		diff[0].childCollections = d1;
		diff[1].childCollections = d2;
	}
	else {
		diff[0].childCollections = [];
		diff[1].childCollections = [];
	}
	
	if (d3.length || d4.length) {
		numDiffs += d3.length + d4.length;
		diff[0].childItems = d3;
		diff[1].childItems = d4;
	}
	else {
		diff[0].childItems = [];
		diff[1].childItems = [];
	}
	
	if (numDiffs == 0) {
		return false;
	}
	
	return diff;
}


/**
 * Returns an unsaved copy of the collection without id and key
 *
 * Doesn't duplicate subcollections or items, because the collection isn't saved
 */
Trellis.Collection.prototype.clone = function (libraryID) {
	Trellis.debug('Cloning collection ' + this.id);
	
	if (libraryID !== undefined && libraryID !== null && typeof libraryID !== 'number') {
		throw new Error("libraryID must be null or an integer");
	}
	
	if (libraryID === undefined || libraryID === null) {
		libraryID = this.libraryID;
	}
	var sameLibrary = libraryID == this.libraryID;
	
	var newCollection = new Trellis.Collection;
	newCollection.libraryID = libraryID;
	
	var json = this.toJSON();
	if (!sameLibrary) {
		delete json.parentCollection;
		delete json.relations;
	}
	newCollection.fromJSON(json);
	
	return newCollection;
}


/**
* Moves the collection and all descendent collections (and optionally items) to trash
**/
Trellis.Collection.prototype.trash = async function (env) {
	Trellis.DB.requireTransaction();
	
	var collections = [this.id];
	
	var descendents = env.isNew ? [] : this.getDescendents(false, null, false);
	var libraryHasTrash = Trellis.Libraries.hasTrash(this.libraryID);
	
	var del = [];
	for(var i=0, len=descendents.length; i<len; i++) {
		// Descendent collections
		if (descendents[i].type == 'collection') {
			collections.push(descendents[i].id);
			var c = await this.ObjectsClass.getAsync(descendents[i].id);
			if (c) {
				env.notifierData[c.id] = {
					libraryID: c.libraryID,
					key: c.key
				};
				// skipDeleteLog is normally added to notifierData in DataObject::_finalizeErase(),
				// so we have to do it manually here
				if (env.options && env.options.skipDeleteLog) {
					env.notifierData[c.id].skipDeleteLog = true;
				}
				// Record undo data for descendent collections
				if (Trellis.UndoHistory && !c.deleted) {
					Trellis.UndoHistory.stageChange({
						objectType: 'collection',
						id: c.id,
						libraryID: c.libraryID,
						key: c.key,
						fields: {
							deleted: { old: false, new: true }
						}
					});
				}
			}
		}
		// Descendent items
		else {
			// Trash/delete items
			if (env.options.deleteItems) {
				del.push(descendents[i].id);
			}
			
		}
	}
	if (del.length) {
		if (libraryHasTrash) {
			await this.ChildObjects.trash(del);
		}
		// If library doesn't have trash, just erase
		else {
			Trellis.debug(Trellis.Libraries.getName(this.libraryID) + " library does not have trash. "
				+ this.ChildObjects._ZDO_Objects + " will be erased");
			let options = {};
			Object.assign(options, env.options);
			options.tx = false;
			for (let i=0; i<del.length; i++) {
				let obj = await this.ChildObjects.getAsync(del[i]);
				await obj.erase(options);
			}
		}
	}

	await Trellis.Utilities.Internal.forEachChunkAsync(
		collections,
		Trellis.DB.MAX_BOUND_PARAMETERS,
		async function (chunk) {
			// Send collection to trash
			var placeholders = chunk.map(() => '(?)').join(',');
			await Trellis.DB.queryAsync('INSERT OR IGNORE INTO deletedCollections (collectionID) VALUES ' + placeholders, chunk);
		}
	);

	if (env.isNew) {
		return;
	}
	
	// Reload collection data to show/restore deleted collections from trash
	for (let collectionID of collections) {
		let collection = Trellis.Collections.get(collectionID);
		await collection.loadDataType('primaryData', true);
		await collection.loadDataType('childCollections', true);
	}
};

/**
* Completely erase the collection and its descendants.
**/
Trellis.Collection.prototype._eraseData = async function (env) {
	Trellis.DB.requireTransaction();

	if (!this.deleted) {
		await this.trash(env);
	}
	
	var collections = [this.id];
	var descendents = this.getDescendents(false, null, true);
	collections = descendents
		.filter(d => d.type == 'collection')
		.map(c => c.id).concat(collections);

	// Make sure all descendant collections will be unloaded in this._finalizeErase()
	env.deletedObjectIDs = collections;

	await Trellis.Utilities.Internal.forEachChunkAsync(
		collections,
		Trellis.DB.MAX_BOUND_PARAMETERS,
		async function (chunk) {
			var placeholders = chunk.map(() => '?').join(',');

			// Remove item associations for all descendent collections
			await Trellis.DB.queryAsync('DELETE FROM collectionItems WHERE collectionID IN '
				+ '(' + placeholders + ')', chunk);
			
			// Remove parent definitions first for FK check
			await Trellis.DB.queryAsync('UPDATE collections SET parentCollectionID=NULL '
				+ 'WHERE parentCollectionID IN (' + placeholders + ')', chunk);

			// And delete all descendent collections
			await Trellis.DB.queryAsync('DELETE FROM collections WHERE collectionID IN '
			+ '(' + placeholders + ')', chunk);
		}
	);

	// Update child collection cache of parent collection
	if (this.parentKey) {
		let parentCollectionID = this.ObjectsClass.getIDFromLibraryAndKey(
			this.libraryID, this.parentKey
		);
		Trellis.DB.addCurrentCallback("commit", function () {
			this.ObjectsClass.unregisterChildCollection(parentCollectionID, this.id);
		}.bind(this));
	}
	
	// Remove erased collection from collection cache of descendant items
	var itemsToUpdate = descendents.filter(d => d.type == 'item').map(c => c.id);
	let deletedCollections = new Set(collections);
	itemsToUpdate.forEach((itemID) => {
		let item = Trellis.Items.get(itemID);
		item._collections = item._collections.filter(c => !deletedCollections.has(c));
	});
};

Trellis.Collection.prototype._finalizeErase = async function (env) {
	await Trellis.Collection._super.prototype._finalizeErase.call(this, env);
	
	await Trellis.Libraries.get(this.libraryID).updateCollections();
};


Trellis.Collection.prototype.serialize = function (nested) {
	var childCollections = this.getChildCollections(true);
	var childItems = this.getChildItems(true);
	var obj = {
		primary: {
			collectionID: this.id,
			libraryID: this.libraryID,
			key: this.key
		},
		fields: {
			name: this.name,
			parentKey: this.parentKey,
		},
		childCollections: childCollections ? childCollections : [],
		childItems: childItems ? childItems : [],
		descendents: this.id ? this.getDescendents(nested) : []
	};
	return obj;
}


Trellis.Collection.prototype.toResponseJSON = function (options = {}) {
	let json = this.constructor._super.prototype.toResponseJSON.call(this, options);
	json.meta.numCollections = this.getChildCollections(true).length;
	json.meta.numItems = this.getChildItems(true).length;
	if (this.parentID) {
		json.links.up = {
			href: Trellis.URI.toAPIURL(Trellis.URI.getCollectionURI(Trellis.Collections.get(this.parentID)), options.apiURL),
			type: 'application/json'
		};
	}
	return json;
};


/**
 * Populate the object's data from an API JSON data object
 *
 * If this object is identified (has an id or library/key), loadAllData() must have been called.
 */
Trellis.Collection.prototype.fromJSON = function (json, options = {}) {
	if (options.strict) {
		for (let prop in json) {
			switch (prop) {
			case 'key':
			case 'version':
			case 'name':
			case 'parentCollection':
			case 'relations':
			case 'deleted':
				break;
			
			default:
				let e = new Error(`Unknown collection property '${prop}'`);
				e.name = "TrellisInvalidDataError";
				throw e;
			}
		}
	}
	
	if (!json.name) {
		throw new Error("'name' property not provided for collection");
	}
	this.name = json.name;
	this.parentKey = json.parentCollection ? json.parentCollection : false;
	
	this.setRelations(json.relations || {});
	
	if (json.deleted || this.deleted) {
		this.deleted = !!json.deleted;
	}
}


Trellis.Collection.prototype.toJSON = function (options = {}) {
	var env = this._preToJSON(options);
	var mode = env.mode;
	
	var obj = env.obj = {};
	obj.key = this.key;
	obj.version = this.version;
	
	obj.name = this.name;
	obj.parentCollection = this.parentKey ? this.parentKey : false;
	obj.relations = this.getRelations();
	
	return this._postToJSON(env);
}


/**
 * Returns an array of descendent collections and items
 *
 * @param	{Boolean}	[nested=false]		Return multidimensional array with 'children'
 *											nodes instead of flat array
 * @param	{String}	[type]				'item', 'collection', or NULL for both
 * @param	{Boolean}	[includeTrashed=false]		Include collections and items in Trash
 * @return	{Object[]} - An array of objects with 'id', 'key', 'type' ('item' or 'collection'),
 *     'parent', and, if collection, 'name' and the nesting 'level'
 */
Trellis.Collection.prototype.getDescendents = function (nested, type, includeTrashed, level) {
	if (!this.id) {
		throw new Error('Cannot be called on an unsaved item');
	}
	
	if (!level) {
		level = 1;
	}
	
	if (type) {
		switch (type) {
			case 'item':
			case 'collection':
				break;
			default:
				throw new (`Invalid type '${type}'`);
		}
	}
	
	var collections = Trellis.Collections.getByParent(this.id, false, includeTrashed);
	var children = collections.map(c => ({
		id: c.id,
		name: c.name,
		type: 0,
		key: c.key
	}));
	if (!type || type == 'item') {
		let items = this.getChildItems(false, includeTrashed);
		children = children.concat(items.map(i => ({
			id: i.id,
			name: null,
			type: 1,
			key: i.key
		})));
	}
	
	children.sort(function (a, b) {
		if (a.name === null || b.name === null) return 0;
		return Trellis.localeCompare(a.name, b.name)
	});
	
	var toReturn = [];
	for(var i=0, len=children.length; i<len; i++) {
		switch (children[i].type) {
			case 0:
				if (!type || type=='collection') {
					toReturn.push({
						id: children[i].id,
						name: children[i].name,
						key: children[i].key,
						type: 'collection',
						level: level,
						parent: this.id
					});
				}
				
				let child = this.ObjectsClass.get(children[i].id);
				let descendents = child.getDescendents(
					nested, type, includeTrashed, level + 1
				);
				
				if (nested) {
					toReturn[toReturn.length-1].children = descendents;
				}
				else {
					for (var j=0, len2=descendents.length; j<len2; j++) {
						toReturn.push(descendents[j]);
					}
				}
			break;
			
			case 1:
				if (!type || type=='item') {
					toReturn.push({
						id: children[i].id,
						key: children[i].key,
						type: 'item',
						parent: this.id
					});
				}
			break;
		}
	}
	
	return toReturn;
};


/**
 * Return a collection in the specified library equivalent to this collection
 *
 * @return {Promise<Trellis.Collection>}
 */
Trellis.Collection.prototype.getLinkedCollection = function (libraryID, bidrectional) {
	return this._getLinkedObject(libraryID, bidrectional);
}


/**
 * Add a linked-object relation pointing to the given collection
 *
 * Does not require a separate save()
 */
Trellis.Collection.prototype.addLinkedCollection = async function (collection) {
	return this._addLinkedObject(collection);
};


//
// Private methods
//
/**
 * Add a collection to the cached child collections list if loaded
 */
Trellis.Collection.prototype._registerChildCollection = function (collectionID) {
	if (this._loaded.childCollections) {
		let collection = this.ObjectsClass.get(collectionID);
		if (collection) {
			this._childCollections.add(collectionID);
		}
	}
}


/**
 * Remove a collection from the cached child collections list if loaded
 */
Trellis.Collection.prototype._unregisterChildCollection = function (collectionID) {
	if (this._loaded.childCollections) {
		this._childCollections.delete(collectionID);
	}
}


/**
 * Add an item to the cached child items list if loaded
 */
Trellis.Collection.prototype._registerChildItem = function (itemID) {
	if (this._loaded.childItems) {
		let item = this.ChildObjects.get(itemID);
		if (item) {
			this._childItems.add(itemID);
		}
	}
}


/**
 * Remove an item from the cached child items list if loaded
 */
Trellis.Collection.prototype._unregisterChildItem = function (itemID) {
	if (this._loaded.childItems) {
		this._childItems.delete(itemID);
	}
}
