/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2014 Center for History and New Media
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

if (!Trellis.Sync.Data) {
	Trellis.Sync.Data = {};
}

Trellis.Sync.Data.Utilities = {
	_syncObjectTypeIDs: {},
	
	init: async function () {
		// If not found, cache all
		var sql = "SELECT name, syncObjectTypeID AS id FROM syncObjectTypes";
		var rows = await Trellis.DB.queryAsync(sql);
		for (let i = 0; i < rows.length; i++) {
			row = rows[i];
			this._syncObjectTypeIDs[row.name] = row.id;
		}
	},
	
	getSyncObjectTypeID: function (objectType) {
		if (!this._syncObjectTypeIDs[objectType]) {
			return false;
		}
		return this._syncObjectTypeIDs[objectType];
	},
	
	
	/**
	 * Prompt whether to reset unsynced local data in a library
	 *
	 * Keep in sync with Sync.Storage.Utilities.showFileWriteAccessLostPrompt()
	 * @param {Window|null} win
	 * @param {Trellis.Library} library
	 * @return {Integer} - 0 to reset, 1 to skip
	 */
	showWriteAccessLostPrompt: function (win, library) {
		var libraryType = library.libraryType;
		switch (libraryType) {
		case 'group':
			var msg = Trellis.getString('sync.error.groupWriteAccessLost',
					[library.name, TRELLIS_CONFIG.DOMAIN_NAME])
				+ "\n\n"
				+ Trellis.getString('sync.error.groupCopyChangedItems')
			var button0Text = Trellis.getString('sync.resetGroupAndSync');
			var button1Text = Trellis.getString('sync.skipGroup');
			break;
		
		default:
			throw new Error("Unsupported library type " + libraryType);
		}
		
		return Trellis.Prompt.confirm({
			window: win,
			title: Trellis.getString('general.permissionDenied'),
			text: msg,
			button0: button0Text,
			button1: button1Text,
			buttonDelay: true,
		});
	}
};
