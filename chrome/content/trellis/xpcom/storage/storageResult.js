"use strict";

/**
 * @property {Boolean} localChanges - Changes were made locally. For logging purposes only.
 * @property {Boolean} remoteChanges - Changes were made on the server. This causes the
 *     last-sync time to be updated on the server (WebDAV) or retrieved (ZFS) and stored locally
 *     to skip additional file syncs until further server changes are made.
 * @property {Boolean} syncRequired - A data sync is required to upload local changes
 * @propretty {Boolean} fileSyncRequired - Another file sync is required to handle files left in
 *     conflict
 */
Trellis.Sync.Storage.Result = function (options = {}) {
	this._props = ['localChanges', 'remoteChanges', 'syncRequired', 'fileSyncRequired'];
	for (let prop of this._props) {
		this[prop] = options[prop] || false;
	}
}

/**
 * Update the properties on this object from multiple Result objects
 *
 * @param {Trellis.Sync.Storage.Result[]} results
 */
Trellis.Sync.Storage.Result.prototype.updateFromResults = function (results) {
	for (let prop of this._props) {
		if (!this[prop]) {
			for (let result of results) {
				if (!(result instanceof Trellis.Sync.Storage.Result)) {
					Trellis.debug(result, 1);
					throw new Error("'result' is not a storage result");
				}
				if (result[prop]) {
					this[prop] = true;
				}
			}
		}
	}
}


/*Trellis.Sync.Storage.Result.prototype.toString = function () {
	var obj = {};
	for (let prop of this._props) {
		obj[prop] = this[prop] || false;
	}
	return JSON.stringify(obj, null, "    ");
}*/
