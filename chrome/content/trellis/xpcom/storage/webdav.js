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


if (!Trellis.Sync.Storage.Mode) {
	Trellis.Sync.Storage.Mode = {};
}

Trellis.Sync.Storage.Mode.WebDAV = function (options) {
	this.options = options;
	
	this.VerificationError = function (error, url) {
		this.message = `WebDAV verification error (${error})`;
		this.error = error;
		this.url = url;
	}
	this.VerificationError.prototype = Object.create(Error.prototype);
}
Trellis.Sync.Storage.Mode.WebDAV.prototype = {
	mode: "webdav",
	name: "WebDAV",
	
	ERROR_DELAY_INTERVALS: [2500],
	ERROR_DELAY_MAX: 3000,
	
	get verified() {
		return Trellis.Prefs.get("sync.storage.verified");
	},
	set verified(val) {
		Trellis.Prefs.set("sync.storage.verified", !!val)
	},
	
	_parentURI: null,
	_rootURI: null,
	_basicAuthHeader: null,
	_digestParams: null,

	/**
	 * Get an Authorization header for the given request.
	 *
	 * Firefox no longer sends preemptive Authorization headers across separate XMLHttpRequest
	 * instances, even to the same host. Every request starts unauthenticated, which triggers 401
	 * round-trips and can cause failures with servers that close the connection on unauthenticated
	 * PUT.
	 *
	 * To work around this, cacheCredentials() captures the auth type from the first authenticated
	 * request:
	 *
	 * - Basic: the Authorization header is stored as-is and replayed on all requests
	 * - Digest: the challenge parameters (realm, nonce, qop, etc.) are stored, and a fresh Digest
	 *   Authorization header is computed per request
	 *
	 * @param {String} method - HTTP method
	 * @param {nsIURI} uri - Request URI
	 * @return {Object} - Headers object, e.g. { Authorization: "..." } or {}
	 */
	_getAuthorizationHeaders(method, uri) {
		// Basic auth can be replayed directly
		if (this._basicAuthHeader) {
			return { Authorization: this._basicAuthHeader };
		}
		// Digest auth -- compute a fresh header for this method/URI
		if (this._digestParams && method && uri) {
			let auth = this._computeDigestAuth(method, uri.pathQueryRef);
			if (auth) {
				return { Authorization: auth };
			}
		}
		return {};
	},

	/**
	 * Parse Digest parameters from a captured Authorization header.
	 *
	 * A Digest Authorization header looks like:
	 *   Digest username="user", realm="WebDAV", nonce="abc", uri="/path",
	 *          qop=auth, nc=00000001, cnonce="xyz", response="...", opaque="..."
	 *
	 * We extract the challenge parameters (realm, nonce, qop, opaque,
	 * algorithm) so we can compute fresh responses for different requests.
	 *
	 * @param {String} header - The Digest Authorization header string
	 * @return {Object|null} - Parsed parameters or null
	 */
	_parseDigestParams(header) {
		if (!header || !header.startsWith('Digest ')) return null;
		let params = {};
		let regex = /(\w+)=(?:"([^"]*)"|([\w]+))/g;
		let match;
		while ((match = regex.exec(header)) !== null) {
			params[match[1]] = match[2] !== undefined ? match[2] : match[3];
		}
		if (!params.realm || !params.nonce) return null;
		return params;
	},

	/**
	 * Compute a Digest Authorization header for the given method and URI.
	 *
	 * @param {String} method - HTTP method
	 * @param {String} path - Request URI path (e.g., "/trellis/file.zip")
	 * @return {String|null} - Complete Digest Authorization header or null
	 */
	_computeDigestAuth(method, path) {
		let p = this._digestParams;
		if (!p) return null;

		let md5 = Trellis.Utilities.Internal.md5;
		let nc = (++p.nc).toString(16).padStart(8, '0');
		let cnonce = Trellis.Utilities.randomString(16);

		let ha1;
		if (p.algorithm && p.algorithm.toLowerCase() === 'md5-sess') {
			let base = md5(`${p.username}:${p.realm}:${p.password}`);
			ha1 = md5(`${base}:${p.nonce}:${cnonce}`);
		}
		else {
			ha1 = md5(`${p.username}:${p.realm}:${p.password}`);
		}

		let ha2 = md5(`${method}:${path}`);

		let response;
		if (p.qop) {
			response = md5(
				`${ha1}:${p.nonce}:${nc}:${cnonce}:${p.qop}:${ha2}`
			);
		}
		else {
			response = md5(`${ha1}:${p.nonce}:${ha2}`);
		}

		let header = `Digest username="${p.username}", realm="${p.realm}"`
			+ `, nonce="${p.nonce}", uri="${path}"`
			+ `, response="${response}"`;
		if (p.algorithm) {
			header += `, algorithm=${p.algorithm}`;
		}
		if (p.qop) {
			header += `, qop=${p.qop}, nc=${nc}, cnonce="${cnonce}"`;
		}
		if (p.opaque) {
			header += `, opaque="${p.opaque}"`;
		}
		return header;
	},

	/**
	 * Callback for onAuthorizationHeader -- caches the auth type and
	 * parameters from a completed request.
	 *
	 * @param {String} authorization - The Authorization header value
	 */
	_cacheAuthorization(authorization) {
		this._basicAuthHeader = null;
		this._digestParams = null;

		if (!authorization) return;

		if (authorization.startsWith('Basic ')) {
			this._basicAuthHeader = authorization;
			Trellis.debug("Cached Basic auth header");
		}
		else if (authorization.startsWith('Digest ')) {
			let parsed = this._parseDigestParams(authorization);
			if (parsed) {
				let username = decodeURIComponent(this.rootURI.username);
				let password = decodeURIComponent(this.rootURI.password);
				this._digestParams = {
					username,
					password,
					realm: parsed.realm,
					nonce: parsed.nonce,
					qop: parsed.qop || null,
					opaque: parsed.opaque || null,
					algorithm: parsed.algorithm || null,
					nc: 0,
				};
				Trellis.debug("Cached Digest auth parameters");
			}
		}
	},

	/**
	 * Clear cached credentials when auth fails (e.g., password changed on server)
	 */
	_onAuthError() {
		Trellis.debug("Clearing cached WebDAV credentials due to auth error");
		this._basicAuthHeader = false;
		this._digestParams = null;
		this.verified = false;
	},

	_loginManagerHost: 'chrome://trellis',
	_loginManagerRealm: 'Trellis Storage Server (encrypted)',
	_loginManagerRealmLegacy: 'Trellis Storage Server',
	
	
	get defaultError() {
		return Trellis.getString('sync.storage.error.webdav.default');
	},
	
	get defaultErrorRestart() {
		return Trellis.getString('sync.storage.error.webdav.defaultRestart', Trellis.appName);
	},
	
	get username() {
		return Trellis.Prefs.get('sync.storage.username');
	},
	
	async getPassword() {
		var username = this.username;
		
		if (!username) {
			Trellis.debug('Username not set before calling Trellis.Sync.Storage.WebDAV.getPassword()');
			return '';
		}
		
		Trellis.debug('Getting WebDAV password');
		
		// Prefer the legacy realm during the transition window: an older version
		// may have written a fresh value there after we migrated. Mirror it to
		// the encrypted realm but keep the legacy entry so a downgrade can still
		// read it. The legacy realm will be cleared in a future version once
		// downgrades are unlikely.
		var legacyLogins = await Services.logins.searchLoginsAsync({
			origin: this._loginManagerHost,
			httpRealm: this._loginManagerRealmLegacy,
		});
		for (let i = 0; i < legacyLogins.length; i++) {
			if (legacyLogins[i].username == username) {
				let password = legacyLogins[i].password;
				if (!this._mirroredPassword) {
					try {
						Trellis.debug("Mirroring plaintext WebDAV password to encrypted storage");
						await this._writeEncryptedPassword(username, password);
						this._mirroredPassword = true;
					}
					catch (e) {
						Trellis.logError(e);
						Trellis.OSKeyStore.alertMigrateFailed();
					}
				}
				return password;
			}
		}
		
		var logins = await Services.logins.searchLoginsAsync({
			origin: this._loginManagerHost,
			httpRealm: this._loginManagerRealm,
		});
		for (var i = 0; i < logins.length; i++) {
			if (logins[i].username == username) {
				return Trellis.OSKeyStore.decrypt(logins[i].password);
			}
		}
		
		// Pre-4.0.28.5 format, broken for findLogins and removeLogin in Fx41
		logins = await Services.logins.searchLoginsAsync({
			origin: "chrome://trellis"
		});
		for (var i = 0; i < logins.length; i++) {
			if (logins[i].username == username
					&& logins[i].formSubmitURL == "Trellis Storage Server") {
				return logins[i].password;
			}
		}
		
		return '';
	},
	
	async setPassword(password) {
		var username = this.username;
		if (!username) {
			Trellis.debug('WebDAV username not set before setting password');
			return;
		}
		
		// Skip the write if the password hasn't changed. This is an optimization,
		// not a correctness requirement -- if we can't read the existing value
		// (e.g. keychain locked), proceed with the write anyway.
		try {
			if (password == (await this.getPassword())) {
				Trellis.debug("WebDAV password hasn't changed");
				return;
			}
		}
		catch (e) {
			Trellis.logError(e);
		}
		
		this._basicAuthHeader = false;
		this._digestParams = null;

		try {
			await this._writeEncryptedPassword(username, password);
		}
		catch (e) {
			// If the write failed because the key database was unusable, reset the login
			// manager and retry
			if (!Trellis.Sync.Data.Local.repairLoginManager()) {
				Trellis.OSKeyStore.alertSaveFailed();
				throw e;
			}
			try {
				await this._writeEncryptedPassword(username, password);
			}
			catch (e) {
				Trellis.OSKeyStore.alertSaveFailed();
				throw e;
			}
		}
		
		// Drop any leftover plaintext entry from the legacy realm
		var logins = await Services.logins.searchLoginsAsync({
			origin: this._loginManagerHost,
			httpRealm: this._loginManagerRealmLegacy
		});
		for (let i = 0; i < logins.length; i++) {
			if (logins[i].httpRealm == this._loginManagerRealmLegacy) {
				try {
					Services.logins.removeLogin(logins[i]);
				}
				catch (e) {
					Trellis.logError(e);
				}
			}
			break;
		}
		
		// Pre-4.0.28.5 format, broken for findLogins and removeLogin in Fx41
		logins = await Services.logins.searchLoginsAsync({
			origin: this._loginManagerHost
		});
		for (var i = 0; i < logins.length; i++) {
			Trellis.debug('Clearing old WebDAV passwords');
			if (logins[i].formSubmitURL == "Trellis Storage Server") {
				try {
					Services.logins.removeLogin(logins[i]);
				}
				catch (e) {
					Trellis.logError(e);
				}
			}
			break;
		}
	},
	
	async _writeEncryptedPassword(username, password) {
		// Remove any existing entries in the encrypted realm for this user
		var logins = await Services.logins.searchLoginsAsync({
			origin: this._loginManagerHost,
			httpRealm: this._loginManagerRealm
		});
		for (let i = 0; i < logins.length; i++) {
			if (logins[i].username == username) {
				Services.logins.removeLogin(logins[i]);
			}
		}
		
		if (password) {
			let storedValue = await Trellis.OSKeyStore.encrypt(password);
			let nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
				Components.interfaces.nsILoginInfo, "init");
			let loginInfo = new nsLoginInfo(this._loginManagerHost, null,
				this._loginManagerRealm, username, storedValue, "", "");
			await Services.logins.addLoginAsync(loginInfo);
		}
	},
	
	get rootURI() {
		if (!this._rootURI) {
			throw new Error("rootURI not set");
		}
		return this._rootURI;
	},
	
	get parentURI() {
		if (!this._parentURI) {
			throw new Error("parentURI not set");
		}
		return this._parentURI;
	},
	
	_init: async function () {
		if (this._rootURI) {
			return;
		}
		
		this._rootURI = false;
		this._parentURI = false;
		
		var scheme = Trellis.Prefs.get('sync.storage.scheme');
		switch (scheme) {
			case 'http':
			case 'https':
				break;
			
			default:
				throw new Error("Invalid WebDAV scheme '" + scheme + "'");
		}
		
		var url = Trellis.Prefs.get('sync.storage.url');
		if (!url) {
			throw new this.VerificationError("NO_URL");
		}
		
		var username = this.username;
		var password = await this.getPassword();
		if (!username) {
			throw new this.VerificationError("NO_USERNAME");
		}
		if (!password) {
			throw new this.VerificationError("NO_PASSWORD");
		}
		
		var spec = scheme + '://'
			+ encodeURIComponent(username) + ':' + encodeURIComponent(password) + '@'
			+ url
			+ (url.endsWith('/') ? '' : '/');
		
		var io = Services.io;
		try {
			this._parentURI = io.newURI(spec, null, null);
		}
		catch (e) {
			if (e.message.includes('NS_ERROR_MALFORMED_URI')) {
				let displayURL = scheme + '://' + url + (url.endsWith('/') ? '' : '/');
				throw new this.VerificationError("INVALID_URL", displayURL);
			}
			throw e;
		}
		this._rootURI = io.newURI(spec + "trellis/", null, null);
		Trellis.HTTP.CookieBlocker.addURL(this._rootURI.spec);
	},
	
	
	cacheCredentials: async function () {
		await this._init();
		
		if (this._basicAuthHeader || this._digestParams) {
			Trellis.debug("WebDAV credentials are already cached");
			return;
		}
		
		Trellis.debug("Caching WebDAV credentials");
		
		let xmlstr = "<propfind xmlns='DAV:'><prop>"
			+ "<getcontentlength/>"
			+ "</prop></propfind>";
		try {
			await Trellis.HTTP.request(
				"PROPFIND",
				this.rootURI,
				{
					body: xmlstr,
					headers: {
						Depth: 0,
						"Content-Type": "text/xml; charset=utf-8"
					},
					successCodes: [207, 404],
					errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
					errorDelayMax: this.ERROR_DELAY_MAX,
					onAuthorizationHeader: (authorization) => {
						this._cacheAuthorization(authorization);
					},
				}
			);
			if (this._basicAuthHeader || this._digestParams) {
				Trellis.debug("Authorization header cached");
			}
			else {
				Trellis.debug("No Authorization header to cache");
			}
		}
		catch (e) {
			if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
				let msg = "HTTP " + e.status + " error from WebDAV server "
					+ "for PROPFIND request";
				Trellis.logError(msg);
				throw new Error(this.defaultErrorRestart);
			}
			throw e;
		}
	},
	
	
	clearCachedCredentials: function () {
		Trellis.debug("WebDAV: Clearing cached credentials");
		if (this._rootURI) {
			Trellis.HTTP.CookieBlocker.removeURL(this._rootURI.spec);
		}
		this._rootURI = this._parentURI = undefined;
		this._basicAuthHeader = false;
		this._digestParams = null;
	},
	
	
	/**
	 * Begin download process for individual file
	 *
	 * @param {Trellis.Sync.Storage.Request} request
	 * @return {Promise<Trellis.Sync.Storage.Result>}
	 */
	downloadFile: async function (request) {
		await this._init();
		
		var item = Trellis.Sync.Storage.Utilities.getItemFromRequest(request);
		if (!item) {
			throw new Error("Item '" + request.name + "' not found");
		}
		
		// Skip download if local file exists and matches mod time
		var path = item.getFilePath();
		if (!path) {
			Trellis.debug(`Cannot download file for attachment ${item.libraryKey} with no path`);
			return new Trellis.Sync.Storage.Result;
		}
		
		// Retrieve modification time from server
		var metadata = await this._getStorageFileMetadata(item, request);
		
		if (!request.isRunning()) {
			Trellis.debug("Download request '" + request.name
				+ "' is no longer running after getting mod time");
			return new Trellis.Sync.Storage.Result;
		}
		
		if (!metadata) {
			Trellis.debug("Remote file not found for item " + item.libraryKey);
			item.attachmentSyncState = "in_sync";
			await item.saveTx({ skipAll: true });
			return new Trellis.Sync.Storage.Result;
		}
		
		var fileModTime = await item.attachmentModificationTime;
		if (metadata.mtime == fileModTime) {
			Trellis.debug("File mod time matches remote file -- skipping download of "
				+ item.libraryKey);
			
			var updateItem = item.attachmentSyncState != 1
			item.attachmentSyncedModificationTime = metadata.mtime;
			item.attachmentSyncState = "in_sync";
			await item.saveTx({ skipAll: true });
			// DEBUG: Necessary?
			if (updateItem) {
				await item.updateSynced(false);
			}
			
			return new Trellis.Sync.Storage.Result({
				localChanges: true, // ?
			});
		}
		
		var uri = this._getItemURI(item);
		
		var destPath = OS.Path.join(Trellis.getTempDirectory().path, item.key + '.tmp');
		await Trellis.File.removeIfExists(destPath);
		
		var requestData = {
			item,
			mtime: metadata.mtime,
			md5: metadata.md5,
			compressed: true
		};
		
		return new Promise(async (resolve, reject) => {
			try {
				let req = await Trellis.HTTP.download(
					uri,
					destPath,
					{
						successCodes: [200, 404],
						noCache: true,
						onProgress(progress, progressMax) {
							request.onProgress(progress, progressMax);
						},
						errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
						errorDelayMax: this.ERROR_DELAY_MAX,
					}
				);
				
				if (req.status == 404) {
					let msg = "Remote ZIP file not found for item " + item.libraryKey;
					Trellis.debug(msg, 2);
					Cu.reportError(msg);
					
					// Delete the orphaned prop file
					try {
						await this._deleteStorageFiles([item.key + ".prop"]);
					}
					catch (e) {
						Trellis.logError(e);
					}

					item.attachmentSyncState = "in_sync";
					await item.saveTx({ skipAll: true });
					resolve(new Trellis.Sync.Storage.Result);
					return;
				}
				
				// Don't try to process if the request has been cancelled
				if (request.isFinished()) {
					Trellis.debug("Download request " + request.name
						+ " is no longer running after file download");
					resolve(new Trellis.Sync.Storage.Result);
					return;
				}
				
				Trellis.debug("Finished download of " + destPath);
				
				resolve(
					Trellis.Sync.Storage.Local.processDownload(requestData)
				);
			}
			catch (e) {
				if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
					try {
						let dispURL = Trellis.HTTP.getDisplayURI(uri).spec;
						this._handleUnexpectedStatus("GET", dispURL, e.xmlhttp.status);
					}
					catch (e) {
						reject(e);
					}
					return;
				}
				Trellis.logError(e);
				reject(new Error(Trellis.Sync.Storage.defaultError));
			}
		});
	},
	
	
	uploadFile: async function (request) {
		await this._init();
		
		var item = Trellis.Sync.Storage.Utilities.getItemFromRequest(request);
		var params = {
			mtime: await item.attachmentModificationTime,
			md5: await item.attachmentHash
		};
		
		var metadata = await this._getStorageFileMetadata(item, request);
		
		if (!request.isRunning()) {
			Trellis.debug("Upload request '" + request.name
				+ "' is no longer running after getting metadata");
			return new Trellis.Sync.Storage.Result;
		}
		
		// Check if file already exists on WebDAV server
		if (item.attachmentSyncState
				!= Trellis.Sync.Storage.Local.SYNC_STATE_FORCE_UPLOAD) {
			if (metadata.mtime) {
				// Local file time
				let fmtime = await item.attachmentModificationTime;
				// Remote prop time
				let mtime = metadata.mtime;
				
				var changed = Trellis.Sync.Storage.Local.checkFileModTime(item, fmtime, mtime);
				if (!changed) {
					// Remote hash
					let hash = metadata.md5;
					if (hash) {
						// Local file hash
						let fhash = await item.attachmentHash;
						if (fhash != hash) {
							changed = true;
						}
					}
					
					// If WebDAV server already has file, update synced properties
					if (!changed) {
						item.attachmentSyncedModificationTime = fmtime;
						if (hash) {
							item.attachmentSyncedHash = hash;
						}
						item.attachmentSyncState = "in_sync";
						await item.saveTx({ skipAll: true });
						// skipAll doesn't mark as unsynced, so do that separately
						await item.updateSynced(false);
						return new Trellis.Sync.Storage.Result({
							localChanges: true,
							syncRequired: true
						});
					}
				}
				
				// Check for conflict between synced values and values on WebDAV server. This
				// should almost never happen, but it's possible if a client uploaded to WebDAV
				// but failed before updating the API (or the local properties if this computer),
				// or if the file was changed identically on two computers at the same time, such
				// that the post-upload API update on computer B happened after the pre-upload API
				// check on computer A. (In the case of a failure, there's no guarantee that the
				// API would ever be updated with the correct values, so we can't just wait for
				// the API to change.) If a conflict is found, we flag the item as in conflict
				// and require another file sync, which will trigger conflict resolution.
				let smtime = item.attachmentSyncedModificationTime;
				if (smtime != mtime) {
					let shash = item.attachmentSyncedHash;
					if (shash && metadata.md5 && shash == metadata.md5) {
						Trellis.debug(`Last synced mod time for item ${item.libraryKey} doesn't `
							+ "match time on storage server but hash does -- using local file mtime");
						
						await this._setStorageFileMetadata(item);
						item.attachmentSyncedModificationTime = fmtime;
						item.attachmentSyncState = "in_sync";
						await item.saveTx({ skipAll: true });
						// skipAll doesn't mark as unsynced, so do that separately
						await item.updateSynced(false);
						
						return new Trellis.Sync.Storage.Result({
							localChanges: true,
							syncRequired: true
						});
					}
					
					Trellis.logError("Conflict -- last synced file mod time for item "
						+ item.libraryKey + " does not match time on storage server"
						+ " (" + smtime + " != " + mtime + ")");
					
					// Conflict resolution uses the synced mtime as the remote value, so set
					// that to the WebDAV value, since that's the one in conflict.
					item.attachmentSyncedModificationTime = mtime;
					item.attachmentSyncState = "in_conflict";
					await item.saveTx({ skipAll: true });
					
					return new Trellis.Sync.Storage.Result({
						fileSyncRequired: true
					});
				}
			}
			else {
				Trellis.debug("Remote file not found for item " + item.id);
			}
		}
		
		var created = await Trellis.Sync.Storage.Utilities.createUploadFile(request);
		if (!created) {
			return new Trellis.Sync.Storage.Result;
		}
		
		/*
		updateSizeMultiplier(
			(100 - Trellis.Sync.Storage.compressionTracker.ratio) / 100
		);
		*/
		
		// Delete .prop file before uploading new .zip
		if (metadata) {
			var propURI = this._getItemPropertyURI(item);
			try {
				await Trellis.HTTP.request(
					"DELETE",
					propURI,
					{
						headers: this._getAuthorizationHeaders("DELETE", propURI),
						successCodes: [200, 204, 404],
						requestObserver: xmlhttp => request.setChannel(xmlhttp.channel),
						errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
						errorDelayMax: this.ERROR_DELAY_MAX,
						debug: true
					}
				);
			}
			catch (e) {
				if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
					this._handleUnexpectedStatus("DELETE", Trellis.HTTP.getDisplayURI(propURI).spec, e.status);
				}
				throw e;
			}
		}
		
		var file = Trellis.getTempDirectory();
		file.append(item.key + '.zip');
		Components.utils.importGlobalProperties(["File"]);
		file = File.createFromFileName ? File.createFromFileName(file.path) : new File(file);
		// File.createFromFileName() returns a Promise in Fx54+
		if (file.then) {
			file = await file;
		}
		
		var uri = this._getItemURI(item);
		
		try {
			var req = await Trellis.HTTP.request(
				"PUT",
				uri,
				{
					headers: Object.assign(
						this._getAuthorizationHeaders("PUT", uri),
						{
							"Content-Type": "application/zip"
						},
					),
					body: file,
					requestObserver: function (req) {
						request.setChannel(req.channel);
						req.upload.addEventListener("progress", function (event) {
							if (event.lengthComputable) {
								request.onProgress(event.loaded, event.total);
							}
						});
					},
					errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
					errorDelayMax: this.ERROR_DELAY_MAX,
					timeout: 0,
					debug: true
				}
			);
		}
		catch (e) {
			if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
				if (e.status == 507) {
					throw new Error(
						Trellis.getString('sync.storage.error.webdav.insufficientSpace')
					);
				}
				
				this._handleUnexpectedStatus("PUT", Trellis.HTTP.getDisplayURI(uri).spec, e.status);
			}
			throw e;
			
			// TODO: Detect cancel?
			//onUploadCancel(httpRequest, status, data)
			//deferred.resolve(false);
		}
		
		request.setChannel(false);
		return this._onUploadComplete(req, request, item, params);
	},
	
	
	/**
	 * @return {Promise}
	 * @throws {Trellis.Sync.Storage.Mode.WebDAV.VerificationError|Error}
	 */
	checkServer: async function (options = {}) {
		// Clear URIs
		await this._init();
		
		var parentURI = this.parentURI;
		var uri = this.rootURI;
		
		var xmlstr = "<propfind xmlns='DAV:'><prop>"
			// IIS 5.1 requires at least one property in PROPFIND
			+ "<getcontentlength/>"
			+ "</prop></propfind>";
		
		var requestObserver = function (req) {
			if (options.onRequest) {
				options.onRequest(req);
			}
		}
		
		// Test whether URL is WebDAV-enabled
		var req = await Trellis.HTTP.request(
			"OPTIONS",
			uri,
			{
				successCodes: [200, 204, 404],
				requestObserver,
				errorDelayMax: 0,
				debug: true
			}
		);

		Trellis.debug(req.getAllResponseHeaders());

		var dav = req.getResponseHeader("DAV");
		if (dav == null) {
			throw new this.VerificationError("NOT_DAV", Trellis.HTTP.getDisplayURI(uri, true).spec);
		}

		var propfindHeaders = {
			Depth: 0,
			"Content-Type": "text/xml; charset=utf-8"
		};

		// Test whether Trellis directory exists
		req = await Trellis.HTTP.request("PROPFIND", uri, {
			body: xmlstr,
			headers: propfindHeaders,
			successCodes: [207, 404],
			requestObserver,
			onAuthorizationHeader: (authorization) => {
				this._cacheAuthorization(authorization);
			},
			errorDelayMax: 0,
			debug: true
		});

		if (req.status == 207) {
			// Test if missing files return 404s
			let missingFileURI = uri.mutate().setSpec(uri.spec + "nonexistent.prop").finalize();
			try {
				req = await Trellis.HTTP.request(
					"GET",
					missingFileURI,
					{
						headers: this._getAuthorizationHeaders("GET", missingFileURI),
						successCodes: [404],
						responseType: 'text',
						requestObserver,
						errorDelayMax: 0,
						debug: true
					}
				)
			}
			catch (e) {
				if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
					if (e.status >= 200 && e.status < 300) {
						throw new this.VerificationError(
							"NONEXISTENT_FILE_NOT_MISSING",
							Trellis.HTTP.getDisplayURI(uri, true).spec
						);
					}
				}
				throw e;
			}

			// Test if Trellis directory is writable
			let testFileURI = uri.mutate().setSpec(uri.spec + "trellis-test-file.prop").finalize();
			req = await Trellis.HTTP.request("PUT", testFileURI, {
				headers: this._getAuthorizationHeaders("PUT", testFileURI),
				body: " ",
				successCodes: [200, 201, 204],
				requestObserver,
				errorDelayMax: 0,
				debug: true
			});

			req = await Trellis.HTTP.request(
				"GET",
				testFileURI,
				{
					headers: this._getAuthorizationHeaders("GET", testFileURI),
					successCodes: [200, 404],
					responseType: 'text',
					requestObserver,
					errorDelayMax: 0,
					debug: true
				}
			);

			if (req.status == 200) {
				// Delete test file
				await Trellis.HTTP.request(
					"DELETE",
					testFileURI,
					{
						headers: this._getAuthorizationHeaders("DELETE", testFileURI),
						successCodes: [200, 204],
						requestObserver,
						errorDelayMax: 0,
						debug: true
					}
				);
			}
			// This can happen with cloud storage services backed by S3 or other eventually
			// consistent data stores.
			//
			// This can also be from IIS 6+, which is configured not to serve .prop files.
			// http://support.microsoft.com/kb/326965
			else if (req.status == 404) {
				throw new this.VerificationError(
					"FILE_MISSING_AFTER_UPLOAD",
					Trellis.HTTP.getDisplayURI(uri, true).spec
				);
			}
		}
		else if (req.status == 404) {
			// Trellis directory wasn't found, so see if at least
			// the parent directory exists
			req = await Trellis.HTTP.request("PROPFIND", parentURI, {
				headers: Object.assign(
					{},
					this._getAuthorizationHeaders("PROPFIND", parentURI),
					propfindHeaders
				),
				body: xmlstr,
				requestObserver,
				successCodes: [207, 404],
				errorDelayMax: 0
			});
			
			if (req.status == 207) {
				throw new this.VerificationError(
					"TRELLIS_DIR_NOT_FOUND",
					Trellis.HTTP.getDisplayURI(uri, true).spec
				);
			}
			else if (req.status == 404) {
				throw new this.VerificationError(
					"PARENT_DIR_NOT_FOUND",
					Trellis.HTTP.getDisplayURI(uri, true).spec
				);
			}
		}
		
		this.verified = true;
		Trellis.debug(this.name + " file sync is successfully set up");
	},
	
	
	/**
	 * Handles the result of WebDAV verification, displaying an alert if necessary.
	 *
	 * @return bool True if the verification eventually succeeded, false otherwise
	 */
	handleVerificationError: async function (err, window, skipSuccessMessage) {
		var promptService = Services.prompt;
		
		var errorTitle, errorMsg;
		
		if (err instanceof Trellis.HTTP.UnexpectedStatusException) {
			switch (err.status) {
			case 0:
				errorMsg = Trellis.getString('sync.storage.error.serverCouldNotBeReached', err.url.host);
				break;
				
			case 401:
				this._onAuthError();
				errorTitle = Trellis.getString('general.permissionDenied');
				errorMsg = Trellis.getString('sync.storage.error.webdav.invalidLogin') + "\n\n"
					+ Trellis.getString('sync.storage.error.checkFileSyncSettings');
				break;
			
			case 403:
				errorTitle = Trellis.getString('general.permissionDenied');
				errorMsg = Trellis.getString('sync.storage.error.webdav.permissionDenied', err.channel.URI.pathQueryRef)
					+ "\n\n" + Trellis.getString('sync.storage.error.checkFileSyncSettings');
				break;
			
			case 500:
				errorTitle = Trellis.getString('sync.storage.error.webdav.serverConfig.title');
				errorMsg = Trellis.getString('sync.storage.error.webdav.serverConfig')
					+ "\n\n" + Trellis.getString('sync.storage.error.checkFileSyncSettings');
				break;
			
			default:
				errorMsg = Trellis.getString('general.unknownErrorOccurred') + "\n\n"
					+ Trellis.getString('sync.storage.error.checkFileSyncSettings') + "\n\n"
					+ "HTTP " + err.status;
				break;
			}
		}
		else if (err instanceof this.VerificationError) {
			switch (err.error) {
				case "NO_URL":
					errorMsg = Trellis.getString('sync.storage.error.webdav.enterURL');
					break;
				
				case "NO_USERNAME":
					errorMsg = Trellis.getString('sync.error.usernameNotSet');
					break;
				
				case "NO_PASSWORD":
					errorMsg = Trellis.getString('sync.error.enterPassword');
					break;
				
				case "INVALID_URL":
				case "NOT_DAV":
					errorMsg = Trellis.getString('sync.storage.error.webdav.invalidURL', err.url);
					break;
				
				case "PARENT_DIR_NOT_FOUND":
					errorTitle = Trellis.getString('sync.storage.error.directoryNotFound');
					var parentURL = err.url.replace(/trellis\/$/, "");
					errorMsg = Trellis.getString('sync.storage.error.doesNotExist', parentURL);
					break;
				
				case "TRELLIS_DIR_NOT_FOUND":
					var create = promptService.confirmEx(
						window,
						Trellis.getString('sync.storage.error.directoryNotFound'),
						Trellis.getString('sync.storage.error.doesNotExist', err.url) + "\n\n"
							+ Trellis.getString('sync.storage.error.createNow'),
						promptService.BUTTON_POS_0
							* promptService.BUTTON_TITLE_IS_STRING
						+ promptService.BUTTON_POS_1
							* promptService.BUTTON_TITLE_CANCEL,
						Trellis.getString('general.create'),
						null, null, null, {}
					);
					
					if (create != 0) {
						return;
					}
					
					try {
						await this._createServerDirectory();
					}
					catch (e) {
						if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
							if (e.status == 403) {
								errorTitle = Trellis.getString('general.permissionDenied');
								let rootURI = this.rootURI;
								let rootSpec = rootURI.scheme + '://' + rootURI.hostPort + rootURI.pathQueryRef
								errorMsg = Trellis.getString('sync.storage.error.permissionDeniedAtAddress')
									+ "\n\n" + rootSpec + "\n\n"
									+ Trellis.getString('sync.storage.error.checkFileSyncSettings');
								break;
							}
						}
						errorMsg = e;
						break;
					}
					
					try {
						await this.checkServer();
						return true;
					}
					catch (e) {
						return this.handleVerificationError(e, window, skipSuccessMessage);
					}
					break;
				
				case "FILE_MISSING_AFTER_UPLOAD":
					errorTitle = Trellis.getString("general.warning");
					errorMsg = Trellis.getString('sync.storage.error.webdav.fileMissingAfterUpload');
					Trellis.Prefs.set("sync.storage.verified", true);
					break;
				
				case "NONEXISTENT_FILE_NOT_MISSING":
					errorTitle = Trellis.getString('sync.storage.error.webdav.serverConfig.title');
					errorMsg = Trellis.getString('sync.storage.error.webdav.nonexistentFileNotMissing');
					break;
				
				default:
					errorMsg = Trellis.getString('general.unknownErrorOccurred') + "\n\n"
						Trellis.getString('sync.storage.error.checkFileSyncSettings');
					break;
			}
		}
		
		var e;
		if (errorMsg) {
			e = {
				message: errorMsg,
				// Prevent Report Errors button for known errors
				dialogButtonText: null
			};
			Trellis.logError(errorMsg);
		}
		else {
			e = err;
			Trellis.logError(err);
		}
		
		if (!skipSuccessMessage) {
			if (!errorTitle) {
				errorTitle = Trellis.getString("general.error");
			}
			Trellis.Utilities.Internal.errorPrompt(errorTitle, e);
		}
		return false;
	},
	
	
	/**
	 * Remove files on storage server that were deleted locally
	 *
	 * @param {Integer} libraryID
	 */
	purgeDeletedStorageFiles: async function (libraryID) {
		await this._init();
		
		var d = new Date();
		
		Trellis.debug("Purging deleted storage files");
		var files = await Trellis.Sync.Storage.Local.getDeletedFiles(libraryID);
		if (!files.length) {
			Trellis.debug("No files to delete remotely");
			return false;
		}
		
		// Add .zip extension
		var files = files.map(file => file + ".zip");
		
		var results = await this._deleteStorageFiles(files)
		
		// Remove deleted and nonexistent files from storage delete log
		var toPurge = Trellis.Utilities.arrayUnique(
			results.deleted.concat(results.missing)
			// Strip file extension so we just have keys
			.map(val => val.replace(/\.(prop|zip)$/, ""))
		);
		if (toPurge.length > 0) {
			await Trellis.Utilities.Internal.forEachChunkAsync(
				toPurge,
				Trellis.DB.MAX_BOUND_PARAMETERS - 1,
				function (chunk) {
					return Trellis.DB.executeTransaction(async function () {
						var sql = "DELETE FROM storageDeleteLog WHERE libraryID=? AND key IN ("
							+ chunk.map(() => '?').join() + ")";
						return Trellis.DB.queryAsync(sql, [libraryID].concat(chunk));
					});
				}
			);
		}
		
		Trellis.debug(`Purged deleted storage files in ${new Date() - d} ms`);
		Trellis.debug(results);
		
		return results;
	},
	
	
	/**
	 * Delete orphaned storage files older than a week before last sync time
	 */
	purgeOrphanedStorageFiles: async function () {
		await this._init();
		
		var d = new Date();
		const libraryID = Trellis.Libraries.userLibraryID;
		const library = Trellis.Libraries.get(libraryID);
		const daysBeforeSyncTime = 7;
		
		// If recently purged, skip
		var lastPurge = Trellis.Prefs.get('lastWebDAVOrphanPurge');
		if (lastPurge) {
			try {
				let purgeAfter = lastPurge + (daysBeforeSyncTime * 24 * 60 * 60);
				if (new Date() < new Date(purgeAfter * 1000)) {
					return false;
				}
			}
			catch (e) {
				Trellis.Prefs.clear('lastWebDAVOrphanPurge');
			}
		}
		
		Trellis.debug("Purging orphaned storage files");
		
		await this.cacheCredentials();
		
		var uri = this.rootURI;
		var path = uri.pathQueryRef;
		
		var contentTypeXML = { "Content-Type": "text/xml; charset=utf-8" };
		var xmlstr = "<propfind xmlns='DAV:'><prop>"
			+ "<getlastmodified/>"
			+ "</prop></propfind>";
		
		var lastSyncDate = library.lastSync;
		if (!lastSyncDate) {
			Trellis.debug(`No last sync date for library ${libraryID} -- not purging orphaned files`);
			return false;
		}
		
		var req = await Trellis.HTTP.request(
			"PROPFIND",
			uri,
			{
				body: xmlstr,
				headers: Object.assign(
					this._getAuthorizationHeaders("PROPFIND", uri),
					{ Depth: 1 },
					contentTypeXML
				),
				successCodes: [207],
				errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
				errorDelayMax: this.ERROR_DELAY_MAX,
				debug: true
			}
		);
		
		var responseNode = req.responseXML.documentElement;
		responseNode.xpath = function (path) {
			return Trellis.Utilities.xpath(this, path, { D: 'DAV:' });
		};
		
		var syncQueueKeys = new Set(
			await Trellis.Sync.Data.Local.getObjectsFromSyncQueue('item', libraryID)
		);
		var deleteFiles = [];
		var trailingSlash = !!path.match(/\/$/);
		for (let response of responseNode.xpath("D:response")) {
			var href = Trellis.Utilities.xpathText(
				response, "D:href", { D: 'DAV:' }
			) || "";
			Trellis.debug("Checking response entry " + href);
			
			// Strip trailing slash if there isn't one on the root path
			if (!trailingSlash) {
				href = href.replace(/\/$/, "");
			}
			
			// Absolute
			if (href.match(/^https?:\/\//)) {
				let ios = Components.classes["@mozilla.org/network/io-service;1"]
					.getService(Components.interfaces.nsIIOService);
				href = ios.newURI(href, null, null).pathQueryRef;
			}
			
			let decodedHref = decodeURIComponent(href).normalize();
			let decodedPath = decodeURIComponent(path).normalize();
			
			// Skip root URI
			if (decodedHref == decodedPath
					// Some Apache servers respond with a "/trellis" href
					// even for a "/trellis/" request
					|| (trailingSlash && decodedHref + '/' == decodedPath)) {
				continue;
			}
			
			if (!decodedHref.startsWith(decodedPath)) {
				throw new Error(`DAV:href '${href}' does not begin with path '${path}'`);
			}
			
			var matches = href.match(/[^\/]+$/);
			if (!matches) {
				throw new Error(`Unexpected href '${href}'`);
			}
			var file = matches[0];
			
			if (file.startsWith('.')) {
				Trellis.debug("Skipping hidden file " + file);
				continue;
			}
			
			var isLastSyncFile = file == 'lastsync.txt' || file == 'lastsync';
			if (!isLastSyncFile) {
				if (!file.endsWith('.zip') && !file.endsWith('.prop')) {
					Trellis.debug("Skipping file " + file);
					continue;
				}
				
				let key = file.replace(/\.(zip|prop)$/, '');
				let item = await Trellis.Items.getByLibraryAndKeyAsync(libraryID, key);
				if (item) {
					Trellis.debug("Skipping existing file " + file);
					continue;
				}
				
				if (syncQueueKeys.has(key)) {
					Trellis.debug(`Skipping file for item ${key} in sync queue`);
					continue;
				}
			}
			
			Trellis.debug("Checking orphaned file " + file);
			
			// TODO: Parse HTTP date properly
			Trellis.debug(response.innerHTML);
			var lastModified = Trellis.Utilities.xpathText(
				response, ".//D:getlastmodified", { D: 'DAV:' }
			);
			lastModified = Trellis.Date.strToISO(lastModified);
			lastModified = Trellis.Date.sqlToDate(lastModified, true);
			
			// Delete files older than a week before last sync time
			var days = (lastSyncDate - lastModified) / 1000 / 60 / 60 / 24;
			
			if (days > daysBeforeSyncTime) {
				deleteFiles.push(file);
			}
		}
		
		var results = await this._deleteStorageFiles(deleteFiles);
		Trellis.Prefs.set("lastWebDAVOrphanPurge", Math.round(new Date().getTime() / 1000));
		
		Trellis.debug(`Purged orphaned storage files in ${new Date() - d} ms`);
		Trellis.debug(results);
		
		return results;
	},
	
	
	//
	// Private methods
	//
	/**
	 * Get mod time and hash of file on storage server
	 *
	 * @param {Trellis.Item} item
	 * @param {Trellis.Sync.Storage.Request} request
	 * @return {Object} - Object with 'mtime' and 'md5'
	 */
	_getStorageFileMetadata: async function (item, request) {
		var uri = this._getItemPropertyURI(item);
		
		try {
			var req = await Trellis.HTTP.request(
				"GET",
				uri,
				{
					headers: this._getAuthorizationHeaders("GET", uri),
					successCodes: [200, 300, 404],
					responseType: 'text',
					requestObserver: xmlhttp => request.setChannel(xmlhttp.channel),
					noCache: true,
					errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
					errorDelayMax: this.ERROR_DELAY_MAX,
					debug: true
				}
			);
		}
		catch (e) {
			if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
				this._handleUnexpectedStatus("GET", Trellis.HTTP.getDisplayURI(uri).spec, e.status);
			}
			throw e;
		}
		
		// mod_speling can return 300s for 404s with base name matches
		if (req.status == 404 || req.status == 300) {
			return false;
		}
		
		// No metadata set
		if (!req.responseText) {
			return false;
		}
		
		var seconds = false;
		var parser = new DOMParser();
		try {
			var xml = parser.parseFromString(req.responseText, "text/xml");
		}
		catch (e) {
			Trellis.logError(e);
		}
		
		var mtime = false;
		var md5 = false;
		
		if (xml) {
			try {
				var mtime = xml.getElementsByTagName('mtime')[0].textContent;
			}
			catch (e) {}
			try {
				var md5 = xml.getElementsByTagName('hash')[0].textContent;
			}
			catch (e) {}
		}
		
		// TEMP: Accept old non-XML prop files with just mtimes in seconds
		if (!mtime) {
			mtime = req.responseText;
			seconds = true;
		}
		
		var invalid = false;
		
		// Unix timestamps need to be converted to ms-based timestamps
		if (seconds) {
			if (mtime.match(/^[0-9]{1,10}$/)) {
				Trellis.debug("Converting Unix timestamp '" + mtime + "' to milliseconds");
				mtime = mtime * 1000;
			}
			else {
				invalid = true;
			}
		}
		else if (!mtime.match(/^[0-9]{1,13}$/)) {
			invalid = true;
		}
		
		// Delete invalid .prop files
		if (invalid) {
			let msg = "Invalid mod date '" + Trellis.Utilities.ellipsize(mtime, 20)
				+ "' for item " + item.libraryKey;
			Trellis.logError(msg);
			await this._deleteStorageFiles([item.key + ".prop"]).catch(function (e) {
				Trellis.logError(e);
			});
			throw new Error(Trellis.Sync.Storage.Mode.WebDAV.defaultError);
		}
		
		return {
			mtime: parseInt(mtime),
			md5
		};
	},
	
	
	/**
	 * Set mod time and hash of file on storage server
	 *
	 * @param	{Trellis.Item}	item
	 */
	_setStorageFileMetadata: async function (item) {
		var uri = this._getItemPropertyURI(item);
		
		var mtime = await item.attachmentModificationTime;
		var md5 = await item.attachmentHash;
		
		var xmlstr = '<properties version="1">'
			+ '<mtime>' + mtime + '</mtime>'
			+ '<hash>' + md5 + '</hash>'
			+ '</properties>';
		
		try {
			await Trellis.HTTP.request(
				"PUT",
				uri,
				{
					headers: Object.assign(
						{
							"Content-Type": "text/xml"
						},
						this._getAuthorizationHeaders("PUT", uri),
					),
					body: xmlstr,
					successCodes: [200, 201, 204],
					errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
					errorDelayMax: this.ERROR_DELAY_MAX,
					debug: true
				}
			)
		}
		catch (e) {
			if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
				this._handleUnexpectedStatus("PUT", Trellis.HTTP.getDisplayURI(uri).spec, e.status);
			}
			throw e;
		}
	},
	
	
	_onUploadComplete: async function (req, request, item, params) {
		Trellis.debug("Upload of attachment " + item.key + " finished with status code " + req.status);
		Trellis.debug(req.responseText);
		
		// Update .prop file on WebDAV server
		await this._setStorageFileMetadata(item);
		
		item.attachmentSyncedModificationTime = params.mtime;
		item.attachmentSyncedHash = params.md5;
		item.attachmentSyncState = "in_sync";
		await item.saveTx({ skipAll: true });
		// skipAll doesn't mark as unsynced, so do that separately
		await item.updateSynced(false);
		
		try {
			await OS.File.remove(
				OS.Path.join(Trellis.getTempDirectory().path, item.key + '.zip')
			);
		}
		catch (e) {
			Trellis.logError(e);
		}
		
		return new Trellis.Sync.Storage.Result({
			localChanges: true,
			remoteChanges: true,
			syncRequired: true
		});
	},
	
	
	_onUploadCancel: function (httpRequest, status, data) {
		var request = data.request;
		var item = data.item;
		
		Trellis.debug("Upload of attachment " + item.key + " cancelled with status code " + status);
		
		try {
			var file = Trellis.getTempDirectory();
			file.append(item.key + '.zip');
			file.remove(false);
		}
		catch (e) {
			Components.utils.reportError(e);
		}
	},
	
	
	/**
	 * Create a Trellis directory on the storage server
	 */
	_createServerDirectory: function () {
		return Trellis.HTTP.request(
			"MKCOL",
			this.rootURI,
			{
				successCodes: [201],
				errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
				errorDelayMax: this.ERROR_DELAY_MAX,
			}
		);
	},
	
	
	/**
	 * Get the storage URI for an item
	 *
	 * @inner
	 * @param	{Trellis.Item}
	 * @return	{nsIURI}					URI of file on storage server
	 */
	_getItemURI: function (item) {
		return this.rootURI.mutate().setSpec(this.rootURI.spec + item.key + '.zip').finalize();
	},
	
	
	/**
	 * Get the storage property file URI for an item
	 *
	 * @inner
	 * @param	{Trellis.Item}
	 * @return	{nsIURI}					URI of property file on storage server
	 */
	_getItemPropertyURI: function (item) {
		return this.rootURI.mutate().setSpec(this.rootURI.spec + item.key + '.prop').finalize();
	},
	
	
	/**
	 * Get the storage property file URI corresponding to a given item storage URI
	 *
	 * @param	{nsIURI}			Item storage URI
	 * @return	{nsIURI|FALSE}	Property file URI, or FALSE if not an item storage URI
	 */
	_getPropertyURIFromItemURI: function (uri) {
		if (!uri.spec.match(/\.zip$/)) {
			return false;
		}
		return uri.mutate().setFilePath(uri.filePath.replace(/\.zip$/, '.prop')).finalize();
	},
	
	
	/**
	 * @inner
	 * @param {String[]} files - Filenames of files to delete
	 * @return {Object} - Object with properties 'deleted', 'missing', and 'error', each
	 *     each containing filenames
	 */
	_deleteStorageFiles: async function (files) {
		var results = {
			deleted: new Set(),
			missing: new Set(),
			error: new Set()
		};
		
		if (files.length == 0) {
			return results;
		}
		
		// Delete .prop files first
		files.sort(function (a, b) {
			if (a.endsWith('.zip') && b.endsWith('.prop')) return 1;
			if (b.endsWith('.zip') && a.endsWith('.prop')) return 1;
			return 0;
		});
		
		let deleteURI = this.rootURI;
		// This should never happen, but let's be safe
		if (!deleteURI.spec.match(/\/$/)) {
			throw new Error("Root URI does not end in slash");
		}
		
		var funcs = [];
		for (let i = 0 ; i < files.length; i++) {
			let fileName = files[i];
			funcs.push(async function () {
				var deleteURI = this.rootURI.mutate().setSpec(this.rootURI.spec + fileName).finalize();
				try {
					var req = await Trellis.HTTP.request(
						"DELETE",
						deleteURI,
						{
							headers: this._getAuthorizationHeaders("DELETE", deleteURI),
							successCodes: [200, 204, 404],
							errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
							errorDelayMax: this.ERROR_DELAY_MAX,
						}
					);
				}
				catch (e) {
					results.error.add(fileName);
					throw e;
				}
				
				switch (req.status) {
					case 204:
					// IIS 5.1 and Sakai return 200
					case 200:
						results.deleted.add(fileName);
						break;
					
					case 404:
						results.missing.add(fileName);
						break;
				}
				
				// If a .zip file URL, get the .prop file URI
				var deletePropURI = this._getPropertyURIFromItemURI(deleteURI);
				// Not a .zip file URL
				if (!deletePropURI) {
					return;
				}
				// Only nsIURL has fileName
				deletePropURI.QueryInterface(Ci.nsIURL);
				fileName = deletePropURI.fileName;
				// Already deleted
				if (results.deleted.has(fileName)) {
					return;
				}
				
				// Delete property file
				var req = await Trellis.HTTP.request(
					"DELETE",
					deletePropURI,
					{
						headers: this._getAuthorizationHeaders("DELETE", deletePropURI),
						successCodes: [200, 204, 404],
						errorDelayIntervals: this.ERROR_DELAY_INTERVALS,
						errorDelayMax: this.ERROR_DELAY_MAX,
					}
				);
				switch (req.status) {
					case 204:
					// IIS 5.1 and Sakai return 200
					case 200:
						results.deleted.add(fileName);
						break;
					
					case 404:
						results.missing.add(fileName);
						break;
				}
			}.bind(this));
		}
		
		const { ConcurrentCaller } = ChromeUtils.importESModule("resource://trellis/concurrentCaller.mjs");
		var caller = new ConcurrentCaller({
			numConcurrent: 4,
			stopOnError: true,
			logger: msg => Trellis.debug(msg),
			onError: e => Trellis.logError(e)
		});
		await caller.start(funcs);
		
		// Convert sets back to arrays
		for (let i in results) {
			results[i] = Array.from(results[i]);
		}
		return results;
	},
	
	
	_handleUnexpectedStatus: function (method, url, status) {
		if (status == 401) {
			this._onAuthError();
		}
		throw new Error(
			Trellis.getString('sync.storage.error.webdav.requestError', [status, method])
			+ "\n\n"
			+ Trellis.getString('sync.storage.error.webdav.checkSettingsOrContactAdmin')
			+ "\n\n"
			+ Trellis.getString('sync.storage.error.webdav.url', url)
		);
	}
}
