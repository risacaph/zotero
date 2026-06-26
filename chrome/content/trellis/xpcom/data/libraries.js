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

Trellis.Libraries = new function () {
	let _userLibraryID;
	Trellis.defineProperty(this, 'userLibraryID', {
		get: function () { 
			if (_userLibraryID === undefined) {
				throw new Error("Library data not yet loaded");
			}
			return _userLibraryID;
		}
	});
	
	Trellis.defineProperty(this, 'userLibrary', {
		get: function () {
			return Trellis.Libraries.get(_userLibraryID);
		}
	})
	
	/**
	 * Manage cache
	 */
	this._cache = null;
	
	this._makeCache = function () {
		return {};
	}
	
	this.register = function (library) {
		if (!this._cache) throw new Error("Trellis.Libraries cache is not initialized");
		Trellis.debug("Trellis.Libraries: Registering library " + library.libraryID, 5);
		this._addToCache(this._cache, library);
	};
	
	this._addToCache = function (cache, library) {
		if (!library.libraryID) throw new Error("Cannot register an unsaved library");
		cache[library.libraryID] = library;
	}
	
	this.unregister = function (libraryID) {
		if (!this._cache) throw new Error("Trellis.Libraries cache is not initialized");
		Trellis.debug("Trellis.Libraries: Unregistering library " + libraryID, 5);
		delete this._cache[libraryID];
	};
	
	/**
	 * Loads all libraries from DB. Groups, Feeds, etc. should not maintain an
	 * independent cache.
	 */
	this.init = async function () {
		let specialLoading = ['feed', 'group'];
		
		// Invalidate caches until we're done loading everything
		let libTypes = ['library'].concat(specialLoading);
		let newCaches = {};
		for (let i=0; i<libTypes.length; i++) {
			let objs = Trellis.DataObjectUtilities.getObjectsClassForObjectType(libTypes[i]);
			delete objs._cache;
			
			newCaches[libTypes[i]] = objs._makeCache();
		}
		
		let sql = Trellis.Library._rowSQL
			// Exclude libraries that require special loading
			+ " WHERE type NOT IN "
			+ "(" + Array(specialLoading.length).fill('?').join(',') + ")";
		let rows = await Trellis.DB.queryAsync(sql, specialLoading);
		
		for (let i=0; i<rows.length; i++) {
			let row = rows[i];
			
			let library;
			switch (row._libraryType) {
				case 'user':
					library = new Trellis.Library();
					library._loadDataFromRow(row); // Does not call save()
					break;
				default:
					throw new Error('Unhandled library type "' + row._libraryType + '"');
			}
			
			if (library.libraryType == 'user') {
				_userLibraryID = library.libraryID;
			}
			
			this._addToCache(newCaches.library, library);
		}
		
		// Load other libraries
		for (let i=0; i<specialLoading.length; i++) {
			let libType = specialLoading[i];
			let LibType = Trellis.Utilities.capitalize(libType);
			
			let libs = await Trellis.DB.queryAsync(Trellis[LibType]._rowSQL);
			for (let j=0; j<libs.length; j++) {
				let lib = new Trellis[LibType]();
				lib._loadDataFromRow(libs[j]);
				
				this._addToCache(newCaches.library, lib);
				Trellis[lib._ObjectTypePlural]._addToCache(newCaches[libType], lib);
			}
		}
		
		// Set new caches
		for (let libType in newCaches) {
			Trellis.DataObjectUtilities.getObjectsClassForObjectType(libType)
				._cache = newCaches[libType];
		}
	};
	
	/**
	 * @param {Integer} libraryID
	 * @return {Boolean}
	 */
	this.exists = function (libraryID) {
		if (!this._cache) throw new Error("Trellis.Libraries cache is not initialized");
		return this._cache[libraryID] !== undefined;
	}
	
	
	this._ensureExists = function (libraryID) {
		if (!this.exists(libraryID)) {
			throw new Error("Invalid library ID " + libraryID);
		}
	}
	
	
	/**
	 * @return {Trellis.Library[]} - All libraries
	 */
	this.getAll = function () {
		if (!this._cache) throw new Error("Trellis.Libraries cache is not initialized");
		var libraries = Object.keys(this._cache).map(v => Trellis.Libraries.get(parseInt(v)));
		var collation = Trellis.getLocaleCollation();
		// Sort My Library, then others by name
		libraries.sort(function (a, b) {
			if (a.libraryID == _userLibraryID) return -1;
			if (b.libraryID == _userLibraryID) return 1;
			return collation.compareString(1, a.name, b.name);
		}.bind(this))
		return libraries;
	}
	
	
	/**
	 * Get an existing library
	 *
	 * @param {Integer} libraryID
	 * @return {Trellis.Library[] | Trellis.Library}
	 */
	this.get = function (libraryID) {
		return this._cache[libraryID] || false;
	}
	
	
	/**
	 * @deprecated
	 */
	this.getName = function (libraryID) {
		Trellis.debug("Trellis.Libraries.getName() is deprecated. Use Trellis.Library.prototype.name instead");
		this._ensureExists(libraryID);
		return Trellis.Libraries.get(libraryID).name;
	}
	
	
	/**
	 * @deprecated
	 */
	this.getType = function (libraryID) {
		Trellis.debug("Trellis.Libraries.getType() is deprecated. Use Trellis.Library.prototype.libraryType instead");
		this._ensureExists(libraryID);
		return Trellis.Libraries.get(libraryID).libraryType;
	}
	
	
	/**
	 * @deprecated
	 * 
	 * @param {Integer} libraryID
	 * @return {Integer}
	 */
	this.getVersion = function (libraryID) {
		Trellis.debug("Trellis.Libraries.getVersion() is deprecated. Use Trellis.Library.prototype.libraryVersion instead");
		this._ensureExists(libraryID);
		return Trellis.Libraries.get(libraryID).libraryVersion;
	}
	
	
	/**
	 * @deprecated
	 *
	 * @param {Integer} libraryID
	 * @param {Integer} version
	 * @return {Promise}
	 */
	this.setVersion = function (libraryID, version) {
		Trellis.debug("Trellis.Libraries.setVersion() is deprecated. Use Trellis.Library.prototype.libraryVersion instead");
		this._ensureExists(libraryID);
		
		let library = Trellis.Libraries.get(libraryID);
		library.libraryVersion = version;
		return library.saveTx();
	};
	
	/**
	 * @deprecated
	 */
	this.getLastSyncTime = function (libraryID) {
		Trellis.debug("Trellis.Libraries.getLastSyncTime() is deprecated. Use Trellis.Library.prototype.lastSync instead");
		this._ensureExists(libraryID);
		return Trellis.Libraries.get(libraryID).lastSync;
	};
	
	
	/**
	 * @deprecated
	 * 
	 * @param {Integer} libraryID
	 * @param {Date} lastSyncTime
	 * @return {Promise}
	 */
	this.setLastSyncTime = function (libraryID, lastSyncTime) {
		Trellis.debug("Trellis.Libraries.setLastSyncTime() is deprecated. Use Trellis.Library.prototype.lastSync instead");
		this._ensureExists(libraryID);
		
		let library = Trellis.Libraries.get(libraryID);
		library.lastSync = lastSyncTime;
		return library.saveTx();
	};
	
	/**
	 * @deprecated
	 */
	this.isEditable = function (libraryID) {
		Trellis.debug("Trellis.Libraries.isEditable() is deprecated. Use Trellis.Library.prototype.editable instead");
		this._ensureExists(libraryID);
		return Trellis.Libraries.get(libraryID).editable;
	}
	
	/**
	 * @deprecated
	 *
	 * @return {Promise}
	 */
	this.setEditable = async function (libraryID, editable) {
		Trellis.debug("Trellis.Libraries.setEditable() is deprecated. Use Trellis.Library.prototype.editable instead");
		this._ensureExists(libraryID);
		
		let library = Trellis.Libraries.get(libraryID);
		library.editable = editable;
		return library.saveTx();
	};
	
	/**
	 * @deprecated
	 */
	this.isFilesEditable = function (libraryID) {
		Trellis.debug("Trellis.Libraries.isFilesEditable() is deprecated. Use Trellis.Library.prototype.filesEditable instead");
		this._ensureExists(libraryID);
		return Trellis.Libraries.get(libraryID).filesEditable;
	};
	
	/**
	 * @deprecated
	 * 
	 * @return {Promise}
	 */
	this.setFilesEditable = async function (libraryID, filesEditable) {
		Trellis.debug("Trellis.Libraries.setFilesEditable() is deprecated. Use Trellis.Library.prototype.filesEditable instead");
		this._ensureExists(libraryID);
		
		let library = Trellis.Libraries.get(libraryID);
		library.filesEditable = filesEditable;
		return library.saveTx();
	};
	
	/**
	 * @deprecated
	 */
	this.isGroupLibrary = function (libraryID) {
		Trellis.debug("Trellis.Libraries.isGroupLibrary() is deprecated. Use Trellis.Library.prototype.isGroup instead");
		this._ensureExists(libraryID);
		return !!Trellis.Libraries.get(libraryID).isGroup;
	}
	
	/**
	 * @deprecated
	 */
	this.hasTrash = function (libraryID) {
		Trellis.debug("Trellis.Libraries.hasTrash() is deprecated. Use Trellis.Library.prototype.hasTrash instead");
		this._ensureExists(libraryID);
		return Trellis.Libraries.get(libraryID).hasTrash;
	}
	
	/**
	 * @deprecated
	 */
	this.updateLastSyncTime = async function (libraryID) {
		Trellis.debug("Trellis.Libraries.updateLastSyncTime() is deprecated. Use Trellis.Library.prototype.updateLastSyncTime instead");
		this._ensureExists(libraryID);
		
		let library = Trellis.Libraries.get(libraryID);
		library.updateLastSyncTime();
		await library.saveTx();
	}
}