/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2022 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
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

This file provides a reasonably complete local implementation of the Trellis API (api.trellis.org).
Endpoints are accessible on the local server (localhost:23119 by default) under /api/.

Limitations compared to api.trellis.org:

- Only API version 3 (https://www.trellis.org/support/dev/web_api/v3/basics) is supported, and only
  one API version will ever be supported at a time. If a new API version is released and your
  client needs to maintain support for older versions, first query /api/ and read the
  Trellis-API-Version response header, then make requests conditionally.
- Write access is not yet supported.
- No authentication.
- No access to user data for users other than the local logged-in user. Use user ID 0 or the user's
  actual API user ID (https://www.trellis.org/settings/keys).
- Minimal access to metadata about groups.
- Atom is not supported.
- Item type/field endpoints (https://www.trellis.org/support/dev/web_api/v3/types_and_fields) will
  return localized names in the user's locale. The locale query parameter is not supported. The
  single exception is /api/creatorFields, which follows the web API's behavior in always returning
  results in English, *not* the user's locale.
- If your code relies on any undefined behavior or especially unusual corner cases in the web API,
  it'll probably work differently when using the local API. This implementation is primarily
  concerned with matching the web API's spec and secondarily with matching its observed behavior,
  but it does not make any attempt to replicate implementation details that your code might rely on.
  Sort orders might differ, quicksearch results will probably differ, and JSON you get from the
  local API is never going to be exactly identical to what you would get from the web API.

That said, there are benefits:

- Pagination is often unnecessary because the API doesn't mind sending you many megabytes of data
  at a time - nothing ever touches the network. For that reason, returned results are not limited
  by default (unlike in the web API, which has a default limit of 25 and will not return more than
  100 results at a time).
- For the same reason, no rate limits, and it's really fast.
- <userOrGroupPrefix>/searches/:searchKey/items returns the set of items matching a saved search
  (unlike in the web API, which doesn't support actually executing searches).

*/

const LOCAL_API_VERSION = 3;

const exportFormats = new Map([
	['bibtex', '9cb70025-a888-4a29-a210-93ec52da40d4'],
	['biblatex', 'b6e39b57-8942-4d11-8259-342c46ce395f'],
	['bookmarks', '4e7119e0-02be-4848-86ef-79a64185aad8'],
	['coins', '05d07af9-105a-4572-99f6-a8e231c0daef'],
	['csljson', 'bc03b4fe-436d-4a1f-ba59-de4d2d7a63f7'],
	['csv', '25f4c5e2-d790-4daa-a667-797619c7e2f2'],
	['mods', '0e2235e7-babf-413c-9acf-f27cce5f059c'],
	['refer', '881f60f2-0802-411a-9228-ce5f47b64c7d'],
	['rdf_bibliontology', '14763d25-8ba0-45df-8f52-b8d1108e7ac9'],
	['rdf_dc', '6e372642-ed9d-4934-b5d1-c11ac758ebb7'],
	['rdf_trellis', '14763d24-8ba0-45df-8f52-b8d1108e7ac9'],
	['ris', '32d59d2d-b65a-4da4-b0a3-bdd3cfb979e7'],
	['tei', '032ae9b7-ab90-9205-a479-baf81f49184a'],
	['wikipedia', '3f50aaac-7acc-4350-acd0-59cb77faf620'],
]);

/**
 * Base class for all local API endpoints. Implements pre- and post-processing steps.
 */
class LocalAPIEndpoint {
	async init(requestData) {
		try {
			return await this._initInternal(requestData);
		}
		catch (e) {
			if (!(e instanceof BadRequestError)) {
				throw e;
			}
			return this.makeResponse(400, 'text/plain', e.message);
		}
	}
	
	async _initInternal(requestData) {
		if (!Trellis.Prefs.get('httpServer.localAPI.enabled')) {
			return this.makeResponse(403, 'text/plain', 'Local API is not enabled');
		}
		
		requestData.headers = new Headers(requestData.headers);
		
		let apiVersion = parseInt(
			requestData.headers.get('Trellis-API-Version')
				|| requestData.searchParams.get('v')
				|| LOCAL_API_VERSION
		);
		// Only allow mismatched version on /api/ no-op endpoint
		if (apiVersion !== LOCAL_API_VERSION && requestData.pathname != '/api/') {
			return this.makeResponse(501, 'text/plain', `API version not implemented: ${apiVersion}`);
		}
		
		let userID = requestData.pathParams.userID && parseInt(requestData.pathParams.userID);
		if (userID !== undefined
				&& userID != 0
				&& userID != Trellis.Users.getCurrentUserID()) {
			let suffix = "";
			let currentUserID = Trellis.Users.getCurrentUserID();
			if (currentUserID) {
				suffix += " or " + currentUserID;
			}
			return this.makeResponse(400, 'text/plain', 'Only data for the logged-in user is available locally -- use userID 0' + suffix);
		}
		
		if (requestData.pathParams.groupID) {
			let groupID = requestData.pathParams.groupID;
			let libraryID = Trellis.Groups.getLibraryIDFromGroupID(parseInt(groupID));
			if (!libraryID) {
				return this.makeResponse(404, 'text/plain', 'Not found');
			}
			requestData.libraryID = libraryID;
		}
		else {
			requestData.libraryID = Trellis.Libraries.userLibraryID;
		}
		
		let library = Trellis.Libraries.get(requestData.libraryID);
		if (!library.getDataLoaded('item')) {
			Trellis.debug("Waiting for items to load for library " + library.libraryID);
			await library.waitForDataLoad('item');
		}
		
		let response = await this.run(requestData);
		if (response.data) {
			let dataIsArray = Array.isArray(response.data);
			if (dataIsArray && requestData.searchParams.has('since')) {
				let since = parseInt(requestData.searchParams.get('since'));
				if (Number.isNaN(since)) {
					return this.makeResponse(400, 'text/plain', `Invalid 'since' value '${requestData.searchParams.get('since')}'`);
				}
				if (since !== 0) {
					response.data = response.data.filter(dataObject => dataObject.version > since);
				}
			}
			
			if (dataIsArray && response.data.length > 1) {
				let sort = requestData.searchParams.get('sort') || 'dateModified';
				if (!['dateAdded', 'dateModified', 'title', 'creator', 'itemType', 'date', 'publisher', 'publicationTitle', 'journalAbbreviation', 'language', 'accessDate', 'libraryCatalog', 'callNumber', 'rights', 'addedBy', 'numItems']
						.includes(sort)) {
					return this.makeResponse(400, 'text/plain', `Invalid 'sort' value '${sort}'`);
				}
				if (sort == 'creator') {
					sort = 'sortCreator';
				}
				let direction;
				if (requestData.searchParams.has('direction')) {
					let directionParam = requestData.searchParams.get('direction');
					if (directionParam == 'asc') {
						direction = 1;
					}
					else if (directionParam == 'desc') {
						direction = -1;
					}
					else {
						return this.makeResponse(400, 'text/plain', `Invalid 'direction' value '${directionParam}'`);
					}
				}
				else {
					direction = sort.startsWith('date') ? -1 : 1;
				}
				response.data.sort((a, b) => {
					let aField = a[sort];
					if (!aField && a instanceof Trellis.Item) {
						aField = a.getField(sort, true, true);
					}
					let bField = b[sort];
					if (!bField && b instanceof Trellis.Item) {
						bField = b.getField(sort, true, true);
					}
					if (sort == 'date') {
						aField = Trellis.Date.multipartToSQL(aField);
						bField = Trellis.Date.multipartToSQL(bField);
					}
					return aField < bField
						? (-direction)
						: (aField > bField
							? direction
							: 0);
				});
			}
			
			let totalResults = 1;
			let links;
			if (dataIsArray) {
				totalResults = response.data.length;
				let start = parseInt(requestData.searchParams.get('start')) || 0;
				if (start < 0) start = 0;
				if (start >= response.data.length) start = response.data.length;
				let limit = parseInt(requestData.searchParams.get('limit')) || response.data.length - start;
				if (limit < 0) limit = 0;
				response.data = response.data.slice(start, start + limit);
				
				links = this.buildLinks(requestData, start, limit, totalResults);
			}
			else {
				links = this.buildLinks(requestData, 0, 0, 1);
			}
			
			let headers = {
				'Total-Results': totalResults,
				'Link': Object.entries(links).map(([rel, url]) => `<${url}>; rel="${rel}"`).join(', ')
			};
			let lastModifiedVersion = dataIsArray
				? Trellis.Libraries.get(requestData.libraryID).libraryVersion
				: response.data.version;
			if (lastModifiedVersion !== undefined) {
				headers['Last-Modified-Version'] = lastModifiedVersion;
			}
			let ifModifiedSinceVersion = requestData.headers.get('If-Modified-Since-Version');
			if (ifModifiedSinceVersion) {
				ifModifiedSinceVersion = parseInt(ifModifiedSinceVersion);
				if (ifModifiedSinceVersion !== 0 && lastModifiedVersion <= ifModifiedSinceVersion) {
					return this.makeResponse(304, headers, '');
				}
			}
			return this.makeDataObjectResponse(requestData, response.data, headers);
		}
		else {
			return this.makeResponse(...response);
		}
	}

	/**
	 * Build an object mapping link 'rel' attributes to URLs for the given request data and response info.
	 *
	 * @param {Object} requestData
	 * @param {Number} start
	 * @param {Number} limit
	 * @param {Number} totalResults
	 * @returns {Object}
	 */
	buildLinks(requestData, start, limit, totalResults) {
		let links = {};
		
		let buildURL = (searchParams) => {
			let url = new URL(requestData.pathname, 'http://' + requestData.headers.get('Host'));
			url.search = searchParams.toString();
			return url.toString();
		};

		// Logic adapted from https://github.com/trellis/dataserver/blob/18443360/model/API.inc.php#L588-L642
		// first
		if (start) {
			let p = new URLSearchParams(requestData.searchParams);
			p.delete('start');
			links.first = buildURL(p);
		}
		// prev
		if (start) {
			let p = new URLSearchParams(requestData.searchParams);
			let prevStart = start - limit;
			if (prevStart <= 0) {
				p.delete('start');
			}
			else {
				p.set('start', prevStart.toString());
			}
			links.prev = buildURL(p);
		}
		// last
		if (!start && limit >= totalResults) {
			let p = new URLSearchParams(requestData.searchParams);
			links.last = buildURL(p);
		}
		else if (limit) {
			let lastStart;
			if (start >= totalResults) {
				lastStart = totalResults - limit;
			}
			else {
				lastStart = totalResults - totalResults % limit;
				if (lastStart == totalResults) {
					lastStart = totalResults - limit;
				}
			}
			let p = new URLSearchParams(requestData.searchParams);
			if (lastStart > 0) {
				p.set('start', lastStart.toString());
			}
			else {
				p.delete('start');
			}
			links.last = buildURL(p);

			// next
			let nextStart = start + limit;
			if (nextStart < totalResults) {
				p.set('start', nextStart.toString());
				links.next = buildURL(p);
			}
		}

		// alternate: only include if logged in, cut off '/api/', replace userID 0 with current userID
		if (Trellis.Users.getCurrentUserID()) {
			links.alternate = TRELLIS_CONFIG.WWW_BASE_URL + requestData.pathname.substring(5)
				.replace('users/0/', `users/${Trellis.Users.getCurrentUserID()}/`);
		}
		
		return links;
	}

	/**
	 * @param {Object} requestData Passed to {@link init}
	 * @param {Trellis.DataObject | Trellis.DataObject[]} dataObjectOrObjects
	 * @param {Object} headers
	 * @returns {Promise} A response to be returned from {@link init}
	 */
	async makeDataObjectResponse(requestData, dataObjectOrObjects, headers) {
		let contentType;
		let body;
		switch (requestData.searchParams.get('format')) {
			case 'atom':
				return this.makeResponse(501, 'text/plain', 'Local API does not support Atom output');
			case 'bib':
				contentType = 'text/html';
				body = await citeprocToHTML(dataObjectOrObjects, requestData.searchParams, false);
				break;
			case 'keys':
				if (!Array.isArray(dataObjectOrObjects)) {
					return this.makeResponse(400, 'text/plain', 'Only multi-object requests can output keys');
				}
				contentType = 'text/plain';
				body = dataObjectOrObjects.map(o => o.key).join('\n');
				break;
			case 'versions':
				if (!Array.isArray(dataObjectOrObjects)) {
					return this.makeResponse(400, 'text/plain', 'Only multi-object requests can output versions');
				}
				contentType = 'application/json';
				body = JSON.stringify(Object.fromEntries(dataObjectOrObjects.map(o => [o.key, o.version])), null, 4);
				break;
			case 'json':
			case null:
				contentType = 'application/json';
				body = JSON.stringify(await toResponseJSON(dataObjectOrObjects, requestData.searchParams), null, 4);
				break;
			default:
				if (exportFormats.has(requestData.searchParams.get('format'))) {
					contentType = 'text/plain';
					body = await exportItems(dataObjectOrObjects, exportFormats.get(requestData.searchParams.get('format')));
				}
				else {
					return this.makeResponse(400, 'text/plain', `Invalid 'format' value '${requestData.searchParams.get('format')}'`);
				}
		}
		return this.makeResponse(200, { ...headers, 'Content-Type': contentType }, body);
	}

	/**
	 * Make an HTTP response array with API headers.
	 *
	 * @param {Number} status
	 * @param {String | Object} contentTypeOrHeaders
	 * @param {String} body
	 * @returns {[Number, Object, String]}
	 */
	makeResponse(status, contentTypeOrHeaders, body) {
		if (typeof contentTypeOrHeaders == 'string') {
			contentTypeOrHeaders = {
				'Content-Type': contentTypeOrHeaders
			};
		}
		contentTypeOrHeaders['Trellis-API-Version'] = LOCAL_API_VERSION;
		contentTypeOrHeaders['Trellis-Schema-Version'] = Trellis.Schema.globalSchemaVersion;
		return [status, contentTypeOrHeaders, body];
	}

	/**
	 * Subclasses must implement this method to process requests.
	 *
	 * @param {Object} requestData
	 * @return {Promise<{ data }> | { data } | [Number, (String | Object), String]}
	 * 		An object with a 'data' property containing a {@link Trellis.DataObject} or an array of DataObjects,
	 * 		or an HTTP response array (status code, Content-Type or headers, body).
	 */
	// eslint-disable-next-line no-unused-vars
	run(requestData) {
		throw new Error("run() must be implemented");
	}
}

const _404 = [404, 'text/plain', 'Not found'];

Trellis.Server.LocalAPI = {};

Trellis.Server.LocalAPI.Root = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run(_) {
		return [200, 'text/plain', 'Nothing to see here.'];
	}
};
Trellis.Server.Endpoints["/api/"] = Trellis.Server.LocalAPI.Root;


Trellis.Server.LocalAPI.Schema = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run(_) {
		return [200, 'application/json', await Trellis.File.getContentsFromURLAsync('resource://trellis/schema/global/schema.json')];
	}
};
Trellis.Server.Endpoints["/api/schema"] = Trellis.Server.LocalAPI.Schema;

Trellis.Server.LocalAPI.ItemTypes = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run(_) {
		let itemTypes = Trellis.ItemTypes.getAll().map((type) => {
			return {
				itemType: type.name,
				localized: Trellis.ItemTypes.getLocalizedString(type.name)
			};
		});
		return [200, 'application/json', JSON.stringify(itemTypes, null, 4)];
	}
};
Trellis.Server.Endpoints["/api/itemTypes"] = Trellis.Server.LocalAPI.ItemTypes;

Trellis.Server.LocalAPI.ItemFields = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run(_) {
		let itemFields = Trellis.ItemFields.getAll().map((field) => {
			return {
				field: field.name,
				localized: Trellis.ItemFields.getLocalizedString(field.name)
			};
		});
		return [200, 'application/json', JSON.stringify(itemFields, null, 4)];
	}
};
Trellis.Server.Endpoints["/api/itemFields"] = Trellis.Server.LocalAPI.ItemFields;

Trellis.Server.LocalAPI.ItemTypeFields = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run({ searchParams }) {
		let itemType = searchParams.get('itemType');
		if (!itemType || !Trellis.ItemTypes.getID(itemType)) {
			return [400, 'text/plain', "Invalid or missing 'itemType' value"];
		}
		let itemFields = Trellis.ItemFields.getItemTypeFields(Trellis.ItemTypes.getID(itemType))
			.map((fieldID) => {
				return {
					field: Trellis.ItemFields.getName(fieldID),
					localized: Trellis.ItemFields.getLocalizedString(fieldID)
				};
			});
		return [200, 'application/json', JSON.stringify(itemFields, null, 4)];
	}
};
Trellis.Server.Endpoints["/api/itemTypeFields"] = Trellis.Server.LocalAPI.ItemTypeFields;

Trellis.Server.LocalAPI.ItemTypeCreatorTypes = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run({ searchParams }) {
		let itemType = searchParams.get('itemType');
		if (!itemType || !Trellis.ItemTypes.getID(itemType)) {
			return [400, 'text/plain', "Invalid or missing 'itemType' value"];
		}
		let creatorTypes = Trellis.CreatorTypes.getTypesForItemType(Trellis.ItemTypes.getID(itemType))
			.map((creatorType) => {
				return {
					creatorType: creatorType.name,
					localized: creatorType.localizedName
				};
			});
		return [200, 'application/json', JSON.stringify(creatorTypes, null, 4)];
	}
};
Trellis.Server.Endpoints["/api/itemTypeCreatorTypes"] = Trellis.Server.LocalAPI.ItemTypeCreatorTypes;

Trellis.Server.LocalAPI.CreatorFields = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run(_) {
		let creatorFields = [
			{ field: 'firstName', localized: 'First' },
			{ field: 'lastName', localized: 'Last' },
			{ field: 'name', localized: 'Name' }
		];
		return [200, 'application/json', JSON.stringify(creatorFields, null, 4)];
	}
};
Trellis.Server.Endpoints["/api/creatorFields"] = Trellis.Server.LocalAPI.CreatorFields;


Trellis.Server.LocalAPI.Settings = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run(_) {
		return [200, 'application/json', '{}'];
	}
};
Trellis.Server.Endpoints["/api/users/:userID/settings"] = Trellis.Server.LocalAPI.Settings;


Trellis.Server.LocalAPI.Collections = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];
	
	run({ pathname, pathParams, libraryID }) {
		let top = pathname.endsWith('/top');
		let collections = pathParams.collectionKey
			? Trellis.Collections.getByParent(Trellis.Collections.getIDFromLibraryAndKey(libraryID, pathParams.collectionKey))
			: Trellis.Collections.getByLibrary(libraryID, !top);
		return { data: collections };
	}
};
Trellis.Server.Endpoints["/api/users/:userID/collections"] = Trellis.Server.LocalAPI.Collections;
Trellis.Server.Endpoints["/api/groups/:groupID/collections"] = Trellis.Server.LocalAPI.Collections;
Trellis.Server.Endpoints["/api/users/:userID/collections/top"] = Trellis.Server.LocalAPI.Collections;
Trellis.Server.Endpoints["/api/groups/:groupID/collections/top"] = Trellis.Server.LocalAPI.Collections;
Trellis.Server.Endpoints["/api/users/:userID/collections/:collectionKey/collections"] = Trellis.Server.LocalAPI.Collections;
Trellis.Server.Endpoints["/api/groups/:groupID/collections/:collectionKey/collections"] = Trellis.Server.LocalAPI.Collections;

Trellis.Server.LocalAPI.Collection = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run({ pathParams, libraryID }) {
		let collection = Trellis.Collections.getByLibraryAndKey(libraryID, pathParams.collectionKey);
		if (!collection) return _404;
		return { data: collection };
	}
};
Trellis.Server.Endpoints["/api/users/:userID/collections/:collectionKey"] = Trellis.Server.LocalAPI.Collection;
Trellis.Server.Endpoints["/api/groups/:groupID/collections/:collectionKey"] = Trellis.Server.LocalAPI.Collection;


Trellis.Server.LocalAPI.Groups = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run(_) {
		let groups = Trellis.Groups.getAll();
		return { data: groups };
	}
};
Trellis.Server.Endpoints["/api/users/:userID/groups"] = Trellis.Server.LocalAPI.Groups;

Trellis.Server.LocalAPI.Group = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	run({ pathParams }) {
		let group = Trellis.Groups.get(pathParams.groupID);
		if (!group) return _404;
		return { data: group };
	}
};
Trellis.Server.Endpoints["/api/groups/:groupID"] = Trellis.Server.LocalAPI.Group;
Trellis.Server.Endpoints["/api/users/:userID/groups/:groupID"] = Trellis.Server.LocalAPI.Group;


Trellis.Server.LocalAPI.Items = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ pathname, pathParams, searchParams, libraryID }) {
		let isTags = pathname.endsWith('/tags');
		if (isTags) {
			// Cut it off so other .endsWith() checks work
			pathname = pathname.slice(0, -5);
		}
		let isTop = pathname.endsWith('/top');
		if (isTop) {
			pathname = pathname.slice(0, -4);
		}

		let search = new Trellis.Search();
		search.libraryID = libraryID;
		
		if (isTop) {
			search.addCondition('noChildren', 'true');
		}
		else {
			search.addCondition('includeChildren', 'true');
		}
		
		if (pathParams.collectionKey) {
			search.addCondition('itemType', 'isNot', 'annotation');
			search.addCondition('collectionID', 'is',
				Trellis.Collections.getIDFromLibraryAndKey(libraryID, pathParams.collectionKey));
		}
		else if (pathParams.itemKey) {
			// We'll filter out the parent later
			search.addCondition('key', 'is', pathParams.itemKey);
		}
		else if (pathname.endsWith('/trash')) {
			search.addCondition('deleted', 'true');
		}
		else if (pathname.endsWith('/publications/items')) {
			search.addCondition('publications', 'true');
		}

		if (searchParams.get('includeTrashed') == '1' && !pathname.endsWith('/trash')) {
			search.addCondition('includeDeleted', 'true');
		}
		
		let savedSearch;
		if (pathParams.searchKey) {
			savedSearch = Trellis.Searches.getByLibraryAndKey(libraryID, pathParams.searchKey);
			if (!savedSearch) return _404;
			search.setScope(savedSearch, true);
		}
		
		if (searchParams.has('itemKey')) {
			let scope = new Trellis.Search();
			if (savedSearch) {
				scope.setScope(savedSearch, true);
			}
			scope.libraryID = libraryID;
			scope.addCondition('joinMode', 'any');
			let keys = new Set(searchParams.get('itemKey').split(','));
			for (let key of keys) {
				scope.addCondition('key', 'is', key);
			}
			search.setScope(scope, true);
		}

		let q = searchParams.get(isTags ? 'itemQ' : 'q');
		let qMode = searchParams.get(isTags ? 'itemQMode' : 'qmode');
		if (q) {
			search.addCondition('libraryID', 'is', libraryID);
			search.addCondition('quicksearch-' + (qMode || 'titleCreatorYear'), 'contains', q);
		}

		// Add conditions that use the API search syntax
		search = buildSearchFromSearchSyntax(
			search,
			searchParams.getAll('itemType'),
			'itemType'
		);
		search = buildSearchFromSearchSyntax(
			search,
			searchParams.getAll(isTags ? 'itemTag' : 'tag'),
			'tag'
		);

		Trellis.debug('Executing local API search');
		Trellis.debug(searchToDebugJSON(search));
		// Searches sometimes return duplicate IDs; de-duplicate first
		// TODO: Fix in search.js
		let uniqueResultIDs = [...new Set(await search.search())];
		let items = await Trellis.Items.getAsync(uniqueResultIDs);
		
		if (pathParams.itemKey) {
			// Filter out the parent, as promised
			items = items.filter(item => item.key != pathParams.itemKey);
		}

		if (isTags) {
			let tmpTable = await Trellis.Search.idsToTempTable(items.map(item => item.id));
			try {
				let tags = await Trellis.Tags.getAllWithin({ tmpTable });
				
				let tagQ = searchParams.get('q');
				if (tagQ) {
					let pred = searchParams.get('qmode') == 'startsWith'
						? (tag => tag.tag.startsWith(tagQ))
						: (tag => tag.tag.includes(tagQ));
					tags = tags.filter(pred);
				}
				
				// getAllWithin() calls cleanData(), which discards type fields when they are 0
				// But we always want them, so add them back if necessary
				let json = await Trellis.Tags.toResponseJSON(libraryID,
					tags.map(tag => ({ ...tag, type: tag.type || 0 })));
				return { data: json };
			}
			finally {
				await Trellis.DB.queryAsync("DROP TABLE IF EXISTS " + tmpTable, [], { noCache: true });
			}
		}
		
		return { data: items };
	}
};

// Add basic library-wide item endpoints
for (let trashPart of ['', '/trash']) {
	for (let topPart of ['', '/top']) {
		for (let tagsPart of ['', '/tags']) {
			for (let userGroupPart of ['/api/users/:userID', '/api/groups/:groupID']) {
				let path = userGroupPart + '/items' + trashPart + topPart + tagsPart;
				Trellis.Server.Endpoints[path] = Trellis.Server.LocalAPI.Items;
			}
		}
	}
}

// Add collection-scoped item endpoints
for (let topPart of ['', '/top']) {
	for (let tagsPart of ['', '/tags']) {
		for (let userGroupPart of ['/api/users/:userID', '/api/groups/:groupID']) {
			let path = userGroupPart + '/collections/:collectionKey/items' + topPart + tagsPart;
			Trellis.Server.Endpoints[path] = Trellis.Server.LocalAPI.Items;
		}
	}
}

// Add the rest manually
Trellis.Server.Endpoints["/api/users/:userID/items/:itemKey/children"] = Trellis.Server.LocalAPI.Items;
Trellis.Server.Endpoints["/api/groups/:groupID/items/:itemKey/children"] = Trellis.Server.LocalAPI.Items;
Trellis.Server.Endpoints["/api/users/:userID/publications/items"] = Trellis.Server.LocalAPI.Items;
Trellis.Server.Endpoints["/api/users/:userID/publications/items/top"] = Trellis.Server.LocalAPI.Items;
Trellis.Server.Endpoints["/api/users/:userID/publications/items/tags"] = Trellis.Server.LocalAPI.Items;
Trellis.Server.Endpoints["/api/users/:userID/searches/:searchKey/items"] = Trellis.Server.LocalAPI.Items;
Trellis.Server.Endpoints["/api/groups/:groupID/searches/:searchKey/items"] = Trellis.Server.LocalAPI.Items;

Trellis.Server.LocalAPI.Item = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ pathParams, libraryID }) {
		let item = await Trellis.Items.getByLibraryAndKeyAsync(libraryID, pathParams.itemKey);
		if (!item) return _404;
		return { data: item };
	}
};
Trellis.Server.Endpoints["/api/users/:userID/items/:itemKey"] = Trellis.Server.LocalAPI.Item;
Trellis.Server.Endpoints["/api/groups/:groupID/items/:itemKey"] = Trellis.Server.LocalAPI.Item;


Trellis.Server.LocalAPI.ItemFile = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ pathname, pathParams, libraryID }) {
		let item = await Trellis.Items.getByLibraryAndKeyAsync(libraryID, pathParams.itemKey);
		if (!item) return _404;
		if (!item.isFileAttachment()) {
			return [400, 'text/plain', `Not a file attachment: ${item.key}`];
		}
		if (pathname.endsWith('/url')) {
			return [200, 'text/plain', item.getLocalFileURL()];
		}
		return [302, { 'Location': item.getLocalFileURL() }, ''];
	}
};
Trellis.Server.Endpoints["/api/users/:userID/items/:itemKey/file"] = Trellis.Server.LocalAPI.ItemFile;
Trellis.Server.Endpoints["/api/groups/:groupID/items/:itemKey/file"] = Trellis.Server.LocalAPI.ItemFile;
Trellis.Server.Endpoints["/api/users/:userID/items/:itemKey/file/view"] = Trellis.Server.LocalAPI.ItemFile;
Trellis.Server.Endpoints["/api/groups/:groupID/items/:itemKey/file/view"] = Trellis.Server.LocalAPI.ItemFile;
Trellis.Server.Endpoints["/api/users/:userID/items/:itemKey/file/view/url"] = Trellis.Server.LocalAPI.ItemFile;
Trellis.Server.Endpoints["/api/groups/:groupID/items/:itemKey/file/view/url"] = Trellis.Server.LocalAPI.ItemFile;


Trellis.Server.LocalAPI.ItemFullText = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ pathParams, libraryID }) {
		let item = await Trellis.Items.getByLibraryAndKeyAsync(libraryID, pathParams.itemKey);
		if (!item || !item.isFileAttachment() || !Trellis.Fulltext.isCachedMIMEType(item.attachmentContentType)) {
			return _404;
		}
		let file = Trellis.Fulltext.getItemCacheFile(item);
		if (!file.exists()) {
			return _404;
		}
		let { indexedPages, totalPages, indexedChars, totalChars, version } = await Trellis.DB.rowQueryAsync(
			"SELECT indexedPages, totalPages, indexedChars, totalChars, version FROM fulltextItems WHERE itemID=?",
			item.id
		);
		return [
			200,
			{
				'Content-Type': 'application/json',
				'Last-Modified-Version': version,
			},
			JSON.stringify(
				{
					content: await Trellis.File.getContentsAsync(file),
					indexedPages: indexedPages ?? undefined,
					totalPages: totalPages ?? undefined,
					indexedChars: indexedChars ?? undefined,
					totalChars: totalChars ?? undefined,
				},
				null,
				4
			)
		];
	}
};
Trellis.Server.Endpoints["/api/users/:userID/items/:itemKey/fulltext"] = Trellis.Server.LocalAPI.ItemFullText;
Trellis.Server.Endpoints["/api/groups/:groupID/items/:itemKey/fulltext"] = Trellis.Server.LocalAPI.ItemFullText;


Trellis.Server.LocalAPI.FullText = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ searchParams, libraryID }) {
		let since = parseInt(searchParams.get('since'));
		if (Number.isNaN(since)) {
			return [400, 'text/plain', `Invalid 'since' value '${searchParams.get('since')}'`];
		}
		let rows = await Trellis.DB.queryAsync(
			"SELECT I.key, FI.version "
				+ "FROM fulltextItems FI JOIN items I USING (itemID) "
				+ "WHERE libraryID=?1 AND (?2=0 OR FI.version>?2)",
			[libraryID, since]
		);
		let obj = {};
		for (let row of rows) {
			obj[row.key] = row.version;
		}
		return [200, 'application/json', JSON.stringify(obj, null, 4)];
	}
};
Trellis.Server.Endpoints["/api/users/:userID/fulltext"] = Trellis.Server.LocalAPI.FullText;
Trellis.Server.Endpoints["/api/groups/:groupID/fulltext"] = Trellis.Server.LocalAPI.FullText;


Trellis.Server.LocalAPI.Searches = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ libraryID }) {
		let searches = await Trellis.Searches.getAll(libraryID);
		return { data: searches };
	}
};
Trellis.Server.Endpoints["/api/users/:userID/searches"] = Trellis.Server.LocalAPI.Searches;
Trellis.Server.Endpoints["/api/groups/:groupID/searches"] = Trellis.Server.LocalAPI.Searches;

Trellis.Server.LocalAPI.Search = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ pathParams, libraryID }) {
		let search = Trellis.Searches.getByLibraryAndKey(libraryID, pathParams.searchKey);
		if (!search) return _404;
		return { data: search };
	}
};
Trellis.Server.Endpoints["/api/users/:userID/searches/:searchKey"] = Trellis.Server.LocalAPI.Search;
Trellis.Server.Endpoints["/api/groups/:groupID/searches/:searchKey"] = Trellis.Server.LocalAPI.Search;


Trellis.Server.LocalAPI.Tags = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ libraryID }) {
		let tags = await Trellis.Tags.getAll(libraryID);
		let json = await Trellis.Tags.toResponseJSON(libraryID, tags);
		return { data: json };
	}
};
Trellis.Server.Endpoints["/api/users/:userID/tags"] = Trellis.Server.LocalAPI.Tags;
Trellis.Server.Endpoints["/api/groups/:groupID/tags"] = Trellis.Server.LocalAPI.Tags;

Trellis.Server.LocalAPI.Tag = class extends LocalAPIEndpoint {
	supportedMethods = ['GET'];

	async run({ pathParams, libraryID }) {
		let tag = decodeURIComponent(pathParams.tag.replaceAll('+', '%20'));
		let json = await Trellis.Tags.toResponseJSON(libraryID, [{ tag }]);
		if (!json) return _404;
		return { data: json };
	}
};
Trellis.Server.Endpoints["/api/users/:userID/tags/:tag"] = Trellis.Server.LocalAPI.Tag;
Trellis.Server.Endpoints["/api/groups/:groupID/tags/:tag"] = Trellis.Server.LocalAPI.Tag;


/**
 * Convert a {@link Trellis.DataObject}, or an array of DataObjects, to response JSON
 * 		with appropriate included data based on the 'include' query parameter.
 *
 * @param {Trellis.DataObject | Trellis.DataObject[]} dataObjectOrObjects
 * @param {URLSearchParams} searchParams
 * @returns {Promise<Object>}
 */
async function toResponseJSON(dataObjectOrObjects, searchParams) {
	if (Array.isArray(dataObjectOrObjects)) {
		return Promise.all(dataObjectOrObjects.map(o => toResponseJSON(o, searchParams)));
	}
	
	// Ask the data object for its response JSON representation, updating URLs to point to localhost
	let dataObject = dataObjectOrObjects;
	let responseJSON = dataObject.toResponseJSONAsync
		? await dataObject.toResponseJSONAsync({
			apiURL: `http://localhost:${Trellis.Server.port}/api/`,
			includeGroupDetails: true
		})
		: dataObject;
	
	// Add includes and remove 'data' if not requested
	let include = searchParams.has('include') ? searchParams.get('include') : 'data';
	let dataIncluded = false;
	for (let includeFormat of include.split(',')) {
		switch (includeFormat) {
			case 'bib':
				responseJSON.bib = await citeprocToHTML(dataObject, searchParams, false);
				break;
			case 'citation':
				responseJSON.citation = await citeprocToHTML(dataObject, searchParams, true);
				break;
			case 'data':
				dataIncluded = true;
				break;
			default:
				if (exportFormats.has(includeFormat)) {
					responseJSON[includeFormat] = await exportItems([dataObject], exportFormats.get(includeFormat));
				}
				else {
					// Ignore since we don't have a great way to propagate the error up
				}
		}
	}
	if (!dataIncluded) {
		delete responseJSON.data;
	}
	return responseJSON;
}

/**
 * Use citeproc to output HTML for an item or items.
 *
 * @param {Trellis.Item | Trellis.Item[]} itemOrItems
 * @param {URLSearchParams} searchParams
 * @param {Boolean} asCitationList
 * @returns {Promise<String>}
 */
async function citeprocToHTML(itemOrItems, searchParams, asCitationList) {
	let items = Array.isArray(itemOrItems)
		? itemOrItems
		: [itemOrItems];
	
	// Filter out attachments, annotations, and notes, which we can't generate citations for
	items = items.filter(item => item.isRegularItem());
	let styleIDOrURL = searchParams.get('style') || 'chicago-shortened-notes-bibliography';
	let locale = searchParams.get('locale') || 'en-US';
	let linkWrap = searchParams.get('linkwrap') == '1';
	
	let style = Trellis.Styles.get(styleIDOrURL);
	// If not a URI, try with standard prefix
	if (!style && !styleIDOrURL.includes(':')) {
		style = Trellis.Styles.get('http://www.trellis.org/styles/' + styleIDOrURL);
	}
	if (!style) {
		// The client wants a style we don't have locally, so download it
		// If they didn't pass an absolute URL, resolve relative to the style repo base
		try {
			let styleURL = new URL(styleIDOrURL, 'https://www.trellis.org/styles/');
			if (styleURL.protocol === 'http:' && styleURL.host === 'www.trellis.org') {
				styleURL.protocol = 'https:';
			}
			styleURL = styleURL.toString();
			let { styleID } = await Trellis.Styles.install({ url: styleURL }, styleURL, true);
			style = Trellis.Styles.get(styleID);
		}
		catch (e) {
			throw new BadRequestError(`Invalid style: ${styleIDOrURL} (${e.message})`);
		}
	}
	if (!style) {
		throw new Error(`Unable to install style: ${styleIDOrURL}`);
	}
	
	let cslEngine = style.getCiteProc(locale, 'html', { cache: true });
	cslEngine.opt.development_extensions.wrap_url_and_doi = linkWrap;
	return Trellis.Cite.makeFormattedBibliographyOrCitationList(cslEngine, items, 'html', asCitationList);
}

/**
 * Export items to a string with the given translator.
 *
 * @param {Trellis.Item|Trellis.Item[]} itemOrItems
 * @param {String} translatorID
 * @returns {Promise<String>}
 */
function exportItems(itemOrItems, translatorID) {
	let items = Array.isArray(itemOrItems)
		? itemOrItems
		: [itemOrItems];
	// Filter out annotations, which we can't export
	items = items.filter(item => !item.isAnnotation());
	return new Promise((resolve, reject) => {
		let translation = new Trellis.Translate.Export();
		translation.setItems(items.slice());
		translation.setTranslator(translatorID);
		translation.setHandler('done', () => {
			resolve(translation.string);
		});
		translation.setHandler('error', (_, error) => {
			reject(error);
		});
		translation.translate();
	});
}

/**
 * Evaluate the API's search syntax: https://www.trellis.org/support/dev/web_api/v3/basics#search_syntax
 *
 * @param {Trellis.Search} parentSearch
 * @param {String[]} searchStrings The search strings provided by the client as query parameters
 * @param {String} condition The search condition name
 */
function buildSearchFromSearchSyntax(parentSearch, searchStrings, condition) {
	for (let searchString of searchStrings) {
		let negate = false;
		if (searchString[0] == '-') {
			negate = true;
			searchString = searchString.substring(1);
		}
		if (searchString[0] == '\\' && searchString[1] == '-') {
			searchString = searchString.substring(1);
		}
		
		let childSearch = new Trellis.Search();
		childSearch.libraryID = parentSearch.libraryID;
		childSearch.setScope(parentSearch, true);
		childSearch.addCondition('joinMode', 'any');
		
		let ors = searchString.split('||').map(or => or.trim());
		for (let or of ors) {
			childSearch.addCondition(condition, negate ? 'isNot' : 'is', or);
		}
		
		parentSearch = childSearch;
	}
	return parentSearch;
}

function searchToDebugJSON(search) {
	return {
		conditions: Object.values(search.conditions).map(condition => ({
			condition: condition.condition,
			operator: condition.operator,
			value: condition.value
		})),
		libraryID: search.libraryID,
		scope: search.scope ? searchToDebugJSON(search.scope) : undefined
	};
}

class BadRequestError extends Error {}
