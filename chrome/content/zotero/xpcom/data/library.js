/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2015 Center for History and New Media
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

Trellis.Library = function (params = {}) {
	let objectType = this._objectType;
	this._ObjectType = Trellis.Utilities.capitalize(objectType);
	this._objectTypePlural = Trellis.DataObjectUtilities.getObjectTypePlural(objectType);
	this._ObjectTypePlural = Trellis.Utilities.capitalize(this._objectTypePlural);
	
	this._changed = {};
	
	this._dataLoaded = {};
	this._dataLoadedDeferreds = {};
	
	this._hasCollections = null;
	this._hasSearches = null;
	this._storageDownloadNeeded = false;
	
	this._lastReadItemInSession = null;
	
	Trellis.Utilities.Internal.assignProps(
		this,
		params,
		[
			'libraryType',
			'editable',
			'filesEditable',
			'libraryVersion',
			'storageVersion',
			'lastSync',
			'archived'
		]
	);
	
	// Return a proxy so that we can disable the object once it's deleted
	return new Proxy(this, {
		get: function (obj, prop) {
			if (obj._disabled && !(prop == 'libraryID' || prop == 'id' || prop == 'name')) {
				throw new Error("Library (" + obj.libraryID + ") has been disabled");
			}
			return obj[prop];
		}
	});
};

/**
 * Non-prototype properties
 */
// DB columns
Trellis.defineProperty(Trellis.Library, '_dbColumns', {
	value: Object.freeze([
		'type', 'editable', 'filesEditable', 'version', 'storageVersion', 'lastSync', 'archived', 'isAdmin'
	])
});

// Converts DB column name to (internal) object property
Trellis.Library._colToProp = function (c) {
	return "_library" + Trellis.Utilities.capitalize(c);
}

// Select all columns in a unique manner, so we can JOIN tables with same column names (e.g. version)
Trellis.defineProperty(Trellis.Library, '_rowSQLSelect', {
	value: "L.libraryID, " + Trellis.Library._dbColumns.map(c => "L." + c + " AS " + Trellis.Library._colToProp(c)).join(", ")
		+ ", (SELECT COUNT(*)>0 FROM collections C WHERE C.libraryID=L.libraryID) AS hasCollections"
		+ ", (SELECT COUNT(*)>0 FROM savedSearches S WHERE S.libraryID=L.libraryID) AS hasSearches"
});

// The actual select statement for above columns
Trellis.defineProperty(Trellis.Library, '_rowSQL', {
	value: "SELECT " + Trellis.Library._rowSQLSelect + " FROM libraries L"
});

/**
 * Prototype properties
 */
Trellis.defineProperty(Trellis.Library.prototype, '_objectType', {
	value: 'library'
});

Trellis.defineProperty(Trellis.Library.prototype, '_childObjectTypes', {
	value: Object.freeze(['item', 'collection', 'search'])
});

// Valid library types
Trellis.defineProperty(Trellis.Library.prototype, 'libraryTypes', {
	value: Object.freeze(['user'])
});

// Immutable libraries
Trellis.defineProperty(Trellis.Library.prototype, 'fixedLibraries', {
	value: Object.freeze(['user'])
});

Trellis.defineProperty(Trellis.Library.prototype, 'libraryID', {
	get: function () { return this._libraryID; },
	set: function (id) { throw new Error("Cannot change library ID"); }
});

Trellis.defineProperty(Trellis.Library.prototype, 'id', {
	get: function () { return this.libraryID; },
	set: function (val) { return this.libraryID = val; }
});

Trellis.defineProperty(Trellis.Library.prototype, 'libraryType', {
	get: function () { return this._get('_libraryType'); },
	set: function (v) { return this._set('_libraryType', v); }
});

Trellis.defineProperty(Trellis.Library.prototype, 'lastReadItemInSession', {
	get() { return this._lastReadItemInSession; },
	set(val) { this._lastReadItemInSession = val; }
});

/**
 * Get the library-type-specific id for the library (e.g., userID for user library,
 * groupID for group library)
 *
 * @property
 */
Trellis.defineProperty(Trellis.Library.prototype, 'libraryTypeID', {
	get: function () {
		switch (this._libraryType) {
		case 'user':
			return Trellis.Users.getCurrentUserID() || 0;
		
		case 'group':
			return Trellis.Groups.getGroupIDFromLibraryID(this._libraryID);
		
		default:
			throw new Error(`Tried to get library type id for ${this._libraryType} library`);
		}
	}
});

Trellis.defineProperty(Trellis.Library.prototype, 'isGroup', {
	get: function () {
		return this.libraryType == 'group';
	}
});

Trellis.defineProperty(Trellis.Library.prototype, 'libraryVersion', {
	get: function () { return this._get('_libraryVersion'); },
	set: function (v) { return this._set('_libraryVersion', v); }
});


Trellis.defineProperty(Trellis.Library.prototype, 'syncable', {
	get: function () { return this._libraryType != 'feed'; }
});


Trellis.defineProperty(Trellis.Library.prototype, 'lastSync', {
	get: function () { return this._get('_libraryLastSync'); }
});


Trellis.defineProperty(Trellis.Library.prototype, 'name', {
	get: function () {
		if (this._libraryType == 'user') {
			return Trellis.getString('pane.collections.library');
		}
		
		// This property is provided by the extending objects (Group, Feed) for other library types
		throw new Error('Unhandled library type "' + this._libraryType + '"');
	}
});

Trellis.defineProperty(Trellis.Library.prototype, 'treeViewID', {
	get: function () {
		return "L" + this._libraryID;
	}
});

Trellis.defineProperty(Trellis.Library.prototype, 'treeViewImage', {
	get: function () {
		return "chrome://trellis/skin/16/universal/library.svg";
	}
});

Trellis.defineProperty(Trellis.Library.prototype, 'hasTrash', {
	value: true
});

Trellis.defineProperty(Trellis.Library.prototype, 'allowsLinkedFiles', {
	value: true
});

// Create other accessors
(function () {
	let accessors = ['editable', 'filesEditable', 'storageVersion', 'archived', 'isAdmin'];
	for (let i=0; i<accessors.length; i++) {
		let prop = Trellis.Library._colToProp(accessors[i]);
		Trellis.defineProperty(Trellis.Library.prototype, accessors[i], {
			get: function () { return this._get(prop); },
			set: function (v) { return this._set(prop, v); }
		})
	}
})()

Trellis.defineProperty(Trellis.Library.prototype, 'storageDownloadNeeded', {
	get: function () { return this._storageDownloadNeeded; },
	set: function (val) { this._storageDownloadNeeded = !!val; },
})

Trellis.Library.prototype._isValidProp = function (prop) {
	let prefix = '_library';
	if (prop.indexOf(prefix) !== 0 || prop.length == prefix.length) {
		return false;
	}
	
	let col = prop.substr(prefix.length);
	col = col.charAt(0).toLowerCase() + col.substr(1);
	
	return Trellis.Library._dbColumns.indexOf(col) != -1;
}

Trellis.Library.prototype._get = function (prop) {
	if (!this._isValidProp(prop)) {
		throw new Error('Unknown property "' + prop + '"');
	}
	
	return this[prop];
}

Trellis.Library.prototype._set = function (prop, val) {
	if (!this._isValidProp(prop)) {
		throw new Error('Unknown property "' + prop + '"');
	}
	
	// Ensure proper format
	switch(prop) {
		case '_libraryType':
			if (this.libraryTypes.indexOf(val) == -1) {
				throw new Error('Invalid library type "' + val + '"');
			}
			
			if (this.libraryID !== undefined) {
				throw new Error("Library type cannot be changed for a saved library");
			}
			
			if (this.fixedLibraries.indexOf(val) != -1) {
				throw new Error('Cannot create library of type "' + val + '"');
			}
			break;
		
		case '_libraryEditable':
		case '_libraryFilesEditable':
			if (['user'].indexOf(this._libraryType) != -1) {
				throw new Error('Cannot change ' + prop + ' for ' + this._libraryType + ' library');
			}
			val = !!val;
			
			// Setting 'editable' to false should also set 'filesEditable' to false
			if (prop == '_libraryEditable' && !val) {
				this._set('_libraryFilesEditable', false);
			}
			break;
		
		case '_libraryVersion':
			var newVal = Number.parseInt(val, 10);
			if (newVal != val) {
				throw new Error(`${prop} must be an integer (${typeof val} '${val}' given)`);
			}
			val = newVal
			
			// Allow -1 to indicate that a full sync is needed
			if (val < -1) throw new Error(prop + ' must not be less than -1');
			
			// Ensure that it is never decreasing, unless it is being set to -1
			if (val != -1 && val < this._libraryVersion) {
				// Caught in syncEngine to trigger a full sync (e.g., after a server-side
				// account deletion/recreation has reset the remote library version)
				let e = new Error(prop + ' cannot decrease');
				e.name = 'TrellisLibraryVersionDecreaseError';
				throw e;
			}
			
			break;
		
		case '_libraryStorageVersion':
			var newVal = parseInt(val);
			if (newVal != val) {
				throw new Error(`${prop} must be an integer (${typeof val} '${val}' given)`);
			}
			// Ensure that it is never decreasing, unless it is being set to -1
			// by Reset File Sync History
			if (val != -1 && val < this._libraryStorageVersion) {
				// Caught in syncEngine to trigger a full sync (e.g., after a server-side
				// account deletion/recreation has reset the remote library version)
				let e = new Error(prop + ' cannot decrease');
				e.name = 'TrellisLibraryVersionDecreaseError';
				throw e;
			}
			val = newVal;
			break;
		
		case '_libraryLastSync':
			if (!val) {
				val = false;
			} else if (!(val instanceof Date)) {
				throw new Error(prop + ' must be a Date object or falsy');
			} else {
				// Storing to DB will drop milliseconds, so, for consistency, we drop it now
				val = new Date(Math.floor(val.getTime()/1000) * 1000);
			}
			break;
		
		case '_libraryArchived':
			if (['user', 'feeds'].indexOf(this._libraryType) != -1) {
				throw new Error('Cannot change ' + prop + ' for ' + this._libraryType + ' library');
			}
			if (val && this._libraryEditable) {
				throw new Error('Cannot set editable library as archived');
			}
			val = !!val;
			break;
	}
	
	if (this[prop] == val) return; // Unchanged
	
	if (this._changed[prop]) {
		// Catch attempts to re-set already set fields before saving
		Trellis.debug('Warning: Attempting to set unsaved ' + this._objectType + ' property "' + prop + '"', 2, true);
	}
	
	this._changed[prop] = true;
	this[prop] = val;
}

Trellis.Library.prototype._loadDataFromRow = function (row) {
	if (this._libraryID !== undefined && this._libraryID !== row.libraryID) {
		Trellis.debug("Warning: library ID changed in Trellis.Library._loadDataFromRow", 2, true);
	}
	
	this._libraryID = row.libraryID;
	this._libraryType = row._libraryType;
	
	this._libraryEditable = !!row._libraryEditable;
	this._libraryFilesEditable = !!row._libraryFilesEditable;
	this._libraryVersion = row._libraryVersion;
	this._libraryStorageVersion = row._libraryStorageVersion;
	this._libraryLastSync =  row._libraryLastSync !== 0 ? new Date(row._libraryLastSync * 1000) : false;
	this._libraryArchived = !!row._libraryArchived;
	this._libraryIsAdmin = !!row._libraryIsAdmin;

	this._hasCollections = !!row.hasCollections;
	this._hasSearches = !!row.hasSearches;
	
	this._changed = {};
}

Trellis.Library.prototype._reloadFromDB = async function () {
	let sql = Trellis.Library._rowSQL + ' WHERE libraryID=?';
	let row = await Trellis.DB.rowQueryAsync(sql, [this.libraryID]);
	this._loadDataFromRow(row);
};

/**
 * Load object data in this library
 */
Trellis.Library.prototype.loadAllDataTypes = async function () {
	await Trellis.SyncedSettings.loadAll(this.libraryID);
	await Trellis.Collections.loadAll(this.libraryID);
	await Trellis.Searches.loadAll(this.libraryID);
	await Trellis.Items.loadAll(this.libraryID);
};

//
// Methods to handle promises that are resolved when object data is loaded for the library
//
Trellis.Library.prototype.getDataLoaded = function (objectType) {
	return this._dataLoaded[objectType] || null;
};

Trellis.Library.prototype.setDataLoading = function (objectType) {
	if (this._dataLoadedDeferreds[objectType]) {
		throw new Error("Items already loading for library " + this.libraryID);
	}
	this._dataLoadedDeferreds[objectType] = Trellis.Promise.defer();
};

Trellis.Library.prototype.getDataLoadedPromise = function (objectType) {
	return this._dataLoadedDeferreds[objectType]
		? this._dataLoadedDeferreds[objectType].promise : null;
};

Trellis.Library.prototype.setDataLoaded = function (objectType) {
	this._dataLoaded[objectType] = true;
	this._dataLoadedDeferreds[objectType].resolve();
};

/**
 * Wait for a given data type to load, loading it now if necessary
 */
Trellis.Library.prototype.waitForDataLoad = async function (objectType) {
	if (this.getDataLoaded(objectType)) return;
	
	let promise = this.getDataLoadedPromise(objectType);
	// If items are already being loaded, wait for them
	if (promise) {
		await promise;
	}
	// Otherwise load them now
	else {
		let objectsClass = Trellis.DataObjectUtilities.getObjectsClassForObjectType(objectType);
		await objectsClass.loadAll(this.libraryID);
	}
};

Trellis.Library.prototype.isChildObjectAllowed = function (type) {
	return this._childObjectTypes.indexOf(type) != -1;
};

Trellis.Library.prototype.updateLastSyncTime = function () {
	this._set('_libraryLastSync', new Date());
};

Trellis.Library.prototype.saveTx = function (options) {
	options = options || {};
	options.tx = true;
	return this.save(options);
}

Trellis.Library.prototype.save = async function (options) {
	options = options || {};
	var env = {
		options: options,
		transactionOptions: options.transactionOptions || {}
	};
	
	if (!env.options.tx && !Trellis.DB.inTransaction()) {
		Trellis.logError("save() called on Trellis.Library without a wrapping "
			+ "transaction -- use saveTx() instead", 2, true);
		env.options.tx = true;
	}
	
	var proceed = await this._initSave(env)
		.catch(async function (e) {
			if (!env.isNew && Trellis.Libraries.exists(this.libraryID)) {
				// Reload from DB and reset this._changed, so this is not a permanent failure
				await this._reloadFromDB();
			}
			throw e;
		}.bind(this));
	
	if (!proceed) return false;
	
	if (env.isNew) {
		Trellis.debug('Saving data for new ' + this._objectType + ' to database', 4);
	}
	else {
		Trellis.debug('Updating database with new ' + this._objectType + ' data', 4);
	}
	
	try {
		env.notifierData = {};
		if (env.options.skipSelect) {
			env.notifierData.skipSelect = true;
		}
		
		// Create transaction
		if (env.options.tx) {
			return Trellis.DB.executeTransaction(async function () {
				await this._saveData(env);
				await this._finalizeSave(env);
			}.bind(this), env.transactionOptions);
		}
		// Use existing transaction
		else {
			Trellis.DB.requireTransaction();
			await this._saveData(env);
			await this._finalizeSave(env);
		}
	} catch(e) {
		Trellis.debug(e, 1);
		throw e;
	}
};

Trellis.Library.prototype._initSave = async function (env) {
	if (this._libraryID === undefined) {
		env.isNew = true;
		
		if (!this._libraryType) {
			throw new Error("libraryType must be set before saving");
		}
		
		if (typeof this._libraryEditable != 'boolean') {
			throw new Error("editable must be set before saving");
		}
		
		if (typeof this._libraryFilesEditable != 'boolean') {
			throw new Error("filesEditable must be set before saving");
		}
	} else {
		Trellis.Libraries._ensureExists(this._libraryID);
		
		if (!Object.keys(this._changed).length) {
			Trellis.debug(`No data changed in ${this._objectType} ${this.id} -- not saving`, 4);
			return false;
		}
	}
	
	return true;
};

Trellis.Library.prototype._saveData = async function (env) {
	// Collect changed columns
	let changedCols = [],
		params = [];
	for (let i=0; i<Trellis.Library._dbColumns.length; i++) {
		let col = Trellis.Library._dbColumns[i];
		let prop = Trellis.Library._colToProp(col);
		
		if (this._changed[prop]) {
			changedCols.push(col);
			
			let val = this[prop];
			if (col == 'lastSync') {
				// convert to integer
				val = val ? Math.floor(val.getTime() / 1000) : 0;
			}
			else if (typeof val == 'boolean') {
				val = val ? 1 : 0;
			}
			
			params.push(val);
		}
	}
	
	if (env.isNew) {
		let id = Trellis.ID.get('libraries');
		changedCols.unshift('libraryID');
		params.unshift(id);
		
		let sql = "INSERT INTO libraries (" + changedCols.join(", ") + ") "
			+ "VALUES (" + Array(params.length).fill("?").join(", ") + ")";
		await Trellis.DB.queryAsync(sql, params);
		
		this._libraryID = id;
	} else if (changedCols.length) {
		params.push(this.libraryID);
		let sql = "UPDATE libraries SET " + changedCols.map(v => v + "=?").join(", ")
			+ " WHERE libraryID=?";
		await Trellis.DB.queryAsync(sql, params);
		
		// Since these are Trellis.Library properties, the 'modify' for the inheriting object may not
		// get triggered, so call it here too
		if (!env.options.skipNotifier && this.libraryType != 'user') {
			Trellis.Notifier.queue('modify', this.libraryType, this.libraryTypeID);
		}
	} else {
		Trellis.debug("Library data did not change for " + this._objectType + " " + this.id, 5);
	}
};

Trellis.Library.prototype._finalizeSave = async function (env) {
	this._changed = {};
	
	if (env.isNew) {
		// Re-fetch from DB to get auto-filled defaults
		await this._reloadFromDB();
		
		Trellis.Libraries.register(this);
		
		await this.loadAllDataTypes();
	}
};

Trellis.Library.prototype.eraseTx = function (options) {
	options = options || {};
	options.tx = true;
	return this.erase(options);
};

Trellis.Library.prototype.erase = async function (options) {
	options = options || {};
	var env = {
		options: options,
		transactionOptions: options.transactionOptions || {}
	};
	
	if (!env.options.tx && !Trellis.DB.inTransaction()) {
		Trellis.logError("erase() called on Trellis." + this._ObjectType + " without a wrapping "
			+ "transaction -- use eraseTx() instead");
		Trellis.debug((new Error).stack, 2);
		env.options.tx = true;
	}
	
	var proceed = await this._initErase(env);
	if (!proceed) return false;
	
	Trellis.debug('Deleting ' + this._objectType + ' ' + this.id);
	
	try {
		env.notifierData = {};
		
		if (env.options.tx) {
			await Trellis.DB.executeTransaction(async function () {
				await this._eraseData(env);
				await this._finalizeErase(env);
			}.bind(this), env.transactionOptions);
		} else {
			Trellis.DB.requireTransaction();
			await this._eraseData(env);
			await this._finalizeErase(env);
		}
	} catch(e) {
		Trellis.debug(e, 1);
		throw e;
	}
};

Trellis.Library.prototype._initErase = function (env) {
	if (this.libraryID === undefined) {
		throw new Error("Attempting to erase an unsaved library");
	}
	
	Trellis.Libraries._ensureExists(this.libraryID);
	
	if (this.fixedLibraries.indexOf(this._libraryType) != -1) {
		throw new Error("Cannot erase library of type '" + this._libraryType + "'");
	}
	
	return true;
};

Trellis.Library.prototype._eraseData = async function (env) {
	// Delete attachment files
	var attachmentKeys = await Trellis.DB.columnQueryAsync(
		"SELECT key FROM items WHERE libraryID=? AND itemID IN "
			+ "(SELECT itemID FROM itemAttachments WHERE linkMode IN (?, ?))",
		[
			this.libraryID,
			Trellis.Attachments.LINK_MODE_IMPORTED_FILE,
			Trellis.Attachments.LINK_MODE_IMPORTED_URL
		]
	);
	if (attachmentKeys.length) {
		Trellis.DB.addCurrentCallback('commit', async function () {
			for (let key of attachmentKeys) {
				try {
					let dir = Trellis.Attachments.getStorageDirectoryByLibraryAndKey(
						this.libraryID, key
					).path;
					await OS.File.removeDir(
						dir,
						{
							ignoreAbsent: true,
							ignorePermissions: true
						}
					);
				}
				catch (e) {
					Trellis.logError(e);
				}
			}
		}.bind(this));
	}
	
	await Trellis.DB.queryAsync("DELETE FROM libraries WHERE libraryID=?", this.libraryID);
	// TODO: Emit event so this doesn't have to be here
	await Trellis.Fulltext.clearLibraryVersion(this.libraryID);

	// Discard undo/redo history that references this library
	if (Trellis.UndoHistory) {
		Trellis.DB.addCurrentCallback('commit', function () {
			Trellis.UndoHistory.clearForLibrary(this.libraryID);
		}.bind(this));
	}
};

Trellis.Library.prototype._finalizeErase = async function (env) {
	Trellis.Libraries.unregister(this.libraryID);
	
	// Clear cached child objects
	for (let i=0; i<this._childObjectTypes.length; i++) {
		let type = this._childObjectTypes[i];
		Trellis.DataObjectUtilities.getObjectsClassForObjectType(type)
			.dropDeadObjectsFromCache();
	}
	
	this._disabled = true;
};

Trellis.Library.prototype.toResponseJSON = function (options = {}) {
	let uri = Trellis.URI.getLibraryURI(this.libraryID);
	return {
		type: this.libraryType,
		id: this.libraryTypeID,
		name: this.name,
		links: {
			self: {
				href: Trellis.URI.toAPIURL(uri, options.apiURL),
				type: 'application/json'
			},
			alternate: Trellis.Users.getCurrentUserID() ? {
				href: Trellis.URI.toWebURL(uri),
				type: 'text/html'
			} : undefined
		}
	};
};

Trellis.Library.prototype.hasCollections = function () {
	if (this._hasCollections === null) {
		throw new Error("Collection data has not been loaded");
	}
	
	return this._hasCollections;
}

Trellis.Library.prototype.updateCollections = async function () {
	let sql = 'SELECT COUNT(*)>0 FROM collections WHERE libraryID=?';
	this._hasCollections = !!((await Trellis.DB.valueQueryAsync(sql, this.libraryID)));
};

Trellis.Library.prototype.hasSearches = function () {
	if (this._hasSearches === null) {
		throw new Error("Saved search data has not been loaded");
	}
	
	return this._hasSearches;
}

Trellis.Library.prototype.updateSearches = async function () {
	let sql = 'SELECT COUNT(*)>0 FROM savedSearches WHERE libraryID=?';
	this._hasSearches = !!((await Trellis.DB.valueQueryAsync(sql, this.libraryID)));
};

Trellis.Library.prototype.hasItems = async function () {
	if (!this.id) {
		throw new Error("Library is not saved yet");
	}
	let sql = 'SELECT COUNT(*)>0 FROM items WHERE libraryID=?';
	// Don't count old <=4.0 Quick Start Guide items
	if (this.libraryID == Trellis.Libraries.userLibraryID) {
		sql += "AND key NOT IN ('ABCD2345', 'ABCD3456')";
	}
	return !!((await Trellis.DB.valueQueryAsync(sql, this.libraryID)));
};

Trellis.Library.prototype.hasItem = function (item) {
	if (!(item instanceof Trellis.Item)) {
		throw new Error("item must be a Trellis.Item");
	}
	return item.libraryID == this.libraryID;
}
