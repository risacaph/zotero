Trellis.Sync.Storage.Local = {
	//
	// Constants
	//
	SYNC_STATE_TO_UPLOAD: 0,
	SYNC_STATE_TO_DOWNLOAD: 1,
	SYNC_STATE_IN_SYNC: 2,
	SYNC_STATE_FORCE_UPLOAD: 3,
	SYNC_STATE_FORCE_DOWNLOAD: 4,
	SYNC_STATE_IN_CONFLICT: 5,
	
	// If last-known remaining storage is below this number of megabytes, skip further upload
	// attempts in various situations
	STORAGE_REMAINING_MINIMUM: 5,
	
	lastFullFileCheck: {},
	uploadCheckFiles: [],
	storageRemainingForLibrary: new Map(),
	
	init: function () {
		Trellis.Notifier.registerObserver(this, ['group'], 'storageLocal');
	},
	
	notify: async function (action, type, ids, _extraData) {
		// Clean up cache on group deletion
		if (action == 'delete' && type == 'group') {
			for (let libraryID of ids) {
				if (this.lastFullFileCheck[libraryID]) {
					delete this.lastFullFileCheck[libraryID];
				}
				if (this.storageRemainingForLibrary.has(libraryID)) {
					this.storageRemainingForLibrary.delete(libraryID);
				}
			}
		}
	},
	
	getEnabledForLibrary: function (libraryID) {
		// The user must have synced for the first time before we allow storage requests.
		// This is relevant if an account is set up for syncing but the DB file is cleared and the
		// user double-clicks on a missing file in download-as-needed mode.
		if (!Trellis.Users.getCurrentUserID()) {
			return false;
		}
		var libraryType = Trellis.Libraries.get(libraryID).libraryType;
		switch (libraryType) {
		case 'user':
			return Trellis.Prefs.get("sync.storage.enabled");
		
		// TEMP: Always sync publications files, at least until we have a better interface for
		// setting library-specific settings
		case 'publications':
			return true;
		
		case 'group':
			return Trellis.Prefs.get("sync.storage.groups.enabled");
		
		case 'feed':
			return false;
		
		default:
			throw new Error(`Unexpected library type '${libraryType}'`);
		}
	},
	
	getClassForLibrary: function (libraryID) {
		return Trellis.Sync.Storage.Utilities.getClassForMode(this.getModeForLibrary(libraryID));
	},
	
	getModeForLibrary: function (libraryID) {
		var libraryType = Trellis.Libraries.get(libraryID).libraryType;
		switch (libraryType) {
		case 'user':
			return Trellis.Prefs.get("sync.storage.protocol") == 'webdav' ? 'webdav' : 'zfs';
		
		case 'publications':
		case 'group':
		// TODO: Remove after making sure this is never called for feed libraries
		case 'feed':
			return 'zfs';
		
		default:
			throw new Error(`Unexpected library type '${libraryType}'`);
		}
	},
	
	setModeForLibrary: function (libraryID, mode) {
		var libraryType = Trellis.Libraries.get(libraryID).libraryType;
		
		if (libraryType != 'user') {
			throw new Error(`Cannot set storage mode for ${libraryType} library`);
		}
		
		switch (mode) {
		case 'webdav':
		case 'zfs':
			Trellis.Prefs.set("sync.storage.protocol", mode);
			break;
		
		default:
			throw new Error(`Unexpected storage mode '${mode}'`);
		}
	},
	
	/**
	 * Check or enable download-as-needed mode
	 *
	 * @param {Integer} [libraryID]
	 * @param {Boolean} [enable] - If true, enable download-as-needed mode for the given library
	 * @return {Boolean|undefined} - If 'enable' isn't set to true, return true if
	 *     download-as-needed mode enabled and false if not
	 */
	downloadAsNeeded: function (libraryID, enable) {
		var pref = this._getDownloadPrefFromLibrary(libraryID);
		var val = 'on-demand';
		if (enable) {
			Trellis.Prefs.set(pref, val);
			return;
		}
		return Trellis.Prefs.get(pref) == val;
	},
	
	/**
	 * Check or enable download-on-sync mode
	 *
	 * @param {Integer} [libraryID]
	 * @param {Boolean} [enable] - If true, enable download-on-demand mode for the given library
	 * @return {Boolean|undefined} - If 'enable' isn't set to true, return true if
	 *     download-as-needed mode enabled and false if not
	 */
	downloadOnSync: function (libraryID, enable) {
		var pref = this._getDownloadPrefFromLibrary(libraryID);
		var val = 'on-sync';
		if (enable) {
			Trellis.Prefs.set(pref, val);
			return;
		}
		return Trellis.Prefs.get(pref) == val;
	},
	
	_getDownloadPrefFromLibrary: function (libraryID) {
		if (libraryID == Trellis.Libraries.userLibraryID) {
			return 'sync.storage.downloadMode.personal';
		}
		// TODO: Library-specific settings
		
		// Group library
		return 'sync.storage.downloadMode.groups';
	},
	
	/**
	 * Get files to check for local modifications for uploading
	 *
	 * This includes files previously modified or opened externally via Trellis within maxCheckAge
	 */
	getFilesToCheck: async function (libraryID, maxCheckAge) {
		var minTime = new Date().getTime() - (maxCheckAge * 1000);
		
		// Get files modified and synced since maxCheckAge
		var sql = "SELECT itemID FROM itemAttachments JOIN items USING (itemID) "
			+ "WHERE libraryID=? AND linkMode IN (?,?) AND syncState IN (?) AND "
			+ "storageModTime>=?";
		var params = [
			libraryID,
			Trellis.Attachments.LINK_MODE_IMPORTED_FILE,
			Trellis.Attachments.LINK_MODE_IMPORTED_URL,
			this.SYNC_STATE_IN_SYNC,
			minTime
		];
		var itemIDs = await Trellis.DB.columnQueryAsync(sql, params);
		
		// Get files opened since maxCheckAge
		itemIDs = itemIDs.concat(
			this.uploadCheckFiles.filter(x => x.timestamp >= minTime).map(x => x.itemID)
		);
		
		return Trellis.Utilities.arrayUnique(itemIDs);
	},
	
	
	/**
	 * Scans local files and marks any that have changed for uploading
	 * and any that are missing for downloading
	 *
	 * @param {Integer} libraryID
	 * @param {Integer[]} [itemIDs]
	 * @param {Object} [itemModTimes]  Item mod times indexed by item ids;
	 *                                 items with stored mod times
	 *                                 that differ from the provided
	 *                                 time but file mod times
	 *                                 matching the stored time will
	 *                                 be marked for download
	 * @return {Promise} Promise resolving to TRUE if any items changed state,
	 *                   FALSE otherwise
	 */
	checkForUpdatedFiles: async function (libraryID, itemIDs, itemModTimes) {
		var libraryName = Trellis.Libraries.getName(libraryID);
		var msg = "Checking for locally changed attachment files in " + libraryName;
		
		var memmgr = Components.classes["@mozilla.org/memory-reporter-manager;1"]
			.getService(Components.interfaces.nsIMemoryReporterManager);
		memmgr.init();
		//Trellis.debug("Memory usage: " + memmgr.resident);
		
		if (itemIDs) {
			if (!itemIDs.length) {
				Trellis.debug("No files to check for local changes");
				return false;
			}
		}
		if (itemModTimes) {
			if (!Object.keys(itemModTimes).length) {
				return false;
			}
			msg += " in download-marking mode";
		}
		
		Trellis.debug(msg);
		
		var changed = false;
		
		if (!itemIDs) {
			itemIDs = Object.keys(itemModTimes ? itemModTimes : {});
		}
		
		// Can only handle a certain number of bound parameters at a time
		var numIDs = itemIDs.length;
		var maxIDs = Trellis.DB.MAX_BOUND_PARAMETERS - 10;
		var done = 0;
		var rows = [];
		
		do {
			let chunk = itemIDs.splice(0, maxIDs);
			let sql = "SELECT itemID, linkMode, path, storageModTime, storageHash, syncState "
						+ "FROM itemAttachments JOIN items USING (itemID) "
						+ "WHERE linkMode IN (?,?) AND syncState IN (?,?)";
			let params = [
				Trellis.Attachments.LINK_MODE_IMPORTED_FILE,
				Trellis.Attachments.LINK_MODE_IMPORTED_URL,
				this.SYNC_STATE_TO_UPLOAD,
				this.SYNC_STATE_IN_SYNC
			];
			if (libraryID !== false) {
				sql += " AND libraryID=?";
				params.push(libraryID);
			}
			if (chunk.length) {
				sql += " AND itemID IN (" + chunk.map(() => '?').join() + ")";
				params = params.concat(chunk);
			}
			let chunkRows = await Trellis.DB.queryAsync(sql, params);
			if (chunkRows) {
				rows = rows.concat(chunkRows);
			}
			done += chunk.length;
		}
		while (done < numIDs);
		
		// If no files, or everything is already marked for download,
		// we don't need to do anything
		if (!rows.length) {
			Trellis.debug("No in-sync or to-upload files found in " + libraryName);
			return false;
		}
		
		// Index attachment data by item id
		itemIDs = [];
		var attachmentData = {};
		for (let row of rows) {
			var id = row.itemID;
			itemIDs.push(id);
			attachmentData[id] = {
				linkMode: row.linkMode,
				path: row.path,
				mtime: row.storageModTime,
				hash: row.storageHash,
				state: row.syncState
			};
		}
		rows = null;
		
		var t = new Date();
		var items = await Trellis.Items.getAsync(itemIDs, { noCache: true });
		var numItems = items.length;
		var updatedStates = {};
		
		//Trellis.debug("Memory usage: " + memmgr.resident);
		
		var changed = false;
		var statesToSet = {};
		for (let item of items) {
			// TODO: Catch error?
			let state = await this._checkForUpdatedFile(item, attachmentData[item.id]);
			if (state !== false) {
				if (!statesToSet[state]) {
					statesToSet[state] = [];
				}
				statesToSet[state].push(item);
				changed = true;
			}
		}
		// Update sync states in bulk
		if (changed) {
			await Trellis.DB.executeTransaction(async function () {
				for (let state in statesToSet) {
					await this.updateSyncStates(statesToSet[state], parseInt(state));
				}
			}.bind(this));
		}
		
		if (!items.length) {
			Trellis.debug("No synced files have changed locally");
		}
		
		Trellis.debug(`Checked ${numItems} files in ${libraryName} in ` + (new Date() - t) + " ms");
		
		return changed;
	},
	
	
	_checkForUpdatedFile: async function (item, attachmentData) {
		var lk = item.libraryKey;
		Trellis.debug("Checking attachment file for item " + lk, 4);
		
		var path = item.getFilePath();
		if (!path) {
			Trellis.debug("Marking pathless attachment " + lk + " as in-sync");
			return this.SYNC_STATE_IN_SYNC;
		}
		var fileName = PathUtils.filename(path);
		
		try {
			let { lastModified: fmtime } = await IOUtils.stat(path);
			//Trellis.debug("Memory usage: " + memmgr.resident);
			
			//Trellis.debug("File modification time for item " + lk + " is " + fmtime);
			
			// If file is already marked for upload, skip check. Even if the file was changed
			// both locally and remotely, conflicts are checked at upload time, so we don't need
			// to worry about it here.
			//
			// This is after stat() so that a missing file is properly marked for download.
			if (item.attachmentSyncState == this.SYNC_STATE_TO_UPLOAD) {
				Trellis.debug("File is already marked for upload");
				return false;
			}
			
			if (fmtime < 0) {
				Trellis.debug("File mod time " + fmtime + " is less than 0 -- interpreting as 0", 2);
				fmtime = 0;
			}
			
			//Trellis.debug("Stored mtime is " + attachmentData.mtime);
			//Trellis.debug("File mtime is " + fmtime);
			
			let mtime = attachmentData ? attachmentData.mtime : false;
			var same = !this.checkFileModTime(item, fmtime, mtime);
			if (same) {
				Trellis.debug("File has not changed");
				return false;
			}
			
			// If file hash matches stored hash, only the mod time changed, so skip
			let fileHash = await Trellis.Utilities.Internal.md5Async(path);
			
			var hash = attachmentData ? attachmentData.hash : ((await this.getSyncedHash(item.id)));
			if (hash && hash == fileHash) {
				Trellis.debug("Mod time didn't match (" + fmtime + " != " + mtime + ") "
					+ "but hash did for " + fileName + " for item " + lk
					+ " -- updating file mod time");
				try {
					await IOUtils.setModificationTime(path, mtime);
				}
				catch (e) {
					Trellis.File.checkFileAccessError(e, path, 'update');
				}
				return false;
			}
			
			// Mark file for upload
			Trellis.debug("Marking attachment " + lk + " as changed "
				+ "(" + mtime + " != " + fmtime + ")");
			return this.SYNC_STATE_TO_UPLOAD;
		}
		catch (e) {
			if (DOMException.isInstance(e)) {
				let missing = e.name == 'NotFoundError';
				if (missing) {
					Trellis.debug("Marking attachment " + lk + " as missing");
					return this.SYNC_STATE_TO_DOWNLOAD;
				}
				Trellis.debug(e, 1);
				throw new Error(`Error for operation '${e.operation}' for ${path}: ${e}`);
			}
			throw e;
		}
	},
	
	/**
	 *
	 * @param {Trellis.Item} item
	 * @param {Integer} fmtime - File modification time in milliseconds
	 * @param {Integer} mtime - Remote modification time in milliseconds
	 * @return {Boolean} - True if file modification time differs from remote mod time,
	 *                     false otherwise
	 */
	checkFileModTime: function (item, fmtime, mtime) {
		var libraryKey = item.libraryKey;
		
		if (fmtime == mtime) {
			Trellis.debug(`Mod time for ${libraryKey} matches remote file -- skipping`);
		}
		// Compare floored timestamps for filesystems that don't support millisecond
		// precision (e.g., HFS+)
		else if (Math.floor(mtime / 1000) == Math.floor(fmtime / 1000)) {
			Trellis.debug(`File mod times for ${libraryKey} are within one-second precision `
				+ "(" + fmtime + " \u2248 " + mtime + ") -- skipping");
		}
		// Allow timestamp to be exactly one hour off to get around time zone issues
		// -- there may be a proper way to fix this
		else if (Math.abs(Math.floor(fmtime / 1000) - Math.floor(mtime / 1000)) == 3600) {
			Trellis.debug(`File mod time (${fmtime}) for {$libraryKey} is exactly one hour off `
				+ `remote file (${mtime}) -- assuming time zone issue and skipping`);
		}
		else {
			return true;
		}
		
		return false;
	},
	
	checkForForcedDownloads: async function (libraryID) {
		// Forced downloads happen even in on-demand mode
		var sql = "SELECT COUNT(*) FROM items JOIN itemAttachments USING (itemID) "
			+ "WHERE libraryID=? AND syncState=?";
		return !!((await Trellis.DB.valueQueryAsync(
			sql, [libraryID, this.SYNC_STATE_FORCE_DOWNLOAD]
		)));
	},
	
	
	/**
	 * Get files marked as ready to download
	 *
	 * @param {Integer} libraryID
	 * @return {Promise<Number[]>} - Promise for an array of attachment itemIDs
	 */
	getFilesToDownload: function (libraryID, forcedOnly) {
		var sql = "SELECT itemID FROM itemAttachments JOIN items USING (itemID) "
					+ "WHERE libraryID=? AND syncState IN (?";
		var params = [libraryID, this.SYNC_STATE_FORCE_DOWNLOAD];
		if (!forcedOnly) {
			sql += ",?";
			params.push(this.SYNC_STATE_TO_DOWNLOAD);
		}
		sql += ") "
			// Skip attachments with empty path, which can't be saved, and files with .trellis*
			// paths, which have somehow ended up in some users' libraries
			+ "AND path!='' AND path NOT LIKE ?";
		params.push('storage:.trellis%');
		return Trellis.DB.columnQueryAsync(sql, params);
	},
	
	
	/**
	 * Get files marked as ready to upload
	 *
	 * @param {Integer} libraryID
	 * @return {Promise<Number[]>} - Promise for an array of attachment itemIDs
	 */
	getFilesToUpload: function (libraryID) {
		var sql = "SELECT itemID FROM itemAttachments JOIN items USING (itemID) "
			+ "WHERE libraryID=? AND syncState IN (?,?) AND linkMode IN (?,?,?)";
		var params = [
			libraryID,
			this.SYNC_STATE_TO_UPLOAD,
			this.SYNC_STATE_FORCE_UPLOAD,
			Trellis.Attachments.LINK_MODE_IMPORTED_FILE,
			Trellis.Attachments.LINK_MODE_IMPORTED_URL,
			Trellis.Attachments.LINK_MODE_EMBEDDED_IMAGE,
		];
		return Trellis.DB.columnQueryAsync(sql, params);
	},
	
	
	/**
	 * @param {Integer} libraryID
	 * @return {Promise<String[]>} - Promise for an array of item keys
	 */
	getDeletedFiles: function (libraryID) {
		var sql = "SELECT key FROM storageDeleteLog WHERE libraryID=?";
		return Trellis.DB.columnQueryAsync(sql, libraryID);
	},
	
	
	/**
	 * @param {Trellis.Item[]} items
	 * @param {String|Integer} syncState
	 * @return {Promise}
	 */
	updateSyncStates: function (items, syncState) {
		if (syncState === undefined) {
			throw new Error("Sync state not specified");
		}
		if (typeof syncState == 'string') {
			syncState = this["SYNC_STATE_" + syncState.toUpperCase()];
		}
		return Trellis.Utilities.Internal.forEachChunkAsync(
			items,
			1000,
			async function (chunk) {
				chunk.forEach((item) => {
					item._attachmentSyncState = syncState;
				});
				return Trellis.DB.queryAsync(
					"UPDATE itemAttachments SET syncState=? WHERE itemID IN "
						+ "(" + chunk.map(item => item.id).join(', ') + ")",
					syncState
				);
			}
		);
	},
	
	
	/**
	 * Mark all stored files for upload checking
	 *
	 * This is used when switching between storage modes in the preferences so that all existing files
	 * are uploaded via the new mode if necessary.
	 */
	resetAllSyncStates: async function (libraryID) {
		if (!libraryID) {
			throw new Error("libraryID not provided");
		}
		
		return Trellis.DB.executeTransaction(async function () {
			var sql = "SELECT itemID FROM items JOIN itemAttachments USING (itemID) "
				+ "WHERE libraryID=? AND itemTypeID=? AND linkMode IN (?, ?, ?)";
			var params = [
				libraryID,
				Trellis.ItemTypes.getID('attachment'),
				Trellis.Attachments.LINK_MODE_IMPORTED_FILE,
				Trellis.Attachments.LINK_MODE_IMPORTED_URL,
				Trellis.Attachments.LINK_MODE_EMBEDDED_IMAGE,
			];
			var itemIDs = await Trellis.DB.columnQueryAsync(sql, params);
			for (let itemID of itemIDs) {
				let item = Trellis.Items.get(itemID);
				item._attachmentSyncState = this.SYNC_STATE_TO_UPLOAD;
			}
			sql = "UPDATE itemAttachments SET syncState=? WHERE itemID IN (" + sql + ")";
			await Trellis.DB.queryAsync(sql, [this.SYNC_STATE_TO_UPLOAD].concat(params));
			
			var library = Trellis.Libraries.get(libraryID);
			library.storageVersion = -1;
			await library.save();
		}.bind(this));
	},
	
	
	/**
	 * Extract a downloaded file and update the database metadata
	 *
	 * @param {Trellis.Item} data.item
	 * @param {Integer}     data.mtime
	 * @param {String}      data.md5
	 * @param {Boolean}     data.compressed
	 * @return {Promise}
	 */
	processDownload: async function (data) {
		if (!data) {
			throw new Error("'data' not set");
		}
		if (!data.item) {
			throw new Error("'data.item' not set");
		}
		if (!data.mtime) {
			throw new Error("'data.mtime' not set");
		}
		if (data.mtime != parseInt(data.mtime)) {
			throw new Error("Invalid mod time '" + data.mtime + "'");
		}
		if (!data.compressed && !data.md5) {
			throw new Error("'data.md5' is required if 'data.compressed'");
		}
		
		var item = data.item;
		var mtime = parseInt(data.mtime);
		var md5 = data.md5;
		
		// TODO: Test file hash
		
		if (data.compressed) {
			var newPath = await this._processZipDownload(item);
		}
		else {
			var newPath = await this._processSingleFileDownload(item);
		}
		
		// If newPath is set, the file was renamed, so set item filename to that
		// and mark item for upload
		var path = await item.getFilePathAsync();
		if (newPath && path != newPath) {
			// If library isn't editable but filename was changed, update database without marking
			// item as unsynced
			try {
				if (!Trellis.Items.isEditable(item)) {
					Trellis.debug("File renamed without library access -- "
						+ "updating attachment path", 3);
					await item.relinkAttachmentFile(newPath, true);
				}
				else {
					await item.relinkAttachmentFile(newPath);
				}
			}
			catch (e) {
				Trellis.File.checkFileAccessError(e, path, 'update');
			}
			
			path = newPath;
		}
		
		if (!path) {
			// This generally shouldn't happen, since if the ZIP doesn't contain the primary file,
			// and there's only one HTML file within it, we rename it to the current filename, but
			// it could occur if there are multiple HTML files or there's an error renaming the file.
			Trellis.logError("File '" + item.attachmentFilename + "' not found after processing "
				+ "download " + item.libraryKey);
			return new Trellis.Sync.Storage.Result({
				localChanges: false
			});
		}
		
		try {
			// If hash not provided (e.g., WebDAV), calculate it now
			if (!md5) {
				md5 = await item.attachmentHash;
			}
			
			// Set the file mtime to the time from the server
			await OS.File.setDates(path, null, new Date(parseInt(mtime)));
		}
		catch (e) {
			Trellis.File.checkFileAccessError(e, path, 'update');
		}
		
		item.attachmentSyncedModificationTime = mtime;
		item.attachmentSyncedHash = md5;
		item.attachmentSyncState = "in_sync";
		await item.saveTx({ skipAll: true });
		
		return new Trellis.Sync.Storage.Result({
			localChanges: true
		});
	},
	
	
	_processSingleFileDownload: async function (item) {
		var tempFilePath = OS.Path.join(Trellis.getTempDirectory().path, item.key + '.tmp');
		
		if (!((await OS.File.exists(tempFilePath)))) {
			Trellis.debug(tempFilePath, 1);
			throw new Error("Downloaded file not found");
		}
		
		try {
			await Trellis.Attachments.createDirectoryForItem(item);
		}
		catch (e) {
			Trellis.File.checkFileAccessError(
				e, Trellis.Attachments.getStorageDirectory(item).path, 'create'
			);
		}
		
		var filename = item.attachmentFilename;
		if (!filename) {
			Trellis.debug("Empty filename for item " + item.key, 2);
		}
		// Don't save Windows aliases
		if (filename.endsWith('.lnk')) {
			return false;
		}
		
		var attachmentDir = Trellis.Attachments.getStorageDirectory(item).path;
		var renamed = false;
		
		// Make sure the new filename is valid, in case an invalid character made it over
		// (e.g., from before we checked for them)
		var filteredFilename = Trellis.File.getValidFileName(filename);
		if (filteredFilename != filename) {
			Trellis.debug("Filtering filename '" + filename + "' to '" + filteredFilename + "'");
			filename = filteredFilename;
			renamed = true;
		}
		var path = OS.Path.join(attachmentDir, filename);
		
		Trellis.debug("Moving download file " + PathUtils.filename(tempFilePath)
			+ ` into attachment directory as '${filename}'`);
		try {
			var finalFilename = Trellis.File.createShortened(
				path, Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0o644
			);
		}
		catch (e) {
			Trellis.File.checkFileAccessError(e, path, 'create');
		}
		
		if (finalFilename != filename) {
			Trellis.debug("Changed filename '" + filename + "' to '" + finalFilename + "'");
			
			filename = finalFilename;
			path = OS.Path.join(attachmentDir, filename);
			
			// Abort if Windows path limitation would cause filenames to be overly truncated
			if (Trellis.isWin && filename.length < 40) {
				try {
					await OS.File.remove(path);
				}
				catch (e) {}
				// TODO: localize
				var msg = "Due to a Windows path length limitation, your Trellis data directory "
					+ "is too deep in the filesystem for syncing to work reliably. "
					+ "Please relocate your Trellis data to a higher directory.";
				Trellis.debug(msg, 1);
				throw new Error(msg);
			}
			
			renamed = true;
		}
		
		try {
			await OS.File.move(tempFilePath, path);
		}
		catch (e) {
			try {
				await OS.File.remove(tempFilePath);
			}
			catch (e) {}
			
			Trellis.File.checkFileAccessError(e, path, 'create');
		}
		
		// processDownload() needs to know that we're renaming the file
		return renamed ? path : null;
	},
	
	
	_processZipDownload: async function (item) {
		var zipFile = Trellis.getTempDirectory();
		zipFile.append(item.key + '.tmp');
		
		if (!zipFile.exists()) {
			Trellis.debug(zipFile.path);
			throw new Error(`Downloaded ZIP file not found for item ${item.libraryKey}`);
		}
		
		var zipReader = Components.classes["@mozilla.org/libjar/zip-reader;1"].
				createInstance(Components.interfaces.nsIZipReader);
		try {
			zipReader.open(zipFile);
			zipReader.test(null);
			
			Trellis.debug("ZIP file is OK");
		}
		catch (e) {
			Trellis.debug(zipFile.leafName + " is not a valid ZIP file", 2);
			try {
				zipReader.close();
			}
			catch (e) {
				Trellis.debug(e, 2);
			}
			zipReader = null
			Cu.forceGC();
			
			try {
				zipFile.remove(false);
			}
			catch (e) {
				Trellis.File.checkFileAccessError(e, zipFile, 'delete');
			}
			
			// TODO: Remove prop file to trigger reuploading, in case it was an upload error?
			
			return false;
		}
		
		var parentDir = Trellis.Attachments.getStorageDirectory(item).path;
		try {
			await Trellis.Attachments.createDirectoryForItem(item);
		}
		catch (e) {
			zipReader.close();
			zipReader = null
			Cu.forceGC();
			throw e;
		}
		
		var returnFile = null;
		var count = 0;
		
		var itemFileName = item.attachmentFilename;
		var filteredItemFileName = Trellis.File.getValidFileName(itemFileName);
		
		var createdFiles = new Set();
		var entries = zipReader.findEntries(null);
		while (entries.hasMore()) {
			var entryName = entries.getNext();
			var entry = zipReader.getEntry(entryName);
			var b64re = /%ZB64$/;
			if (entryName.match(b64re)) {
				var filePath = Trellis.Utilities.Internal.Base64.decode(
					entryName.replace(b64re, '')
				);
			}
			else {
				var filePath = entryName;
			}
			
			if (filePath.startsWith('.trellis')) {
				Trellis.debug("Skipping " + filePath);
				continue;
			}
			
			if (entry.isDirectory) {
				Trellis.debug("Skipping directory " + filePath);
				continue;
			}
			count++;
			
			Trellis.debug("Extracting " + filePath);
			
			var primaryFile = itemFileName == filePath;
			var filtered = false;
			var renamed = false;
			
			// Make sure all components of the path are valid, in case an invalid character somehow made
			// it into the ZIP (e.g., from before we checked for them)
			var filteredPath = filePath.split('/').map(part => Trellis.File.getValidFileName(part)).join('/');
			if (filteredPath != filePath) {
				Trellis.debug("Filtering filename '" + filePath + "' to '" + filteredPath + "'");
				filePath = filteredPath;
				filtered = true;
			}
			
			let destPath = OS.Path.join(parentDir, ...filePath.split('/'));
			
			// If only one file in zip and it doesn't match the known filename,
			// take our chances and use that name
			if (count == 1 && !entries.hasMore() && itemFileName) {
				// May not be necessary, but let's be safe
				if (filteredItemFileName != filePath) {
					let msg = "Renaming single file '" + filePath + "' in ZIP to known filename '"
						+ filteredItemFileName + "'";
					Trellis.debug(msg, 2);
					Components.utils.reportError(msg);
					filePath = filteredItemFileName;
					destPath = OS.Path.join(PathUtils.parent(destPath), filteredItemFileName);
					renamed = true;
					primaryFile = true;
				}
			}
			
			if (primaryFile && filtered) {
				renamed = true;
			}
			
			if (await OS.File.exists(destPath)) {
				var msg = "ZIP entry '" + filePath + "' already exists";
				Trellis.logError(msg);
				Trellis.debug(destPath);
				continue;
			}
			
			let shortened;
			try {
				shortened = Trellis.File.createShortened(
					destPath, Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0o644
				);
			}
			catch (e) {
				Trellis.logError(e);
				
				zipReader.close();
				zipReader = null
				Cu.forceGC();
				
				Trellis.File.checkFileAccessError(e, destPath, 'create');
			}
			
			if (PathUtils.filename(destPath) != shortened) {
				Trellis.debug(`Changed filename '${PathUtils.filename(destPath)}' to '${shortened}'`);
				
				// Abort if Windows path limitation would cause filenames to be overly truncated
				if (Trellis.isWin && shortened < 40) {
					try {
						await OS.File.remove(destPath);
					}
					catch (e) {}
					zipReader.close();
					zipReader = null
					Cu.forceGC();
					
					// TODO: localize
					var msg = "Due to a Windows path length limitation, your Trellis data directory "
						+ "is too deep in the filesystem for syncing to work reliably. "
						+ "Please relocate your Trellis data to a higher directory.";
					Trellis.debug(msg, 1);
					throw new Error(msg);
				}
				
				destPath = OS.Path.join(PathUtils.parent(destPath), shortened);
				
				if (primaryFile) {
					renamed = true;
				}
			}
			
			try {
				zipReader.extract(entryName, Trellis.File.pathToFile(destPath));
				createdFiles.add(PathUtils.filename(destPath));
			}
			catch (e) {
				try {
					await OS.File.remove(destPath);
				}
				catch (e) {}
				
				// For advertising junk files, ignore a bug on Windows where
				// destFile.create() works but zipReader.extract() doesn't
				// when the path length is close to 255.
				if (PathUtils.filename(destPath).match(/[a-zA-Z0-9+=]{130,}/)) {
					var msg = "Ignoring error extracting '" + destPath + "'";
					Trellis.debug(msg, 2);
					Trellis.debug(e, 2);
					Components.utils.reportError(msg + " in " + funcName);
					continue;
				}
				
				zipReader.close();
				zipReader = null
				Cu.forceGC();
				
				Trellis.File.checkFileAccessError(e, destPath, 'create');
			}
			
			await Trellis.File.setNormalFilePermissions(destPath);
			
			// If we're renaming the main file, processDownload() needs to know
			if (renamed) {
				returnFile = destPath;
			}
		}
		zipReader.close();
		zipReader = null
		Cu.forceGC();
		
		// TEMP: Allow deleting to fail on Windows
		if (Trellis.isWin) {
			try {
				zipFile.remove(false);
			}
			catch (e) {
				Trellis.logError(e);
				// Try again in 30 seconds
				setTimeout(() => {
					try {
						zipFile.remove(false);
					}
					catch (e) {
						Trellis.logError(e);
					}
				}, 30000);
			}
		}
		else {
			zipFile.remove(false);
		}
		
		// If no extracted files match the known filename, but there's only one HTML file, rename it
		if (!createdFiles.has(filteredItemFileName)) {
			Trellis.debug(`${filteredItemFileName} not found among extracted files`);
			let htmlFiles = [...createdFiles].filter(x => /\.html?$/.test(x));
			if (htmlFiles.length == 1) {
				let destPath = PathUtils.join(parentDir, filteredItemFileName);
				try {
					Trellis.debug(`Renaming ${htmlFiles[0]} to ${filteredItemFileName}`);
					await IOUtils.move(PathUtils.join(parentDir, htmlFiles[0]), destPath);
					returnFile = destPath;
				}
				catch (e) {
					Trellis.logError(e);
				}
			}
		}
		
		return returnFile;
	},
	
	
	/**
	 * @return {Promise<Object[]>} - A promise for an array of conflict objects
	 */
	getConflicts: async function (libraryID) {
		var sql = "SELECT itemID, version FROM items JOIN itemAttachments USING (itemID) "
			+ "WHERE libraryID=? AND syncState=?";
		var rows = await Trellis.DB.queryAsync(
			sql,
			[
				{ int: libraryID },
				this.SYNC_STATE_IN_CONFLICT
			]
		);
		var keyVersionPairs = rows.map(function (row) {
			var { libraryID, key } = Trellis.Items.getLibraryAndKeyFromID(row.itemID);
			return [key, row.version];
		});
		var cacheObjects = await Trellis.Sync.Data.Local.getCacheObjects(
			'item', libraryID, keyVersionPairs
		);
		if (!cacheObjects.length) return [];
		
		var cacheObjectsByKey = {};
		cacheObjects.forEach(obj => cacheObjectsByKey[obj.key] = obj);
		
		var items = [];
		var localItems = await Trellis.Items.getAsync(rows.map(row => row.itemID));
		for (let localItem of localItems) {
			// Use the mtime for the dateModified field, since that's all that's shown in the
			// CR window at the moment
			let localItemJSON = localItem.toJSON();
			localItemJSON.dateModified = Trellis.Date.dateToISO(
				new Date(await localItem.attachmentModificationTime)
			);
			
			let remoteItemJSON = cacheObjectsByKey[localItem.key];
			if (!remoteItemJSON) {
				Trellis.logError("Cached object not found for item " + localItem.libraryKey);
				continue;
			}
			remoteItemJSON = remoteItemJSON.data;
			if (remoteItemJSON.mtime) {
				remoteItemJSON.dateModified = Trellis.Date.dateToISO(new Date(remoteItemJSON.mtime));
			}
			items.push({
				libraryID,
				left: localItemJSON,
				right: remoteItemJSON,
				changes: [],
				conflicts: []
			})
		}
		return items;
	},
	
	
	resolveConflicts: async function (libraryID) {
		var conflicts = await this.getConflicts(libraryID);
		if (!conflicts.length) return false;
		
		Trellis.debug("Reconciling conflicts for " + Trellis.Libraries.get(libraryID).name);
		Trellis.debug(conflicts);
		
		var io = {
			dataIn: {
				type: 'file',
				captions: [
					Trellis.getString('sync.storage.localFile'),
					Trellis.getString('sync.storage.remoteFile'),
					Trellis.getString('sync.storage.savedFile')
				],
				conflicts
			}
		};
		
		var wm = Services.wm;
		var lastWin = wm.getMostRecentWindow("navigator:browser");
		lastWin.openDialog('chrome://trellis/content/merge.xhtml', '', 'chrome,modal,centerscreen', io);
		
		if (!io.dataOut) {
			return false;
		}
		
		await Trellis.DB.executeTransaction(async function () {
			for (let i = 0; i < conflicts.length; i++) {
				let conflict = conflicts[i];
				// TEMP
				Trellis.debug(conflict);
				let item = Trellis.Items.getByLibraryAndKey(libraryID, conflict.left.key);
				let mtime = io.dataOut[i].data.dateModified;
				// Local
				if (mtime == conflict.left.dateModified) {
					syncState = this.SYNC_STATE_FORCE_UPLOAD;
					// When local version is chosen, update stored mtime and hash to remote values
					// so that upload goes through without a 412.
					//
					// These sometimes might not be set in the cached JSON (for unclear reasons, but
					// see https://forums.trellis.org/discussion/79011/trellis-error-report), in which
					// case we just ignore them and hope that the local version has null values too.
					if (conflict.right.mtime) {
						item.attachmentSyncedModificationTime = conflict.right.mtime;
					}
					if (conflict.right.md5) {
						item.attachmentSyncedHash = conflict.right.md5;
					}
				}
				// Remote
				else {
					syncState = this.SYNC_STATE_FORCE_DOWNLOAD;
				}
				item.attachmentSyncState = syncState;
				await item.save({ skipAll: true });
			}
		}.bind(this));
		return true;
	}
}
