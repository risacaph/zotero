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

Trellis.Fulltext = Trellis.FullText = new function () {
	this.__defineGetter__("fulltextCacheFile", function () { return '.trellis-ft-cache'; });

	this.INDEX_STATE_UNAVAILABLE = 0;
	this.INDEX_STATE_UNINDEXED = 1;
	this.INDEX_STATE_PARTIAL = 2;
	this.INDEX_STATE_INDEXED = 3;
	this.INDEX_STATE_QUEUED = 4;
	
	this.SYNC_STATE_UNSYNCED = 0;
	this.SYNC_STATE_IN_SYNC = 1;
	this.SYNC_STATE_TO_PROCESS = 2;
	this.SYNC_STATE_TO_DOWNLOAD = 3;
	this.SYNC_STATE_MISSING = 4;
	
	const _processorCacheFile = '.trellis-ft-unprocessed';
	
	const kWbClassSpace =            0;
	const kWbClassAlphaLetter =      1;
	const kWbClassPunct =            2;
	const kWbClassHanLetter =        3;
	const kWbClassKatakanaLetter =   4;
	const kWbClassHiraganaLetter =   5;
	const kWbClassHWKatakanaLetter = 6;
	const kWbClassThaiLetter =       7;
	
	var _pdfConverter = null; // nsIFile to executable
	var _pdfInfo = null; // nsIFile to executable
	var _pdfData = null;
	
	var _idleObserverIsRegistered = false;
	var _idleObserverDelay = 30;
	var _processorTimeoutID = null;
	var _processorBlacklist = {};
	var _upgradeCheck = true;
	var _syncLibraryVersion = 0;
	
	this.init = async function () {
		let setUpIndexingDB = async () => {
			await Trellis.DB.queryAsync("ATTACH ':memory:' AS 'indexing'");
			await Trellis.DB.queryAsync('CREATE TABLE indexing.fulltextWords (word NOT NULL)');
		};
		await setUpIndexingDB();
		// ATTACHed databases don't survive a connection reopen (e.g., after vacuum), so
		// re-run the setup on every reconnect
		Trellis.DB.onConnect(setUpIndexingDB);

		let pdfConverterFileName = "pdftotext";
		let pdfInfoFileName = "pdfinfo";
		
		if (Trellis.isWin) {
			pdfConverterFileName += '.exe';
			pdfInfoFileName += '.exe';
		}
		
		// AChrome is app/chrome
		let dir = FileUtils.getDir('AChrom', []).parent.parent;
		
		_pdfData = dir.clone();
		_pdfData.append('poppler-data');
		_pdfData = _pdfData.path;
		
		_pdfConverter = dir.clone();
		_pdfInfo = dir.clone();
		
		if(Trellis.isMac) {
			_pdfConverter = _pdfConverter.parent;
			_pdfConverter.append('MacOS');
			
			_pdfInfo = _pdfInfo.parent;
			_pdfInfo.append('MacOS');
		}

		_pdfConverter.append(pdfConverterFileName);
		_pdfInfo.append(pdfInfoFileName);
		
		Trellis.uiReadyPromise.then(async () => {
			await Trellis.Promise.delay(30000);
			
			this.registerContentProcessor();
			Trellis.addShutdownListener(this.unregisterContentProcessor.bind(this));
			
			// Start/stop content processor with full-text content syncing pref
			Trellis.Prefs.registerObserver('sync.fulltext.enabled', (enabled) => {
				if (enabled) {
					this.registerContentProcessor();
				}
				else {
					this.unregisterContentProcessor();
				}
			});
			
			// Stop content processor during syncs
			Trellis.Notifier.registerObserver(
				{
					notify: function (event, type, ids, extraData) {
						if (event == 'start') {
							this.unregisterContentProcessor();
						}
						else if (event == 'stop') {
							this.registerContentProcessor();
						}
					}.bind(this)
				},
				['sync'],
				'fulltext'
			);
		});
	};
	
	
	this.setPDFConverterPath = function (path) {
		_pdfConverter = Trellis.File.pathToFile(path);
	};
	
	
	this.setPDFInfoPath = function (path) {
		_pdfInfo = Trellis.File.pathToFile(path);
		
	};
	
	
	this.setPDFDataPath = function (path) {
		_pdfData = path;
	};
	
	
	this.getLibraryVersion = function (libraryID) {
		if (!libraryID) throw new Error("libraryID not provided");
		return Trellis.DB.valueQueryAsync(
			"SELECT version FROM version WHERE schema=?", "fulltext_" + libraryID
		)
	};
	
	
	this.setLibraryVersion = async function (libraryID, version) {
		if (!libraryID) throw new Error("libraryID not provided");
		await Trellis.DB.queryAsync(
			"REPLACE INTO version VALUES (?, ?)", ["fulltext_" + libraryID, version]
		);
	};
	
	
	this.clearLibraryVersion = function (libraryID) {
		return Trellis.DB.queryAsync("DELETE FROM version WHERE schema=?", "fulltext_" + libraryID);
	};
	
	
	this.getItemVersion = async function (itemID) {
		return Trellis.DB.valueQueryAsync(
			"SELECT version FROM fulltextItems WHERE itemID=?", itemID
		)
	};
	
	
	this.setItemSynced = function (itemID, version) {
		return Trellis.DB.queryAsync(
			"UPDATE fulltextItems SET synced=?, version=? WHERE itemID=?",
			[this.SYNC_STATE_IN_SYNC, version, itemID]
		);
	};
	
	
	// this is a port from http://mxr.mozilla.org/mozilla-central/source/intl/lwbrk/src/nsSampleWordBreaker.cpp to
	// Javascript to avoid the overhead of xpcom calls. The port keeps to the mozilla naming of interfaces/constants as
	// closely as possible.
	function getClass(c, cc) {
		if (cc < 0x2E80) { //alphabetical script
			if ((cc & 0xFF80) == 0) { // ascii
				if (c == ' '  || c == "\t" || c == "\r" || c == "\n") { return kWbClassSpace; }
				if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) { return kWbClassAlphaLetter; }
				return kWbClassPunct;
			}
			if ((0xFF80 & cc) == 0x0E00) { return kWbClassThaiLetter; }
			if (cc == 0x00A0/*NBSP*/) { return kWbClassSpace; }
			
			// General and Supplemental Unicode punctuation
			if ((cc >= 0x2000 && cc <= 0x206f) || (cc >= 0x2e00 && cc <= 0x2e7f)) { return kWbClassPunct; }
			
			return kWbClassAlphaLetter;
		}

		if ((cc >= 0x3400 && cc <= 0x9fff) || (cc>= 0xf900 && cc <= 0xfaff)) /*han*/ { return kWbClassHanLetter; }
		if (cc >= 0x30A0 && cc <= 0x30FF) { return kWbClassKatakanaLetter; }
		if (cc >= 0x3040 && cc <= 0x309F) { return kWbClassHiraganaLetter; }
		if (cc>= 0xFF60 && cc <= 0xFF9F) { return kWbClassHWKatakanaLetter; }
		return kWbClassAlphaLetter;
	}
	
	
	this.getPDFConverterExecAndArgs = function () {
		return {
			exec: _pdfConverter,
			args: ['-datadir', _pdfData]
		}
	};
	
	
	/*
	 * Returns true if MIME type is converted to text and cached before indexing
	 *   (e.g. application/pdf is run through pdftotext)
	 */
	this.isCachedMIMEType = function (mimeType) {
		switch (mimeType) {
			case 'application/pdf':
			case 'text/html':
			case 'application/epub+zip':
				return true;
		}
		return false;
	};
	
	
	/**
	 * Index multiple words at once
	 *
	 * @requireTransaction
	 * @param {Number} itemID
	 * @param {Array<string>} words
	 * @return {Promise}
	 */
	var indexWords = async function (itemID, words, stats, version, synced) {
		Trellis.DB.requireTransaction();
		let chunk;
		await Trellis.DB.queryAsync("DELETE FROM indexing.fulltextWords");
		while (words.length > 0) {
			chunk = words.splice(0, 100);
			await Trellis.DB.queryAsync('INSERT INTO indexing.fulltextWords (word) ' + chunk.map(x => 'SELECT ?').join(' UNION '), chunk);
		}
		await Trellis.DB.queryAsync('INSERT OR IGNORE INTO fulltextWords (word) SELECT word FROM indexing.fulltextWords');
		await Trellis.DB.queryAsync('DELETE FROM fulltextItemWords WHERE itemID = ?', [itemID]);
		await Trellis.DB.queryAsync('INSERT OR IGNORE INTO fulltextItemWords (wordID, itemID) SELECT wordID, ? FROM fulltextWords JOIN indexing.fulltextWords USING(word)', [itemID]);
		
		var cols = ['itemID', 'version', 'synced'];
		var params = [
			itemID,
			version ? parseInt(version) : 0,
			synced ? parseInt(synced) : Trellis.FullText.SYNC_STATE_UNSYNCED
		];
		if (stats) {
			for (let stat in stats) {
				cols.push(stat);
				params.push(stats[stat] ? parseInt(stats[stat]) : null);
			}
		}
		var sql = `REPLACE INTO fulltextItems (${cols.join(', ')}) `
			+ `VALUES (${cols.map(_ => '?').join(', ')})`;
		await Trellis.DB.queryAsync(sql, params);
		
		await Trellis.DB.queryAsync("DELETE FROM indexing.fulltextWords");
	};
	
	
	/**
	 * @return {Promise}
	 */
	var indexString = async function (text, itemID, stats, version, synced) {
		if (itemID != parseInt(itemID)) {
			throw new Error("itemID not provided");
		}
		
		var words = this.semanticSplitter(text);
		
		while (Trellis.DB.inTransaction()) {
			await Trellis.DB.waitForTransaction('indexString()');
		}
		
		await Trellis.DB.executeTransaction(async function () {
			this.clearItemWords(itemID, true);
			await indexWords(itemID, words, stats, version, synced);
			
			/*
			var sql = "REPLACE INTO fulltextContent (itemID, textContent) VALUES (?,?)";
			Trellis.DB.query(sql, [itemID, {string:text}]);
			*/
			
			Trellis.Notifier.queue('index', 'item', itemID);
			Trellis.Notifier.queue('refresh', 'item', itemID);
		}.bind(this));
		
		// If there's a processor cache file, delete it (whether or not we just used it)
		var item = await Trellis.Items.getAsync(itemID);
		var cacheFile = this.getItemProcessorCacheFile(item);
		if (cacheFile.exists()) {
			cacheFile.remove(false);
		}
	}.bind(this);
	
	
	/**
	 * @param {Document} document
	 * @param {Number} itemID
	 * @return {Promise}
	 */
	this.indexDocument = async function (document, itemID) {
		if (!itemID){
			throw ('Item ID not provided to indexDocument()');
		}
		
		Trellis.debug("Indexing document '" + document.title + "'");
		
		if (!Trellis.MIME.isTextType(document.contentType)) {
			Trellis.debug(document.contentType + " document is not text", 2);
			return false;
		}
		
		if (!document.body) {
			Trellis.debug("Cannot index " + document.contentType + " file", 2);
			return false;
		}
		
		if (!document.characterSet){
			Trellis.debug("Text file didn't have charset", 2);
			return false;
		}
		
		var maxLength = Trellis.Prefs.get('fulltext.textMaxLength');
		if (!maxLength) {
			return false;
		}
		var text = document.documentElement.innerText;
		var totalChars = text.length;
		var item = Trellis.Items.get(itemID);
		if (document.contentType == 'text/html') {
			await writeCacheFile(item, text, maxLength);
		}
		
		if (totalChars > maxLength) {
			Trellis.debug('Only indexing first ' + maxLength + ' characters of item '
				+ itemID + ' in indexDocument()');
		}
		
		await indexString(
			text,
			itemID,
			{ indexedChars: text.length, totalChars }
		);
	};
	

	/**
	 * Index PDF file and store the fulltext content in a file
	 *
	 * @param {String} filePath
	 * @param {Number} itemID
	 * @param {Boolean} [allPages] - If true, index all pages rather than pdfMaxPages
	 * @return {Promise}
	 */
	this.indexPDF = async function (filePath, itemID, allPages) {
		var maxPages = Trellis.Prefs.get('fulltext.pdfMaxPages');
		if (maxPages == 0) {
			return false;
		}
		var item = await Trellis.Items.getAsync(itemID);
		var linkMode = item.attachmentLinkMode;
		// If the file is stored outside of Trellis, the cache file is saved in
		// the item's storage directory
		var parentDirPath = linkMode == Trellis.Attachments.LINK_MODE_LINKED_FILE
			? Trellis.Attachments.getStorageDirectory(item).path
			: PathUtils.parent(filePath);
		var cacheFilePath = OS.Path.join(parentDirPath, this.fulltextCacheFile);
		if (linkMode == Trellis.Attachments.LINK_MODE_LINKED_FILE) {
			// Create only if missing -- don't use createDirectoryForItem(),
			// which deletes and recreates the directory and would destroy
			// other files stored there (e.g., the SDT cache)
			await Trellis.File.createDirectoryIfMissingAsync(parentDirPath);
			// Remove any previous cache file, which createDirectoryForItem()
			// did implicitly, so that a failed re-extraction below can't
			// leave a replaced file's old text in place
			await IOUtils.remove(cacheFilePath, { ignoreAbsent: true });
		}
		try {
			var {
				text,
				extractedPages,
				totalPages
			} = await Trellis.PDFWorker.getFullText(itemID, allPages ? null : maxPages);
		}
		catch (e) {
			Trellis.logError(e);
			return false;
		}
		if (!text || !extractedPages) {
			return false;
		}
		await Trellis.File.putContentsAsync(cacheFilePath, text);
		var stats = { indexedPages: extractedPages, totalPages };
		await indexString(text, itemID, stats);
		return true;
	};


	/**
	 * Index EPUB file and store the fulltext content in a file
	 *
	 * @param {String} filePath
	 * @param {Number} itemID
	 * @param {Boolean} [allText] If true, index all text rather than textMaxLength
	 * @return {Promise}
	 */
	this.indexEPUB = async function (filePath, itemID, allText) {
		const { EPUB } = ChromeUtils.importESModule("chrome://trellis/content/EPUB.mjs");
		
		let maxLength = Trellis.Prefs.get('fulltext.textMaxLength');
		if (maxLength === 0) {
			return false;
		}
		let item = await Trellis.Items.getAsync(itemID);
		let epub = new EPUB(filePath);
		
		try {
			let text = '';
			let totalChars = 0;
			for await (let { href, doc } of epub.getSectionDocuments(filePath)) {
				if (!doc.body) {
					Trellis.debug(`Skipping EPUB entry '${href}' with no body`);
					continue;
				}
				
				let bodyText = doc.body.innerText;
				totalChars += bodyText.length;
				if (!allText) {
					bodyText = bodyText.substring(0, maxLength - text.length);
				}
				text += bodyText;
			}
			
			await writeCacheFile(item, text, maxLength, allText);
			await indexString(text, itemID, { indexedChars: text.length, totalChars });
			return true;
		}
		catch (e) {
			Trellis.logError(e);
			return false;
		}
		finally {
			epub.close();
		}
	};
	
	
	/**
	 * @param {Integer[]|Integer} items - One or more itemIDs
	 * @param {Object} [options]
	 * @param {Boolean} [options.complete=false] - Ignore page/character limits
	 * @param {Boolean} [options.ignoreErrors=false] - Continue on error instead of throwing
	 */
	this.indexItems = async function (itemIDs, options = {}) {
		var complete;
		var ignoreErrors;
		if (typeof options == 'boolean') {
			Trellis.logError("indexItems() now takes an 'options' object -- please update your code");
			complete = options;
			ignoreErrors = arguments[2];
		}
		else {
			complete = options.complete;
			ignoreErrors = options.ignoreErrors;
		}
		
		if (!Array.isArray(itemIDs)) {
			itemIDs = [itemIDs];
		}
		var items = await Trellis.Items.getAsync(itemIDs);
		for (let item of items) {
			if (!item.isAttachment()) {
				continue;
			}
			
			Trellis.debug("Indexing item " + item.libraryKey);
			let itemID = item.id;
			
			// If there's a processor cache file from syncing, use it
			let processorCacheFile = this.getItemProcessorCacheFile(item).path;
			if (await OS.File.exists(processorCacheFile)) {
				let indexed = await Trellis.Fulltext.indexFromProcessorCache(itemID);
				if (indexed) {
					continue;
				}
			}
			
			var path = await item.getFilePathAsync();
			if (!path) {
				Trellis.debug("No file to index for item " + item.libraryKey);
				continue;
			}
			
			try {
				await indexItem(item, path, complete);
			}
			catch (e) {
				if (ignoreErrors) {
					Trellis.logError("Error indexing " + path);
					Trellis.logError(e);
					continue;
				}
				throw e;
			}
		}
	};
	
	
	var indexItem = async function (item, path, complete) {
		if (!(await OS.File.exists(path))) {
			Trellis.debug(`${path} does not exist in indexItem()`, 2);
			return false;
		}
		
		var contentType = item.attachmentContentType;
		var charset = item.attachmentCharset;
		
		if (!contentType) {
			Trellis.debug("No content type in indexItem()", 2);
			return false;
		}
		
		var maxLength = Trellis.Prefs.get('fulltext.textMaxLength');
		if (!maxLength) {
			Trellis.debug('fulltext.textMaxLength is 0 -- skipping indexing');
			return false;
		}
		
		if (contentType == 'application/pdf') {
			return this.indexPDF(path, item.id, complete);
		}
		
		if (contentType == 'application/epub+zip') {
			return this.indexEPUB(path, item.id, complete);
		}

		if (!Trellis.MIME.isTextType(contentType)) {
			Trellis.debug('File is not text in indexItem()', 2);
			return false;
		}
		
		Trellis.debug('Indexing file ' + path);
		
		var text;
		
		// If it's a plain-text file and we know the charset, just get the contents
		if (contentType == 'text/plain' && charset) {
			text = await Trellis.File.getContentsAsync(path, charset);
		}
		// Otherwise load it in a hidden browser
		else {
			// If the file's content type can't be displayed in a browser, treat it as text/plain
			if (!Cc["@mozilla.org/webnavigation-info;1"].getService(Ci.nsIWebNavigationInfo)
					.isTypeSupported(contentType)) {
				contentType = 'text/plain';
			}
			
			let pageData = await getPageData(path, contentType);
			text = pageData.bodyText;
			if (!charset) {
				charset = pageData.characterSet;
			}
			if (contentType == 'text/html') {
				await writeCacheFile(item, text, maxLength, complete);
			}
			
			// If the item didn't have a charset assigned and the library is editable, update it now
			if (charset && !item.attachmentCharset && item.library.editable) {
				let canonical = Trellis.CharacterSets.toCanonical(charset);
				let msg = `Character set is ${canonical}`;
				if (charset != canonical) {
					msg += ` (detected: ${charset})`;
					charset = canonical;
				}
				Trellis.debug(msg);
				
				if (charset) {
					item.attachmentCharset = charset;
					await item.saveTx({
						skipNotifier: true
					});
				}
			}
			
			if (!charset) {
				Trellis.debug(`Couldn't detect character set for ${item.libraryKey} -- using UTF-8`);
				charset = 'utf-8';
			}
		}
		
		var totalChars = text.length;
		if (!complete) {
			text = text.substr(0, maxLength);
		}
		var stats = { indexedChars: text.length, totalChars };
		await indexString(text, item.id, stats);
	}.bind(this);
	
	
	// TEMP: Temporary mechanism to serialize indexing of new attachments
	//
	// This should instead save the itemID to a table that's read by the content processor
	var _queue = [];
	var _indexing = false;
	var _nextIndexTime;
	var _indexDelay = 5000;
	var _indexInterval = 500;
	var _indexNextInTest = false;
	
	this.queueItem = async function (item) {
		// Index files immediately during tests that enable it
		if (Trellis.test) {
			if (_indexNextInTest) {
				_indexNextInTest = false;
				await this.indexItems([item.id]);
			}
			return;
		}
		
		_queue.push(item.id);
		_nextIndexTime = Date.now() + _indexDelay;
		setTimeout(() => {
			_processNextItem()
		}, _indexDelay);
	};
	
	this.indexNextInTest = function () {
		_indexNextInTest = true;
	};
	
	async function _processNextItem() {
		if (!_queue.length) return;
		// Another _processNextItem() was scheduled
		if (Date.now() < _nextIndexTime) return;
		// If indexing is already running, _processNextItem() will be called when it's done
		if (_indexing) return;
		_indexing = true;
		var itemID = _queue.shift();
		try {
			await Trellis.FullText.indexItems([itemID], { ignoreErrors: true });
		}
		finally {
			_indexing = false;
		}
		setTimeout(() => {
			_processNextItem();
		}, _indexInterval);
	};
	
	
	//
	// Full-text content syncing
	//
	/**
	 * Get content and stats that haven't yet been synced
	 *
	 * @param {Integer} libraryID
	 * @param {Integer} [options]
	 * @param {Integer} [options.maxSize]
	 * @param {Integer} [options.maxItems]
	 * @param {Integer} [options.lastItemID] - Only return content for items above this id
	 * @return {Promise<Array<Object>>}
	 */
	this.getUnsyncedContent = async function (libraryID, options = {}) {
		var contentItems = [];
		var sql = "SELECT itemID, indexedChars, totalChars, indexedPages, totalPages "
			+ "FROM fulltextItems FI JOIN items I USING (itemID) WHERE libraryID=? AND "
			+ "FI.synced=? AND I.synced=1 ";
		var params = [libraryID, this.SYNC_STATE_UNSYNCED];
		if (options.lastItemID) {
			sql += "AND itemID>?";
			params.push(options.lastItemID);
		}
		sql += "ORDER BY itemID";
		var rows = await Trellis.DB.queryAsync(sql, params);
		var contentSize = 0;
		for (let i = 0; i < rows.length; i++) {
			let row = rows[i];
			let content;
			let itemID = row.itemID;
			let item = await Trellis.Items.getAsync(itemID);
			let libraryKey = item.libraryKey;
			let contentType = item.attachmentContentType;
			if (contentType && (this.isCachedMIMEType(contentType) || Trellis.MIME.isTextType(contentType))) {
				try {
					let cacheFile = this.getItemCacheFile(item).path;
					if (await OS.File.exists(cacheFile)) {
						Trellis.debug("Getting full-text content from cache "
							+ "file for item " + libraryKey);
						content = await Trellis.File.getContentsAsync(cacheFile);
					}
					else {
						// If a cache file is required, mark the full text as missing
						if (this.isCachedMIMEType(contentType)) {
							Trellis.debug("Full-text content cache file doesn't exist for item "
								+ libraryKey, 2);
							let sql = "UPDATE fulltextItems SET synced=? WHERE itemID=?";
							await Trellis.DB.queryAsync(sql, [this.SYNC_STATE_MISSING, item.id]);
							continue;
						}
						
						// Same for missing attachments
						let path = await item.getFilePathAsync();
						if (!path) {
							Trellis.debug("File doesn't exist getting full-text content for item "
								+ libraryKey, 2);
							let sql = "UPDATE fulltextItems SET synced=? WHERE itemID=?";
							await Trellis.DB.queryAsync(sql, [this.SYNC_STATE_MISSING, item.id]);
							continue;
						}
						
						Trellis.debug("Getting full-text content from file for item " + libraryKey);
						content = await Trellis.File.getContentsAsync(path, item.attachmentCharset);
						
						// Include only as many characters as we've indexed
						content = content.substr(0, row.indexedChars);
					}
				}
				catch (e) {
					Trellis.logError(e);
					continue;
				}
			}
			else {
				Trellis.debug("Skipping non-text file getting full-text content for item "
					+ `${libraryKey} (contentType: ${contentType})`, 2);
				
				// Delete rows for items that weren't supposed to be indexed
				await Trellis.DB.executeTransaction(async function () {
					await this.clearItemWords(itemID);
				}.bind(this));
				continue;
			}
			
			// If this isn't the first item and it would put us over the size limit, stop
			if (contentItems.length && options.maxSize && contentSize + content.length > options.maxSize) {
				break;
			}
			
			contentItems.push({
				itemID: item.id,
				key: item.key,
				content,
				indexedChars: row.indexedChars ? row.indexedChars : 0,
				totalChars: row.totalChars ? row.totalChars : 0,
				indexedPages: row.indexedPages ? row.indexedPages : 0,
				totalPages: row.totalPages ? row.totalPages : 0
			});
			
			if (options.maxItems && contentItems.length >= options.maxItems) {
				break;
			}
			contentSize += content.length;
		}
		return contentItems;
	};
	
	
	/**
	 * @return {String}  PHP-formatted POST data for items not yet downloaded
	 */
	this.getUndownloadedPostData = async function () {
		// TODO: Redo for API syncing
		
		// On upgrade, get all content
		var sql = "SELECT value FROM settings WHERE setting='fulltext' AND key='downloadAll'";
		if (await Trellis.DB.valueQueryAsync(sql)) {
			return "&ftkeys=all";
		}
		
		var sql = "SELECT itemID FROM fulltextItems WHERE synced=" + this.SYNC_STATE_TO_DOWNLOAD;
		var itemIDs = await Trellis.DB.columnQueryAsync(sql);
		if (!itemIDs) {
			return "";
		}
		var undownloaded = {};
		for (let i=0; i<itemIDs.length; i++) {
			let itemID = itemIDs[i];
			let item = await Trellis.Items.getAsync(itemID);
			let libraryID = item.libraryID
			if (!undownloaded[libraryID]) {
				undownloaded[libraryID] = [];
			}
			undownloaded[libraryID].push(item.key);
		}
		var data = "";
		for (let libraryID in undownloaded) {
			for (let i = 0; i < undownloaded[libraryID].length; i++) {
				data += "&" + encodeURIComponent("ftkeys[" + libraryID + "][" + i + "]")
					+ "=" + undownloaded[libraryID][i];
			}
		}
		return data;
	};
	
	
	/**
	 * Save full-text content and stats to a cache file
	 *
	 * @param {Integer} libraryID
	 * @param {String} key - Item key
	 * @param {Object} data
	 * @param {String} data.content
	 * @param {Integer} [data.indexedChars]
	 * @param {Integer} [data.totalChars]
	 * @param {Integer} [data.indexedPages]
	 * @param {Integer} [data.totalPages]
	 * @param {Integer} version
	 * @return {Promise}
	 */
	this.setItemContent = async function (libraryID, key, data, version) {
		var libraryKey = libraryID + "/" + key;
		var item = Trellis.Items.getByLibraryAndKey(libraryID, key);
		if (!item) {
			let msg = "Item " + libraryKey + " not found setting full-text content";
			Trellis.logError(msg);
			return;
		}
		var itemID = item.id;
		var currentVersion = await this.getItemVersion(itemID)
		
		var processorCacheFile = this.getItemProcessorCacheFile(item).path; // .trellis-ft-unprocessed
		var itemCacheFile = this.getItemCacheFile(item).path; // .trellis-ft-cache
		
		// If a storage directory doesn't exist, create it
		if (!((await OS.File.exists(PathUtils.parent(processorCacheFile))))) {
			await Trellis.Attachments.createDirectoryForItem(item);
		}
		
		// If indexed previously and the existing extracted text matches the new text,
		// just update the version
		if (currentVersion !== false
				&& ((await OS.File.exists(itemCacheFile)))
				&& ((await Trellis.File.getContentsAsync(itemCacheFile))) == data.content) {
			Trellis.debug("Current full-text content matches remote for item "
				+ libraryKey + " -- updating version");
			return Trellis.DB.queryAsync(
				"UPDATE fulltextItems SET version=?, synced=? WHERE itemID=?",
				[version, this.SYNC_STATE_IN_SYNC, itemID]
			);
		}
		
		// Otherwise save data to -unprocessed file
		Trellis.debug("Writing full-text content and data for item " + libraryKey
			+ " to " + processorCacheFile);
		await Trellis.File.putContentsAsync(processorCacheFile, JSON.stringify({
			indexedChars: data.indexedChars,
			totalChars: data.totalChars,
			indexedPages: data.indexedPages,
			totalPages: data.totalPages,
			version,
			text: data.content
		}));
		var synced = this.SYNC_STATE_TO_PROCESS;
		// If indexed previously, update the sync state
		if (currentVersion !== false) {
			await Trellis.DB.queryAsync("UPDATE fulltextItems SET synced=? WHERE itemID=?", [synced, itemID]);
		}
		// If not yet indexed, add an empty row
		else {
			await Trellis.DB.queryAsync(
				"REPLACE INTO fulltextItems (itemID, version, synced) VALUES (?, 0, ?)",
				[itemID, synced]
			);
		}
		
		this.registerContentProcessor();
	};
	
	
	/**
	 * Start the idle observer for the background content processor
	 */
	this.registerContentProcessor = function () {
		// Don't start idle observer during tests
		if (Trellis.test) return;
		if (!Trellis.Prefs.get('sync.fulltext.enabled')) return;
		
		if (!_idleObserverIsRegistered) {
			Trellis.debug("Starting full-text content processor");
			var idleService = Components.classes["@mozilla.org/widget/useridleservice;1"]
					.getService(Components.interfaces.nsIUserIdleService);
			idleService.addIdleObserver(this.idleObserver, _idleObserverDelay);
			_idleObserverIsRegistered = true;
		}
	}
	
	
	this.unregisterContentProcessor = function () {
		if (_idleObserverIsRegistered) {
			Trellis.debug("Unregistering full-text content processor idle observer");
			var idleService = Components.classes["@mozilla.org/widget/useridleservice;1"]
				.getService(Components.interfaces.nsIUserIdleService);
			idleService.removeIdleObserver(this.idleObserver, _idleObserverDelay);
			_idleObserverIsRegistered = false;
		}
		
		this.stopContentProcessor();
	}
	
	
	/**
	 * Stop the idle observer and a running timer, if there is one
	 */
	this.stopContentProcessor = function () {
		Trellis.debug("Stopping full-text content processor");
		if (_processorTimeoutID) {
			clearTimeout(_processorTimeoutID);
			_processorTimeoutID = null;
		}
	}
	
	/**
	 * Find items marked as having unprocessed cache files, run cache file processing on one item, and
	 * after a short delay call self again with the remaining items
	 *
	 * @param {Array<Integer>} itemIDs  An array of itemIDs to process; if this
	 *                                  is omitted, a database query is made
	 *                                  to find unprocessed content
	 * @return {Boolean}  TRUE if there's more content to process; FALSE otherwise
	 */
	this.processUnprocessedContent = async function (itemIDs) {
		// Idle observer can take a little while to trigger and may not cancel the setTimeout()
		// in time, so check idle time directly
		var idleService = Components.classes["@mozilla.org/widget/useridleservice;1"]
			.getService(Components.interfaces.nsIUserIdleService);
		if (idleService.idleTime < _idleObserverDelay * 1000) {
			return;
		}
		
		if (!itemIDs) {
			Trellis.debug("Checking for unprocessed full-text content");
			let sql = "SELECT itemID FROM fulltextItems WHERE synced=" + this.SYNC_STATE_TO_PROCESS;
			itemIDs = await Trellis.DB.columnQueryAsync(sql);
		}
		
		var origLen = itemIDs.length;
		itemIDs = itemIDs.filter(function (id) {
			return !(id in _processorBlacklist);
		});
		if (itemIDs.length < origLen) {
			let skipped = (origLen - itemIDs.length);
			Trellis.debug("Skipping large full-text content for " + skipped
				+ " item" + (skipped == 1 ? '' : 's'));
		}
		
		// If there's no more unprocessed content, stop the idle observer
		if (!itemIDs.length) {
			Trellis.debug("No unprocessed full-text content found");
			this.unregisterContentProcessor();
			return;
		}
		
		let itemID = itemIDs.shift();
		let item = await Trellis.Items.getAsync(itemID);
		
		Trellis.debug("Processing full-text content for item " + item.libraryKey);
		
		await Trellis.Fulltext.indexFromProcessorCache(itemID);
		
		if (!itemIDs.length || idleService.idleTime < _idleObserverDelay * 1000) {
			return;
		}
		
		// If there are remaining items, call self again after a short delay. The delay allows
		// for processing to be interrupted if the user returns from idle. At least on macOS,
		// when Trellis is in the background this can be throttled to 10 seconds.
		_processorTimeoutID = setTimeout(() => this.processUnprocessedContent(itemIDs), 200);
	};
	
	this.idleObserver = {
		observe: function (subject, topic, data) {
			// On idle, start the background processor
			if (topic == 'idle') {
				this.processUnprocessedContent();
			}
			// When back from idle, stop the processor (but keep the idle observer registered)
			else if (topic == 'active') {
				this.stopContentProcessor();
			}
		}.bind(this)
	};
	
	
	/**
	 * @param {Number} itemID
	 * @return {Promise<Boolean>}
	 */
	this.indexFromProcessorCache = async function (itemID) {
		try {
			var item = await Trellis.Items.getAsync(itemID);
			var cacheFile = this.getItemProcessorCacheFile(item).path;
			if (!((await OS.File.exists(cacheFile))))  {
				Trellis.debug("Full-text content processor cache file doesn't exist for item " + itemID);
				await Trellis.DB.queryAsync(
					"UPDATE fulltextItems SET synced=? WHERE itemID=?",
					[this.SYNC_STATE_UNSYNCED, itemID]
				);
				return false;
			}
			
			var json = await Trellis.File.getContentsAsync(cacheFile);
			var data = JSON.parse(json);
			
			// Write the text content to the regular cache file
			var item = await Trellis.Items.getAsync(itemID);
			cacheFile = this.getItemCacheFile(item).path;
			Trellis.debug("Writing full-text content to " + cacheFile);
			await Trellis.File.putContentsAsync(cacheFile, data.text);
			
			await indexString(
				data.text,
				itemID,
				{
					indexedChars: data.indexedChars,
					totalChars: data.totalChars,
					indexedPages: data.indexedPages,
					totalPages: data.totalPages
				},
				data.version,
				this.SYNC_STATE_IN_SYNC
			);
			
			return true;
		}
		catch (e) {
			Trellis.logError(e);
			return false;
		};
	};
	
	//
	// End full-text content syncing
	//
	
	
	/*
	 * Scan a string for another string
	 *
	 * _items_ -- one or more attachment items to search
	 * _searchText_ -- text pattern to search for
	 * _mode_:
	 *    'regexp' -- regular expression (case-insensitive)
	 *    'regexpCS' -- regular expression (case-sensitive)
	 *
	 * - Slashes in regex are optional
	 */
	function findTextInString(content, searchText, mode) {
		switch (mode){
			case 'regexp':
			case 'regexpCS':
			case 'regexpBinary':
			case 'regexpCSBinary':
				// Do a multiline search by default
				var flags = 'm';
				var parts = searchText.match(/^\/(.*)\/([^\/]*)/);
				if (parts){
					searchText = parts[1];
					// Ignore user-supplied flags
					//flags = parts[2];
				}
				
				if (mode.indexOf('regexpCS')==-1){
					flags += 'i';
				}
				
				try {
					var re = new RegExp(searchText, flags);
					var matches = re.exec(content);
				}
				catch (e) {
					Trellis.debug(e, 1);
					Components.utils.reportError(e);
				}
				if (matches){
					Trellis.debug("Text found");
					return content.substr(matches.index, 50);
				}
				
				break;
			
			default:
				// Case-insensitive
				searchText = searchText.toLowerCase();
				content = content.toLowerCase();
				
				var pos = content.indexOf(searchText);
				if (pos!=-1){
					Trellis.debug('Text found');
					return content.substr(pos, 50);
				}
		}
		
		return -1;
	}
	
	/**
	 * Scan item files for a text string
	 *
	 * _items_ -- one or more attachment items to search
	 * _searchText_ -- text pattern to search for
	 * _mode_:
	 *    'phrase'
	 *    'regexp'
	 *    'regexpCS' -- case-sensitive regular expression
	 *
	 * Note:
	 *  - Slashes in regex are optional
	 *  - Add 'Binary' to the mode to search all files, not just text files
	 *
	 * @return {Promise<Array<Object>>} A promise for an array of match objects, with 'id' containing
	 *                                  an itemID and 'match' containing a string snippet
	 */
	this.findTextInItems = async function (items, searchText, mode) {
		if (!searchText){
			return [];
		}
		
		var items = await Trellis.Items.getAsync(items);
		var found = [];
		
		for (let i=0; i<items.length; i++) {
			let item = items[i];
			if (!item.isAttachment()) {
				continue;
			}
			
			let itemID = item.id;
			let content;
			let mimeType = item.attachmentContentType;
			let maxLength = Trellis.Prefs.get('fulltext.textMaxLength');
			let binaryMode = mode && mode.indexOf('Binary') != -1;
			
			if (this.isCachedMIMEType(mimeType)) {
				let file = this.getItemCacheFile(item).path;
				if (!((await OS.File.exists(file)))) {
					Trellis.debug("No cache file at " + file, 2);
					// TODO: Index on-demand?
					// What about a cleared full-text index?
					continue;
				}
				
				Trellis.debug("Searching for text '" + searchText + "' in " + file);
				content = await Trellis.File.getContentsAsync(file, 'utf-8', maxLength);
			}
			else {
				// If not binary mode, only scan plaintext files
				if (!binaryMode) {
					if (!Trellis.MIME.isTextType(mimeType)) {
						Trellis.debug('Not scanning MIME type ' + mimeType, 4);
						continue;
					}
				}
				
				let path = await item.getFilePathAsync();
				if (!path) {
					continue;
				}
				
				Trellis.debug("Searching for text '" + searchText + "' in " + path);
				content = await Trellis.File.getContentsAsync(path, item.attachmentCharset, maxLength);
			}
			
			let match = findTextInString(content, searchText, mode);
			if (match != -1) {
				found.push({
					id: itemID,
					match: match
				});
			}
		}
		
		return found;
	};
	
	
	this.transferItemIndex = async function (fromItem, toItem) {
		await this.clearItemWords(toItem.id);
		
		// Copy cache file if it exists
		var cacheFile = this.getItemCacheFile(fromItem).path;
		if (await OS.File.exists(cacheFile)) {
			try {
				await OS.File.move(cacheFile, this.getItemCacheFile(toItem).path);
			}
			catch (e) {
				Trellis.logError(e);
				return;
			}
		}
		
		// Update database with new item id
		await Trellis.DB.queryAsync("PRAGMA foreign_keys = false");
		try {
			await Trellis.DB.queryAsync(
				"UPDATE fulltextItems SET itemID=? WHERE itemID=?",
				[toItem.id, fromItem.id]
			);
			await Trellis.DB.queryAsync(
				"UPDATE fulltextItemWords SET itemID=? WHERE itemID=?",
				[toItem.id, fromItem.id]
			);
		}
		catch (e) {
			await Trellis.DB.queryAsync("PRAGMA foreign_keys = true");
		}
	};
	
	
	/**
	 * @requireTransaction
	 */
	this.clearItemWords = async function (itemID, skipCacheClear) {
		Trellis.DB.requireTransaction();
		
		var sql = "SELECT rowid FROM fulltextItems WHERE itemID=? LIMIT 1";
		var indexed = await Trellis.DB.valueQueryAsync(sql, itemID);
		if (indexed) {
			await Trellis.DB.queryAsync("DELETE FROM fulltextItemWords WHERE itemID=?", itemID);
			await Trellis.DB.queryAsync("DELETE FROM fulltextItems WHERE itemID=?", itemID);
		}
		
		if (indexed) {
			Trellis.Prefs.set('purge.fulltext', true);
		}
		
		if (!skipCacheClear) {
			// Delete fulltext cache file if there is one
			await clearCacheFile(itemID);
		}
	};
	
	
	/**
	 * @return {Promise}
	 */
	this.getPages = function (itemID) {
		var sql = "SELECT indexedPages, totalPages AS total "
			+ "FROM fulltextItems WHERE itemID=?";
		return Trellis.DB.rowQueryAsync(sql, itemID);
	}


	/**
	 * @return {Promise}
	 */
	function getChars(itemID) {
		var sql = "SELECT indexedChars, totalChars AS total "
			+ "FROM fulltextItems WHERE itemID=?";
		return Trellis.DB.rowQueryAsync(sql, itemID);
	}
	
	
	/**
	 * Gets the number of characters from the PDF converter cache file
	 *
	 * @return {Promise}
	 */
	var getTotalCharsFromFile = async function (itemID) {
		var item = await Trellis.Items.getAsync(itemID);
		switch (item.attachmentContentType) {
			case 'application/pdf':
				var file = OS.Path.join(
					Trellis.Attachments.getStorageDirectory(item).path,
					this.fulltextCacheFile
				);
				if (!((await OS.File.exists(file)))) {
					return false;
				}
				break;
				
			default:
				var file = await item.getFilePathAsync();
				if (!file) {
					return false;
				}
		}
		
		var contents = await Trellis.File.getContentsAsync(file);
		return contents.length;
	};
	
	
	/**
	 * @return {Promise}
	 */
	function setPages(itemID, obj) {
		var sql = "UPDATE fulltextItems SET indexedPages=?, totalPages=? WHERE itemID=?";
		return Trellis.DB.queryAsync(
			sql,
			[
				obj.indexed ? parseInt(obj.indexed) : null,
				obj.total ? parseInt(obj.total) : null,
				itemID
			]
		);
	}
	
	
	/**
	 * @param {Number} itemID
	 * @param {Object} obj
	 * @return {Promise}
	 */
	function setChars(itemID, obj) {
		var sql = "UPDATE fulltextItems SET indexedChars=?, totalChars=? WHERE itemID=?";
		return Trellis.DB.queryAsync(
			sql,
			[
				obj.indexed ? parseInt(obj.indexed) : null,
				obj.total ? parseInt(obj.total) : null,
				itemID
			]
		);
	}
	
	
	/*
	 * Gets the indexed state of an item, 
	 */
	this.getIndexedState = async function (item) {
		if (!item.isAttachment()) {
			throw new Error('Item is not an attachment');
		}
		
		// If the file or cache file wasn't available during syncing, mark as unindexed
		var synced = await Trellis.DB.valueQueryAsync(
			"SELECT synced FROM fulltextItems WHERE itemID=?", item.id
		);
		if (synced === false || synced == this.SYNC_STATE_MISSING) {
			return this.INDEX_STATE_UNINDEXED;
		}
		
		var itemID = item.id;
		var state = this.INDEX_STATE_UNINDEXED;
		switch (item.attachmentContentType) {
			// Use pages for PDFs
			case 'application/pdf':
				var o = await this.getPages(itemID);
				if (o) {
					var stats = {
						indexed: o.indexedPages,
						total: o.total
					};
				}
				break;
			
			default:
				var o = await getChars(itemID);
				if (o) {
					var stats = {
						indexed: o.indexedChars,
						total: o.total
					};
				}
		}
		
		if (stats) {
			if (!stats.total && !stats.indexed) {
				let queued = false;
				try {
					queued = await OS.File.exists(this.getItemProcessorCacheFile(item).path);
				}
				catch (e) {
					Trellis.logError(e);
				}
				state = queued ? this.INDEX_STATE_QUEUED : this.INDEX_STATE_UNAVAILABLE;
			}
			else if (!stats.indexed) {
				state = this.INDEX_STATE_UNINDEXED;
			}
			else if (stats.indexed < stats.total) {
				state = this.INDEX_STATE_PARTIAL;
			}
			else {
				state = this.INDEX_STATE_INDEXED;
			}
		}
		return state;
	};
	
	
	this.isFullyIndexed = async function (item) {
		return ((await this.getIndexedState(item))) == this.INDEX_STATE_INDEXED;
	};
	
	
	/**
	 * @return {Promise}
	 */
	this.getIndexStats = async function () {
		var sql = "SELECT COUNT(*) FROM fulltextItems WHERE synced != ? AND "
			+ "((indexedPages IS NOT NULL AND indexedPages=totalPages) OR "
			+ "(indexedChars IS NOT NULL AND indexedChars=totalChars))"
		var indexed = await Trellis.DB.valueQueryAsync(sql, this.SYNC_STATE_MISSING);
		
		var sql = "SELECT COUNT(*) FROM fulltextItems WHERE "
			+ "(indexedPages IS NOT NULL AND indexedPages<totalPages) OR "
			+ "(indexedChars IS NOT NULL AND indexedChars<totalChars)"
		var partial = await Trellis.DB.valueQueryAsync(sql);
		
		var sql = "SELECT COUNT(*) FROM itemAttachments WHERE itemID NOT IN "
			+ "(SELECT itemID FROM fulltextItems WHERE synced != ? AND "
			+ "(indexedPages IS NOT NULL OR indexedChars IS NOT NULL))";
		var unindexed = await Trellis.DB.valueQueryAsync(sql, this.SYNC_STATE_MISSING);
		
		var sql = "SELECT COUNT(*) FROM fulltextWords";
		var words = await Trellis.DB.valueQueryAsync(sql);
		
		return { indexed, partial, unindexed, words };
	};
	
	
	this.getItemCacheFile = function (item) {
		var cacheFile = Trellis.Attachments.getStorageDirectory(item);
		cacheFile.append(this.fulltextCacheFile);
		return cacheFile;
	}
	
	
	this.getItemProcessorCacheFile = function (item) {
		var cacheFile = Trellis.Attachments.getStorageDirectory(item);
		cacheFile.append(_processorCacheFile);
		return cacheFile;
	}
	
	
	this.canIndex = function (item) {
		if (!item.isAttachment()
				|| item.attachmentLinkMode == Trellis.Attachments.LINK_MODE_LINKED_URL) {
			return false;
		}
		var contentType = item.attachmentContentType;
		return contentType
			&& (contentType == 'application/pdf'
				|| contentType == 'application/epub+zip'
				|| Trellis.MIME.isTextType(contentType));
	};
	
	
	/*
	 * Returns true if an item can be reindexed
	 *
	 * Item must be a non-web-link attachment that isn't already fully indexed
	 */
	this.canReindex = async function (item) {
		if (!this.canIndex(item)) {
			return false;
		}
		switch (await this.getIndexedState(item)) {
			case this.INDEX_STATE_UNAVAILABLE:
			case this.INDEX_STATE_UNINDEXED:
			case this.INDEX_STATE_PARTIAL:
			case this.INDEX_STATE_QUEUED:
			// TODO: automatically reindex already-indexed attachments?
			case this.INDEX_STATE_INDEXED:
				return true;
		}
		return false;
	};
	
	
	/**
	 * @return {Promise}
	 */
	this.rebuildIndex = async function (unindexedOnly) {
		// Get all attachments other than web links
		var sql = "SELECT itemID FROM itemAttachments WHERE linkMode!="
			+ Trellis.Attachments.LINK_MODE_LINKED_URL;
		var params = [];
		if (unindexedOnly) {
			sql += " AND itemID NOT IN (SELECT itemID FROM fulltextItems "
				+ "WHERE synced != ? AND (indexedChars IS NOT NULL OR indexedPages IS NOT NULL))";
			params.push(this.SYNC_STATE_MISSING);
		}
		var itemIDs = await Trellis.DB.columnQueryAsync(sql, params);
		if (!itemIDs.length) {
			Trellis.debug("No items to index");
			return;
		}
		
		// If rebuilding from scratch, delete any processor cache files so they're not used.
		// Otherwise, indexing unindexed items will force indexing of processor cache files
		// without waiting for idle processing.
		if (!unindexedOnly) {
			for (let itemID of itemIDs) {
				let item = await Trellis.Items.getAsync(itemID);
				let cacheFile = this.getItemProcessorCacheFile(item).path;
				try {
					await OS.File.remove(cacheFile, { ignoreAbsent: true });
				}
				catch (e) {
					Trellis.logError(e);
				}
			}
		}
		
		await this.indexItems(itemIDs, { ignoreErrors: true });
	};
	
	
	/**
	 * Clears full-text word index and all full-text cache files
	 *
	 * @return {Promise}
	 */
	this.clearIndex = async function (skipLinkedURLs) {
		await Trellis.DB.executeTransaction(async function () {
			var sql = "DELETE FROM fulltextItems";
			if (skipLinkedURLs) {
				var linkSQL = "SELECT itemID FROM itemAttachments WHERE linkMode ="
					+ Trellis.Attachments.LINK_MODE_LINKED_URL;
				
				sql += " WHERE itemID NOT IN (" + linkSQL + ")";
			}
			await Trellis.DB.queryAsync(sql);
			
			sql = "DELETE FROM fulltextItemWords";
			if (skipLinkedURLs) {
				sql += " WHERE itemID NOT IN (" + linkSQL + ")";
			}
			await Trellis.DB.queryAsync(sql);
		});
		
		if (skipLinkedURLs) {
			await this.purgeUnusedWords();
		}
		else {
			await Trellis.DB.queryAsync("DELETE FROM fulltextWords");
		}
		
		await clearCacheFiles();
		await Trellis.DB.queryAsync('VACUUM');
	}
	
	
	/*
	 * Clears cache file for an item
	 */
	var clearCacheFile = async function (itemID) {
		var item = await Trellis.Items.getAsync(itemID);
		if (!item) {
			return;
		}
		
		if (!item.isAttachment()) {
			Trellis.debug("Item " + itemID + " is not an attachment in Trellis.Fulltext.clearCacheFile()");
			return;
		}
		
		Trellis.debug('Clearing full-text cache file for item ' + itemID);
		var cacheFile = Trellis.Fulltext.getItemCacheFile(item);
		if (cacheFile.exists()) {
			try {
				cacheFile.remove(false);
			}
			catch (e) {
				Trellis.File.checkFileAccessError(e, cacheFile, 'delete');
			}
		}
	};
	
	
	/*
	 * Clear cache files for all attachments
	 */
	var clearCacheFiles = async function (skipLinkedURLs) {
		var sql = "SELECT itemID FROM itemAttachments";
		if (skipLinkedURLs) {
			sql += " WHERE linkMode != " + Trellis.Attachments.LINK_MODE_LINKED_URL;
		}
		var items = await Trellis.DB.columnQueryAsync(sql);
		for (var i=0; i<items.length; i++) {
			await clearCacheFile(items[i]);
		}
	};
	
	
	/*
	function clearItemContent(itemID){
		Trellis.DB.query("DELETE FROM fulltextContent WHERE itemID=" + itemID);
	}
	*/
	
	
	/**
	 * @return {Promise}
	 */
	this.purgeUnusedWords = async function () {
		if (!Trellis.Prefs.get('purge.fulltext')) {
			return;
		}
		
		var sql = "DELETE FROM fulltextWords WHERE wordID NOT IN "
					+ "(SELECT wordID FROM fulltextItemWords)";
		await Trellis.DB.queryAsync(sql);
		
		Trellis.Prefs.set('purge.fulltext', false)
	};
	
	
	async function getPageData(path, contentType) {
		const { HiddenBrowser } = ChromeUtils.importESModule("chrome://trellis/content/HiddenBrowser.mjs");
		var blobURL;
		var browser;
		var pageData;
		try {
			// Wrap the file in a blob to set its content type
			let arrayBuffer = await (await fetch(Trellis.File.pathToFileURI(path))).arrayBuffer();
			let blob = new Blob([arrayBuffer], { type: contentType });
			blobURL = URL.createObjectURL(blob);
			browser = new HiddenBrowser({ blockRemoteResources: true });
			await browser.load(blobURL);
			pageData = await browser.getPageData(['characterSet', 'bodyText']);
		}
		finally {
			if (blobURL) {
				URL.revokeObjectURL(blobURL);
			}
			if (browser) {
				browser.destroy();
			}
		}
		return {
			characterSet: pageData.characterSet,
			bodyText: pageData.bodyText
		};
	}
	
	
	/**
	 * Write the converted text to a cache file
	 */
	var writeCacheFile = async function (item, text, maxLength, complete) {
		if (!complete) {
			text = text.substr(0, maxLength);
		}
		var cacheFile = this.getItemCacheFile(item).path;
		Trellis.debug("Writing converted full-text content to " + cacheFile);
		if (!(await OS.File.exists(PathUtils.parent(cacheFile)))) {
			await Trellis.Attachments.createDirectoryForItem(item);
		}
		try {
			await Trellis.File.putContentsAsync(cacheFile, text);
		}
		catch (e) {
			Trellis.logError(e);
		}
	}.bind(this);
	
	
	/**
	 * @param {String} text
	 * @param {String} [charset]
	 * @return {Array<String>}
	 */
	this.semanticSplitter = function (text, charset) {
		if (!text){
			Trellis.debug('No text to index');
			return [];
		}
		
		var words = {};
		var word = '';
		var cclass = null;
		var strlen = text.length;
		for (var i = 0; i < strlen; i++) {
			var charCode = text.charCodeAt(i);
			var cc = null;
			
			// Adjustments
			if (charCode == 8216 || charCode == 8217) {
				// Curly quotes to straight
				var c = "'";
			}
			else {
				var c = text.charAt(i);
			}
			
			// Consider single quote in the middle of a word a letter
			if (c == "'" && word !== '') {
				cc = kWbClassAlphaLetter;
			}
			
			if (!cc) {
				cc = getClass(c, charCode);
			}
			
			// When we reach space or punctuation, store the previous word if there is one
			if (cc == kWbClassSpace || cc == kWbClassPunct) {
				if (word != '') {
					words[word] = true;
					word = '';
				}
			// When we reach Han character, store previous word and add Han character
			} else if (cc == kWbClassHanLetter) {
				if (word !== '') {
					words[word] = true;
					word = '';
				}
				words[c] = true;
			// Otherwise, if character class hasn't changed, keep adding characters to previous word
			} else if (cc == cclass) {
				word += c.toLowerCase();
			// If character class is different, store previous word and start new word
			} else {
				if (word !== '') {
					words[word] = true;
				}
				word = c.toLowerCase();
			}
			cclass = cc;
		}
		if (word !== '') {
			words[word] = true;
		}
		
		return Object.keys(words).map(function (w) {
			// Trim trailing single quotes
			if (w.slice(-1) == "'") {
				w = w.substr(0, w.length - 1);
			}
			return w;
		});
	}
	
	function _getScriptExtension() {
		return Trellis.isWin ? 'vbs' : 'sh';
	}

}
