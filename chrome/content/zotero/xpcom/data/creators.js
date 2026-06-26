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


Trellis.Creators = new function () {
	this.fields = ['firstName', 'lastName', 'fieldMode'];
	this.totes = 0;
	
	var _cache = {};
	
	this.init = async function () {
		_cache = {};
		var repaired = false;
		var sql = "SELECT * FROM creators";
		var rows = await Trellis.DB.queryAsync(sql);
		for (let i = 0; i < rows.length; i++) {
			let row = rows[i];
			try {
				_cache[row.creatorID] = this.cleanData({
					// Avoid "DB column 'name' not found" warnings from the DB row Proxy
					firstName: row.firstName,
					lastName: row.lastName,
					fieldMode: row.fieldMode
				});
			}
			catch (e) {
				// Automatically fix DB errors and try again
				if (!repaired) {
					Trellis.logError(e);
					Trellis.logError("Trying integrity check to fix creator error");
					await Trellis.Schema.integrityCheck(true);
					repaired = true;
					rows = await Trellis.DB.queryAsync(sql);
					i = -1;
					continue;
				}
				
				throw e;
			}
		}
	};
	
	/*
	 * Returns creator data in internal format for a given creatorID
	 */
	this.get = function (creatorID) {
		if (!creatorID) {
			throw new Error("creatorID not provided");
		}
		
		if (!_cache[creatorID]) {
			throw new Error("Creator " + creatorID + " not found");
		}
		
		// Return copy of data
		return this.cleanData(_cache[creatorID]);
	};
	
	
	this.getItemsWithCreator = function (creatorID) {
		var sql = "SELECT DISTINCT itemID FROM itemCreators WHERE creatorID=?";
		return Trellis.DB.columnQueryAsync(sql, creatorID);
	}
	
	
	this.countItemAssociations = function (creatorID) {
		var sql = "SELECT COUNT(*) FROM itemCreators WHERE creatorID=?";
		return Trellis.DB.valueQueryAsync(sql, creatorID);
	}
	
	
	/**
	 * Returns the creatorID matching given fields, or creates a new creator and returns its id
	 *
	 * @requireTransaction
	 * @param {Object} data  Creator data in API JSON format
	 * @param {Boolean} [create=false]  If no matching creator, create one
	 * @return {Promise<Integer>}  creatorID
	 */
	this.getIDFromData = async function (data, create) {
		Trellis.DB.requireTransaction();
		data = this.cleanData(data);
		var sql = "SELECT creatorID FROM creators WHERE "
			+ "firstName=? AND lastName=? AND fieldMode=?";
		var id = await Trellis.DB.valueQueryAsync(
			sql, [data.firstName, data.lastName, data.fieldMode]
		);
		if (!id && create) {
			id = Trellis.ID.get('creators');
			let sql = "INSERT INTO creators (creatorID, firstName, lastName, fieldMode) "
				+ "VALUES (?, ?, ?, ?)";
			await Trellis.DB.queryAsync(
				sql, [id, data.firstName, data.lastName, data.fieldMode]
			);
			_cache[id] = data;
		}
		return id;
	};
	
	
	this.updateCreator = async function (creatorID, creatorData) {
		var creator = await this.get(creatorID);
		if (!creator) {
			throw new Error("Creator " + creatorID + " doesn't exist");
		}
		creator.fieldMode = creatorData.fieldMode;
		creator.firstName = creatorData.firstName;
		creator.lastName = creatorData.lastName;
		return creator.save();
	};
	
	
	/**
	 * Delete obsolete creator rows from database and clear internal cache entries
	 *
	 * @return {Promise}
	 */
	this.purge = async function () {
		if (!Trellis.Prefs.get('purge.creators')) {
			return;
		}
		
		Trellis.debug("Purging creator tables");
		
		var sql = 'SELECT creatorID FROM creators WHERE creatorID NOT IN '
			+ '(SELECT creatorID FROM itemCreators)';
		var toDelete = await Trellis.DB.columnQueryAsync(sql);
		if (toDelete.length) {
			// Clear creator entries in internal array
			for (let i=0; i<toDelete.length; i++) {
				delete _cache[toDelete[i]];
			}
			
			await Trellis.DB.executeTransaction(async function () {
				var sql = "DELETE FROM creators WHERE creatorID NOT IN "
					+ "(SELECT creatorID FROM itemCreators)";
				await Trellis.DB.queryAsync(sql, [], { ignoreDBLock: true });
			}, { disableForeignKeys: true });
		}
		
		Trellis.Prefs.set('purge.creators', false);
	};
	
	
	this.equals = function (data1, data2) {
		data1 = this.cleanData(data1);
		data2 = this.cleanData(data2);
		return data1.lastName === data2.lastName
			&& data1.firstName === data2.firstName
			&& data1.fieldMode === data2.fieldMode
			&& data1.creatorTypeID === data2.creatorTypeID;
	},
	
	
	this.cleanData = function (data, options = {}) {
		// Validate data
		if (data.name === undefined && data.lastName === undefined) {
			throw new Error("Creator data must contain either 'name' or 'firstName'/'lastName' properties");
		}
		if (data.name !== undefined && (data.firstName !== undefined || data.lastName !== undefined)) {
			throw new Error("Creator data cannot contain both 'name' and 'firstName'/'lastName' properties");
		}
		if (data.name !== undefined && data.fieldMode === 0) {
			throw new Error("'fieldMode' cannot be 0 with 'name' property");
		}
		if (data.fieldMode === 1
				&& !(data.firstName === undefined || data.firstName === "" || data.firstName === null)) {
			throw new Error("'fieldMode' cannot be 1 with 'firstName' property");
		}
		if (data.name !== undefined && typeof data.name != 'string') {
			throw new Error("'name' must be a string");
		}
		if (data.firstName !== undefined && data.firstName !== null && typeof data.firstName != 'string') {
			throw new Error("'firstName' must be a string");
		}
		if (data.lastName !== undefined && typeof data.lastName != 'string') {
			throw new Error("'lastName' must be a string");
		}
		
		var cleanedData = {
			fieldMode: 0,
			firstName: '',
			lastName: ''
		};
		for (let i=0; i<this.fields.length; i++) {
			let field = this.fields[i];
			let val = data[field];
			switch (field) {
			case 'firstName':
			case 'lastName':
				if (val === undefined || val === null) continue;
				cleanedData[field] = val.trim().normalize();
				break;
			
			case 'fieldMode':
				cleanedData[field] = val ? parseInt(val) : 0;
				break;
			}
		}
		
		// Handle API JSON .name
		if (data.name !== undefined) {
			cleanedData.lastName = data.name.trim().normalize();
			cleanedData.fieldMode = 1;
		}
		
		var creatorType = data.creatorType || data.creatorTypeID;
		if (creatorType) {
			cleanedData.creatorTypeID = Trellis.CreatorTypes.getID(creatorType);
			if (!cleanedData.creatorTypeID) {
				if (options.strict) {
					let e = new Error(`Unknown creator type '${creatorType}'`);
					e.name = "TrellisInvalidDataError";
					throw e;
				}
				Trellis.warn(`'${creatorType}' isn't a valid creator type`);
			}
		}
		
		return cleanedData;
	}
	
	
	this.internalToJSON = function (fields) {
		var obj = {};
		if (fields.fieldMode == 1) {
			obj.name = fields.lastName;
		}
		else {
			obj.firstName = fields.firstName;
			obj.lastName = fields.lastName;
		}
		obj.creatorType = Trellis.CreatorTypes.getName(fields.creatorTypeID);
		return obj;
	}
}
