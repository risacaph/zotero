"use strict";

Trellis.Sync.EventListeners = {
	/**
	 * Start all listeners
	 */
	init: function () {
		for (let i in this) {
			if (i.indexOf('Listener') != -1) {
				if (this[i].init) {
					this[i].init();
				}
			}
		}
	}
};


/**
 * Notifier observer to add deleted objects to syncDeleteLog/storageDeleteLog
 * plus related methods
 */
Trellis.Sync.EventListeners.ChangeListener = new function () {
	this.init = function () {
		// Initialize delete log listener
		// TODO: Support clearing of full-text for an item?
		Trellis.Notifier.registerObserver(
			this, ['collection', 'item', 'search', 'setting'], 'deleteLog'
		);
	}
	
	this.notify = function (event, type, ids, extraData) {
		var syncObjectTypeID = Trellis.Sync.Data.Utilities.getSyncObjectTypeID(type);
		if (!syncObjectTypeID) {
			return;
		}
		
		if (event != 'delete') {
			return;
		}
		
		var syncSQL = "REPLACE INTO syncDeleteLog (syncObjectTypeID, libraryID, key) VALUES ";
		var storageSQL = "REPLACE INTO storageDeleteLog (libraryID, key) VALUES ";
		
		var storageForLibrary = {};
		
		return Trellis.Utilities.Internal.forEachChunkAsync(
			ids,
			100,
			async function (chunk) {
				var syncSets = [];
				var storageSets = [];
				chunk
					.filter(id => !extraData[id] || !extraData[id].skipDeleteLog)
					.forEach(id => {
						if (type == 'setting') {
							var [libraryID, key] = id.split("/");
						}
						else {
							var { libraryID, key } = extraData[id];
						}
						if (!key) {
							throw new Error("Key not provided in notifier object");
						}
						syncSets.push(syncObjectTypeID, libraryID, key);
						
						if (type == 'item') {
							if (storageForLibrary[libraryID] === undefined) {
								storageForLibrary[libraryID] =
									Trellis.Sync.Storage.Local.getModeForLibrary(libraryID) == 'webdav';
							}
							if (storageForLibrary[libraryID] && extraData[id].storageDeleteLog) {
								storageSets.push(libraryID, key);
							}
						}
					});
				
				if (storageSets.length) {
					return Trellis.DB.executeTransaction(async function () {
						await Trellis.DB.queryAsync(
							syncSQL + Array(syncSets.length / 3).fill('(?, ?, ?)').join(', '),
							syncSets
						);
						await Trellis.DB.queryAsync(
							storageSQL + Array(storageSets.length / 2).fill('(?, ?)').join(', '),
							storageSets
						);
					});
				}
				else if (syncSets.length) {
					await Trellis.DB.queryAsync(
						syncSQL + Array(syncSets.length / 3).fill('(?, ?, ?)').join(', '), syncSets
					);
				}
			}
		);
	};
}


Trellis.Sync.EventListeners.AutoSyncListener = {
	_editTimeout: 3,
	_observerID: null,
	
	init: function () {
		// If auto-sync is enabled, initialize the save observer
		if (Trellis.Prefs.get('sync.autoSync')) {
			this.register();
		}
	},
	
	register: function () {
		this._observerID = Trellis.Notifier.registerObserver(this, false, 'autosync');
	},
	
	notify: function (event, type, ids, extraData) {
		switch (event) {
			case 'add':
			case 'modify':
			case 'delete':
			case 'index':
				break;
			
			default:
				return;
		}
		
		// Only trigger sync for certain types
		// TODO: full text
		if (![...Trellis.DataObjectUtilities.getTypes(), 'setting'].includes(type)) {
			return;
		}
		
		var autoSyncDelay = 0;
		if (extraData) {
			// Some events (e.g., writes from the server) skip auto-syncing altogether
			if (extraData.skipAutoSync) {
				return;
			}
			
			// Use a different timeout if specified (e.g., for note editing)
			if (extraData.autoSyncDelay) {
				autoSyncDelay = extraData.autoSyncDelay;
			}
		}
		
		// Determine affected libraries so only those can be synced
		let libraries = [];
		var fileLibraries = new Set();
		var fullTextLibraries = new Set();
		
		if (type == 'setting') {
			for (let id of ids) {
				// E.g., '1/lastPageIndex_u_ABCD2345'
				let libraryID = parseInt(id.split('/')[0]);
				let library = Trellis.Libraries.get(libraryID);
				if (library.syncable) {
					libraries.push(library);
				}
			}
		}
		else if (Trellis.DataObjectUtilities.getTypes().includes(type)) {
			let objectsClass = Trellis.DataObjectUtilities.getObjectsClassForObjectType(type);
			ids.forEach(id => {
				let libraryID;
				let lk = objectsClass.getLibraryAndKeyFromID(id);
				if (lk) {
					libraryID = lk.libraryID;
				}
				// On object deletion, libraryID should be in extraData
				else if (extraData && extraData[id] && extraData[id].libraryID) {
					libraryID = extraData[id].libraryID;
				}
				if (libraryID) {
					let library = Trellis.Libraries.get(libraryID);
					if (library.syncable) {
						libraries.push(library);
					}
				}
			});
		}
		else {
			return;
		}
		
		libraries = Trellis.Sync.Data.Local.filterSkippedLibraries(libraries);
		if (!libraries.length) {
			return;
		}
		
		if (type == 'item') {
			// Check whether file syncing or full-text syncing are necessary
			if (event == 'add' || event == 'modify' || event == 'index') {
				for (let id of ids) {
					let item = Trellis.Items.get(id);
					if (!item) continue;
					if (item.isStoredFileAttachment()) {
						fileLibraries.add(item.libraryID);
					}
					if (item.isFileAttachment()) {
						fullTextLibraries.add(item.libraryID);
					}
				}
			}
		}
		
		Trellis.Sync.Runner.setSyncTimeout(
			autoSyncDelay || this._editTimeout,
			false,
			{
				libraries: [...new Set(libraries.map(library => library.libraryID))],
				fileLibraries: [...fileLibraries],
				fullTextLibraries: [...fullTextLibraries]
			}
		);
	},
	
	unregister: function () {
		if (this._observerID) {
			Trellis.Notifier.unregisterObserver(this._observerID);
		}
	}
}


Trellis.Sync.EventListeners.IdleListener = {
	_idleTimeout: 3600,
	_backTimeout: 900,
	
	init: function () {
		// DEBUG: Allow override for testing
		var idleTimeout = Trellis.Prefs.get("sync.autoSync.idleTimeout");
		if (idleTimeout) {
			this._idleTimeout = idleTimeout;
		}
		var backTimeout = Trellis.Prefs.get("sync.autoSync.backTimeout");
		if (backTimeout) {
			this._backTimeout = backTimeout;
		}
		
		if (Trellis.Prefs.get("sync.autoSync")) {
			this.register();
		}
	},
	
	register: function () {
		Trellis.debug("Registering auto-sync idle observer");
		var idleService = Components.classes["@mozilla.org/widget/useridleservice;1"]
				.getService(Components.interfaces.nsIUserIdleService);
		idleService.addIdleObserver(this, this._idleTimeout);
		idleService.addIdleObserver(this._backObserver, this._backTimeout);
	},
	
	observe: function (subject, topic, data) {
		if (topic != 'idle') {
			return;
		}
		
		if (!Trellis.Sync.Runner.enabled || Trellis.Sync.Runner.syncInProgress) {
			return;
		}
		
		// TODO: move to Runner.sync()?
		if (Trellis.locked) {
			Trellis.debug('Trellis is locked -- skipping idle sync', 4);
			return;
		}
		
		if (Trellis.Sync.Server.manualSyncRequired) {
			Trellis.debug('Manual sync required -- skipping idle sync', 4);
			return;
		}
		
		Trellis.debug("Beginning idle sync");
		
		Trellis.Sync.Runner.setSyncTimeout(this._idleTimeout, true);
		
		Trellis.Sync.Runner.sync({
			background: true
		});
	},
	
	_backObserver: {
		observe: function (subject, topic, data) {
			if (topic !== 'active') {
				return;
			}
			
			Trellis.Sync.Runner.clearSyncTimeout();
			if (!Trellis.Sync.Runner.enabled || Trellis.Sync.Runner.syncInProgress) {
				return;
			}
			Trellis.debug("Beginning return-from-idle sync");
			Trellis.Sync.Runner.sync({
				background: true
			});
		}
	},
	
	unregister: function () {
		Trellis.debug("Unregistering auto-sync idle observer");
		var idleService = Components.classes["@mozilla.org/widget/useridleservice;1"]
				.getService(Components.interfaces.nsIUserIdleService);
		idleService.removeIdleObserver(this, this._idleTimeout);
		idleService.removeIdleObserver(this._backObserver, this._backTimeout);
	}
}



Trellis.Sync.EventListeners.progressListener = {
	onStart: function () {
		
	},
	
	
	onProgress: function (current, max) {
		
	},
	
	
	onStop: function () {
		
	}
};


Trellis.Sync.EventListeners.StorageFileOpenListener = {
	init: function () {
		Trellis.Notifier.registerObserver(this, ['file'], 'storageFileOpen');
	},
	
	notify: function (event, type, ids, extraData) {
		if (event == 'open' && type == 'file') {
			let timestamp = new Date().getTime();
			
			for (let i = 0; i < ids.length; i++) {
				Trellis.Sync.Storage.Local.uploadCheckFiles.push({
					itemID: ids[i],
					timestamp: timestamp
				});
			}
		}
	}
}
