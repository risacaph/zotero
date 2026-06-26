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


/*
 * Primary interface for accessing Trellis feed items
 */
Trellis.FeedItems = new Proxy(function () {
	let _idCache = {},
		_guidCache = {};
	
	// Teach Trellis.Items about Trellis.FeedItem
	
	// This one is a lazy getter, so we don't patch it up until first access
	let zi_primaryDataSQLParts = Object.getOwnPropertyDescriptor(Trellis.Items, '_primaryDataSQLParts').get;
	Trellis.defineProperty(Trellis.Items, '_primaryDataSQLParts', {
		get: function () {
			let obj = zi_primaryDataSQLParts.call(this);
			obj.feedItemGUID = "FI.guid AS feedItemGUID";
			obj.feedItemReadTime = "FI.readTime AS feedItemReadTime";
			obj.feedItemTranslatedTime = "FI.translatedTime AS feedItemTranslatedTime";
			return obj;
		}
	}, {lazy: true});
	Trellis.Items._primaryDataSQLFrom += " LEFT JOIN feedItems FI ON (FI.itemID=O.itemID)";
	
	let zi_getObjectForRow = Trellis.Items._getObjectForRow;
	Trellis.Items._getObjectForRow = function (row) {
		if (row.feedItemGUID) {
			return new Trellis.FeedItem();
		}
		
		return zi_getObjectForRow.apply(Trellis.Items, arguments);
	}
	
	this.getIDFromGUID = async function (guid) {
		if (_idCache[guid] !== undefined) return _idCache[guid];
		
		let id = await Trellis.DB.valueQueryAsync('SELECT itemID FROM feedItems WHERE guid=?', [guid]);
		if (!id) return false;
		
		this._setGUIDMapping(guid, id);
		return id;
	};
	
	this._setGUIDMapping = function (guid, id) {
		_idCache[guid] = id;
		_guidCache[id] = guid;
	};
	
	this._deleteGUIDMapping = function (guid, id) {
		if (!id) id = _idCache[guid];
		if (!guid) guid = _guidCache[id];
		
		if (!guid || !id) return;
		
		delete _idCache[guid];
		delete _guidCache[id];
	};
	
	this.unload = function () {
		Trellis.Items.unload.apply(Trellis.Items, arguments);
		let ids = Trellis.flattenArguments(arguments);
		for (let i=0; i<ids.length; i++) {
			this._deleteGUIDMapping(null, ids[i]);
		}
	};
	
	this.getAsyncByGUID = async function (guid) {
		let id = await this.getIDFromGUID(guid);
		if (id === false) return false;
		
		return this.getAsync(id);
	};
	
	this.getMarkedAsRead = async function (libraryID, onlyGUIDs=false) {
		let sql = "SELECT " + (onlyGUIDs ? "guid " : "itemID ") + 
			"FROM feedItems FI " +
			"JOIN items I USING (itemID) " +
			"WHERE libraryID=? AND readTime IS NOT NULL";
		let ids = await Trellis.DB.columnQueryAsync(sql, [libraryID]);
		if (onlyGUIDs) {
			return ids;
		}
		return Trellis.FeedItems.getAsync(ids);
		
	};

	/**
	 * Currently not used
	 */
	this.markAsReadByGUID = async function (guids) {
		if (! Array.isArray(guids)) {
			throw new Error('guids must be an array in Trellis.FeedItems.toggleReadByID');
		}
		let ids = [];
		Trellis.debug("Marking items as read");
		Trellis.debug(guids);
		for (let guid of guids) {
			let id = await this.getIDFromGUID(guid);
			if (id) {
				ids.push(id);
			}
		}
		return this.toggleReadByID(ids, true);
	};
	
	this.toggleReadByID = async function (ids, state) {
		if (!Array.isArray(ids)) {
			if (typeof ids != 'string') throw new Error('ids must be a string or array in Trellis.FeedItems.toggleReadByID');
			
			ids = [ids];
		}
		if (!ids.length) {
			throw new Error("No ids passed");
		}
		
		let items = await this.getAsync(ids);
		
		if (state == undefined) {
			// If state undefined, toggle read if at least one unread
			state = false;
			for (let item of items) {
				if (!item.isRead) {
					state = true;
					break;
				}
			}
		}

		let feedsToUpdate = new Set();
		let readTime = state ? Trellis.Date.dateToSQL(new Date(), true) : null;
		for (let i=0; i<items.length; i++) {
			items[i]._feedItemReadTime = readTime;

			let feed = Trellis.Feeds.get(items[i].libraryID);
			feedsToUpdate.add(feed);
		}
		
		await Trellis.DB.queryAsync(`UPDATE feedItems SET readTime=? WHERE itemID IN (${ids.join(', ')})`, readTime);
		await Trellis.Notifier.trigger('modify', 'item', ids, {});

		for (let feed of feedsToUpdate) {
			await feed.updateUnreadCount();
		}
	};
	
	return this;
}.call({}),

// Proxy handler
{
	get: function (target, name) {
		return name in target
			? target[name]
			: Trellis.Items[name];
	},
	has: function (target, name) {
		return name in target || name in Trellis.Items;
	}
});