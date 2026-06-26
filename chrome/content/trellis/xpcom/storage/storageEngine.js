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

var { ConcurrentCaller } = ChromeUtils.importESModule("resource://trellis/concurrentCaller.mjs");
var { CanceledException } = ChromeUtils.importESModule("chrome://trellis/content/modules/errors.mjs");

if (!Trellis.Sync.Storage) {
	Trellis.Sync.Storage = {};
}

/**
 * An Engine manages file sync processes for a given library
 *
 * @param {Object} options
 * @param {Integer} options.libraryID
 * @param {Object} options.controller - Storage controller instance (ZFS_Controller/WebDAV_Controller)
 * @param {Function} [onProgress] - Function to run when a request finishes: f(progress, progressMax)
 * @param {Function} [onError] - Function to run on error
 * @param {Boolean} [stopOnError]
 */
Trellis.Sync.Storage.Engine = function (options) {
	if (options.libraryID == undefined) {
		throw new Error("options.libraryID not set");
	}
	if (options.controller == undefined) {
		throw new Error("options.controller not set");
	}
	
	this.background = options.background;
	this.firstInSession = options.firstInSession;
	this.lastFullFileCheck = options.lastFullFileCheck;
	this.libraryID = options.libraryID;
	this.library = Trellis.Libraries.get(options.libraryID);
	this.controller = options.controller;
	
	this.numRequests = 0;
	this.requestsRemaining = 0;
	
	this.local = Trellis.Sync.Storage.Local;
	this.utils = Trellis.Sync.Storage.Utilities;
	
	this.setStatus = options.setStatus || function () {};
	this.onError = options.onError || function (e) {};
	this.onProgress = options.onProgress || function (progress, progressMax) {};
	this.stopOnError = options.stopOnError || false;
	
	this.queues = [];
	['download', 'upload'].forEach(function (type) {
		this.queues[type] = new ConcurrentCaller({
			id: `${this.libraryID}/${type}`,
			numConcurrent: Trellis.Prefs.get(
				'sync.storage.max' + Trellis.Utilities.capitalize(type) + 's'
			),
			onError: this.onError,
			stopOnError: this.stopOnError,
			logger: Trellis.debug
		});
	}.bind(this))
	
	this.maxCheckAge = 10800; // maximum age in seconds for upload modification check (3 hours)
}

Trellis.Sync.Storage.Engine.prototype.start = async function () {
	var libraryID = this.libraryID;
	if (!Trellis.Sync.Storage.Local.getEnabledForLibrary(libraryID)) {
		Trellis.debug("File sync is not enabled for " + this.library.name);
		return false;
	}
	
	Trellis.debug("Starting file sync for " + this.library.name);
	
	if (!this.controller.verified) {
		Trellis.debug(`${this.controller.name} file sync is not active -- verifying`);
		
		try {
			await this.controller.checkServer();
		}
		catch (e) {
			let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
			   .getService(Components.interfaces.nsIWindowMediator);
			let lastWin = wm.getMostRecentWindow("navigator:browser");
			
			let success = await this.controller.handleVerificationError(e, lastWin, true);
			if (!success) {
				Trellis.debug(this.controller.name + " verification failed", 2);
				
				throw new Trellis.Error(
					Trellis.getString('sync.storage.error.verificationFailed', this.controller.name),
					0,
					{
						dialogButtonText: Trellis.getString('sync.openSyncPreferences'),
						dialogButtonCallback: function () {
							let wm = Components.classes["@mozilla.org/appshell/window-mediator;1"]
									   .getService(Components.interfaces.nsIWindowMediator);
							let lastWin = wm.getMostRecentWindow("navigator:browser");
							lastWin.TrellisPane.openPreferences('trellis-prefpane-account');
						}
					}
				);
			}
		}
	}
	
	if (this.controller.cacheCredentials) {
		await this.controller.cacheCredentials();
	}
	
	var lastSyncTime = null;
	var downloadAll = this.local.downloadOnSync(libraryID);
	//
	// TODO: If files are persistently missing, don't try to download them each time
	
	var filesEditable = Trellis.Libraries.get(libraryID).filesEditable;
	this.requestsRemaining = 0;
	
	// Clear over-quota flag on manual sync
	if (!this.background && Trellis.Sync.Storage.Local.storageRemainingForLibrary.has(libraryID)) {
		Trellis.debug("Clearing over-quota flag for " + this.library.name);
		Trellis.Sync.Storage.Local.storageRemainingForLibrary.delete(libraryID)
	}
	
	// Check for updated files to upload
	if (!filesEditable) {
		Trellis.debug("No file editing access -- skipping file modification check for "
			+ this.library.name);
	}
	// If the file change watcher is active, files that actually changed on disk were already
	// checked and marked in the database when the sync runner took the watcher snapshot at the
	// start of file syncing, so the scan can be skipped entirely unless this library needs a
	// full scan (not yet scanned, watcher fallback, daily refresh, or manual sync)
	else if (Trellis.Sync.Storage.FileChangeWatcher.available) {
		if (Trellis.Sync.Storage.FileChangeWatcher.needsFullScan(libraryID, this.background)) {
			this.local.lastFullFileCheck[libraryID] = new Date().getTime();
			await this.local.checkForUpdatedFiles(libraryID);
			Trellis.Sync.Storage.FileChangeWatcher.recordFullScan(libraryID);
		}
	}
	// If this is a background sync, it's not the first sync of the session, the library has had
	// at least one full check this session, and it's been less than maxCheckAge since the last
	// full check of this library, check only files that were previously modified or opened
	// recently
	else if (this.background
			// TEMP: Don't check all files at startup
			// https://github.com/trellis/trellis/issues/5025
			//&& !this.firstInSession
			&& this.local.lastFullFileCheck[libraryID]
			&& (this.local.lastFullFileCheck[libraryID]
				+ (this.maxCheckAge * 1000)) > new Date().getTime()) {
		let itemIDs = await this.local.getFilesToCheck(libraryID, this.maxCheckAge);
		await this.local.checkForUpdatedFiles(libraryID, itemIDs);
	}
	// Otherwise check all files in library
	else {
		this.local.lastFullFileCheck[libraryID] = new Date().getTime();
		await this.local.checkForUpdatedFiles(libraryID);
	}
	
	await this.local.resolveConflicts(libraryID);
	
	var downloadForced = await this.local.checkForForcedDownloads(libraryID);
	
	// If we don't have any forced downloads, we can skip downloads if no storage metadata has
	// changed (meaning nothing else has uploaded files since the last successful file sync)
	if (downloadAll && !downloadForced) {
		if (this.library.storageVersion == this.library.libraryVersion) {
			Trellis.debug("No remote storage changes for " + this.library.name
				+ " -- skipping file downloads");
			downloadAll = false;
		}
	}
	
	// Get files to download
	if (downloadAll || downloadForced) {
		let itemIDs = await this.local.getFilesToDownload(libraryID, !downloadAll);
		if (itemIDs.length) {
			Trellis.debug(itemIDs.length + " file" + (itemIDs.length == 1 ? '' : 's') + " to "
				+ "download for " + this.library.name);
			for (let itemID of itemIDs) {
				let item = await Trellis.Items.getAsync(itemID);
				await this.queueItem(item);
			}
		}
		else {
			Trellis.debug("No files to download for " + this.library.name);
		}
	}
	
	// Get files to upload
	if (filesEditable) {
		let itemIDs = await this.local.getFilesToUpload(libraryID);
		if (itemIDs.length) {
			Trellis.debug(itemIDs.length + " file" + (itemIDs.length == 1 ? '' : 's') + " to "
				+ "upload for " + this.library.name);
			for (let itemID of itemIDs) {
				let item = await Trellis.Items.getAsync(itemID, { noCache: true });
				await this.queueItem(item);
			}
		}
		else {
			Trellis.debug("No files to upload for " + this.library.name);
		}
	}
	else {
		Trellis.debug("No file editing access -- skipping file uploads for " + this.library.name);
	}
	
	var promises = {
		download: this.queues.download.runAll(),
		upload: this.queues.upload.runAll()
	}
	
	// Process the results
	var downloadSuccessful = false;
	var changes = new Trellis.Sync.Storage.Result;
	for (let type of ['download', 'upload']) {
		let results = await Promise.allSettled(await promises[type]);
		let successfulResults = [];
		let succeeded = 0;
		let failed = 0;
		
		for (let r of results) {
			if (r.status == 'fulfilled') {
				succeeded++;
				successfulResults.push(r.value);
			}
			else {
				let e = r.reason;
				if (e instanceof CanceledException) {
					continue;
				}
				if (e instanceof Trellis.HTTP.CancelledException) {
					Trellis.debug(`File ${type} sync cancelled for ${this.library.name} `
						+ `(${succeeded} succeeded, ${failed} failed)`);
					throw new Trellis.Sync.UserCancelledException();
				}
				if (this.stopOnError) {
					Trellis.debug(`File ${type} sync failed for ${this.library.name}`);
					throw e;
				}
				failed++;
			}
		}
		
		Trellis.debug(`File ${type} sync finished for ${this.library.name} `
			+ `(${succeeded} succeeded, ${failed} failed)`);
		
		changes.updateFromResults(successfulResults);
		
		if (type == 'download'
				// Not stopped
				&& this.requestsRemaining == 0
				// No errors
				&& failed === 0) {
			downloadSuccessful = true;
		}
	}
	
	if (downloadSuccessful) {
		this.library.storageDownloadNeeded = false;
		this.library.storageVersion = this.library.libraryVersion;
		await this.library.saveTx();
	}
	
	// For ZFS, this purges all files on server based on flag set when switching from ZFS
	// to WebDAV in prefs. For WebDAV, this purges locally deleted files on server.
	try {
		await this.controller.purgeDeletedStorageFiles(libraryID);
	}
	catch (e) {
		Trellis.logError(e);
	}
	
	// If WebDAV sync, purge orphaned files
	if (downloadSuccessful && this.controller.mode == 'webdav') {
		try {
			await this.controller.purgeOrphanedStorageFiles(libraryID);
		}
		catch (e) {
			Trellis.logError(e);
		}
	}
	
	if (!changes.localChanges) {
		Trellis.debug("No local changes made during file sync");
	}
	
	Trellis.debug("Done with file sync for " + this.library.name);
	
	return changes;
}


/**
 * @param {String} [queueToStop] - 'upload' or 'download'; if not specified, stop all queues
 */
Trellis.Sync.Storage.Engine.prototype.stop = function (queueToStop) {
	if (queueToStop) {
		Trellis.debug(`Stopping file sync ${queueToStop} queue for ` + this.library.name);
		this.queues[queueToStop].stop();
	}
	else {
		Trellis.debug("Stopping file sync for " + this.library.name);
		for (let type in this.queues) {
			this.queues[type].stop();
		}
	}
}

Trellis.Sync.Storage.Engine.prototype.queueItem = async function (item) {
	switch (item.attachmentSyncState) {
		case Trellis.Sync.Storage.Local.SYNC_STATE_TO_DOWNLOAD:
		case Trellis.Sync.Storage.Local.SYNC_STATE_FORCE_DOWNLOAD:
			var type = 'download';
			var fn = 'downloadFile';
			break;
		
		case Trellis.Sync.Storage.Local.SYNC_STATE_TO_UPLOAD:
		case Trellis.Sync.Storage.Local.SYNC_STATE_FORCE_UPLOAD:
			var type = 'upload';
			var fn = 'uploadFile';
			break;
		
		case false:
			Trellis.debug("Sync state for item " + item.id + " not found", 2);
			return;
		
		default:
			throw new Error("Invalid sync state " + item.attachmentSyncState + " for item "
				+ item.libraryKey);
	}
	
	if (type == 'upload') {
		if (!((await item.fileExists()))) {
			Trellis.debug("File " + item.libraryKey + " not available to upload -- skipping");
			return;
		}
	}
	this.queues[type].add(() => {
		var request = new Trellis.Sync.Storage.Request({
			type,
			engine: this,
			libraryID: this.libraryID,
			name: item.libraryKey,
			onStart: request => this.controller[fn](request, this),
			onStop: () => {
				this.requestsRemaining--;
				this.onProgress(this.numRequests - this.requestsRemaining, this.numRequests);
			}
		});
		return request.start();
	});
	this.numRequests++;
	this.requestsRemaining++;
}
