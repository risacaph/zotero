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

"use strict";

Trellis.Group = function (params = {}) {
	params.libraryType = 'group';
	Trellis.Group._super.call(this, params);
	
	Trellis.Utilities.Internal.assignProps(this, params, ['groupID', 'name', 'description',
		'version']);
	
	// Return a proxy so that we can disable the object once it's deleted
	return new Proxy(this, {
		get: function (obj, prop) {
			if (obj._disabled && !(prop == 'libraryID' || prop == 'id' || prop == 'name')) {
				throw new Error("Group (" + obj.libraryID + ") has been disabled");
			}
			return obj[prop];
		}
	});
}


/**
 * Non-prototype properties
 */

Trellis.defineProperty(Trellis.Group, '_dbColumns', {
	value: Object.freeze(['name', 'description', 'version'])
});

Trellis.Group._colToProp = function (c) {
	return "_group" + Trellis.Utilities.capitalize(c);
}

Trellis.defineProperty(Trellis.Group, '_rowSQLSelect', {
	value: Trellis.Library._rowSQLSelect + ", G.groupID, "
		+ Trellis.Group._dbColumns.map(c => "G." + c + " AS " + Trellis.Group._colToProp(c)).join(", ")
});

Trellis.defineProperty(Trellis.Group, '_rowSQL', {
	value: "SELECT " + Trellis.Group._rowSQLSelect
		+ " FROM groups G JOIN libraries L USING (libraryID)"
});

Trellis.extendClass(Trellis.Library, Trellis.Group);

Trellis.defineProperty(Trellis.Group.prototype, '_objectType', {
	value: 'group'
});

Trellis.defineProperty(Trellis.Group.prototype, 'libraryTypes', {
	value: Object.freeze(Trellis.Group._super.prototype.libraryTypes.concat(['group']))
});

Trellis.defineProperty(Trellis.Group.prototype, 'groupID', {
	get: function () { return this._groupID; },
	set: function (v) { return this._groupID = v; }
});

Trellis.defineProperty(Trellis.Group.prototype, 'id', {
	get: function () { return this.groupID; },
	set: function (v) { return this.groupID = v; }
});

Trellis.defineProperty(Trellis.Group.prototype, 'allowsLinkedFiles', {
	value: false
});

// Create accessors
(function () {
let accessors = ['name', 'description', 'version'];
for (let i=0; i<accessors.length; i++) {
	let name = accessors[i];
	let prop = Trellis.Group._colToProp(name);
	Trellis.defineProperty(Trellis.Group.prototype, name, {
		get: function () { return this._get(prop); },
		set: function (v) { return this._set(prop, v); }
	})
}
})();

Trellis.Group.prototype._isValidGroupProp = function (prop) {
	let preffix = '_group';
	if (prop.indexOf(preffix) !== 0 || prop.length == preffix.length) {
		return false;
	}
	
	let col = prop.substr(preffix.length);
	col =  col.charAt(0).toLowerCase() + col.substr(1);
	
	return Trellis.Group._dbColumns.indexOf(col) != -1;
}

Trellis.Group.prototype._isValidProp = function (prop) {
	return this._isValidGroupProp(prop)
		|| Trellis.Group._super.prototype._isValidProp.call(this, prop);
}

/*
 * Populate group data from a database row
 */
Trellis.Group.prototype._loadDataFromRow = function (row) {
	Trellis.Group._super.prototype._loadDataFromRow.call(this, row);
	
	this._groupID = row.groupID;
	this._groupName = row._groupName;
	this._groupDescription = row._groupDescription;
	this._groupVersion = row._groupVersion;
}

Trellis.Group.prototype._set = function (prop, val) {
	switch(prop) {
		case '_groupVersion':
			let newVal = Number.parseInt(val, 10);
			if (newVal != val) {
				throw new Error(prop + ' must be an integer');
			}
			val = newVal
			
			if (val < 0) {
				throw new Error(prop + ' must be non-negative');
			}
			
			// Ensure that it is never decreasing
			if (val < this._groupVersion) {
				throw new Error(prop + ' cannot decrease');
			}
			
			break;
		case '_groupName':
		case '_groupDescription':
			if (typeof val != 'string') {
				throw new Error(prop + ' must be a string');
			}
			break;
	}
	
	return Trellis.Group._super.prototype._set.call(this, prop, val);
}

Trellis.Group.prototype._reloadFromDB = async function () {
	let sql = Trellis.Group._rowSQL + " WHERE G.groupID=?";
	let row = await Trellis.DB.rowQueryAsync(sql, [this.groupID]);
	this._loadDataFromRow(row);
};

Trellis.Group.prototype._initSave = async function (env) {
	let proceed = await Trellis.Group._super.prototype._initSave.call(this, env);
	if (!proceed) return false;
	
	if (!this._groupName) throw new Error("Group name not set");
	if (typeof this._groupDescription != 'string') throw new Error("Group description not set");
	if (!(this._groupVersion >= 0)) throw new Error("Group version not set");
	if (!this._groupID) throw new Error("Group ID not set");
	
	return true;
};

Trellis.Group.prototype._saveData = async function (env) {
	await Trellis.Group._super.prototype._saveData.call(this, env);
	
	let changedCols = [], params = [];
	for (let i=0; i<Trellis.Group._dbColumns.length; i++) {
		let col = Trellis.Group._dbColumns[i];
		let prop = Trellis.Group._colToProp(col);
		
		if (!this._changed[prop]) continue;
		
		changedCols.push(col);
		params.push(this[prop]);
	}
	
	if (env.isNew) {
		changedCols.push('groupID', 'libraryID');
		params.push(this.groupID, this.libraryID);
		
		let sql = "INSERT INTO groups (" + changedCols.join(', ') + ") "
			+ "VALUES (" + Array(params.length).fill('?').join(', ') + ")";
		await Trellis.DB.queryAsync(sql, params);
		
		Trellis.Notifier.queue('add', 'group', this.groupID, env.notifierData);
	}
	else if (changedCols.length) {
		let sql = "UPDATE groups SET " + changedCols.map(v => v + '=?').join(', ')
			+ " WHERE groupID=?";
		params.push(this.groupID);
		await Trellis.DB.queryAsync(sql, params);
		
		if (!env.options.skipNotifier) {
			Trellis.Notifier.queue('modify', 'group', this.groupID, env.notifierData);
		}
	}
	else {
		Trellis.debug("Group data did not change for group " + this.groupID, 5);
	}
};

Trellis.Group.prototype._finalizeSave = async function (env) {
	await Trellis.Group._super.prototype._finalizeSave.call(this, env);
	
	if (env.isNew) {
		Trellis.Groups.register(this);
	}
};

Trellis.Group.prototype._finalizeErase = async function (env) {
	let notifierData = {};
	notifierData[this.groupID] = {
		libraryID: this.libraryID
	};
	Trellis.Notifier.queue('delete', 'group', this.groupID, notifierData);
	
	Trellis.Groups.unregister(this.groupID);
	
	await Trellis.Group._super.prototype._finalizeErase.call(this, env);
};

Trellis.Group.prototype.toResponseJSON = function (options = {}) {
	if (options.includeGroupDetails) {
		let uri = Trellis.URI.getGroupURI(this);
		return {
			id: this.id,
			version: this.version,
			links: {
				self: {
					href: Trellis.URI.toAPIURL(uri, options.apiURL),
					type: 'application/json'
				},
				alternate: {
					href: Trellis.URI.toWebURL(uri),
					type: 'text/html'
				}
			},
			meta: {
				// created
				// lastModified
			},
			data: {
				id: this.id,
				version: this.version,
				name: this.name,
				description: this.description
			}
		};
	}
	else {
		return Trellis.Group._super.prototype.toResponseJSON.call(this, options);
	}
};

Trellis.Group.prototype.toResponseJSONAsync = async function (options = {}) {
	let json = this.toResponseJSON(options);
	if (options.includeGroupDetails) {
		json.meta.numItems = await Trellis.DB.valueQueryAsync(
			"SELECT COUNT(*) FROM items WHERE libraryID = ?", this.libraryID);
	}
	return json;
};

Trellis.Group.prototype.fromJSON = function (json, userID) {
	if (json.name !== undefined) this.name = json.name;
	if (json.description !== undefined) this.description = json.description;
	
	var editable = false;
	var filesEditable = false;
	var isAdmin = false;
	if (userID) {
		({ editable, filesEditable, isAdmin } = Trellis.Groups.getPermissionsFromJSON(json, userID));
	}
	this.editable = editable;
	this.filesEditable = filesEditable;
	this.isAdmin = isAdmin;
}

Trellis.Group.prototype._prepFieldChange = function (field) {
	if (!this._changed) {
		this._changed = {};
	}
	this._changed[field] = true;
	
	// Save a copy of the data before changing
	// TODO: only save previous data if group exists
	if (this.id && this.exists() && !this._previousData) {
		//this._previousData = this.serialize();
	}
}
