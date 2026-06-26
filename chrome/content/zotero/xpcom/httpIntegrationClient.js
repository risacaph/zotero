/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2017 Center for History and New Media
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

/**
 * This is a HTTP-based integration interface for Trellis. The actual
 * heavy lifting occurs in the connector and/or wherever the connector delegates the heavy
 * lifting to.
 */
Trellis.HTTPIntegrationClient = {
	deferredResponse: null,
	sendCommandPromise: Promise.resolve(),
	sendCommand: async function (command, args=[]) {
		let payload = JSON.stringify({command, arguments: args});
		function sendCommand() {
			Trellis.HTTPIntegrationClient.deferredResponse = Trellis.Promise.defer();
			Trellis.HTTPIntegrationClient.sendResponse.apply(Trellis.HTTPIntegrationClient,
				[200, 'application/json', payload]);
			return Trellis.HTTPIntegrationClient.deferredResponse.promise;
		}
		// Force issued commands to occur sequentially, since these are really just
		// a sequence of HTTP requests and responses.
		// We might want to consider something better later, but this has the advantage of
		// being easy to interface with as a Client, as you don't need SSE or WS.
		if (command != 'Document.complete') {
			Trellis.HTTPIntegrationClient.sendCommandPromise = 
				Trellis.HTTPIntegrationClient.sendCommandPromise.then(sendCommand, sendCommand);
		} else {
			await Trellis.HTTPIntegrationClient.sendCommandPromise;
			sendCommand();
		}
		return Trellis.HTTPIntegrationClient.sendCommandPromise;
	}
};

Trellis.HTTPIntegrationClient.Application = function () {
	this.primaryFieldType = "Http";
	this.secondaryFieldType = "Http";
	this.outputFormat = 'html';
	this.supportedNotes = ['footnotes'];
	this.supportsImportExport = false;
	this.supportsTextInsertion = false;
	this.supportsCitationMerging = false;
	this.processorName = "HTTP Integration";
};
Trellis.HTTPIntegrationClient.Application.prototype = {
	getActiveDocument: async function () {
		let result = await Trellis.HTTPIntegrationClient.sendCommand('Application.getActiveDocument');
		this.outputFormat = result.outputFormat || this.outputFormat;
		this.supportedNotes = result.supportedNotes || this.supportedNotes;
		this.supportsImportExport = result.supportsImportExport || this.supportsImportExport;
		this.supportsTextInsertion = result.supportsTextInsertion || this.supportsTextInsertion;
		this.supportsCitationMerging = result.supportsCitationMerging || this.supportsCitationMerging;
		this.processorName = result.processorName || this.processorName;
		return new Trellis.HTTPIntegrationClient.Document(result.documentID, this.processorName);
	}
};

/**
 * See integrationTests.js
 */
Trellis.HTTPIntegrationClient.Document = function (documentID, processorName) {
	this._documentID = documentID;
	this.processorName = processorName;
};
for (let method of ["activate", "canInsertField", "displayAlert", "getDocumentData",
	"setDocumentData", "setBibliographyStyle", "importDocument", "exportDocument",
	"insertText"]) {
	Trellis.HTTPIntegrationClient.Document.prototype[method] = async function () {
		return Trellis.HTTPIntegrationClient.sendCommand("Document."+method,
			[this._documentID].concat(Array.prototype.slice.call(arguments)));
	};
}

// @NOTE Currently unused, prompts are done using the connector
Trellis.HTTPIntegrationClient.Document.prototype._displayAlert = async function (dialogText, icon, buttons) {
	var ps = Services.prompt;
	var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_OK)
		+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_IS_STRING);
	
	switch (buttons) {
		case DIALOG_BUTTONS_OK:
			buttonFlags = ps.BUTTON_POS_0_DEFAULT + ps.BUTTON_POS_0 * ps.BUTTON_TITLE_OK; break;
		case DIALOG_BUTTONS_OK_CANCEL:
			buttonFlags = ps.BUTTON_POS_0_DEFAULT + ps.STD_OK_CANCEL_BUTTONS; break;
		case DIALOG_BUTTONS_YES_NO:
			buttonFlags = ps.BUTTON_POS_0_DEFAULT + ps.STD_YES_NO_BUTTONS; break;
		case DIALOG_BUTTONS_YES_NO_CANCEL:
			buttonFlags = ps.BUTTON_POS_0_DEFAULT + ps.BUTTON_POS_0 * ps.BUTTON_TITLE_YES +
				ps.BUTTON_POS_1 * ps.BUTTON_TITLE_NO +
				ps.BUTTON_POS_2 * ps.BUTTON_TITLE_CANCEL; break;
	}

	var result = ps.confirmEx(
		null,
		"Trellis",
		dialogText,
		buttonFlags,
		null, null, null,
		null,
		{}
	);
	
	switch (buttons) {
		default:
			break;
		case DIALOG_BUTTONS_OK_CANCEL:
		case DIALOG_BUTTONS_YES_NO:
			result = (result+1)%2; break;
		case DIALOG_BUTTONS_YES_NO_CANCEL:
			result = result == 0 ? 2 : result == 2 ? 0 : 1; break;
	}
	await this.activate();
	return result;
}
Trellis.HTTPIntegrationClient.Document.prototype.cleanup = async function () {};
Trellis.HTTPIntegrationClient.Document.prototype.cursorInField = async function (fieldType) {
	var retVal = await Trellis.HTTPIntegrationClient.sendCommand("Document.cursorInField", [this._documentID, fieldType]);
	if (!retVal) return null;
	return new Trellis.HTTPIntegrationClient.Field(this._documentID, retVal);
};
Trellis.HTTPIntegrationClient.Document.prototype.insertField = async function (fieldType, noteType) {
	var retVal = await Trellis.HTTPIntegrationClient.sendCommand("Document.insertField", [this._documentID, fieldType, parseInt(noteType) || 0]);
	return new Trellis.HTTPIntegrationClient.Field(this._documentID, retVal);
};
Trellis.HTTPIntegrationClient.Document.prototype.getFields = async function (fieldType) {
	var retVal = await Trellis.HTTPIntegrationClient.sendCommand("Document.getFields", [this._documentID, fieldType]);
	return retVal.map(field => new Trellis.HTTPIntegrationClient.Field(this._documentID, field));
};
Trellis.HTTPIntegrationClient.Document.prototype.convert = async function (fields, fieldType, noteTypes) {
	fields = fields.map((f) => f._id);
	await Trellis.HTTPIntegrationClient.sendCommand("Document.convert", [this._documentID, fields, fieldType, noteTypes]);
};
Trellis.HTTPIntegrationClient.Document.prototype.convertPlaceholdersToFields = async function (codes, placeholderIDs, noteType) {
	var retVal = await Trellis.HTTPIntegrationClient.sendCommand("Document.convertPlaceholdersToFields", [this._documentID, codes, placeholderIDs, noteType]);
	return retVal.map(field => new Trellis.HTTPIntegrationClient.Field(this._documentID, field));
}
Trellis.HTTPIntegrationClient.Document.prototype.complete = async function () {
	Trellis.HTTPIntegrationClient.inProgress = false;
	Trellis.HTTPIntegrationClient.sendCommand("Document.complete", [this._documentID]);
};

/**
 * See integrationTests.js
 */
Trellis.HTTPIntegrationClient.Field = function (documentID, json) {
	this._documentID = documentID; 
	this._id = json.id;
	this._code = json.code;
	this._text = json.text;
	this._noteIndex = json.noteIndex;
	this._adjacent = json.adjacent;
	if (this._adjacent !== 'undefined') {
		this.isAdjacentToNextField = this._isAdjacentToNextField;
	}
};
Trellis.HTTPIntegrationClient.Field.prototype = {};

for (let method of ["delete", "select", "removeCode"]) {
	Trellis.HTTPIntegrationClient.Field.prototype[method] = async function () {
		return Trellis.HTTPIntegrationClient.sendCommand("Field."+method,
			[this._documentID, this._id].concat(Array.prototype.slice.call(arguments)));
	};
}
Trellis.HTTPIntegrationClient.Field.prototype.getText = async function () {
	return this._text;
};
Trellis.HTTPIntegrationClient.Field.prototype.setText = async function (text, isRich) {
	// The HTML will be stripped by Google Docs and and since we're 
	// caching this value, we need to strip it ourselves
	var parser = new DOMParser();
	var doc = parser.parseFromString(text, "text/html");
	this._text = doc.documentElement.textContent;
	return Trellis.HTTPIntegrationClient.sendCommand("Field.setText", [this._documentID, this._id, text, true]);
};
Trellis.HTTPIntegrationClient.Field.prototype.getCode = async function () {
	return this._code;
};
Trellis.HTTPIntegrationClient.Field.prototype.setCode = async function (code) {
	this._code = code;
	return Trellis.HTTPIntegrationClient.sendCommand("Field.setCode", [this._documentID, this._id, code]);
};
Trellis.HTTPIntegrationClient.Field.prototype.getNoteIndex = async function () {
	return this._noteIndex;
};
Trellis.HTTPIntegrationClient.Field.prototype.equals = async function (arg) {
	return this._id === arg._id;
};
Trellis.HTTPIntegrationClient.Field.prototype._isAdjacentToNextField = async function () {
	return this._adjacent;
}
