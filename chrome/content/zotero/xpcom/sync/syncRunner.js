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

"use strict";

if (!Trellis.Sync) {
	Trellis.Sync = {};
}

// Initialized as Trellis.Sync.Runner in trellis.js
Trellis.Sync.Runner_Module = function (options = {}) {
	const stopOnError = false;
	
	Trellis.defineProperty(this, 'enabled', {
		get: () => {
			return _apiKey || Trellis.Sync.Data.Local.hasCredentials();
		}
	});
	Trellis.defineProperty(this, 'syncInProgress', { get: () => _syncInProgress });
	Trellis.defineProperty(this, 'lastSyncStatus', { get: () => _lastSyncStatus });
	
	Trellis.defineProperty(this, 'RESET_MODE_FROM_SERVER', { value: 1 });
	Trellis.defineProperty(this, 'RESET_MODE_TO_SERVER', { value: 2 });
	
	Trellis.defineProperty(this, 'baseURL', {
		get: () => {
			let url = options.baseURL || Trellis.Prefs.get("api.url") || TRELLIS_CONFIG.API_URL;
			if (!url.endsWith('/')) {
				url += '/';
			}
			return url;
		}
	});
	this.apiVersion = options.apiVersion || TRELLIS_CONFIG.API_VERSION;
	
	// Allows tests to set apiKey in options or as property, overriding login manager
	var _apiKey = options.apiKey;
	Trellis.defineProperty(this, 'apiKey', { set: val => _apiKey = val });
	
	const { ConcurrentCaller } = ChromeUtils.importESModule("resource://trellis/concurrentCaller.mjs");
	this.caller = new ConcurrentCaller({
		numConcurrent: 4,
		stopOnError,
		logger: msg => Trellis.debug(msg),
		onError: e => Trellis.logError(e)
	});
	
	var _enabled = false;
	var _autoSyncTimer;
	var _delaySyncUntil;
	var _delayPromises = new Set();
	var _firstInSession = true;
	var _syncInProgress = false;
	var _queuedSyncOptions = [];
	var _stopping = false;
	var _canceller;
	var _manualSyncRequired = false; // TODO: make public?
	
	var _currentEngine = null;
	var _storageControllers = {};
	
	var _lastSyncStatus;
	var _currentSyncStatusLabel;
	var _currentLastSyncLabel;
	var _currentTooltipMessages;
	var _errors = [];
	var _tooltipMessages = [];
	
	Trellis.addShutdownListener(() => this.stop());
	
	this.getAPIClient = function (options = {}) {
		return new Trellis.Sync.APIClient({
			baseURL: this.baseURL,
			apiVersion: this.apiVersion,
			schemaVersion: this.globalSchemaVersion,
			apiKey: options.apiKey,
			caller: this.caller,
			cancellerReceiver: _cancellerReceiver,
		});
	}
	
	
	/**
	 * Begin a sync session
	 *
	 * @param {Object}    [options]
	 * @param {Boolean}   [options.background=false]  Whether this is a background request, which
	 *                                                prevents some alerts from being shown
	 * @param {Integer[]} [options.libraries]         IDs of libraries to sync; skipped libraries must
	 *     be removed if unwanted
	 * @param {Function}  [options.onError]           Function to pass errors to instead of
	 *                                                handling internally (used for testing)
	 */
	this.sync = Trellis.serial(function (options = {}) {
		return this._sync(options);
	});


	this._sync = async function (options) {
		// Clear message list
		_errors = [];
		_tooltipMessages = [];

		// Shouldn't be possible because of serial()
		if (_syncInProgress) {
			let msg = Trellis.getString('sync.error.syncInProgress');
			let e = new Trellis.Error(msg, 0, { dialogButtonText: null, frontWindowOnly: true });
			this.updateIcons(e);
			return false;
		}
		_syncInProgress = true;
		_stopping = false;

		// Reset remote-change tracking for this sync; the undo stack is
		// cleared lazily at the end only if remote mutations were applied.
		Trellis.Sync.Data.Local.resetRemoteChangesApplied();
		
		try {
			await Trellis.Notifier.trigger('start', 'sync', []);
			
			let apiKey = await _getAPIKey();
			if (!apiKey) {
				throw new Trellis.Error("API key not set", Trellis.Error.ERROR_API_KEY_NOT_SET);
			}
			
			if (_firstInSession) {
				options.firstInSession = true;
				_firstInSession = false;
			}
			
			this.updateIcons('animate');
			
			// If a delay is set (e.g., from the connector target selector), wait to sync
			while (_delaySyncUntil && new Date() < _delaySyncUntil) {
				this.setSyncStatus(Trellis.getString('sync.status.waiting'));
				let delay = _delaySyncUntil - new Date();
				Trellis.debug(`Waiting ${delay} ms to sync`);
				await Trellis.Promise.delay(delay);
			}
			
			// If paused, wait until we're done
			while (_delayPromises.size) {
				this.setSyncStatus(Trellis.getString('sync.status.waiting'));
				Trellis.debug("Syncing is paused -- waiting to sync");
				await Promise.all(_delayPromises);
			}
			
			// purgeDataObjects() starts a transaction, so if there's an active one then show a
			// nice message and wait until there's not. Another transaction could still start
			// before purgeDataObjects() and result in a wait timeout, but this should reduce the
			// frequency of that.
			while (Trellis.DB.inTransaction()) {
				this.setSyncStatus(Trellis.getString('sync.status.waiting'));
				Trellis.debug("Transaction in progress -- waiting to sync");
				await Trellis.DB.waitForTransaction('sync');
				_stopCheck();
			}
			
			this.setSyncStatus(Trellis.getString('sync.status.preparing'));
			
			let client = this.getAPIClient({ apiKey });
			let keyInfo = await this.checkAccess(client, options);
			
			_stopCheck();
			
			let emptyLibraryContinue = await this.checkEmptyLibrary(keyInfo);
			if (!emptyLibraryContinue) {
				Trellis.debug("Syncing cancelled because user library is empty");
				return false;
			}
			
			let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
				.getService(Components.interfaces.nsIWindowMediator);
			let lastWin = wm.getMostRecentWindow("navigator:browser");
			let ok = await Trellis.Sync.Data.Local.checkUser(
				lastWin,
				keyInfo.userID,
				keyInfo.username,
				keyInfo.displayName,
				keyInfo.emails
			);
			if (!ok) {
				Trellis.debug("User cancelled sync on username mismatch");
				return false;
			}
			
			let engineOptions = {
				userID: keyInfo.userID,
				apiClient: client,
				caller: this.caller,
				setStatus: this.setSyncStatus.bind(this),
				stopOnError,
				onError: function (e) {
					// Ignore cancelled requests
					if (e instanceof Trellis.HTTP.CancelledException) {
						Trellis.debug("Request was cancelled");
						return;
					}
					if (options.onError) {
						options.onError(e);
					}
					else {
						this.addError(e);
					}
				}.bind(this),
				background: !!options.background,
				firstInSession: options.firstInSession,
				resetMode: options.resetMode
			};
			
			var librariesToSync = options.libraries = await this.checkLibraries(
				client,
				options,
				keyInfo,
				options.libraries ? Array.from(options.libraries) : []
			);
			
			// If file and full-text libraries are specified, limit to libraries we're already
			// syncing
			var fileLibrariesToSync = new Set(
				options.fileLibraries
					? options.fileLibraries.filter(id => librariesToSync.includes(id))
					: librariesToSync
			);
			var fullTextLibrariesToSync = new Set(
				options.fullTextLibraries
					? options.fullTextLibraries.filter(id => librariesToSync.includes(id))
					: librariesToSync
			);
			
			_stopCheck();
			
			// If items not yet loaded for libraries we need, load them now
			for (let libraryID of librariesToSync) {
				let library = Trellis.Libraries.get(libraryID);
				if (!library.getDataLoaded('item')) {
					await library.waitForDataLoad('item');
				}
			}
			
			_stopCheck();
			
			// Sync data and files, and then repeat if necessary
			let attempt = 1;
			let successfulLibraries = new Set(librariesToSync);
			while (librariesToSync.length) {
				_stopCheck();
				
				if (attempt > 3) {
					// TODO: Back off and/or nicer error
					throw new Error("Too many sync attempts -- stopping");
				}
				let nextLibraries = await _doDataSync(librariesToSync, engineOptions);
				// Remove failed libraries from the successful set
				Trellis.Utilities.arrayDiff(librariesToSync, nextLibraries).forEach(libraryID => {
					successfulLibraries.delete(libraryID);
				});
				
				_stopCheck();
				
				// Run file sync on all allowed libraries that passed the last data sync
				librariesToSync = await _doFileSync(
					nextLibraries.filter(libraryID => fileLibrariesToSync.has(libraryID)),
					engineOptions
				);
				if (librariesToSync.length) {
					attempt++;
					continue;
				}
				
				_stopCheck();
				
				// Run full-text sync on all allowed libraries that haven't failed a data sync
				librariesToSync = await _doFullTextSync(
					[...successfulLibraries].filter(libraryID => fullTextLibrariesToSync.has(libraryID)),
					engineOptions
				);
				if (librariesToSync.length) {
					attempt++;
					continue;
				}
				break;
			}
		}
		catch (e) {
			if (e instanceof Trellis.HTTP.BrowserOfflineException) {
				let msg = Trellis.getString('general.browserIsOffline', Trellis.appName);
				e = new Trellis.Error(msg, 0, { dialogButtonText: null })
				Trellis.logError(e);
				_errors = [];
			}
			
			if (e instanceof Trellis.Sync.UserCancelledException
					|| e instanceof Trellis.HTTP.CancelledException) {
				Trellis.debug("Sync was cancelled");
			}
			else if (options.onError) {
				options.onError(e);
			}
			else {
				this.addError(e);
			}
		}
		finally {
			await this.end(options);

			// Clear undo history if this iteration applied remote changes.
			// Done before any restart/queued recursive call so the inner
			// sync's reset doesn't lose the decision made here.
			if (Trellis.Sync.Data.Local.remoteChangesApplied) {
				Trellis.UndoHistory.clear();
			}

			if (options.restartSync) {
				delete options.restartSync;
				Trellis.debug("Restarting sync");
				await this._sync(options);
				return;
			}
			// If an auto-sync was queued while a sync was ongoing, start again with its options
			else if (_queuedSyncOptions.length) {
				Trellis.debug("Restarting sync");
				await this._sync(JSON.parse(_queuedSyncOptions.shift()));
				return;
			}

			Trellis.debug("Done syncing");
			Trellis.Notifier.trigger('finish', 'sync', librariesToSync || []);
		}
	};
	
	
	/**
	 * Check key for current user info and return access info
	 */
	this.checkAccess = async function (client, options={}) {
		var json = await client.getKeyInfo(options);
		Trellis.debug(json);
		if (!json) {
			throw new Trellis.Error("API key not set", Trellis.Error.ERROR_API_KEY_INVALID);
		}
		
		// Sanity check
		if (!json.userID) throw new Error("userID not found in key response");
		if (!json.username) throw new Error("username not found in key response");
		if (!json.access) throw new Error("'access' not found in key response");
		
		return json;
	};


	// Prompt if library empty and there is no userID stored
	this.checkEmptyLibrary = async function (keyInfo) {
		let library = Trellis.Libraries.userLibrary;
		let feeds = Trellis.Feeds.getAll();
		let userID = Trellis.Users.getCurrentUserID();

		if (!userID) {
			let hasItems = await library.hasItems();
			if (!hasItems && feeds.length <= 0 && !Trellis.resetDataDir) {
				let ps = Services.prompt;
				let index = ps.confirmEx(
					null,
					Trellis.getString('general.warning'),
					Trellis.getString(
							'account.warning.emptyLibrary',
							[Trellis.clientName, PathUtils.filename(Trellis.DB.path)]
						) + "\n\n"
						+ Trellis.getString(
							'account.warning.emptyLibrary.dataWillBeDownloaded',
							keyInfo.username
						)
						+ "\n\n"
						+ Trellis.getString(
							'account.warning.existingDataElsewhere',
							Trellis.clientName
						)
						+ "\n\n"
						+ Trellis.getString('dataDir.location', Trellis.DataDirectory.dir),
					(ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING) 
						+ (ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL)
						+ (ps.BUTTON_POS_2 * ps.BUTTON_TITLE_IS_STRING),
					Trellis.getString('sync.sync'),
					null, 
					Trellis.getString('general.moreInformation'),
					null, {}
				);
				if (index == 1) {
					return false;
				}
				else if (index == 2) {
					Trellis.launchURL('https://www.trellis.org/support/trellis_data#locating_missing_trellis_data');
					return false;
				}
			}
		}
		return true;
	};
	
	
	/**
	 * @return {Promise<Integer[]> - IDs of libraries to sync
	 */
	this.checkLibraries = async function (client, options, keyInfo, libraries = []) {
		var access = keyInfo.access;
		
		var syncAllLibraries = !libraries || !libraries.length;
		
		// TODO: Ability to remove or disable editing of user library?
		
		if (syncAllLibraries) {
			if (access.user && access.user.library) {
				libraries = [Trellis.Libraries.userLibraryID];
				let skippedLibraries = Trellis.Sync.Data.Local.getSkippedLibraries();
				
				// If syncing all libraries, remove skipped libraries
				if (skippedLibraries.length) {
					Trellis.debug("Skipped libraries:");
					Trellis.debug(skippedLibraries);
					libraries = Trellis.Utilities.arrayDiff(libraries, skippedLibraries);
				}
			}
		}
		else {
			// Check access to specified libraries
			for (let libraryID of libraries) {
				let type = Trellis.Libraries.get(libraryID).libraryType;
				if (type == 'user') {
					if (!access.user || !access.user.library) {
						// TODO: Alert
						throw new Error("Key does not have access to library " + libraryID);
					}
				}
			}
		}
		
		//
		// Check group access
		//
		let remotelyMissingGroups = [];
		let groupsToDownload = [];
		
		if (!Trellis.Utilities.isEmpty(access.groups)) {
			// TEMP: Require all-group access for now
			if (access.groups.all) {
				
			}
			else {
				throw new Error("Full group access is currently required");
			}
			
			let remoteGroupVersions = await client.getGroupVersions(keyInfo.userID);
			let remoteGroupIDs = Object.keys(remoteGroupVersions).map(id => parseInt(id));
			let skippedGroups = Trellis.Sync.Data.Local.getSkippedGroups();
			
			// Remove skipped groups
			if (syncAllLibraries) {
				let newGroups = Trellis.Utilities.arrayDiff(remoteGroupIDs, skippedGroups);
				Trellis.Utilities.arrayDiff(remoteGroupIDs, newGroups)
					.forEach(id => { delete remoteGroupVersions[id] });
				remoteGroupIDs = newGroups;
			}
			
			for (let id in remoteGroupVersions) {
				id = parseInt(id);
				let group = Trellis.Groups.get(id);
				
				if (syncAllLibraries) {
					// If syncing all libraries, mark any that don't exist, are outdated, or are
					// archived locally for update. Group is added to the library list after downloading.
					if (!group || group.version < remoteGroupVersions[id] || group.archived) {
						Trellis.debug(`Marking group ${id} to download`);
						groupsToDownload.push(id);
					}
					// If not outdated, just add to library list
					else {
						Trellis.debug(`Adding group library ${group.libraryID} to sync`);
						libraries.push(group.libraryID);
					}
				}
				else {
					// If specific libraries were provided, ignore remote groups that don't
					// exist locally or aren't in the given list
					if (!group || libraries.indexOf(group.libraryID) == -1) {
						continue;
					}
					// If group metadata is outdated, mark for update
					if (group.version < remoteGroupVersions[id]) {
						groupsToDownload.push(id);
					}
				}
			}
			
			// Get local groups (all if syncing all libraries or just selected ones) that don't
			// exist remotely
			// TODO: Use explicit removals?
			let localGroups;
			if (syncAllLibraries) {
				localGroups = Trellis.Groups.getAll()
					.map(g => g.id)
					// Don't include skipped groups
					.filter(id => skippedGroups.indexOf(id) == -1);
			}
			else {
				localGroups = libraries
					.filter(id => Trellis.Libraries.get(id).libraryType == 'group')
					.map(id => Trellis.Groups.getGroupIDFromLibraryID(id))
			}
			Trellis.debug("Local groups:");
			Trellis.debug(localGroups);
			remotelyMissingGroups = Trellis.Utilities.arrayDiff(localGroups, remoteGroupIDs)
				.map(id => Trellis.Groups.get(id));
		}
		// No group access
		else {
			remotelyMissingGroups = Trellis.Groups.getAll();
		}
		
		if (remotelyMissingGroups.length) {
			// TODO: What about explicit deletions?
			
			let removedGroups = [];
			let keptGroups = [];
			
			// Prompt for each group
			//
			// TODO: Localize
			for (let group of remotelyMissingGroups) {
				// Ignore remotely missing archived groups
				if (group.archived) {
					groupsToDownload = groupsToDownload.filter(groupID => groupID != group.id);
					continue;
				}
				
				let msg;
				// If all-groups access but group is missing, user left it
				if (access.groups && access.groups.all) {
					msg = "You are no longer a member of the group \u2018" + group.name + "\u2019.";
				}
				// If not all-groups access, key might just not have access
				else {
					msg = "You no longer have access to the group \u2018" + group.name + "\u2019.";
				}
				
				msg += "\n\n" + "Would you like to remove it from this computer or keep it "
					+ "as a read-only library?";
				
				let index = Trellis.Prompt.confirm({
					title: "Group Not Found",
					text: msg,
					button0: "Remove Group",
					// TODO: Any way to have Esc trigger extra1 instead so it doesn't
					// have to be in this order?
					button1: "Cancel Sync",
					button2: "Keep Group",
					buttonDelay: true,
				});
				
				if (index == 0) {
					removedGroups.push(group);
				}
				else if (index == 1) {
					Trellis.debug("Cancelling sync");
					return [];
				}
				else if (index == 2) {
					keptGroups.push(group);
				}
			}
			
			let removedLibraryIDs = [];
			for (let group of removedGroups) {
				removedLibraryIDs.push(group.libraryID);
				await group.eraseTx();
			}
			libraries = Trellis.Utilities.arrayDiff(libraries, removedLibraryIDs);
			
			let keptLibraryIDs = [];
			for (let group of keptGroups) {
				keptLibraryIDs.push(group.libraryID);
				group.editable = false;
				group.archived = true;
				await group.saveTx();
			}
			libraries = Trellis.Utilities.arrayDiff(libraries, keptLibraryIDs);
		}
		
		// Update metadata and permissions on missing or outdated groups
		for (let groupID of groupsToDownload) {
			let info = await client.getGroup(groupID);
			if (!info) {
				throw new Error("Group " + groupID + " not found");
			}
			let group = Trellis.Groups.get(groupID);
			if (group) {
				// Check if the user's permissions for the group have changed, and prompt to reset
				// data if so
				let { editable, filesEditable } = Trellis.Groups.getPermissionsFromJSON(
					info.data, keyInfo.userID
				);
				let keepGoing = await Trellis.Sync.Data.Local.checkLibraryForAccess(
					null, group.libraryID, editable, filesEditable
				);
				// User chose to skip library
				if (!keepGoing) {
					Trellis.debug("Skipping sync of group " + group.id);
					continue;
				}
			}
			else {
				group = new Trellis.Group;
				group.id = groupID;
			}
			group.version = info.version;
			group.archived = false;
			group.fromJSON(info.data, Trellis.Users.getCurrentUserID());
			await group.saveTx();
			
			// Add group to library list
			libraries.push(group.libraryID);
		}
		
		// Note: If any non-group library types become archivable, they'll need to be unarchived here.
		Trellis.debug("Final libraries to sync:");
		Trellis.debug(libraries);
		
		return [...new Set(libraries)];
	};
	
	
	/**
	 * Run sync engine for passed libraries
	 *
	 * @param {Integer[]} libraries
	 * @param {Object} options
	 * @param {Boolean} skipUpdateLastSyncTime
	 * @return {Integer[]} - Array of libraryIDs that completed successfully
	 */
	var _doDataSync = async function (libraries, options, skipUpdateLastSyncTime) {
		var successfulLibraries = [];
		for (let libraryID of libraries) {
			_stopCheck();
			try {
				let opts = {};
				Object.assign(opts, options);
				opts.libraryID = libraryID;
				
				_currentEngine = new Trellis.Sync.Data.Engine(opts);
				await _currentEngine.start();
				_currentEngine = null;
				successfulLibraries.push(libraryID);
			}
			catch (e) {
				if (e instanceof Trellis.Sync.UserCancelledException) {
					if (e.advanceToNextLibrary) {
						Trellis.debug("Sync cancelled for library " + libraryID + " -- "
							+ "advancing to next library");
						continue;
					}
					throw e;
				}
				
				Trellis.debug("Sync failed for library " + libraryID, 1);
				Trellis.logError(e);
				this.checkError(e);
				options.onError(e);
				if (stopOnError || e.fatal) {
					Trellis.debug("Stopping on error", 1);
					options.caller.stop();
					break;
				}
			}
		}
		// Update last-sync time if any libraries synced
		// TEMP: Do we want to show updated time if some libraries haven't synced?
		if (!libraries.length || successfulLibraries.length) {
			await Trellis.Sync.Data.Local.updateLastSyncTime();
		}
		return successfulLibraries;
	}.bind(this);
	
	
	/**
	 * @return {Integer[]} - Array of libraries that need data syncing again
	 */
	var _doFileSync = async function (libraries, options) {
		Trellis.debug("Starting file syncing");
		// Drain file change events and run the modification check on the changed files across
		// all libraries
		await Trellis.Sync.Storage.FileChangeWatcher.snapshot();
		var resyncLibraries = []
		for (let libraryID of libraries) {
			_stopCheck();
			let libraryName = Trellis.Libraries.get(libraryID).name;
			this.setSyncStatus(
				Trellis.getString('sync.status.syncingFilesInLibrary', libraryName)
			);
			try {
				let opts = {
					onProgress: (progress, progressMax) => {
						var remaining = progressMax - progress;
						this.setSyncStatus(
							Trellis.getString(
								'sync.status.syncingFilesInLibraryWithRemaining',
								[libraryName, remaining],
								remaining
							)
						);
					}
				};
				Object.assign(opts, options);
				opts.libraryID = libraryID;
				
				let mode = Trellis.Sync.Storage.Local.getModeForLibrary(libraryID);
				opts.controller = this.getStorageController(mode, opts);
				
				let tries = 3;
				while (true) {
					if (tries == 0) {
						throw new Error("Too many file sync attempts for library " + libraryID);
					}
					tries--;
					_currentEngine = new Trellis.Sync.Storage.Engine(opts);
					let results = await _currentEngine.start();
					_currentEngine = null;
					if (results.syncRequired) {
						resyncLibraries.push(libraryID);
					}
					else if (results.fileSyncRequired) {
						Trellis.debug("Another file sync required -- restarting");
						continue;
					}
					break;
				}
			}
			catch (e) {
				if (e instanceof Trellis.Sync.UserCancelledException) {
					if (e.advanceToNextLibrary) {
						Trellis.debug("Storage sync cancelled for library " + libraryID + " -- "
							+ "advancing to next library");
						continue;
					}
					throw e;
				}
				
				Trellis.debug("File sync failed for library " + libraryID);
				Trellis.logError(e);
				this.checkError(e);
				options.onError(e);
				if (stopOnError || e.fatal) {
					options.caller.stop();
					break;
				}
			}
		}
		Trellis.debug("Done with file syncing");
		if (resyncLibraries.length) {
			Trellis.debug("Libraries to resync: " + resyncLibraries.join(", "));
		}
		return resyncLibraries;
	}.bind(this);
	
	
	/**
	 * @return {Integer[]} - Array of libraries that need data syncing again
	 */
	var _doFullTextSync = async function (libraries, options) {
		if (!Trellis.Prefs.get("sync.fulltext.enabled")) return [];
		
		Trellis.debug("Starting full-text syncing");
		this.setSyncStatus(Trellis.getString('sync.status.syncingFullText'));
		var resyncLibraries = [];
		for (let libraryID of libraries) {
			_stopCheck();
			try {
				let opts = {};
				Object.assign(opts, options);
				opts.libraryID = libraryID;
				
				_currentEngine = new Trellis.Sync.Data.FullTextEngine(opts);
				await _currentEngine.start();
				_currentEngine = null;
			}
			catch (e) {
				if (e instanceof Trellis.Sync.UserCancelledException) {
					throw e;
				}
				
				if (e instanceof Trellis.HTTP.UnexpectedStatusException && e.status == 412) {
					resyncLibraries.push(libraryID);
					continue;
				}
				Trellis.debug("Full-text sync failed for library " + libraryID);
				Trellis.logError(e);
				this.checkError(e);
				options.onError(e);
				if (stopOnError || e.fatal) {
					options.caller.stop();
					break;
				}
			}
		}
		Trellis.debug("Done with full-text syncing");
		if (resyncLibraries.length) {
			Trellis.debug("Libraries to resync: " + resyncLibraries.join(", "));
		}
		return resyncLibraries;
	}.bind(this);
	
	
	/**
	 * Get a storage controller for a given mode ('zfs', 'webdav'),
	 * caching it if necessary
	 */
	this.getStorageController = function (mode, options) {
		if (_storageControllers[mode]) {
			return _storageControllers[mode];
		}
		var modeClass = Trellis.Sync.Storage.Utilities.getClassForMode(mode);
		return _storageControllers[mode] = new modeClass(options);
	},
	
	
	this.resetStorageController = function (mode) {
		delete _storageControllers[mode];
	},
	
	
	/**
	 * Download a single file on demand (not within a sync process)
	 */
	this.downloadFile = async function (item, requestCallbacks) {
		if (Trellis.HTTP.browserIsOffline()) {
			Trellis.debug("Browser is offline", 2);
			return false;
		}
		
		var apiKey = await _getAPIKey();
		if (!apiKey) {
			Trellis.debug("API key not set -- skipping download");
			return false;
		}
		
		// TEMP
		var options = {};
		
		var itemID = item.id;
		var modeClass = Trellis.Sync.Storage.Local.getClassForLibrary(item.libraryID);
		var controller = new modeClass({
			apiClient: this.getAPIClient({apiKey })
		});
		
		// TODO: verify WebDAV on-demand?
		if (!controller.verified) {
			Trellis.debug("File syncing is not active for item's library -- skipping download");
			return false;
		}
		
		if (!item.isStoredFileAttachment()) {
			throw new Error("Not a stored file attachment");
		}
		
		if (await item.getFilePathAsync()) {
			Trellis.debug("File already exists -- replacing");
		}
		
		// TODO: start sync icon?
		// TODO: create queue for cancelling
		
		if (!requestCallbacks) {
			requestCallbacks = {};
		}
		var onStart = function (request) {
			return controller.downloadFile(request);
		};
		var request = new Trellis.Sync.Storage.Request({
			type: 'download',
			libraryID: item.libraryID,
			name: item.libraryKey,
			onStart: requestCallbacks.onStart
				? [onStart, requestCallbacks.onStart]
				: [onStart]
		});
		return request.start();
	};
	
	
	this.stop = function () {
		this.setSyncStatus(Trellis.getString('sync.stopping'));
		_stopping = true;
		if (_currentEngine) {
			_currentEngine.stop();
		}
		if (_canceller) {
			_canceller();
		}
	}
	
	
	this.end = async function (options) {
		_syncInProgress = false;
		await this.checkErrors(_errors, options);
		if (!options.restartSync) {
			let showOnSyncButton = !options.background
				&& _errors.length
				&& _errors[0].showOnSyncButton;
			// Don't show the error icon for errors that will be shown on
			// the sync button
			this.updateIcons(showOnSyncButton ? [] : _errors);

			if (!options.background && _errors.length) {
				// Trigger dialog button immediately for some errors
				// (e.g., long tag fixer)
				if (_errors[0].dialogButtonImmediate) {
					let maybePromise = _errors[0].dialogButtonCallback();
					if (maybePromise && maybePromise.then) {
						await maybePromise;
					}
				}
				// Show the error panel anchored to the sync button
				else if (showOnSyncButton) {
					let win = Services.wm.getMostRecentWindow("navigator:browser");
					if (win) {
						let doc = win.document;
						let syncButton = doc.getElementById('trellis-tb-sync');
						let panel = this.updateErrorPanel(doc, _errors);
						panel.openPopup(syncButton, "after_end", 0, 0, false, false);
					}
				}
				// Auto-open the error panel for other foreground errors
				else {
					let win = Services.wm.getMostRecentWindow("navigator:browser");
					if (win) {
						let icon = win.document.getElementById('trellis-tb-sync-error');
						if (icon && !icon.hidden) {
							icon.click();
						}
					}
				}
			}
		}
		_errors = [];
	};
	
	
	/**
	 * @param {Integer} timeout - Timeout in seconds
	 * @param {Boolean} [recurring=false]
	 * @param {Object} [options] - Sync options (e.g., 'libraries', 'fileLibraries', 'fullTextLibraries')
	 */
	this.setSyncTimeout = function (timeout, recurring, options = {}) {
		if (!Trellis.Prefs.get('sync.autoSync') || !this.enabled) {
			return;
		}
		
		if (!timeout) {
			throw new Error("Timeout not provided");
		}
		
		if (timeout != parseInt(timeout)) {
			throw new Error(`Timeout must be an integer (${timeout} given)`);
		}
		
		if (_autoSyncTimer) {
			Trellis.debug("Cancelling auto-sync timer");
			_autoSyncTimer.cancel();
		}
		else {
			_autoSyncTimer = Components.classes["@mozilla.org/timer;1"].
				createInstance(Components.interfaces.nsITimer);
		}
		
		var mergedOpts = {
			background: true
		};
		Object.assign(mergedOpts, options);
		
		// Implements nsITimerCallback
		var callback = {
			notify: async function (timer) {
				if (!_getAPIKey()) {
					return;
				}
				
				// If a delay is set (e.g., from the connector target selector), wait to sync.
				// We do this in sync() too for manual syncs, but no need to start spinning if
				// it's just an auto-sync.
				while (_delaySyncUntil && new Date() < _delaySyncUntil) {
					let delay = _delaySyncUntil - new Date();
					Trellis.debug(`Waiting ${delay} ms to start auto-sync`);
					await Trellis.Promise.delay(delay);
				}
				
				if (Trellis.locked) {
					Trellis.debug('Trellis is locked -- skipping auto-sync', 4);
					_queueSyncOptions(mergedOpts);
					return;
				}
				
				if (_syncInProgress) {
					Trellis.debug('Sync already in progress -- skipping auto-sync', 4);
					_queueSyncOptions(mergedOpts);
					return;
				}
				
				if (_manualSyncRequired) {
					Trellis.debug('Manual sync required -- skipping auto-sync', 4);
					return;
				}
				
				this.sync(mergedOpts);
			}.bind(this)
		}
		
		if (recurring) {
			Trellis.debug('Setting auto-sync interval to ' + timeout + ' seconds');
			_autoSyncTimer.initWithCallback(
				callback, timeout * 1000, Components.interfaces.nsITimer.TYPE_REPEATING_SLACK
			);
		}
		else {
			if (_syncInProgress) {
				Trellis.debug('Sync in progress -- not setting auto-sync timeout', 4);
				_queueSyncOptions(mergedOpts);
				return;
			}
			
			Trellis.debug('Setting auto-sync timeout to ' + timeout + ' seconds');
			_autoSyncTimer.initWithCallback(
				callback, timeout * 1000, Components.interfaces.nsITimer.TYPE_ONE_SHOT
			);
		}
	}
	
	
	function _queueSyncOptions(options) {
		var jsonOptions = JSON.stringify(options);
		// Don't queue options if already queued
		if (_queuedSyncOptions.includes(jsonOptions)) {
			return;
		}
		Trellis.debug("Queueing sync options");
		Trellis.debug(options);
		_queuedSyncOptions.push(jsonOptions);
	}
	
	
	this.clearSyncTimeout = function () {
		if (_autoSyncTimer) {
			_autoSyncTimer.cancel();
		}
	}
	
	
	this.delaySync = function (ms) {
		_delaySyncUntil = new Date(Date.now() + ms);
	};
	
	
	/**
	 * Delay syncs until the returned function is called
	 *
	 * @return {Function} - Resolve function
	 */
	this.delayIndefinite = function () {
		let { resolve, promise } = Trellis.Promise.defer();
		_delayPromises.add(promise);
		promise.then(() => _delayPromises.delete(promise));
		return resolve;
	};
	
	
	/**
	 * Trigger updating of the main sync icon, the sync error icon, and
	 * library-specific sync error icons across all windows
	 */
	this.addError = function (e, libraryID) {
		if (e.added) return;
		e.added = true;
		if (libraryID) {
			e.libraryID = libraryID;
		}
		Trellis.logError(e);
		_errors.push(this.parseError(e));
	}
	
	
	this.getErrorsByLibrary = function (libraryID) {
		return _errors.filter(e => e.libraryID === libraryID);
	}
	
	
	/**
	 * Get most severe error type from an array of parsed errors
	 */
	this.getPrimaryErrorType = function (errors) {
		// Set highest priority error as the primary (sync error icon)
		var errorTypes = {
			info: 1,
			warning: 2,
			error: 3,
			upgrade: 4,
			
			// Skip these
			animate: -1,
			ignore: -2
		};
		var state = false;
		for (let i = 0; i < errors.length; i++) {
			let e = errors[i];
			
			let errorType = e.errorType;
				
			if (e.fatal) {
				return 'error';
			}
			
			if (!errorType || errorTypes[errorType] < 0) {
				continue;
			}
			if (!state || errorTypes[errorType] > errorTypes[state]) {
				state = errorType;
			}
		}
		return state;
	}
	
	
	this.checkErrors = async function (errors, options = {}) {
		for (let e of errors) {
			let handled = await this.checkError(e, options);
			if (handled) {
				break;
			}
		}
	};
	
	
	this.checkError = async function (e, options = {}) {
		if (e.name && e.name == 'Trellis Error') {
			switch (e.error) {
				case Trellis.Error.ERROR_API_KEY_NOT_SET:
				case Trellis.Error.ERROR_API_KEY_INVALID:
					e.message = Trellis.ftl.formatValueSync('account-not-logged-in-text');
					e.dialogButtonText = Trellis.ftl.formatValueSync('account-log-in');
					e.dialogButtonCallback = function () {
						Trellis.Utilities.Internal.openPreferences(
							"trellis-prefpane-account",
							{ action: 'logIn' }
						);
					};
					e.showOnSyncButton = true;
					break;
			}
		}
		else if (e.name && e.name == 'TrellisObjectUploadError') {
			let { code, data, objectType, object } = e;
			
			if (code == 413) {
				// Collection name too long
				if (objectType == 'collection' && data && data.value) {
					e.message = Trellis.getString('sync.error.collectionTooLong', [data.value]);
					
					e.dialogButtonText = Trellis.getString('pane.collections.showCollectionInLibrary');
					e.dialogButtonCallback = () => {
						var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
							.getService(Components.interfaces.nsIWindowMediator);
						var win = wm.getMostRecentWindow("navigator:browser");
						win.TrellisPane.collectionsView.selectCollection(object.id);
					};
				}
				else if (objectType == 'item') {
					// Tag too long
					if (data && data.tag !== undefined) {
						// Show long tag fixer and handle result
						e.dialogButtonText = Trellis.getString('general.fix');
						e.dialogButtonCallback = async function () {
							var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
							   .getService(Components.interfaces.nsIWindowMediator);
							var lastWin = wm.getMostRecentWindow("navigator:browser");
							
							// Open long tag fixer for library we're syncing
							let oldTagIDs = await Trellis.Tags.getLongTagsInLibrary(object.libraryID);
							
							for (let oldTagID of oldTagIDs) {
								let oldTag = Trellis.Tags.getName(oldTagID);
								let dataOut = { result: null };
								lastWin.openDialog(
									'chrome://trellis/content/longTagFixer.xhtml',
									'',
									'chrome,modal,centerscreen',
									{ oldTag, isLongTag: true },
									dataOut
								);
								// If dialog was cancelled, stop
								if (!dataOut.result) {
									return;
								}
								const itemIDs = await Trellis.Tags.getTagItems(object.libraryID, oldTagID);

								switch (dataOut.result.op) {
									case 'split':
										await Trellis.DB.executeTransaction(async function () {
											for (let itemID of itemIDs) {
												let item = await Trellis.Items.getAsync(itemID);
												let tagType = item.getTagType(oldTag);
												for (let tag of dataOut.result.tags) {
													item.addTag(tag, tagType);
												}
												item.removeTag(oldTag);
												await item.save();
											}
											await Trellis.Tags.purge(oldTagID);
										});
										break;
									
									case 'edit':
										await Trellis.DB.executeTransaction(async function () {
											for (let itemID of itemIDs) {
												let item = await Trellis.Items.getAsync(itemID);
												item.replaceTag(oldTag, dataOut.result.tag);
												await item.save();
											}
										});
										break;
									
									case 'delete':
										await Trellis.Tags.removeFromLibrary(object.libraryID, oldTagID);
										break;
								}
							}
							
							options.restartSync = true;
						};
						e.dialogButtonImmediate = true;
					}
					else {
						// Note too long
						if (object.isNote() || object.isAttachment()) {
							// Throw an error that adds a button for selecting the item to the sync error dialog
							if (e.message.includes('<img src="data:image')) {
								e.message = Trellis.getString('sync.error.noteEmbeddedImage');
							}
							else if (e.message.match(/^Note '.*' too long for item/)) {
								e.message = Trellis.getString(
									'sync.error.noteTooLong',
									Trellis.Utilities.ellipsize(object.getNoteTitle(), 40)
								);
							}
						}
						// Field or creator too long
						else if (data && data.field) {
							e.message = (data.field == 'creator'
								? Trellis.getString(
									'sync.error.creatorTooLong',
									[data.value]
								)
								: Trellis.getString(
									'sync.error.fieldTooLong',
									[data.field, data.value]
								))
								+ '\n\n'
								+ Trellis.getString(
									'sync.error.reportSiteIssuesToForums',
									Trellis.clientName
								);
						}
						
						// Include "Show Item in Library" button
						e.dialogButtonText = Trellis.getString('pane.items.showItemInLibrary');
						e.dialogButtonCallback = () => {
							var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
								.getService(Components.interfaces.nsIWindowMediator);
							var win = wm.getMostRecentWindow("navigator:browser");
							win.TrellisPane.selectItem(object.id);
						};
					}
				}
			}
		}
		// Show warning for unknown data that couldn't be saved
		else if (e.name && e.name == 'TrellisInvalidDataError') {
			let library = Trellis.Libraries.get(e.libraryID);
			let msg = Trellis.getString(
					'sync.error.invalidDataError',
					[
						library.name,
						Trellis.clientName
					]
				)
					+ "\n\n"
					+ Trellis.getString('sync.error.invalidDataError.otherData');
			
			// Show warning for My Library
			if (library.libraryType == 'user') {
				e.message = msg;
				e.errorType = 'warning';
				e.dialogButtonText = Trellis.getString('general.checkForUpdates');
				e.dialogButtonCallback = () => {
					Trellis.openCheckForUpdatesWindow({ modal: true });
				};
				e.dialogButton2Text = Trellis.getString('general.moreInformation');
				e.dialogButton2Callback = () => {
					Trellis.launchURL('https://www.trellis.org/support/kb/unknown_data_error');
				};
			}
			// Otherwise just show in sync button tooltip
			else {
				_addTooltipMessage(msg);
				e.errorType = 'ignore';
			}
		}
	};
	
	
	/**
	 * Set the sync icon and sync error icon across all windows
	 *
	 * @param {Error|Error[]|'animate'} errors - An error, an array of errors, or 'animate' to
	 *                                           spin the icon. An empty array will reset the
	 *                                           icons.
	 */
	this.updateIcons = function (errors) {
		if (typeof errors == 'string') {
			var state = errors;
			errors = [];
		}
		else {
			if (!Array.isArray(errors)) {
				errors = [errors];
			}
			errors = errors.filter(o => o.errorType !== 'ignore');
			var state = this.getPrimaryErrorType(errors);
		}
		
		// Refresh source list
		//yield Trellis.Notifier.trigger('redraw', 'collection', []);
		
		if (errors.length == 1 && errors[0].frontWindowOnly) {
			// Fake an nsISimpleEnumerator with just the topmost window
			var enumerator = {
				_returned: false,
				hasMoreElements: function () {
					return !this._returned;
				},
				getNext: function () {
					if (this._returned) {
						throw ("No more windows to return in Trellis.Sync.Runner.updateIcons()");
					}
					this._returned = true;
					var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
								.getService(Components.interfaces.nsIWindowMediator);
					return wm.getMostRecentWindow("navigator:browser");
				}
			};
		}
		// Update all windows
		else {
			var wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
						.getService(Components.interfaces.nsIWindowMediator);
			var enumerator = wm.getEnumerator('navigator:browser');
		}
		
		while (enumerator.hasMoreElements()) {
			var win = enumerator.getNext();
			if (!win.TrellisPane) continue;
			var doc = win.TrellisPane.document;
			
			// Update sync error icon
			var icon = doc.getElementById('trellis-tb-sync-error');
			this.updateErrorIcon(icon, state, errors);
			
			// Update sync icon
			var syncIcon = doc.getElementById('trellis-tb-sync');
			if (state == 'animate') {
				syncIcon.setAttribute('status', state);
			}
			else {
				syncIcon.removeAttribute('status');
			}
		}
		
		// Clear status
		this.setSyncStatus();
	}
	
	
	/**
	 * Set the sync icon tooltip message
	 */
	this.setSyncStatus = function (msg) {
		_lastSyncStatus = msg;
		
		// If a label is registered, update it
		if (_currentSyncStatusLabel) {
			_updateSyncStatusLabel();
		}
	}
	
	
	this.parseError = function (e) {
		if (!e) {
			return { parsed: true };
		}
		
		// Already parsed
		if (e.parsed) {
			return e;
		}
		
		e.parsed = true;
		e.errorType = e.errorType ? e.errorType : 'error';
		
		return e;
	}
	
	
	/**
	 * Set the state of the sync error icon and add an onclick to populate
	 * the error panel
	 */
	this.updateErrorIcon = function (icon, state, errors) {
		if (!errors || !errors.length) {
			icon.hidden = true;
			icon.onclick = null;
			return;
		}
		
		icon.hidden = false;
		icon.setAttribute('state', state);
		var self = this;
		icon.onclick = function () {
			var panel = self.updateErrorPanel(this.ownerDocument, errors);
			panel.openPopup(this, "after_end", 16, 0, false, false);
		};
	}
	
	
	this.updateErrorPanel = function (doc, errors) {
		var panel = doc.getElementById('trellis-sync-error-panel');
		
		// Clear existing panel content
		while (panel.hasChildNodes()) {
			panel.removeChild(panel.firstChild);
		}
		
		for (let [index, e] of errors.entries()) {
			var box = doc.createXULElement('vbox');
			var label = doc.createXULElement('label');
			if (e.libraryID !== undefined) {
				label.className = "trellis-sync-error-panel-library-name";
				if (e.libraryID == 0) {
					var libraryName = Trellis.getString('pane.collections.library');
				}
				else {
					let group = Trellis.Groups.getByLibraryID(e.libraryID);
					var libraryName = group.name;
				}
				label.setAttribute('value', libraryName);
			}
			var content = doc.createXULElement('vbox');
			var buttons = doc.createXULElement('hbox');
			buttons.id = 'trellis-sync-error-panel-buttons';
			box.appendChild(label);
			box.appendChild(content);
			box.appendChild(buttons);
			
			if (e.dialogHeader) {
				let header = doc.createXULElement('description');
				header.className = 'error-header';
				header.setAttribute("control", `trellis-sync-error-panel-button-${index}`);
				header.textContent = e.dialogHeader;
				content.appendChild(header);
			}
			
			// Show our own error messages directly
			var msg;
			if (e instanceof Trellis.Error) {
				msg = e.message;
			}
			// For unexpected ones, just show a generic message
			else if (e instanceof Trellis.HTTP.UnexpectedStatusException && e.xmlhttp.responseText) {
				msg = Trellis.Utilities.ellipsize(e.xmlhttp.responseText, 1000, true);
			}
			else {
				msg = e.message;
			}
			
			var desc = doc.createXULElement('description');
			desc.textContent = msg;
			// Make the text selectable
			desc.setAttribute('style', '-moz-user-select: text; cursor: text');
			content.appendChild(desc);
			desc.setAttribute("control", `trellis-sync-error-panel-button-${index}`);

			/*// If not an error and there's no explicit button text, don't show
			// button to report errors
			if (e.errorType != 'error' && e.dialogButtonText === undefined) {
				e.dialogButtonText = null;
			}*/
			
			if (e.dialogButtonText !== null) {
				if (e.dialogButtonText === undefined) {
					var buttonText = Trellis.getString('errorReport.reportError');
					var buttonCallback = function () {
						doc.defaultView.TrellisPane.reportErrors();
					};
				}
				else {
					var buttonText = e.dialogButtonText;
					var buttonCallback = e.dialogButtonCallback;
				}
				
				 
				function addEventHandlers(button, cb) {
					button.addEventListener("click", () => {
						cb();
						panel.hidePopup();
					});
				}
				
				let button = doc.createXULElement('button');
				button.setAttribute('label', buttonText);
				button.setAttribute("id", `trellis-sync-error-panel-button-${index}`);
				addEventHandlers(button, buttonCallback);
				buttons.appendChild(button);
				
				// Second button
				if (e.dialogButton2Text) {
					buttonText = e.dialogButton2Text;
					buttonCallback = e.dialogButton2Callback;
					
					let button2 = doc.createXULElement('button');
					button2.setAttribute("id", `trellis-sync-error-panel-button-${index}`);
					button.removeAttribute("id");
					button2.setAttribute('label', buttonText);
					addEventHandlers(button2, buttonCallback);
					buttons.insertBefore(button2, button);
				}
			}
			
			panel.appendChild(box)
			break;
		}
		
		return panel;
	}
	
	
	this.alert = function (e) {
		e = Trellis.Sync.Runner.parseError(e);
		var ps = Services.prompt;
		var buttonText = e.dialogButtonText;
		var buttonCallback = e.dialogButtonCallback;
		
		if (e.errorType == 'warning' || e.errorType == 'error') {
			let title = Trellis.getString('general.' + e.errorType);
			// TODO: Display header in bold
			let msg = (e.dialogHeader ? e.dialogHeader + '\n\n' : '') + e.message;
			
			if (e.errorType == 'warning' || buttonText === null) {
				ps.alert(null, title, e.message);
				return;
			}
			
			if (!buttonText) {
				buttonText = Trellis.getString('errorReport.reportError');
				buttonCallback = function () {
					Trellis.getActiveTrellisPane().reportErrors();
				};
			}
			
			let buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_OK
				+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING;
			let index = ps.confirmEx(
				null,
				title,
				msg,
				buttonFlags,
				"",
				buttonText,
				"", null, {}
			);
			
			if (index == 1) {
				setTimeout(buttonCallback, 1);
			}
		}
		// Upgrade message
		else if (e.errorType == 'upgrade') {
			ps.alert(null, "", e.message);
			return;
		}
	};
	
	
	/**
	 * Register labels in sync icon tooltip to receive updates
	 *
	 * If no label passed, unregister current label
	 *
	 * @param {Tooltip} [tooltip]
	 */
	this.registerSyncStatus = function (tooltip) {
		if (tooltip) {
			_currentSyncStatusLabel = tooltip.querySelector('.sync-button-tooltip-status');
			_currentLastSyncLabel = tooltip.querySelector('.sync-button-tooltip-last-sync');
			_currentTooltipMessages = tooltip.querySelector('.sync-button-tooltip-messages');
		}
		else {
			_currentSyncStatusLabel = null;
			_currentLastSyncLabel = null;
			_currentTooltipMessages = null;
		}
		if (_currentSyncStatusLabel) {
			_updateSyncStatusLabel();
		}
	}


	this.createAPIKeyFromCredentials = async function (username, password) {
		var client = this.getAPIClient();
		var json = await client.createAPIKeyFromCredentials(username, password);
		if (!json) {
			return false;
		}

		// Sanity check
		if (!json.userID) throw new Error("userID not found in key response");
		if (!json.username) throw new Error("username not found in key response");
		if (!json.access) throw new Error("'access' not found in key response");

		await Trellis.Sync.Data.Local.setAPIKey(json.key);

		return json;
	}


	this.startLoginSession = async function () {
		let client = this.getAPIClient();
		let userID = Trellis.Users.getCurrentUserID();
		return client.createLoginSession(userID || undefined);
	}


	this.checkLoginSession = async function (sessionToken, result) {
		if (!result) {
			let client = this.getAPIClient();
			result = await client.checkLoginSession(sessionToken);
		}
		// Polling returns { status: "completed", ... }
		// Streaming returns { event: "loginComplete", ... }
		if (result.status == "completed" || result.event == "loginComplete") {
			if (!result.apiKey) throw new Error("apiKey not found in session response");
			if (!result.userID) throw new Error("userID not found in session response");
			if (!result.username) throw new Error("username not found in session response");
			await Trellis.Sync.Data.Local.setAPIKey(result.apiKey);
		}
		return result;
	}


	this.cancelLoginSession = async function (sessionToken) {
		try {
			let client = this.getAPIClient();
			await client.cancelLoginSession(sessionToken);
		}
		catch (e) {
			Trellis.debug("Failed to cancel login session: " + e, 2);
		}
	}


	this.deleteAPIKey = async function () {
		this.resetStorageController('zfs');
		var apiKey = await Trellis.Sync.Data.Local.getAPIKey();
		var client = this.getAPIClient({apiKey});
		// Remove streaming subscription before clearing the key
		await Trellis.Streamer.removeSyncSubscription();
		await Trellis.Sync.Data.Local.setAPIKey();
		await client.deleteAPIKey();
	}
	
	
	function _addTooltipMessage(msg) {
		_tooltipMessages.push(msg.replace(/\n+/g, ' '));
	};
	
	
	function _updateSyncStatusLabel() {
		if (_lastSyncStatus) {
			_currentSyncStatusLabel.value = _lastSyncStatus;
			_currentSyncStatusLabel.hidden = false;
		}
		else {
			_currentSyncStatusLabel.hidden = true;
		}
		
		// Always update last sync time
		var lastSyncTime = Trellis.Sync.Data.Local.getLastSyncTime();
		if (!lastSyncTime) {
			try {
				lastSyncTime = Trellis.Sync.Data.Local.getLastClassicSyncTime();
			}
			catch (e) {
				Trellis.debug(e, 2);
				Components.utils.reportError(e);
				_currentLastSyncLabel.hidden = true;
				return;
			}
		}
		if (lastSyncTime) {
			var msg = Trellis.Date.toRelativeDate(lastSyncTime);
		}
		// Don't show "Not yet synced" if a sync is in progress
		else if (_syncInProgress) {
			_currentLastSyncLabel.hidden = true;
			return;
		}
		else {
			var msg = Trellis.getString('sync.status.notYetSynced');
		}
		
		_currentLastSyncLabel.value = Trellis.getString('sync.status.lastSync') + " " + msg;
		_currentLastSyncLabel.hidden = false;
		
		if (_tooltipMessages.length) {
			_currentTooltipMessages.textContent = '';
			for (let message of _tooltipMessages) {
				let elem = _currentTooltipMessages.ownerDocument.createElement('p');
				elem.textContent = message;
				_currentTooltipMessages.appendChild(elem);
			}
			_currentTooltipMessages.hidden = false;
		}
		else {
			_currentTooltipMessages.hidden = true;
		}
	}
	
	
	var _getAPIKey = function () {
		// Set as .apiKey on Runner in tests or set in login manager
		return _apiKey || Trellis.Sync.Data.Local.getAPIKey()
	}
	
	
	function _stopCheck() {
		if (_stopping) {
			throw new Trellis.Sync.UserCancelledException;
		}
	}
	
	
	function _cancellerReceiver(canceller) {
		_canceller = canceller;
	}
}
