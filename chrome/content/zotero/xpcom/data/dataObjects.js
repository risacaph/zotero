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


Trellis.DataObjects = function () {
	if (!this._ZDO_object) throw new Error('this._ZDO_object must be set before calling Trellis.DataObjects constructor');
	
	if (!this._ZDO_objects) {
		this._ZDO_objects = Trellis.DataObjectUtilities.getObjectTypePlural(this._ZDO_object);
	}
	if (!this._ZDO_Object) {
		this._ZDO_Object = this._ZDO_object.substr(0, 1).toUpperCase()
			+ this._ZDO_object.substr(1);
	}
	if (!this._ZDO_Objects) {
		this._ZDO_Objects = this._ZDO_objects.substr(0, 1).toUpperCase()
			+ this._ZDO_objects.substr(1);
	}
	
	if (!this._ZDO_id) {
		this._ZDO_id = this._ZDO_object + 'ID';
	}
	
	if (!this._ZDO_table) {
		this._ZDO_table = this._ZDO_objects;
	}
	
	if (!this.ObjectClass) {
		this.ObjectClass = Trellis[this._ZDO_Object];
	}
	
	this._objectCache = {};
	this._objectKeys = {};
	this._objectIDs = {};
	this._loadedLibraries = {};
}

Trellis.DataObjects.prototype._ZDO_idOnly = false;

// Public properties
Trellis.defineProperty(Trellis.DataObjects.prototype, 'idColumn', {
	get: function () { return this._ZDO_id; }
});
Trellis.defineProperty(Trellis.DataObjects.prototype, 'table', {
	get: function () { return this._ZDO_table; }
});

Trellis.defineProperty(Trellis.DataObjects.prototype, 'relationsTable', {
	get: function () { return this._ZDO_object + 'Relations'; }
});

Trellis.defineProperty(Trellis.DataObjects.prototype, 'primaryFields', {
	get: function () { return Object.keys(this._primaryDataSQLParts); }
}, {lazy: true});

Trellis.defineProperty(Trellis.DataObjects.prototype, "_primaryDataSQLWhere", {
	value: "WHERE 1"
});

Trellis.defineProperty(Trellis.DataObjects.prototype, 'primaryDataSQLFrom', {
	get: function () { return " " + this._primaryDataSQLFrom + " " + this._primaryDataSQLWhere; }
}, {lateInit: true});

Trellis.DataObjects.prototype.init = function () {
	return this._loadIDsAndKeys();
}


Trellis.DataObjects.prototype.isPrimaryField = function (field) {
	return this.primaryFields.indexOf(field) != -1;
}


/**
 * Retrieves one or more already-loaded items
 *
 * If an item hasn't been loaded, an error is thrown
 *
 * @param {Array|Integer} ids  An individual object id or an array of object ids
 * @return {Trellis.[Object]|Array<Trellis.[Object]>} A Trellis.[Object], if a scalar id was passed;
 *                                          otherwise, an array of Trellis.[Object]
 */
Trellis.DataObjects.prototype.get = function (ids) {
	if (Array.isArray(ids)) {
		var singleObject = false;
	}
	else {
		var singleObject = true;
		ids = [ids];
	}
	
	var toReturn = [];
	
	for (let i=0; i<ids.length; i++) {
		let id = ids[i];
		// Check if already loaded
		if (!this._objectCache[id]) {
			// If unloaded id is registered, throw an error
			if (this._objectKeys[id]) {
				throw new Trellis.Exception.UnloadedDataException(
					this._ZDO_Object + " " + id + " not yet loaded"
				);
			}
			// Otherwise ignore (which means returning false for a single id)
			else {
				continue;
			}
		}
		toReturn.push(this._objectCache[id]);
	}
	
	// If single id, return the object directly
	if (singleObject) {
		return toReturn.length ? toReturn[0] : false;
	}
	
	return toReturn;
};
	
	
/**
 * Retrieves (and loads, if necessary) one or more items
 *
 * @param {Array|Integer} ids  An individual object id or an array of object ids
 * @param {Object} [options]
 * @param {Boolean} [options.noCache=false] - Don't add object to cache after loading
 * @return {Promise<Trellis.DataObject|Trellis.DataObject[]>} - A promise for either a data object,
 *     if a scalar id was passed, or an array of data objects, if an array of ids was passed
 */
Trellis.DataObjects.prototype.getAsync = async function (ids, options) {
	var toLoad = [];
	var toReturn = [];
	
	if (!ids) {
		throw new Error("No arguments provided");
	}
	
	if (options && typeof options != 'object') {
		throw new Error(`'options' must be an object, ${typeof options} given`);
	}
	
	if (Array.isArray(ids)) {
		var singleObject = false;
	}
	else {
		var singleObject = true;
		ids = [ids];
	}
	
	for (let i=0; i<ids.length; i++) {
		let id = ids[i];
		
		if (!Number.isInteger(id)) {
			// TEMP: Re-enable test when removed
			let e = new Error(`${this._ZDO_object} ID '${id}' is not an integer (${typeof id})`);
			Trellis.logError(e);
			id = parseInt(id);
			//throw new Error(`${this._ZDO_object} ID '${id}' is not an integer (${typeof id})`);
		}
		
		// Check if already loaded
		if (this._objectCache[id]) {
			toReturn.push(this._objectCache[id]);
		}
		else {
			toLoad.push(id);
		}
	}
	
	// New object to load
	if (toLoad.length) {
		let loaded = await this._loadSerial(null, toLoad, options);
		for (let id of toLoad) {
			let obj = loaded[id];
			if (!obj) {
				Trellis.debug(this._ZDO_Object + " " + id + " doesn't exist", 2);
				continue;
			}
			toReturn.push(obj);
		}
	}
	
	// If single id, return the object directly
	if (singleObject) {
		return toReturn.length ? toReturn[0] : false;
	}
	
	return toReturn;
};


/**
 * Get all loaded objects
 *
 * @return {Trellis.DataObject[]}
 */
Trellis.DataObjects.prototype.getLoaded = function () {
	return Object.keys(this._objectCache).map(id => this._objectCache[id]);
}


/**
 * Return objects in the trash
 *
 * @param {Integer} libraryID - Library to search
 * @param {Boolean} [asIDs] - Return object ids instead of objects
 * @param {Integer} [days]
 * @param {Integer} [limit]
 * @return {Promise<Trellis.DataObject[]|Integer[]>}
 */
Trellis.DataObjects.prototype.getDeleted = async function (libraryID, asIDs, days, limit) {
	var sql = `SELECT ${this._ZDO_id} FROM ${this._ZDO_table} `
		+ `JOIN deleted${this._ZDO_Objects} USING (${this._ZDO_id}) `
		+ "WHERE libraryID=?";
	var params = [libraryID];
	if (days) {
		sql += " AND dateDeleted <= DATE('NOW', '-" + parseInt(days) + " DAYS')";
	}
	if (limit) {
		sql += " LIMIT ?";
		params.push(limit);
	}
	var ids = await Trellis.DB.columnQueryAsync(sql, params);
	if (!ids.length) {
		return [];
	}
	if (asIDs) {
		return ids;
	}
	return this.getAsync(ids);
};




Trellis.DataObjects.prototype.getAllIDs = function (libraryID) {
	var sql = `SELECT ${this._ZDO_id} FROM ${this._ZDO_table} WHERE libraryID=?`;
	return Trellis.DB.columnQueryAsync(sql, [libraryID]);
};


Trellis.DataObjects.prototype.getAllKeys = function (libraryID) {
	var sql = "SELECT key FROM " + this._ZDO_table + " WHERE libraryID=?";
	return Trellis.DB.columnQueryAsync(sql, [libraryID]);
};


/**
 * @deprecated - use .libraryKey
 */
Trellis.DataObjects.prototype.makeLibraryKeyHash = function (libraryID, key) {
	Trellis.debug("WARNING: " + this._ZDO_Objects + ".makeLibraryKeyHash() is deprecated -- use .libraryKey instead");
	return libraryID + '_' + key;
}


/**
 * @deprecated - use .libraryKey
 */
Trellis.DataObjects.prototype.getLibraryKeyHash = function (obj) {
	Trellis.debug("WARNING: " + this._ZDO_Objects + ".getLibraryKeyHash() is deprecated -- use .libraryKey instead");
	return this.makeLibraryKeyHash(obj.libraryID, obj.key);
}


Trellis.DataObjects.prototype.parseLibraryKey = function (libraryKey) {
	var [libraryID, key] = libraryKey.split('/');
	return {
		libraryID: parseInt(libraryID),
		key: key
	};
}


/**
 * @deprecated - Use Trellis.DataObjects.parseLibraryKey()
 */
Trellis.DataObjects.prototype.parseLibraryKeyHash = function (libraryKey) {
	Trellis.debug("WARNING: " + this._ZDO_Objects + ".parseLibraryKeyHash() is deprecated -- use .parseLibraryKey() instead");
	var [libraryID, key] = libraryKey.split('_');
	if (!key) {
		return false;
	}
	return {
		libraryID: parseInt(libraryID),
		key: key
	};
}


/**
 * Retrieves an object by its libraryID and key
 *
 * @param	{Integer}		libraryID
 * @param	{String}			key
 * @return	{Trellis.DataObject}			Trellis data object, or FALSE if not found
 */
Trellis.DataObjects.prototype.getByLibraryAndKey = function (libraryID, key, options) {
	var id = this.getIDFromLibraryAndKey(libraryID, key);
	if (!id) {
		return false;
	}
	return Trellis[this._ZDO_Objects].get(id, options);
};


/**
 * Asynchronously retrieves an object by its libraryID and key
 *
 * @param {Integer} - libraryID
 * @param {String} - key
 * @param {Object} [options]
 * @param {Boolean} [options.noCache=false] - Don't add object to cache after loading
 * @return {Promise<Trellis.DataObject>} - Promise for a data object, or FALSE if not found
 */
Trellis.DataObjects.prototype.getByLibraryAndKeyAsync = function (libraryID, key, options) {
	var id = this.getIDFromLibraryAndKey(libraryID, key);
	if (!id) {
		return false;
	}
	return Trellis[this._ZDO_Objects].getAsync(id, options);
};


Trellis.DataObjects.prototype.exists = function (id) {
	return !!this.getLibraryAndKeyFromID(id);
}


Trellis.DataObjects.prototype.existsByKey = function (key) {
	return !!this.getIDFromLibraryAndKey(id);
}


/**
 * @return {Object} Object with 'libraryID' and 'key'
 */
Trellis.DataObjects.prototype.getLibraryAndKeyFromID = function (id) {
	var lk = this._objectKeys[id];
	return lk ? { libraryID: lk[0], key: lk[1] } : false;
}


Trellis.DataObjects.prototype.getIDFromLibraryAndKey = function (libraryID, key) {
	if (!libraryID) throw new Error("Library ID not provided");
	// TEMP: Just warn for now
	//if (!key) throw new Error("Key not provided");
	if (!key) Trellis.logError("Key not provided");
	return (this._objectIDs[libraryID] && this._objectIDs[libraryID][key])
		? this._objectIDs[libraryID][key] : false;
}


Trellis.DataObjects.prototype.getOlder = function (libraryID, date) {
	if (!date || date.constructor.name != 'Date') {
		throw ("date must be a JS Date in "
			+ "Trellis." + this._ZDO_Objects + ".getOlder()")
	}
	
	var sql = "SELECT ROWID FROM " + this._ZDO_table
		+ " WHERE libraryID=? AND clientDateModified<?";
	return Trellis.DB.columnQueryAsync(sql, [libraryID, Trellis.Date.dateToSQL(date, true)]);
};


Trellis.DataObjects.prototype.getNewer = function (libraryID, date, ignoreFutureDates) {
	if (!date || date.constructor.name != 'Date') {
		throw ("date must be a JS Date in "
			+ "Trellis." + this._ZDO_Objects + ".getNewer()")
	}
	
	var sql = "SELECT ROWID FROM " + this._ZDO_table
		+ " WHERE libraryID=? AND clientDateModified>?";
	if (ignoreFutureDates) {
		sql += " AND clientDateModified<=CURRENT_TIMESTAMP";
	}
	return Trellis.DB.columnQueryAsync(sql, [libraryID, Trellis.Date.dateToSQL(date, true)]);
};


/**
 * Gets the latest version for each object of a given type in the given library
 *
 * @return {Promise<Object>} - A promise for an object with object keys as keys and versions
 *                             as properties
 */
Trellis.DataObjects.prototype.getObjectVersions = async function (libraryID, keys = null) {
	var versions = {};
	
	if (keys) {
		await Trellis.Utilities.Internal.forEachChunkAsync(
			keys,
			Trellis.DB.MAX_BOUND_PARAMETERS - 1,
			async function (chunk) {
				var sql = "SELECT key, version FROM " + this._ZDO_table
					+ " WHERE libraryID=? AND key IN (" + chunk.map(key => '?').join(', ') + ")";
				var rows = await Trellis.DB.queryAsync(sql, [libraryID].concat(chunk));
				for (let i = 0; i < rows.length; i++) {
					let row = rows[i];
					versions[row.key] = row.version;
				}
			}.bind(this)
		);
	}
	else {
		let sql = "SELECT key, version FROM " + this._ZDO_table + " WHERE libraryID=?";
		let rows = await Trellis.DB.queryAsync(sql, [libraryID]);
		for (let i = 0; i < rows.length; i++) {
			let row = rows[i];
			versions[row.key] = row.version;
		}
	}
	
	return versions;
};


/**
 * Bulk-load data type(s) of given objects if not loaded
 *
 * This would generally be used to load necessary data for cross-library search results, since those
 * results might include objects in libraries that haven't yet been loaded.
 *
 * @param {Trellis.DataObject[]} objects
 * @param {String[]} [dataTypes] - Data types to load, defaulting to all types
 * @return {Promise}
 */
Trellis.DataObjects.prototype.loadDataTypes = async function (objects, dataTypes) {
	if (!dataTypes) {
		dataTypes = this.ObjectClass.prototype._dataTypes;
	}
	for (let dataType of dataTypes) {
		let typeIDsByLibrary = {};
		for (let obj of objects) {
			if (obj._loaded[dataType]) {
				continue;
			}
			if (!typeIDsByLibrary[obj.libraryID]) {
				typeIDsByLibrary[obj.libraryID] = [];
			}
			typeIDsByLibrary[obj.libraryID].push(obj.id);
		}
		for (let libraryID in typeIDsByLibrary) {
			await this._loadDataTypeInLibrary(dataType, parseInt(libraryID), typeIDsByLibrary[libraryID]);
		}
	}
};


/**
 * Loads data for a given data type
 * @param {String} dataType
 * @param {Integer} libraryID
 * @param {Integer[]} [ids]
 */
Trellis.DataObjects.prototype._loadDataTypeInLibrary = async function (dataType, libraryID, ids) {
	// note → loadNotes
	// itemData → loadItemData
	// annotationDeferred → loadAnnotationsDeferred
	var baseDataType = dataType.replace('Deferred', '');
	var funcName = "_load" + dataType[0].toUpperCase() + baseDataType.substr(1)
		// Single data types need an 's' (e.g., 'note' -> 'loadNotes()')
		+ ((baseDataType.endsWith('s') || baseDataType.endsWith('Data') ? '' : 's'))
		+ (dataType.endsWith('Deferred') ? 'Deferred' : '');
	if (!this[funcName]) {
		throw new Error(`Trellis.${this._ZDO_Objects}.${funcName} is not a function`);
	}
	
	if (ids && ids.length == 0) {
		return;
	}
	
	var t = new Date;
	var libraryName = Trellis.Libraries.get(libraryID).name;
	
	var idSQL = "";
	if (ids) {
		idSQL = " AND " + this.idColumn + " IN (" + ids.map(id => parseInt(id)).join(", ") + ")";
	}
	
	Trellis.debug("Loading " + dataType + " for "
		+ (ids
			? ids.length + " " + (ids.length == 1 ? this._ZDO_object : this._ZDO_objects)
			: this._ZDO_objects)
		+ " in " + libraryName);
	
	await this[funcName](libraryID, ids ? ids : [], idSQL);
	
	Trellis.debug(`Loaded ${dataType} in ${libraryName} in ${new Date() - t} ms`);
};

Trellis.DataObjects.prototype.loadAll = async function (libraryID, ids) {
	var t = new Date();
	var library = Trellis.Libraries.get(libraryID)
	
	Trellis.debug("Loading "
		+ (ids ? ids.length : "all") + " "
		+ (ids && ids.length == 1 ? this._ZDO_object : this._ZDO_objects)
		+ " in " + library.name);
	
	if (!ids) {
		library.setDataLoading(this._ZDO_object);
	}
	
	let dataTypes = this.ObjectClass.prototype._dataTypes;
	for (let i = 0; i < dataTypes.length; i++) {
		await this._loadDataTypeInLibrary(dataTypes[i], libraryID, ids);
	}
	
	Trellis.debug(`Loaded ${this._ZDO_objects} in ${library.name} in ${new Date() - t} ms`);
	
	if (!ids) {
		library.setDataLoaded(this._ZDO_object);
	}
};


Trellis.DataObjects.prototype._loadPrimaryData = async function (libraryID, ids, idSQL, options) {
	var loaded = {};
	
	// If library isn't an integer (presumably false or null), skip it
	if (parseInt(libraryID) != libraryID) {
		libraryID = false;
	}
	
	var sql = this.primaryDataSQL;
	var params = [];
	if (libraryID !== false) {
		sql += ' AND O.libraryID=?';
		params.push(libraryID);
	}
	if (ids.length) {
		sql += ' AND O.' + this._ZDO_id + ' IN (' + ids.join(',') + ')';
	}
	
	await Trellis.DB.queryAsync(
		sql,
		params,
		{
			noCache: true,
			onRow: function (row) {
				var id = row.getResultByName(this._ZDO_id);
				var columns = Object.keys(this._primaryDataSQLParts);
				var rowObj = {};
				for (let i=0; i<columns.length; i++) {
					rowObj[columns[i]] = row.getResultByIndex(i);
				}
				var obj;
				
				// Existing object -- reload in place
				if (this._objectCache[id]) {
					this._objectCache[id].loadFromRow(rowObj, true);
					obj = this._objectCache[id];
				}
				// Object doesn't exist -- create new object and stuff in cache
				else {
					obj = this._getObjectForRow(rowObj);
					obj.loadFromRow(rowObj, true);
					if (!options || !options.noCache) {
						this.registerObject(obj);
					}
				}
				loaded[id] = obj;
			}.bind(this)
		}
	);
	
	if (!ids) {
		this._loadedLibraries[libraryID] = true;
		
		// If loading all objects, remove cached objects that no longer exist
		for (let i in this._objectCache) {
			let obj = this._objectCache[i];
			if (libraryID !== false && obj.libraryID !== libraryID) {
				continue;
			}
			if (!loaded[obj.id]) {
				this.unload(obj.id);
			}
		}
		
		if (this._postLoad) {
			this._postLoad(libraryID, ids);
		}
	}
	
	return loaded;
};


Trellis.DataObjects.prototype._loadRelations = async function (libraryID, ids, idSQL) {
	if (!this._relationsTable) {
		throw new Error("Relations not supported for " + this._ZDO_objects);
	}
	
	var sql = "SELECT " + this.idColumn + ", predicate, object "
		+ `FROM ${this.table} LEFT JOIN ${this._relationsTable} USING (${this.idColumn}) `
		+ "LEFT JOIN relationPredicates USING (predicateID) "
		+ "WHERE libraryID=?" + idSQL;
	var params = [libraryID];
	
	var lastID;
	var rows = [];
	var setRows = function (id, rows) {
		var obj = this._objectCache[id];
		if (!obj) {
			throw new Error(this._ZDO_Object + " " + id + " not found");
		}
		
		var relations = {};
		function addRel(predicate, object) {
			if (!relations[predicate]) {
				relations[predicate] = [];
			}
			relations[predicate].push(object);
		}
		
		for (let i = 0; i < rows.length; i++) {
			let row = rows[i];
			addRel(row.predicate, row.object);
		}
		
		/*if (this._objectType == 'item') {
			let getURI = Trellis.URI["get" + this._ObjectType + "URI"].bind(Trellis.URI);
			let objectURI = getURI(this);
			
			// Related items are bidirectional, so include any pointing to this object
			let objects = yield Trellis.Relations.getByPredicateAndObject(
				Trellis.Relations.relatedItemPredicate, objectURI
			);
			for (let i = 0; i < objects.length; i++) {
				addRel(Trellis.Relations.relatedItemPredicate, getURI(objects[i]));
			}
			
			// Also include any owl:sameAs relations pointing to this object
			objects = yield Trellis.Relations.getByPredicateAndObject(
				Trellis.Relations.linkedObjectPredicate, objectURI
			);
			for (let i = 0; i < objects.length; i++) {
				addRel(Trellis.Relations.linkedObjectPredicate, getURI(objects[i]));
			}
		}*/
		
		// Relations are stored as predicate-object pairs
		obj._relations = this.flattenRelations(relations);
		obj._loaded.relations = true;
		obj._clearChanged('relations');
	}.bind(this);
	
	await Trellis.DB.queryAsync(
		sql,
		params,
		{
			noCache: true,
			onRow: function (row) {
				let id = row.getResultByIndex(0);
				
				if (lastID && id !== lastID) {
					setRows(lastID, rows);
					rows = [];
				}
				
				lastID = id;
				let predicate = row.getResultByIndex(1);
				// No relations
				if (predicate === null) {
					return;
				}
				rows.push({
					predicate,
					object: row.getResultByIndex(2)
				});
			}.bind(this)
		}
	);
	
	if (lastID) {
		setRows(lastID, rows);
	}
};


/**
 * Sort an array of collections or items from top-level to deepest, grouped by level
 *
 * All top-level objects are returned, followed by all second-level objects, followed by
 * third-level, etc. The order within each level is undefined.
 *
 * This is used to sort higher-level objects first in upload JSON, since otherwise the API would
 * reject lower-level objects for having missing parents.
 *
 * @param {Trellis.DataObject[]} objects - An array of objects
 * @return {Trellis.DataObject[]} - A sorted array of objects
 */
Trellis.DataObjects.prototype.sortByLevel = function (objects) {
	// Convert to ids
	var ids = objects.map(o => o.id);
	var levels = {};
	
	// Get top-level objects
	var top = objects.filter(o => !o.parentID).map(o => o.id);
	levels["0"] = top.slice();
	ids = Trellis.Utilities.arrayDiff(ids, top);
	
	// For each object in list, walk up its parent tree. If a parent is present in the
	// list of ids, add it to the appropriate level bucket and remove it.
	while (ids.length) {
		let tree = [ids[0]];
		let keep = [ids[0]];
		let id = ids.shift();
		let seen = new Set([id]);
		while (true) {
			let o = Trellis[this._ZDO_Objects].get(id);
			let parentID = o.parentID;
			if (!parentID) {
				break;
			}
			// Avoid an infinite loop if objects are incorrectly nested within each other
			if (seen.has(parentID)) {
				throw new Trellis.Error(
					`Incorrectly nested ${this._ZDO_objects}`,
					Trellis.Error.ERROR_INVALID_OBJECT_NESTING,
					{
						[this._ZDO_id]: id
					}
				);
			}
			seen.add(parentID);
			tree.push(parentID);
			// If parent is in list, remove it
			let pos = ids.indexOf(parentID);
			if (pos != -1) {
				keep.push(parentID);
				ids.splice(pos, 1);
			}
			id = parentID;
		}
		let level = tree.length - 1;
		for (let i = 0; i < tree.length; i++) {
			let currentLevel = level - i;
			for (let j = 0; j < keep.length; j++) {
				if (tree[i] != keep[j]) continue;
				
				if (!levels[currentLevel]) {
					levels[currentLevel] = [];
				}
				levels[currentLevel].push(keep[j]);
			}
		}
	}
	
	var ordered = [];
	for (let level in levels) {
		ordered = ordered.concat(levels[level]);
	}
	// Convert back to objects
	return ordered.map(id => Trellis[this._ZDO_Objects].get(id));
};


/**
 * Sort an array of collections or items from top-level to deepest, grouped by parent
 *
 * Child objects are included before any sibling objects. The order within each level is undefined.
 *
 * This is used to sort higher-level objects first in upload JSON, since otherwise the API would
 * reject lower-level objects for having missing parents.
 *
 * @param {Trellis.DataObject[]} ids - An array of data objects
 * @return {Trellis.DataObject[]} - A sorted array of data objects
 */
Trellis.DataObjects.prototype.sortByParent = function (objects) {
	// Convert to ids
	var ids = objects.map(o => o.id);
	var ordered = [];
	
	// For each object in list, walk up its parent tree. If a parent is present in the list of
	// objects, keep track of it and remove it from the list. When we get to a top-level object, add
	// all the objects we've kept to the ordered list.
	while (ids.length) {
		let id = ids.shift();
		let keep = [id];
		let seen = new Set([id]);
		while (true) {
			let o = Trellis[this._ZDO_Objects].get(id);
			let parentID = o.parentID;
			if (!parentID) {
				// We've reached a top-level object, so add any kept ids to the list
				ordered.push(...keep);
				break;
			}
			// Avoid an infinite loop if objects are incorrectly nested within each other
			if (seen.has(parentID)) {
				throw new Trellis.Error(
					`Incorrectly nested ${this._ZDO_objects}`,
					Trellis.Error.ERROR_INVALID_OBJECT_NESTING,
					{
						[this._ZDO_id]: id
					}
				);
			}
			seen.add(parentID);
			// If parent is in list of ids, keep it and remove it from list
			let pos = ids.indexOf(parentID);
			if (pos != -1) {
				keep.unshift(parentID);
				ids.splice(pos, 1);
			}
			// Otherwise, check if parent has already been added to the ordered list, in which case
			// we can slot in all kept ids after it
			else {
				pos = ordered.indexOf(parentID);
				if (pos != -1) {
					ordered.splice(pos + 1, 0, ...keep);
					break;
				}
			}
			id = parentID;
		}
	}
	
	// Convert back to objects
	return ordered.map(id => Trellis[this._ZDO_Objects].get(id));
}


/**
 * Flatten API JSON relations object into an array of unique predicate-object pairs
 *
 * @param {Object} relations - Relations object in API JSON format, with predicates as keys
 *                             and arrays of URIs as objects
 * @return {Array[]} - Predicate-object pairs
 */
Trellis.DataObjects.prototype.flattenRelations = function (relations) {
	var relationsFlat = [];
	for (let predicate in relations) {
		let object = relations[predicate];
		if (Array.isArray(object)) {
			object = Trellis.Utilities.arrayUnique(object);
			for (let i = 0; i < object.length; i++) {
				relationsFlat.push([predicate, object[i]]);
			}
		}
		else if (typeof object == 'string') {
			relationsFlat.push([predicate, object]);
		}
		else {
			Trellis.debug(object, 1);
			throw new Error("Invalid relation value");
		}
	}
	return relationsFlat;
}


/**
 * Reload loaded data of loaded objects
 *
 * @param {Array|Number} ids - An id or array of ids
 * @param {Array} [dataTypes] - Data types to reload (e.g., 'primaryData'), or all loaded
 *                              types if not provided
   * @param {Boolean} [reloadUnchanged=false] - Reload even data that hasn't changed internally.
   *                                            This should be set to true for data that was
   *                                            changed externally (e.g., globally renamed tags).
   */
Trellis.DataObjects.prototype.reload = async function (ids, dataTypes, reloadUnchanged) {
	ids = Trellis.flattenArguments(ids);
	
	Trellis.debug('Reloading ' + (dataTypes ? '[' + dataTypes.join(', ') + '] for ' : '')
		+ this._ZDO_objects + ' ' + ids);
	
	// If data types not specified, reload loaded data for each object individually.
	// TODO: optimize
	if (!dataTypes) {
		for (let i=0; i<ids.length; i++) {
			if (this._objectCache[ids[i]]) {
				await this._objectCache[ids[i]].reload(dataTypes, reloadUnchanged);
			}
		}
		return;
	}
	
	for (let dataType of dataTypes) {
		let typeIDsByLibrary = {};
		for (let id of ids) {
			let obj = this._objectCache[id];
			if (!obj || !obj._loaded[dataType] || obj._skipDataTypeLoad[dataType]
					|| (!reloadUnchanged && !obj._changed[dataType])) {
				continue;
			}
			if (!typeIDsByLibrary[obj.libraryID]) {
				typeIDsByLibrary[obj.libraryID] = [];
			}
			typeIDsByLibrary[obj.libraryID].push(id);
		}
		for (let libraryID in typeIDsByLibrary) {
			await this._loadDataTypeInLibrary(dataType, parseInt(libraryID), typeIDsByLibrary[libraryID]);
		}
	}
	
	return true;
};


Trellis.DataObjects.prototype.reloadAll = function (libraryID) {
	Trellis.debug("Reloading all " + this._ZDO_objects);
	
	// Remove objects not stored in database
	var sql = "SELECT ROWID FROM " + this._ZDO_table;
	var params = [];
	if (libraryID !== undefined) {
		sql += ' WHERE libraryID=?';
		params.push(libraryID);
	}
	return Trellis.DB.columnQueryAsync(sql, params)
	.then(function (ids) {
		for (var id in this._objectCache) {
			if (!ids || ids.indexOf(parseInt(id)) == -1) {
				delete this._objectCache[id];
			}
		}
		
		// Reload data
		this._loadedLibraries[libraryID] = false;
		return this._load(libraryID);
	});
}


Trellis.DataObjects.prototype.registerObject = function (obj) {
	var id = obj.id;
	var libraryID = obj.libraryID;
	var key = obj.key;
	
	//Trellis.debug("Registering " + this._ZDO_object + " " + id + " as " + libraryID + "/" + key);
	if (!this._objectIDs[libraryID]) {
		this._objectIDs[libraryID] = {};
	}
	this._objectIDs[libraryID][key] = id;
	this._objectKeys[id] = [libraryID, key];
	this._objectCache[id] = obj;
	obj._inCache = true;
}

Trellis.DataObjects.prototype.dropDeadObjectsFromCache = function () {
	let ids = [];
	for (let libraryID in this._objectIDs) {
		if (Trellis.Libraries.exists(libraryID)) continue;
		for (let key in this._objectIDs[libraryID]) {
			ids.push(this._objectIDs[libraryID][key]);
		}
	}
	
	this.unload(ids);
}

/**
 * Clear object from internal array
 *
 * @param	int[]	ids		objectIDs
 */
Trellis.DataObjects.prototype.unload = function () {
	var ids = Trellis.flattenArguments(arguments);
	for (var i=0; i<ids.length; i++) {
		let id = ids[i];
		let {libraryID, key} = this.getLibraryAndKeyFromID(id);
		if (key) {
			delete this._objectIDs[libraryID][key];
			delete this._objectKeys[id];
		}
		delete this._objectCache[id];
	}
}


/**
 * Set the version of objects, efficiently
 *
 * @param {Integer[]} ids - Ids of objects to update
 * @param {Boolean} version
 */
Trellis.DataObjects.prototype.updateVersion = function (ids, version) {
	if (version != parseInt(version)) {
		throw new Error("'version' must be an integer ('" + version + "' given)");
	}
	version = parseInt(version);
	
	let sql = "UPDATE " + this.table + " SET version=" + version + " "
		+ "WHERE " + this.idColumn + " IN (";
	return Trellis.Utilities.Internal.forEachChunkAsync(
		ids,
		Trellis.DB.MAX_BOUND_PARAMETERS,
		async function (chunk) {
			await Trellis.DB.queryAsync(sql + chunk.map(() => '?').join(', ') + ')', chunk);
			// Update the internal 'version' property of any loaded objects
			for (let i = 0; i < chunk.length; i++) {
				let id = chunk[i];
				let obj = this._objectCache[id];
				if (obj) {
					obj.updateVersion(version, true);
				}
			}
		}.bind(this)
	);
};


/**
 * Set the sync state of objects, efficiently
 *
 * @param {Integer[]} ids - Ids of objects to update
 * @param {Boolean} synced
 */
Trellis.DataObjects.prototype.updateSynced = function (ids, synced) {
	let sql = "UPDATE " + this.table + " SET synced=" + (synced ? 1 : 0) + " "
		+ "WHERE " + this.idColumn + " IN (";
	return Trellis.Utilities.Internal.forEachChunkAsync(
		ids,
		Trellis.DB.MAX_BOUND_PARAMETERS,
		async function (chunk) {
			await Trellis.DB.queryAsync(sql + chunk.map(() => '?').join(', ') + ')', chunk);
			// Update the internal 'synced' property of any loaded objects
			for (let i = 0; i < chunk.length; i++) {
				let id = chunk[i];
				let obj = this._objectCache[id];
				if (obj) {
					obj.updateSynced(!!synced, true);
				}
			}
		}.bind(this)
	);
};


Trellis.DataObjects.prototype.isEditable = function (obj) {
	var libraryID = obj.libraryID;
	if (!libraryID) {
		return true;
	}
	
	if (!Trellis.Libraries.get(libraryID).editable) return false;
	
	if (obj.objectType == 'item' && obj.isAttachment()
		&& (obj.attachmentLinkMode == Trellis.Attachments.LINK_MODE_IMPORTED_URL ||
			obj.attachmentLinkMode == Trellis.Attachments.LINK_MODE_IMPORTED_FILE)
		&& !Trellis.Libraries.get(libraryID).filesEditable
	) {
		return false;
	}
	
	return true;
}

Trellis.defineProperty(Trellis.DataObjects.prototype, "primaryDataSQL", {
	get: function () {
		return "SELECT "
		+ Object.keys(this._primaryDataSQLParts).map((val) => this._primaryDataSQLParts[val]).join(', ')
		+ this.primaryDataSQLFrom;
	}
}, {lazy: true});

Trellis.DataObjects.prototype.getPrimaryDataSQLPart = function (part) {
	var sql = this._primaryDataSQLParts[part];
	if (!sql) {
		throw new Error("Invalid primary data SQL part '" + part + "'");
	}
	return sql;
}


/**
 * Delete one or more objects from the database and caches
 *
 * @param {Integer|Integer[]} ids - Object ids
 * @param {Object} [options] - See Trellis.DataObject.prototype.erase
 * @param {Function} [options.onProgress] - f(progress, progressMax)
 * @return {Promise}
 */
Trellis.DataObjects.prototype.erase = async function (ids, options = {}) {
	ids = Trellis.flattenArguments(ids);
	await Trellis.DB.executeTransaction(async function () {
		for (let i = 0; i < ids.length; i++) {
			let obj = await this.getAsync(ids[i]);
			if (!obj) {
				continue;
			}
			await obj.erase(options);
			if (options.onProgress) {
				options.onProgress(i + 1, ids.length);
			}
		}
		this.unload(ids);
	}.bind(this));
};


// TEMP: remove
Trellis.DataObjects.prototype._load = async function (libraryID, ids, options) {
	var loaded = {};

	// If library isn't an integer (presumably false or null), skip it
	if (parseInt(libraryID) != libraryID) {
		libraryID = false;
	}

	if (libraryID === false && !ids) {
		throw new Error("Either libraryID or ids must be provided");
	}

	if (libraryID !== false && this._loadedLibraries[libraryID]) {
		return loaded;
	}

	var sql = this.primaryDataSQL;
	var params = [];
	if (libraryID !== false) {
		sql += ' AND O.libraryID=?';
		params.push(libraryID);
	}
	if (ids) {
		sql += ' AND O.' + this._ZDO_id + ' IN (' + ids.join(',') + ')';
	}

	var t = new Date();
	await Trellis.DB.queryAsync(
		sql,
		params,
		{
			onRow: function (row) {
				var id = row.getResultByName(this._ZDO_id);
				var columns = Object.keys(this._primaryDataSQLParts);
				var rowObj = {};
				for (let i=0; i<columns.length; i++) {
					rowObj[columns[i]] = row.getResultByIndex(i);
				}
				var obj;

				// Existing object -- reload in place
				if (this._objectCache[id]) {
					this._objectCache[id].loadFromRow(rowObj, true);
					obj = this._objectCache[id];
				}
				// Object doesn't exist -- create new object and stuff in cache
				else {
					obj = this._getObjectForRow(rowObj);
					obj.loadFromRow(rowObj, true);
					if (!options || !options.noCache) {
						this.registerObject(obj);
					}
				}
				loaded[id] = obj;
			}.bind(this)
		}
	);
	Trellis.debug("Loaded " + this._ZDO_objects + " in " + ((new Date) - t) + "ms");

	if (!ids) {
		this._loadedLibraries[libraryID] = true;

		// If loading all objects, remove cached objects that no longer exist
		for (let i in this._objectCache) {
			let obj = this._objectCache[i];
			if (libraryID !== false && obj.libraryID !== libraryID) {
				continue;
			}
			if (!loaded[obj.id]) {
				this.unload(obj.id);
			}
		}

		if (this._postLoad) {
			this._postLoad(libraryID, ids);
		}
	}

	return loaded;
};

Trellis.DataObjects.prototype._loadSerial = Trellis.Utilities.Internal.serial(Trellis.DataObjects.prototype._load);

Trellis.DataObjects.prototype._getObjectForRow = function (row) {
	return new Trellis[this._ZDO_Object];
};

Trellis.DataObjects.prototype._loadIDsAndKeys = async function () {
	var sql = "SELECT ROWID AS id, libraryID, key FROM " + this._ZDO_table;
	var rows = await Trellis.DB.queryAsync(sql);
	for (let i=0; i<rows.length; i++) {
		let row = rows[i];
		this._objectKeys[row.id] = [row.libraryID, row.key];
		if (!this._objectIDs[row.libraryID]) {
			this._objectIDs[row.libraryID] = {};
		}
		this._objectIDs[row.libraryID][row.key] = row.id;
	}
};
