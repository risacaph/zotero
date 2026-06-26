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

Trellis.API = {
	parseParams: function (params) {
		if (params.groupID) {
			params.libraryID = Trellis.Groups.getLibraryIDFromGroupID(params.groupID);
		}
		
		if (typeof params.itemKey == 'string') {
			params.itemKey = params.itemKey.split(',');
		}
	},
	
	
	/**
	 * @return {(Trellis.Collection|Trellis.Search|Trellis.Item)[]}
	 */
	getResultsFromParams: async function (params) {
		if (!params.objectType) {
			throw new Error("objectType not specified");
		}
		
		var results;
		
		if (params.objectType == 'collection') {
			let col = Trellis.Collections.getByLibraryAndKey(params.libraryID, params.objectKey);
			if (col) {
				results = [col];
			}
		}
		else if (params.objectType == 'search') {
			let s = Trellis.Searches.getByLibraryAndKey(params.libraryID, params.objectKey);
			if (s) {
				results = [s];
			}
		}
		else if (params.objectType == 'item') {
			switch (params.scopeObject) {
				case 'collections':
					if (params.scopeObjectKey) {
						var col = Trellis.Collections.getByLibraryAndKey(
							params.libraryID, params.scopeObjectKey
						);
					}
					else {
						var col = Trellis.Collections.get(params.scopeObjectID);
					}
					if (!col) {
						throw new Error('Invalid collection ID or key');
					}
					results = col.getChildItems();
					if (params.objectKey) {
						let item = results.find(item => item.key == params.objectKey);
						results = item ? [item] : [];
					}
					break;
				
				case 'searches':
					if (params.scopeObjectKey) {
						var s = Trellis.Searches.getByLibraryAndKey(
							params.libraryID, params.scopeObjectKey
						);
					}
					else {
						var s = Trellis.Searches.get(params.scopeObjectID);
					}
					if (!s) {
						throw new Error('Invalid search ID or key');
					}
					
					var s2 = new Trellis.Search();
					s2.setScope(s);
					var ids = await s2.search();
					if (params.objectKey) {
						let id = Trellis.Items.getIDFromLibraryAndKey(s.libraryID, params.objectKey);
						ids = ids.includes(id) ? [id] : [];
					}
					break;
				
				default:
					if (params.scopeObject) {
						throw new Error("Invalid scope object '" + params.scopeObject + "'");
					}
					
					var s = new Trellis.Search;
					s.libraryID = params.libraryID;
					
					if (params.objectKey) {
						s.addCondition('key', 'is', params.objectKey);
					}
					else if (params.objectID) {
						s.addCondition('itemID', 'is', params.objectID);
					}
					// For performance reasons, add requested item keys instead of filtering after.
					// This will need to be changed if other conditions are added to the search.
					else if (params.itemKey) {
						s.addCondition('joinMode', 'any');
						for (let key of params.itemKey) {
							s.addCondition('key', 'is', key);
						}
					}
					
					// Display all top-level items
					/*if (params.onlyTopLevel) {
						s.addCondition('noChildren', 'true');
					}*/
					
					var ids = await s.search();
			}
			
			let itemKeys = new Set(params.itemKey || []);
			if (results) {
				// Filter results by item key
				if (params.itemKey) {
					results = results.filter(item => itemKeys.has(item.key));
				}
			}
			else if (ids) {
				// Filter results by item key
				if (params.itemKey) {
					ids = ids.filter((id) => {
						var {libraryID, key} = Trellis.Items.getLibraryAndKeyFromID(id);
						return itemKeys.has(key);
					});
				}
				results = await Trellis.Items.getAsync(ids);
			}
		}
		else {
			throw new Error("Unsupported object type '" + params.objectType + "'");
		}
		
		return results;
	},
	
	
	getLibraryPrefix: function (libraryID) {
		var type = Trellis.Libraries.get(libraryID).libraryType;
		switch (type) {
		case 'user':
			return 'library';
		
		case 'publications':
			return 'publications';
		
		case 'group':
			return 'groups/' + Trellis.Groups.getGroupIDFromLibraryID(libraryID);
		
		default:
			throw new Error(`Invalid type '${type}'`);
		}
	}
};

Trellis.API.Data = {
	/**
	 * Parse a relative URI path and return parameters for the request
	 */
	parsePath: function (path) {
		var userLibraryID = Trellis.Libraries.userLibraryID;
		var params = {};
		var router = new Trellis.Router(params);
		
		// Top-level objects
		router.add('library/:controller/top', function () {
			params.libraryID = userLibraryID;
			params.subset = 'top';
		});
		router.add('groups/:groupID/:controller/top', function () {
			params.subset = 'top';
		});
		
		router.add('library/:scopeObject/:scopeObjectKey/items/:objectKey/:subset', function () {
			params.libraryID = userLibraryID;
			params.controller = 'items';
		});
		router.add('groups/:groupID/:scopeObject/:scopeObjectKey/items/:objectKey/:subset', function () {
			params.controller = 'items';
		});
		
		// All objects
		router.add('library/:controller', function () {
			params.libraryID = userLibraryID;
		});
		router.add('groups/:groupID/:controller', function () {});
		
		var parsed = router.run(path);
		if (!parsed || !params.controller) {
			throw new Trellis.Router.InvalidPathException(path);
		}
		
		if (params.groupID) {
			params.libraryID = Trellis.Groups.getLibraryIDFromGroupID(params.groupID);
		}
		Trellis.Router.Utilities.convertControllerToObjectType(params);
		
		return params;
	},
	
	
	getGenerator: function (path) {
		var params = this.parsePath(path);
		//Trellis.debug(params);
		
		return Trellis.DataObjectUtilities.getObjectsClassForObjectType(params.objectType)
			.apiDataGenerator(params);
	}
};




