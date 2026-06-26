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


Trellis.Sync.Storage = new function () {
	
	// TEMP
	this.__defineGetter__("defaultError", function () { return Trellis.getString('sync.storage.error.default', Trellis.appName); });
	this.__defineGetter__("defaultErrorRestart", function () { return Trellis.getString('sync.storage.error.defaultRestart', Trellis.appName); });
	
	var _itemDownloadPercentages = {};
	
	//
	// Public properties
	//
	this.compressionTracker = {
		compressed: 0,
		uncompressed: 0,
		get ratio() {
			return (Trellis.Sync.Storage.compressionTracker.uncompressed - 
				Trellis.Sync.Storage.compressionTracker.compressed) /
				Trellis.Sync.Storage.compressionTracker.uncompressed;
		}
	}
	
	
	this.getItemDownloadProgress = function (item) {
		var lk = item.libraryID + "/" + item.key;
		
		if (typeof _itemDownloadPercentages[lk] == 'undefined') {
			return false;
		}
		
		var percentage = _itemDownloadPercentages[lk];
		return percentage;
	};
	
	
	/**
	 * @param {String} libraryKey
	 * @param {Number|NULL}
	 */
	this.setItemDownloadPercentage = function (libraryKey, percentage) {
		Trellis.debug("Setting image download percentage to " + percentage
			+ " for item " + libraryKey);

		let isItemPercentageChanged = _itemDownloadPercentages[libraryKey] !== percentage;
		if (percentage !== false) {
			_itemDownloadPercentages[libraryKey] = percentage;
		}
		else {
			delete _itemDownloadPercentages[libraryKey];
		}
		
		var libraryID, key;
		[libraryID, key] = libraryKey.split("/");
		var item = Trellis.Items.getByLibraryAndKey(libraryID, key);
		// Item may not longer exist in tests
		if (Trellis.test && !item) {
			return;
		}
		
		if (isItemPercentageChanged) {
			// TODO: yield or switch to queue
			Trellis.Notifier.trigger('redraw', 'item', item.id, { column: "hasAttachment" });
		}
		
		var parent = item.parentItemKey;
		if (parent) {
			var parentItem = Trellis.Items.getByLibraryAndKey(libraryID, parent);
			var parentLibraryKey = libraryID + "/" + parentItem.key;
			let isParentPercentageChanged = _itemDownloadPercentages[parentLibraryKey] !== percentage;
			if (percentage !== false) {
				_itemDownloadPercentages[parentLibraryKey] = percentage;
			}
			else {
				delete _itemDownloadPercentages[parentLibraryKey];
			}
			if (isParentPercentageChanged) {
				Trellis.Notifier.trigger('redraw', 'item', parentItem.id, { column: "hasAttachment" });
			}
		}
	};
	
	
	function error(e) {
		if (_syncInProgress) {
			Trellis.Sync.Storage.QueueManager.cancel(true);
			_syncInProgress = false;
		}
		
		Trellis.DB.rollbackAllTransactions();
		
		if (e) {
			Trellis.debug(e, 1);
		}
		else {
			e = Trellis.Sync.Storage.defaultError;
		}
		
		if (e.error && e.error == Trellis.Error.ERROR_ZFS_FILE_EDITING_DENIED) {
			setTimeout(function () {
				var group = Trellis.Groups.get(e.data.groupID);
				
				var index = Trellis.Prompt.confirm({
					title: Trellis.getString('general.warning'),
					text: Trellis.getString('sync.storage.error.fileEditingAccessLost', group.name) + "\n\n"
						+ Trellis.getString('sync.error.groupWillBeReset') + "\n\n"
						+ Trellis.getString('sync.error.copyChangedItems'),
					button0: Trellis.getString('sync.resetGroupAndSync'),
					buttonDelay: true,
				});
				
				if (index == 0) {
					// TODO: transaction
					group.erase();
					Trellis.Sync.Server.resetClient();
					Trellis.Sync.Storage.resetAllSyncStates();
					Trellis.Sync.Runner.sync();
					return;
				}
			}, 1);
		}
	}
}



