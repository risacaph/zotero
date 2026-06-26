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

const TRELLIS_AC_CLASS_ID = Components.ID('{06a2ed11-d0a4-4ff0-a56f-a44545eee6ea}');
const TRELLIS_AC_CONTRACT_ID = "@mozilla.org/autocomplete/search;1?name=trellis";

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

import { Trellis } from "chrome://trellis/content/trellis.mjs";

/*
 * Implements nsIAutoCompleteSearch
 */
export function TrellisAutoComplete() {}

TrellisAutoComplete.prototype.startSearch = async function (searchString, searchParams, previousResult, listener) {
	// FIXME
	//this.stopSearch();
	
	var result = Cc["@mozilla.org/autocomplete/simple-result;1"]
					.createInstance(Ci.nsIAutoCompleteSimpleResult);
	result.setSearchString(searchString);
	
	this._result = result;
	this._results = [];
	this._listener = listener;
	this._cancelled = false;
	
	Trellis.debug("Starting autocomplete search with data '"
		+ searchParams + "'" + " and string '" + searchString + "'");
	
	searchParams = JSON.parse(searchParams);
	if (!searchParams) {
		throw new Error("Invalid JSON passed to autocomplete");
	}
	var [fieldName, , subField] = searchParams.fieldName.split("-");

	// Library scope: accept a single libraryID (e.g. the item pane and tags box) or an
	// array of libraryIDs (advanced search across a multi-library selection). An empty
	// array means no library filter (suggest values from all libraries).
	var libraryIDs = searchParams.libraryIDs
		|| (searchParams.libraryID ? [searchParams.libraryID] : []);
	// Bare '?' placeholder list, e.g. "?, ?, ?", for sites that push params sequentially
	var libraryPlaceholders = libraryIDs.map(() => '?').join(', ');

	var resultsCallback;
	
	switch (fieldName) {
		case '':
			break;
		
		case 'tag':
			var sql = "SELECT DISTINCT name AS val, NULL AS id FROM tags WHERE name LIKE ? ESCAPE '\\'";
			var sqlParams = [Trellis.DB.escapeSQLExpression(searchString) + '%'];
			if (libraryIDs.length) {
				sql += " AND tagID IN (SELECT tagID FROM itemTags JOIN items USING (itemID) "
					+ `WHERE libraryID IN (${libraryPlaceholders}))`;
				sqlParams.push(...libraryIDs);
			}
			if (searchParams.itemID) {
				sql += " AND name NOT IN (SELECT name FROM tags WHERE tagID IN ("
					+ "SELECT tagID FROM itemTags WHERE itemID = ?))";
				sqlParams.push(searchParams.itemID);
			}
			sql += " ORDER BY val COLLATE locale";
			break;
		
		case 'creator':
		case 'author':
		case 'bookAuthor':
		case 'editor':
			// Valid fieldMode values:
			// 		0 == search two-field creators
			// 		1 == search single-field creators
			// 		2 == search both
			if (searchParams.fieldMode == 2) {
				var sql = "SELECT DISTINCT CASE fieldMode WHEN 1 THEN lastName "
					+ "WHEN 0 THEN firstName || ' ' || lastName END AS val, NULL AS id "
					+ "FROM creators ";
				if (fieldName != 'creator' || libraryIDs.length) {
					sql += "JOIN itemCreators USING (creatorID) ";
				}
				if (libraryIDs.length) {
					sql += "JOIN items USING (itemID) ";
				}
				sql += "WHERE CASE fieldMode "
					+ "WHEN 1 THEN lastName LIKE ?1 "
					+ "WHEN 0 THEN (firstName || ' ' || lastName LIKE ?1) OR (lastName LIKE ?1) END ";
				var sqlParams = [searchString + '%'];
				// Limit results to specific creator type
				if (fieldName != 'creator') {
					sql += "AND creatorTypeID=? ";
					sqlParams.push(Trellis.CreatorTypes.getID(fieldName));
				}
				if (libraryIDs.length) {
					sql += ` AND libraryID IN (${libraryPlaceholders}) `;
					sqlParams.push(...libraryIDs);
				}
				sql += "ORDER BY val";
			}
			else
			{
				var sql = "SELECT DISTINCT ";
				if (searchParams.fieldMode == 1) {
					sql += "lastName AS val, creatorID || '-1' AS id";
				}
				// Retrieve the matches in the specified field
				// as well as any full names using the name
				//
				// e.g. "Shakespeare" and "Shakespeare, William"
				//
				// creatorID is in the format "12345-1" or "12345-2",
				// 		- 1 means the row uses only the specified field
				// 		- 2 means it uses both
				else {
					sql += "CASE WHEN firstName='' OR firstName IS NULL THEN lastName "
						+ "ELSE lastName || ', ' || firstName END AS val, "
						+ "creatorID || '-' || CASE "
						+ "WHEN (firstName = '' OR firstName IS NULL) THEN 1 "
						+ "ELSE 2 END AS id";
				}
				
				var fromSQL = " FROM creators "
				if (libraryIDs.length) {
					fromSQL += "JOIN itemCreators USING (creatorID) JOIN items USING (itemID) ";
				}
				fromSQL += "WHERE " + subField + " LIKE ?1 AND fieldMode=?2";
				var sqlParams = [
					searchString + '%',
					searchParams.fieldMode ? searchParams.fieldMode : 0
				];
				if (searchParams.itemID) {
					fromSQL += " AND creatorID NOT IN (SELECT creatorID FROM "
						+ `itemCreators WHERE itemID=?${sqlParams.length + 1}`;
					sqlParams.push(searchParams.itemID);
					if (searchParams.creatorTypeID) {
						fromSQL += ` AND creatorTypeID=?${sqlParams.length + 1}`;
						sqlParams.push(searchParams.creatorTypeID);
					}
					fromSQL += ")";
				}
				if (libraryIDs.length) {
					fromSQL += ` AND libraryID IN (${libraryIDs.map((_, i) => '?' + (sqlParams.length + 1 + i)).join(', ')})`;
					sqlParams.push(...libraryIDs);
				}

				sql += fromSQL;
				
				// If double-field mode, include matches for just this field
				// as well (i.e. "Shakespeare"), and group to collapse repeats
				if (searchParams.fieldMode != 1) {
					sql = "SELECT * FROM (" + sql + " UNION SELECT DISTINCT "
						+ subField + " AS val, creatorID || '-1' AS id"
						+ fromSQL + ") GROUP BY val";
				}
				
				sql += " ORDER BY val";
			}
			break;
		
		case 'dateModified':
		case 'dateAdded':
			var sql = "SELECT DISTINCT DATE(" + fieldName + ", 'localtime') AS val, NULL AS id "
				+ "FROM items WHERE " + fieldName + " LIKE ? ";
			var sqlParams = [searchString + '%'];
			if (libraryIDs.length) {
				sql += `AND libraryID IN (${libraryPlaceholders}) `;
				sqlParams.push(...libraryIDs);
			}
			sql += "ORDER BY " + fieldName;
			
			break;
			
		case 'accessDate':
			var fieldID = Trellis.ItemFields.getID('accessDate');
			
			var sql = "SELECT DISTINCT DATE(value, 'localtime') AS val, NULL AS id FROM itemData ";
			if (libraryIDs.length) {
				sql += "JOIN items USING (itemID) ";
			}
			sql += "WHERE fieldID=? AND value LIKE ? ";
			var sqlParams = [fieldID, searchString + '%'];
			if (libraryIDs.length) {
				sql += `AND libraryID IN (${libraryPlaceholders}) `;
				sqlParams.push(...libraryIDs);
			}
			sql += "ORDER BY value";
			
			break;
		
		default:
			var fieldID = Trellis.ItemFields.getID(fieldName);
			if (!fieldID) {
				Trellis.debug("'" + fieldName + "' is not a valid autocomplete scope", 1);
				this.updateResults([], false, Ci.nsIAutoCompleteResult.RESULT_IGNORED);
				return;
			}
			
			// We don't use date autocomplete anywhere, but if we're not
			// disallowing it altogether, we should at least do it right and
			// use the user part of the multipart field
			var valueField = fieldName == 'date' ? 'SUBSTR(value, 12, 100)' : 'value';
			
			var sql = "SELECT DISTINCT " + valueField + " AS val, NULL AS id FROM itemData ";
			if (libraryIDs.length) {
				sql += "JOIN items USING (itemID) ";
			}
			sql += "JOIN itemDataValues USING (valueID) "
				+ "WHERE fieldID=?1 AND " + valueField + " LIKE ?2 ";
			var sqlParams = [fieldID, searchString + '%'];
			// Exclude values from an item
			if (searchParams.itemID) {
				sql += "AND value NOT IN (SELECT value FROM itemData "
					+ "NATURAL JOIN itemDataValues WHERE fieldID=?1 AND itemID=?3) ";
				sqlParams.push(searchParams.itemID);
			}
			// Limit to specific libraries
			if (libraryIDs.length) {
				sql += `AND libraryID IN (${libraryIDs.map((_, i) => '?' + (sqlParams.length + 1 + i)).join(', ')}) `;
				sqlParams.push(...libraryIDs);
			}
			sql += "ORDER BY value";
	}
	
	sql += " LIMIT 50";
	
	var onRow = null;
	// If there's a result callback (e.g., for sorting), don't use a row handler
	if (!resultsCallback) {
		onRow = function (row, cancel) {
			if (this._cancelled) {
				Trellis.debug("Cancelling query");
				cancel();
				return;
			}
			var value = row.getResultByIndex(0);
			var id = row.getResultByIndex(1);
			this.updateResult(value, id);
		}.bind(this);
	}
	var resultCode;
	try {
		let results = await Trellis.DB.queryAsync(sql, sqlParams, { onRow: onRow });
		// Post-process the results
		if (resultsCallback) {
			resultsCallback(results);
			this.updateResults(
				Object.values(results).map(x => x.val),
				Object.values(results).map(x => x.id),
				false
			);
		}
		resultCode = null;
		Trellis.debug("Autocomplete query completed");
	}
	catch (e) {
		Trellis.debug(e, 1);
		resultCode = Ci.nsIAutoCompleteResult.RESULT_FAILURE;
		Trellis.debug("Autocomplete query aborted");
	}
	finally {
		this.updateResults(null, null, false, resultCode);
	};
};


TrellisAutoComplete.prototype.updateResult = function (value, id) {
	Trellis.debug(`Appending autocomplete value '${value}'` + (id ? " (" + id + ")" : ''));
	// Add to nsIAutoCompleteResult
	this._result.appendMatch(value, id, null, null, null, value);
	// Add to our own list
	this._results.push(value);
	// Only update the UI every 10 records
	if (this._result.matchCount % 10 == 0) {
		this._result.setSearchResult(Ci.nsIAutoCompleteResult.RESULT_SUCCESS_ONGOING);
		this._listener.onSearchResult(this, this._result);
	}
}


TrellisAutoComplete.prototype.updateResults = function (values, ids, ongoing, resultCode) {
	if (!values) {
		values = [];
	}
	if (!ids) {
		ids = [];
	}
	
	for (let i = 0; i < values.length; i++) {
		let value = values[i];
		
		if (!this._results.includes(value)) {
			let id = ids[i] || null;
			Trellis.debug("Adding autocomplete value '" + value + "'" + (id ? " (" + id + ")" : ""));
			this._result.appendMatch(value, id, null, null, null, value);
			this._results.push(value);
		}
		else {
			//Trellis.debug("Skipping existing value '" + result + "'");
		}
	}
	
	if (!resultCode) {
		resultCode = "RESULT_";
		if (!this._result.matchCount) {
			resultCode += "NOMATCH";
		}
		else {
			resultCode += "SUCCESS";
		}
		if (ongoing) {
			resultCode += "_ONGOING";
		}
		resultCode = Ci.nsIAutoCompleteResult[resultCode];
	}
	
	Trellis.debug("Found " + this._result.matchCount
		+ " result" + (this._result.matchCount != 1 ? "s" : ""));
	
	this._result.setSearchResult(resultCode);
	this._listener.onSearchResult(this, this._result);
}

TrellisAutoComplete.prototype.createInstance = function (iid) {
	return this.QueryInterface(iid);
};

// FIXME
TrellisAutoComplete.prototype.stopSearch = function (){
	Trellis.debug('Stopping autocomplete search');
	this._cancelled = true;
}

// Static
TrellisAutoComplete.init = function () {
	// If already registered (e.g., after a Trellis.reinit() in tests), skip
	var registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
	if (registrar.isCIDRegistered(TRELLIS_AC_CLASS_ID)) {
		return;
	}
	var search = new TrellisAutoComplete();
	registrar.registerFactory(TRELLIS_AC_CLASS_ID, "", TRELLIS_AC_CONTRACT_ID, search);
};

//
// XPCOM goop
//

TrellisAutoComplete.prototype.classID = TRELLIS_AC_CLASS_ID;
TrellisAutoComplete.prototype.QueryInterface = ChromeUtils.generateQI([
	"nsIFactory",
	"nsIAutoCompleteSearch"
]);
