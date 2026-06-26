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

"use strict";

Trellis.CollectionTreeRow = function (collectionTreeView, type, ref, level, isOpen) {
	this.view = collectionTreeView;
	this.type = type;
	this.ref = ref;
	this.level = level || 0;
	this.isOpen = isOpen || false;
	this.onUnload = null;
	this.searchText = "";
	this.searchMode = "search";
	this.tags = new Set();
	
	// Per-instance search cache. Within a single refresh cycle, multiple consumers need the
	// same search results — getItems() for the items pane and getTags() for the tag selector
	// both call getSearchResults(), and getSearchResults() calls getSearchObject(). This cache
	// ensures the underlying DB query only runs once per cycle. Call clearCache() to invalidate
	// (e.g., at the start of a refresh, or when filters change).
	//
	// On search failure (e.g., a saved search with invalid conditions), getSearchResults() throws
	// a Trellis.CollectionTreeRow.SearchError. This is caught in
	// CollectionViewItemTreeRowProvider.refresh() to show a load-error message without bricking
	// the UI, so the user can still edit/delete the broken search. See the catch block in
	// refresh() for details.
	this._cachedResults = null;
	this._cachedSearch = null;
	this._cachedTempTable = null;
}

/**
 * Error thrown by CollectionTreeRow.getSearchResults() when the underlying
 * Trellis.Search query fails (e.g., a saved search with invalid conditions).
 * Caught by CollectionViewItemTreeRowProvider.refresh() to show a load-error
 * message without bricking the UI.
 */
Trellis.CollectionTreeRow.SearchError = class SearchError extends Error {
	constructor(cause) {
		super('TrellisSearchError');
		this.name = 'TrellisSearchError';
		this.cause = cause;
	}
};

Trellis.CollectionTreeRow.IDCounter = 0;


Trellis.CollectionTreeRow.prototype.__defineGetter__('id', function () {
	switch (this.type) {
		case 'library':
		case 'group':
		case 'feed':
			return 'L' + this.ref.libraryID;
		
		case 'collection':
			return 'C' + this.ref.id;
		
		case 'search':
			return 'S' + this.ref.id;
		
		case 'duplicates':
			return 'D' + this.ref.libraryID;
		
		case 'unfiled':
			return 'U' + this.ref.libraryID;
		
		case 'recentlyRead':
			return 'Y' + this.ref.libraryID;
		
		case 'retracted':
			return 'R' + this.ref.libraryID;
		
		case 'publications':
			return 'P' + this.ref.libraryID;
			
		case 'trash':
			return 'T' + this.ref.libraryID;
		
		case 'feeds':
			return 'F1';
		
		case 'header':
			switch (this.ref.id) {
				case 'group-libraries-header':
					return "HG";
			}
			break;
	}
	
	if (!this._id) {
		this._id = 'I' + Trellis.CollectionTreeRow.IDCounter++;
	}
	return this._id;
});

Trellis.CollectionTreeRow.prototype.isLibrary = function (includeGlobal)
{
	if (includeGlobal) {
		var global = ['library', 'group', 'feed'];
		return global.indexOf(this.type) != -1;
	}
	return this.type == 'library';
}

Trellis.CollectionTreeRow.prototype.isCollection = function ()
{
	return this.type == 'collection';
}

Trellis.CollectionTreeRow.prototype.isSearch = function ()
{
	return this.type == 'search';
}

Trellis.CollectionTreeRow.prototype.isDuplicates = function () {
	return this.type == 'duplicates';
}

Trellis.CollectionTreeRow.prototype.isUnfiled = function () {
	return this.type == 'unfiled';
}

Trellis.CollectionTreeRow.prototype.isRecentlyRead = function () {
	return this.type == 'recentlyRead';
}

Trellis.CollectionTreeRow.prototype.isRetracted = function () {
	return this.type == 'retracted';
}

Trellis.CollectionTreeRow.prototype.isTrash = function ()
{
	return this.type == 'trash';
}

Trellis.CollectionTreeRow.prototype.isHeader = function () {
	return this.type == 'header';
}

Trellis.CollectionTreeRow.prototype.isPublications = function () {
	return this.type == 'publications';
}

Trellis.CollectionTreeRow.prototype.isGroup = function () {
	return this.type == 'group';
}

Trellis.CollectionTreeRow.prototype.isFeed = function () {
	return this.type == 'feed';
}

Trellis.CollectionTreeRow.prototype.isFeeds = function () {
	return this.type == 'feeds';
}

Trellis.CollectionTreeRow.prototype.isFeedsOrFeed = function () {
	return this.isFeeds() || this.isFeed();
}

Trellis.CollectionTreeRow.prototype.isSeparator = function () {
	return this.type == 'separator';
}

Trellis.CollectionTreeRow.prototype.isBucket = function ()
{
	return this.type == 'bucket';
}

Trellis.CollectionTreeRow.prototype.isShare = function ()
{
	return this.type == 'share';
}

Trellis.CollectionTreeRow.prototype.isContainer = function () {
	return this.isLibrary(true) || this.isCollection() || this.isPublications() || this.isBucket() || this.isFeeds();
}



// Special
Trellis.CollectionTreeRow.prototype.isWithinGroup = function () {
	return this.ref && !this.isHeader()
		&& Trellis.Libraries.get(this.ref.libraryID).libraryType == 'group';
}

Trellis.CollectionTreeRow.prototype.isWithinEditableGroup = function () {
	if (!this.isWithinGroup()) {
		return false;
	}
	var groupID = Trellis.Groups.getGroupIDFromLibraryID(this.ref.libraryID);
	return Trellis.Groups.get(groupID).editable;
}

Trellis.CollectionTreeRow.prototype.__defineGetter__('editable', function () {
	if (this.isTrash() || this.isShare() || this.isBucket()) {
		return false;
	}
	if (this.isGroup() || this.isFeedsOrFeed()) {
		return this.ref.editable;
	}
	if (!this.isWithinGroup() || this.isPublications()) {
		return true;
	}
	var libraryID = this.ref.libraryID;
	if (this.isCollection() || this.isSearch() || this.isDuplicates() || this.isUnfiled() || this.isRecentlyRead() || this.isRetracted()) {
		var type = Trellis.Libraries.get(libraryID).libraryType;
		if (type == 'group') {
			var groupID = Trellis.Groups.getGroupIDFromLibraryID(libraryID);
			var group = Trellis.Groups.get(groupID);
			return group.editable;
		}
		throw ("Unknown library type '" + type + "' in Trellis.CollectionTreeRow.editable");
	}
	return false;
});

Trellis.CollectionTreeRow.prototype.__defineGetter__('filesEditable', function () {
	if (this.isTrash() || this.isShare() || this.isFeed()) {
		return false;
	}
	if (!this.isWithinGroup() || this.isPublications()) {
		return true;
	}
	var libraryID = this.ref.libraryID;
	if (this.isGroup()) {
		return this.ref.editable && this.ref.filesEditable;
	}
	if (this.isCollection() || this.isSearch() || this.isDuplicates() || this.isUnfiled() || this.isRecentlyRead() || this.isRetracted()) {
		var type = Trellis.Libraries.get(libraryID).libraryType;
		if (type == 'group') {
			var groupID = Trellis.Groups.getGroupIDFromLibraryID(libraryID);
			var group = Trellis.Groups.get(groupID);
			return group.editable && group.filesEditable;
		}
		throw ("Unknown library type '" + type + "' in Trellis.CollectionTreeRow.filesEditable");
	}
	return false;
});


Trellis.CollectionTreeRow.visibilityGroups = {'feed': 'feed', 'feeds': 'feeds', 'recentlyRead': 'recentlyRead'};


Trellis.CollectionTreeRow.prototype.__defineGetter__('visibilityGroup', function () {
	return Trellis.CollectionTreeRow.visibilityGroups[this.type] || 'default';
});


Trellis.CollectionTreeRow.prototype.getName = function ()
{
	switch (this.type) {
		case 'library':
			return Trellis.getString('pane.collections.library');
		
		case 'publications':
			return Trellis.getString('pane.collections.publications');
		
		case 'feeds':
			return Trellis.getString('pane.collections.feedLibraries');
		
		case 'trash':
			return Trellis.getString('pane.collections.trash');
		
		case 'header':
			return this.ref.label;
		
		case 'separator':
			return "";
		
		default:
			return this.ref.name;
	}
}

Trellis.CollectionTreeRow.prototype.getChildren = function () {
	if (this.isLibrary(true)) {
		return Trellis.Collections.getByLibrary(this.ref.libraryID);
	}
	else if (this.isCollection()) {
		return Trellis.Collections.getByParent(this.ref.id);
	}
	else if (this.isFeeds()) {
		return Trellis.Feeds.getAll().sort((a, b) => Trellis.localeCompare(a.name, b.name));
	}
}

// Returns the list of deleted collections in the trash.
// Subcollections of deleted collections are filtered out.
Trellis.CollectionTreeRow.prototype.getTrashedCollections = async function () {
	if (!this.isTrash()) {
		return [];
	}
	let deleted = await Trellis.Collections.getDeleted(this.ref.libraryID);

	let deletedParents = new Set();
	for (let d of deleted) {
		deletedParents.add(d.key);
	}
	return deleted.filter(d => !d.parentKey || !deletedParents.has(d.parentKey));
};


/**
 * @param {Object} [options]
 * @param {Boolean} [options.unfiltered=false] - If true, ignore quicksearch, tag, and
 *     advanced search filters
 */
Trellis.CollectionTreeRow.prototype.getItems = async function (options = {}) {
	switch (this.type) {
		// Fake results if this is a shared library
		case 'share':
			return this.ref.getAll();
		
		case 'bucket':
			return this.ref.getItems();
	}
	
	var ids = await this.getSearchResults(false, { unfiltered: options.unfiltered });
	
	// Filter out items that exist in the items table (where search results come from) but that haven't
	// yet been registered. This helps prevent unloaded-data crashes when switching collections while
	// items are being added (e.g., during sync).
	var len = ids.length;
	ids = ids.filter(id => Trellis.Items.getLibraryAndKeyFromID(id));
	if (len > ids.length) {
		let diff = len - ids.length;
		Trellis.debug(`Not showing ${diff} unloaded item${diff != 1 ? 's' : ''}`);
	}
	
	if (!ids.length) {
		return []
	}
	
	return Trellis.Items.getAsync(ids);
};

/**
 * @param {Boolean} [asTempTable=false]
 * @param {Object} [options]
 * @param {Boolean} [options.unfiltered=false] - If true, ignore quicksearch, tag, and
 *     advanced search filters and bypass the cache
 */
Trellis.CollectionTreeRow.prototype.getSearchResults = async function (asTempTable, options = {}) {
	if (options.unfiltered) {
		let s = await this.getSearchObject({ unfiltered: true });
		let ids = await s.search();
		if (asTempTable) {
			return Trellis.Search.idsToTempTable(ids);
		}
		return ids;
	}
	
	if (!this._cachedResults) {
		let s = await this.getSearchObject();
		try {
			this._cachedResults = await s.search();
		}
		catch (e) {
			Trellis.logError(e);
			throw new Trellis.CollectionTreeRow.SearchError(e);
		}
	}
	
	if (asTempTable) {
		if (!this._cachedTempTable) {
			this._cachedTempTable = await Trellis.Search.idsToTempTable(this._cachedResults);
		}
		return this._cachedTempTable;
	}
	return this._cachedResults;
};

/*
 * Returns the search object for the currently display
 *
 * This accounts for the collection, saved search, quicksearch, tags, etc.
 *
 * @param {Object} [options]
 * @param {Boolean} [options.unfiltered=false] - If true, ignore quicksearch, tag, and
 *     advanced search filters and bypass the cache
 */
Trellis.CollectionTreeRow.prototype.getSearchObject = async function (options = {}) {
	if (!options.unfiltered && this._cachedSearch) {
		return this._cachedSearch;
	}
	
	var s;
	var includeScopeChildren = false;
	
	// Create/load the inner search
	if (this.isRecentlyRead()) {
		let ids = await Trellis.Items.getLastRead(this.ref.libraryID);
		let tmpTable = await Trellis.Search.idsToTempTable(ids, { idColumn: 'id' });
		s = new Trellis.Search();
		s.libraryID = this.ref.libraryID;
		s.addCondition('tempTable', 'is', tmpTable);
		this.onUnload = async function () {
			await Trellis.DB.queryAsync(`DROP TABLE IF EXISTS ${tmpTable}`, false, { noCache: true });
		};
	}
	else if (this.ref instanceof Trellis.Search) {
		s = this.ref;
	}
	else if (this.isDuplicates()) {
		s = await this.ref.getSearchObject();
		if (!options.unfiltered) {
			let tmpTable;
			for (let id in s.conditions) {
				let c = s.conditions[id];
				if (c.condition == 'tempTable') {
					tmpTable = c.value;
					break;
				}
			}
			// Called by ItemTreeView::unregister()
			this.onUnload = async function () {
				await Trellis.DB.queryAsync(`DROP TABLE IF EXISTS ${tmpTable}`, false, { noCache: true });
			};
		}
	}
	else {
		s = new Trellis.Search();
		if (!this.isFeeds()) {
			s.libraryID = this.ref.libraryID;
		}
		// Library root
		if (this.isLibrary(true)) {
			s.addCondition('noChildren', 'true');
			// Allow tag selector to match child items in "Title, Creator, Year" mode
			includeScopeChildren = true;
		}
		else if (this.isCollection()) {
			s.addCondition('noChildren', 'true');
			s.addCondition('collectionID', 'is', this.ref.id);
			if (Trellis.Prefs.get('recursiveCollections')) {
				s.addCondition('recursive', 'true');
			}
			// Allow tag selector to match child items in "Title, Creator, Year" mode
			includeScopeChildren = true;
		}
		else if (this.isPublications()) {
			s.addCondition('publications', 'true');
		}
		else if (this.isTrash()) {
			s.addCondition('deleted', 'true');
		}
		else if (this.isFeeds()) {
			s.addCondition('feed', 'true');
		}
		else {
			throw new Error('Invalid search mode ' + this.type);
		}
	}
	
	// Create the outer (filter) search
	var s2 = new Trellis.Search();
	if (this.isFeeds()) {
		s2.addCondition('feed', true);
	}
	else {
		s2.libraryID = this.ref.libraryID;
	}
	
	if (this.isTrash()) {
		s2.addCondition('deleted', 'true');
	}
	s2.setScope(s, includeScopeChildren);
	
	if (!options.unfiltered) {
		// Add Quick Search unless advanced search is enabled
		if (this.searchText && !this.advancedSearch) {
			let cond = 'quicksearch-'
				+ (this.searchMode || Trellis.Prefs.get('search.quicksearch-mode'));
			s2.addCondition(cond, 'contains', this.searchText);
		}
	
		if (this.tags) {
			for (let tag of this.tags) {
				s2.addCondition('tag', 'is', tag);
			}
		}
	}
	
	let s3;
	if (!options.unfiltered && this.advancedSearch) {
		if (this.advancedSearch.libraryID === null) {
			// A library-less search (Feeds pseudo-library) can't be clone()d
			s3 = new Trellis.Search();
			s3.fromJSON(this.advancedSearch.toJSON());
		}
		else {
			s3 = this.advancedSearch.clone();
		}
		// In the trash, the scope (s2) returns only deleted items, so the
		// advanced search itself has to include deleted items in order to match
		// them. Outside the trash, deleted items are excluded by default, the
		// same as for a quick search. Special condition -- unaffected by joinMode.
		if (this.isTrash()) {
			s3.addCondition('includeDeleted', 'true');
		}
		s3.setScope(s2, includeScopeChildren);
	}
	else {
		s3 = s2;
	}
	
	if (!options.unfiltered) {
		this._cachedSearch = s3;
	}
	return s3;
};

Trellis.CollectionTreeRow.prototype.getChildTags = function () {
	Trellis.warn("Trellis.CollectionTreeRow::getChildTags() is deprecated -- use getTags() instead");
	return this.getTags();
};

/**
 * Returns all the tags used by items in the current view
 *
 * @return {Promise<Object[]>}
 */
Trellis.CollectionTreeRow.prototype.getTags = async function (types, tagIDs) {
	switch (this.type) {
		// TODO: implement?
		case 'share':
			return [];
		
		case 'bucket':
			return [];
			
		case 'feeds':
			return [];
	}
	var results = await this.getSearchResults(true);
	return Trellis.Tags.getAllWithin({ tmpTable: results, types, tagIDs });
};


/**
 * Returns all the tags used by items across multiple rows' views
 *
 * Combines the rows' search results into a single temporary table and runs one tag
 * query, rather than creating a temp table and running a separate query per row.
 *
 * @param {Trellis.CollectionTreeRow[]} rows
 * @param {Number[]} [types]
 * @param {Number[]} [tagIDs]
 * @return {Promise<Object[]>}
 */
Trellis.CollectionTreeRow.getTagsAcrossRows = async function (rows, types, tagIDs) {
	// share/bucket/feeds rows never contribute tags (see getTags())
	var tagRows = rows.filter(row => !['share', 'bucket', 'feeds'].includes(row.type));
	if (!tagRows.length) {
		return [];
	}
	// Combine the rows' search results into a single set of item IDs
	var itemIDs = new Set();
	for (let ids of await Promise.all(tagRows.map(row => row.getSearchResults(false)))) {
		for (let id of ids) {
			itemIDs.add(id);
		}
	}
	var tmpTable = await Trellis.Search.idsToTempTable([...itemIDs]);
	try {
		return await Trellis.Tags.getAllWithin({ tmpTable, types, tagIDs });
	}
	finally {
		await Trellis.DB.queryAsync(`DROP TABLE IF EXISTS ${tmpTable}`, false, { noCache: true });
	}
};


/**
 * Clear the per-instance search cache. Call this at the start of a refresh cycle
 * or when search/tag filters change, so the next getSearchResults()/getSearchObject()
 * call runs a fresh DB query.
 */
Trellis.CollectionTreeRow.prototype.clearCache = function () {
	this._cachedSearch = null;
	if (this._cachedTempTable) {
		let tableName = this._cachedTempTable;
		let id = Trellis.DB.addCallback('commit', async function () {
			await Trellis.DB.queryAsync(
				"DROP TABLE IF EXISTS " + tableName, false, { noCache: true }
			);
			Trellis.DB.removeCallback('commit', id);
		});
	}
	this._cachedTempTable = null;
	this._cachedResults = null;
};

Trellis.CollectionTreeRow.prototype.setSearch = function (searchText, mode = null) {
	if (this.searchText === searchText && this.searchMode === mode) {
		return false;
	}
	this.clearCache();
	this.searchText = searchText;
	this.searchMode = mode;
	return true;
}

Trellis.CollectionTreeRow.prototype.setAdvancedSearch = function (advancedSearch) {
	this.clearCache();
	if (!advancedSearch) {
		this.advancedSearch = undefined;
	}
	else if (this.ref.libraryID === undefined) {
		// Feeds pseudo-library -- leave the library unset so that the search
		// spans all feed libraries
		this.advancedSearch = new Trellis.Search();
		this.advancedSearch.fromJSON(advancedSearch.toJSON());
	}
	else {
		this.advancedSearch = advancedSearch.clone(this.ref.libraryID);
	}
	return true;
};

Trellis.CollectionTreeRow.prototype.setTags = function (tags) {
	let oldTags = this.tags instanceof Set ? this.tags : new Set(this.tags || []);
	let newTags = tags instanceof Set ? new Set(tags) : new Set(tags || []);
	if (oldTags.size === newTags.size) {
		let hasChanges = false;
		for (let tag of newTags) {
			if (!oldTags.has(tag)) {
				hasChanges = true;
				break;
			}
		}
		if (!hasChanges) {
			return false;
		}
	}
	this.clearCache();
	this.tags = newTags;
	return true;
}

/*
 * Returns TRUE if saved search, quicksearch or tag filter
 */
Trellis.CollectionTreeRow.prototype.isSearchMode = function () {
	switch (this.type) {
		case 'search':
		case 'publications':
		case 'trash':
		case 'unfiled':
		case 'recentlyRead':
			return true;
	}
	
	// Search filters
	if (this.advancedSearch || this.searchText != '') {
		return true;
	}
	
	// Tag filter
	if (this.tags && this.tags.size) {
		return true;
	}
}

Trellis.CollectionTreeRow.prototype.isSortable = function () {
	return !this.isFeedsOrFeed() && !this.isRecentlyRead();
}
