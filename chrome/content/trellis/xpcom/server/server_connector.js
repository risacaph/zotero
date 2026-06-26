/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2011 Center for History and New Media
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
const CONNECTOR_API_VERSION = 3;

Trellis.Server.Connector = {
	_waitingForSelection: {},
	
	getSaveTarget: function (allowReadOnly, allowFilesReadOnly=true) {
		var zp = Trellis.getActiveTrellisPane();
		var library = null;
		var collection = null;
		var editable = null;
		
		if (zp && zp.collectionsView) {
			if (allowReadOnly || zp.collectionsView.editable && allowFilesReadOnly || zp.collectionsView.filesEditable) {
				// The Connector saves to a single target, so derive both the library and the
				// collection from the focused row. A multiple-collection selection in the pane
				// isn't expressible here yet, and getSelectedCollection() could otherwise return
				// a collection from a different library than the focused row.
				let treeRow = zp.collectionsView.selectedTreeRow;
				library = Trellis.Libraries.get(zp.getSelectedLibraryID());
				collection = treeRow && treeRow.isCollection() ? treeRow.ref : null;
				editable = zp.collectionsView.editable;
			}
			// If not editable, switch to My Library if it exists and is editable
			else {
				let userLibrary = Trellis.Libraries.userLibrary;
				if (userLibrary && userLibrary.editable) {
					Trellis.debug("Save target isn't editable -- switching to My Library");
					
					// Don't wait for this, because we don't want to slow down all conenctor
					// requests by making this function async
					zp.collectionsView.selectByID(userLibrary.treeViewID);
					
					library = userLibrary;
					collection = null;
					editable = true;
				}
			}
		}
		else {
			let id = Trellis.Prefs.get('lastViewedFolder');
			if (id) {
				({ library, collection, editable } = this.resolveTarget(id));
				if (!editable && !allowReadOnly) {
					let userLibrary = Trellis.Libraries.userLibrary;
					if (userLibrary && userLibrary.editable) {
						Trellis.debug("Save target isn't editable -- switching lastViewedFolder to My Library");
						let treeViewID = userLibrary.treeViewID;
						Trellis.Prefs.set('lastViewedFolder', treeViewID);
						({ library, collection, editable } = this.resolveTarget(treeViewID));
					}
				}
			}
		}
		
		// Default to My Library if present if pane not yet opened
		// (which should never be the case anymore)
		if (!library) {
			let userLibrary = Trellis.Libraries.userLibrary;
			if (userLibrary && userLibrary.editable) {
				library = userLibrary;
			}
		}
		
		return { library, collection, editable };
	},
	
	resolveTarget: function (targetID) {
		var library;
		var collection;
		var editable;
		
		var type = targetID[0];
		var id = parseInt(('' + targetID).substr(1));
		
		switch (type) {
		case 'L':
			library = Trellis.Libraries.get(id);
			editable = library.editable;
			break;
		
		case 'C':
			collection = Trellis.Collections.get(id);
			library = collection.library;
			editable = collection.editable;
			break;
		
		default:
			throw new Error(`Unsupported target type '${type}'`);
		}
		
		return { library, collection, editable };
	},

	/**
	 * Warn on outdated connector version
	 */
	versionWarning: function (req, force=false) {
		try {
			if (!force) {
				if (!Trellis.Prefs.get('showConnectorVersionWarning')) return;
				if (Trellis.Server.Connector.skipVersionWarning) return;
			}
			if (!req.headers || !req.headers['X-Trellis-Connector-API-Version']) return;
			
			const appName = TRELLIS_CONFIG.CLIENT_NAME;
			const domain = TRELLIS_CONFIG.DOMAIN_NAME;
			
			const apiVersion = req.headers['X-Trellis-Connector-API-Version'];
			// We are up to date
			if (apiVersion >= CONNECTOR_API_VERSION) return;
			
			var message = Trellis.getString("connector-version-warning");
			
			if (!force) {
				var showNext = Trellis.Prefs.get('nextConnectorVersionWarning');
				if (showNext && new Date() < new Date(showNext * 1000)) return;
			}
			
			// Don't show again for this browser until restart (unless forced)
			Trellis.Server.Connector.skipVersionWarning = true;
			setTimeout(function () {
				if (this.versionWarningShowing) return;
				
				var remindLater = {};
				let options = {
					title: Trellis.getString('general.updateAvailable'),
					text: message,
					button0: Trellis.getString('general.upgrade'),
					button1: Trellis.getString('general.notNow'),
				}
				if (!force) {
					const SHOW_AGAIN_DAYS = 7;
					options.checkLabel = Trellis.getString(
						'general.dontShowAgainFor',
						SHOW_AGAIN_DAYS,
						SHOW_AGAIN_DAYS
					);
					options.checkbox = remindLater;
				}
				this.versionWarningShowing = true;
				const index = Trellis.Prompt.confirm(options)
				this.versionWarningShowing = false;
				
				var nextShowDays;
				// Remind in a week if checked remind me later
				if (remindLater.value) {
					nextShowDays = 7;
				}
				// Don't show again for at least a day, even after a restart
				else {
					nextShowDays = 1;
				}
				Trellis.Prefs.set('nextConnectorVersionWarning', Math.round(Date.now() / 1000) + 24*60*60 * nextShowDays);
				
				if (index == 0) {
					Trellis.launchURL(TRELLIS_CONFIG.CONNECTORS_URL);
				}
			}.bind(this), 0);

			return [400, "application/json", JSON.stringify({ error: "CONNECTOR_VERSION_OUTDATED" })];
		}
		catch (e) {
			Trellis.debug(e, 2);
		}
	}
};

/**
 * Lists all available translators, including code for translators that should be run on every page
 *
 * Accepts:
 *		Nothing
 * Returns:
 *		Array of Trellis.Translator objects
 */
Trellis.Server.Connector.GetTranslators = function () {};
Trellis.Server.Endpoints["/connector/getTranslators"] = Trellis.Server.Connector.GetTranslators;
Trellis.Server.Connector.GetTranslators.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	
	/**
	 * Gets available translator list and other important data
	 * @param {Object} data POST data or GET query string
	 * @param {Function} sendResponseCallback function to send HTTP response
	 */
	init: function (data, sendResponseCallback) {
		// Translator data
		var me = this;
		if(data.url) {
			Trellis.Translators.getWebTranslatorsForLocation(data.url, data.url).then(function (data) {
				sendResponseCallback(200, "application/json",
						JSON.stringify(me._serializeTranslators(data[0])));
			});
		} else {
			Trellis.Translators.getAll().then(function (translators) {
				var responseData = me._serializeTranslators(translators);
				sendResponseCallback(200, "application/json", JSON.stringify(responseData));
			}).catch(function (e) {
				sendResponseCallback(500);
				throw e;
			});
		}
	},
	
	_serializeTranslators: function (translators) {
		var responseData = [];
		let properties = ["translatorID", "translatorType", "label", "creator", "target", "targetAll",
			"minVersion", "maxVersion", "priority", "browserSupport", "inRepository", "lastUpdated"];
		for (var translator of translators) {
			responseData.push(translator.serialize(properties));
		}
		return responseData;
	}
}

/**
 * Detects whether there is an available translator to handle a given page
 *
 * Accepts:
 *		uri - The URI of the page to be saved
 *		html - document.innerHTML or equivalent
 *		cookie - document.cookie or equivalent
 *
 * Returns a list of available translators as an array
 */
Trellis.Server.Connector.Detect = function () {};
Trellis.Server.Endpoints["/connector/detect"] = Trellis.Server.Connector.Detect;
Trellis.Server.Connector.Detect.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	
	/**
	 * Loads HTML into a hidden browser and initiates translator detection
	 */
	init: async function (requestData) {
		try {
			var translators = await this.getTranslators(requestData);
		} catch (e) {
			Trellis.logError(e);
			return 500;
		}
		
		translators = translators.map(function (translator) {
			return translator.serialize(TRANSLATOR_PASSING_PROPERTIES);
		});
		return [200, "application/json", JSON.stringify(translators)];
	},
	
	async getTranslators(requestData) {
		var data = requestData.data;

		var parser = new DOMParser();
		var doc = parser.parseFromString(`<html>${data.html}</html>`, 'text/html');
		doc = Trellis.HTTP.wrapDocument(doc, data.uri);

		let translate = this._translate = new Trellis.Translate.Web();
		translate.setDocument(doc);

		return await translate.getTranslators();
	},
}

/**
 * Saves items to DB
 *
 * Accepts:
 *		items - an array of JSON format items
 * Returns:
 *		201 response code with item in body.
 */
Trellis.Server.Connector.SaveItems = function () {};
Trellis.Server.Endpoints["/connector/saveItems"] = Trellis.Server.Connector.SaveItems;
Trellis.Server.Connector.SaveItems.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	
	/**
	 * Either loads HTML into a hidden browser and initiates translation, or saves items directly
	 * to the database
	 */
	init: async function (requestData) {
		const response = Trellis.Server.Connector.versionWarning(requestData, true);
		if (response) {
			return response;
		}
		var data = requestData.data;
		
		var { library, collection, editable } = Trellis.Server.Connector.getSaveTarget();
		var libraryID = library.libraryID;
		var targetID = collection ? collection.treeViewID : library.treeViewID;
		
		try {
			var session = Trellis.Server.Connector.SessionManager.create(
				data.sessionID,
				'saveItems',
				requestData
			);
		}
		catch (e) {
			Trellis.debug(e);
			return [409, "application/json", JSON.stringify({ error: "SESSION_EXISTS" })];
		}
		await session.update(targetID);
		
		// Shouldn't happen as long as My Library exists
		if (!library.editable) {
			Trellis.logError("Can't add item to read-only library " + library.name);
			return [500, "application/json", JSON.stringify({ libraryEditable: false })];
		}
		
		try {
			await session.saveItems(targetID);
			return [201, "application/json"];
		}
		catch (e) {
			Trellis.logError(e);
			session.remove();
			return 500;
		}
	},
}

/**
 * Gets the top-level item created for a standalone attachment
 *
 * Accepts:
 *		sessionID - A session ID previously passed to /saveItems
 * Returns:
 * 		200
 */
Trellis.Server.Connector.GetRecognizedItem = function () {};
Trellis.Server.Endpoints["/connector/getRecognizedItem"] = Trellis.Server.Connector.GetRecognizedItem;
Trellis.Server.Connector.GetRecognizedItem.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["*"],
	permitBookmarklet: true,

	init: async function (requestData) {
		const sessionID = requestData.data.sessionID;
		if (!sessionID) {
			return [400, "application/json", JSON.stringify({ error: "SESSION_ID_NOT_PROVIDED" })];
		}
		
		const session = Trellis.Server.Connector.SessionManager.get(sessionID);
		if (!session) {
			Trellis.debug("Can't find session " + sessionID, 1);
			return [400, "application/json", JSON.stringify({ error: "SESSION_NOT_FOUND" })];
		}
		
		await session.autoRecognizePromise;
		let item = session.getRecognizedItem();
		if (!item) {
			return 204;
		}
		let jsonItem = {
			title: item.getDisplayTitle(),
			itemType: item.itemType,
		};
		return [200, "application/json", JSON.stringify({ ...jsonItem })];
	}
};


/**
 * Saves a standalone attachment
 *
 * URI params:
 *		sessionID
 * Expected headers:
 * 		X-Metadata:
 * 			- parentItemID
 * 			- title
 * 			- url
 * Returns:
 * 		400 - Bad params
 * 		200 - Non-writable library
 * 		201 - Created
 */
Trellis.Server.Connector.SaveStandaloneAttachment = function () {};
Trellis.Server.Endpoints["/connector/saveStandaloneAttachment"] = Trellis.Server.Connector.SaveStandaloneAttachment;
Trellis.Server.Connector.SaveStandaloneAttachment.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["*"],
	permitBookmarklet: true,

	init: async function (requestData) {
		// Retrieve payload
		if (!requestData.headers['X-Metadata']) {
			return [400, "application/json", JSON.stringify({ error: "METADATA_NOT_PROVIDED" })];
		}
		const metadata = JSON.parse(requestData.headers['X-Metadata']);

		const sessionID = metadata.sessionID || requestData.searchParams.get('sessionID');
		if (!sessionID) {
			return [400, "application/json", JSON.stringify({ error: "SESSION_ID_NOT_PROVIDED" })];
		}
		var { library, collection } = Trellis.Server.Connector.getSaveTarget(false, false);
		var libraryID = library.libraryID;
		var targetID = collection ? collection.treeViewID : library.treeViewID;

		try {
			var session = Trellis.Server.Connector.SessionManager.create(
				sessionID,
				'saveStandaloneAttachment',
				requestData
			);
		}
		catch (e) {
			return [409, "application/json", JSON.stringify({ error: "SESSION_EXISTS" })];
		}
		await session.update(targetID);

		// Save standalone attachment from stream
		let item = await Trellis.Attachments.importFromNetworkStream({
			url: metadata.url,
			libraryID,
			collections: collection ? [collection.id] : undefined,
			title: metadata.title,
			contentType: requestData.headers['Content-Type'],
			stream: requestData.data,
			byteCount: requestData.headers['Content-Length'],
		});
		session.addItem(metadata.url, item);
		
		let canRecognize = Trellis.RecognizeDocument.canRecognize(item);
		if (canRecognize) {
			// Automatically recognize PDF/EPUB
			session.autoRecognizePromise = Trellis.RecognizeDocument.autoRecognizeItems([item]);
		}
		return [201, "application/json", JSON.stringify({ canRecognize })];
	}
};

/**
 * Attaches an PDF/EPUB attachment to an item saved with /saveItems or /saveSnapshot
 *
 * URI params:
 *		sessionID
 * Expected headers:
 * 		X-Metadata:
 * 			- parentItemID
 * 			- title
 * 			- url
 * Returns:
 * 		400 - Bad params
 * 		200 - Non-writable library
 * 		201 - Created
 */
Trellis.Server.Connector.SaveAttachment = function () {};
Trellis.Server.Endpoints["/connector/saveAttachment"] = Trellis.Server.Connector.SaveAttachment;
Trellis.Server.Connector.SaveAttachment.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["*"],
	permitBookmarklet: true,

	init: async function (requestData) {
		// Retrieve payload
		if (!requestData.headers['X-Metadata']) {
			return [400, "application/json", JSON.stringify({ error: "METADATA_NOT_PROVIDED" })];
		}
		const metadata = JSON.parse(requestData.headers['X-Metadata']);
		
		const sessionID = metadata.sessionID || requestData.searchParams.get('sessionID');
		if (!sessionID) {
			return [400, "application/json", JSON.stringify({ error: "SESSION_ID_NOT_PROVIDED" })];
		}

		let session = Trellis.Server.Connector.SessionManager.get(sessionID);
		if (!session) {
			Trellis.debug("Can't find session " + sessionID, 1);
			return [400, "application/json", JSON.stringify({ error: "SESSION_NOT_FOUND" })];
		}
		
		let { library } = Trellis.Server.Connector.getSaveTarget();
		if (!library.filesEditable) {
			return [200, 'text/plain', 'Library files are not editable.'];
		}

		// Save attachment based on provided parent id from stream
		let parentItem = session.getItemByConnectorKey(metadata.parentItemID);
		await Trellis.Attachments.importFromNetworkStream({
			url: metadata.url,
			parentItemID: parentItem.id,
			title: metadata.title,
			contentType: requestData.headers['Content-Type'],
			stream: requestData.data,
			byteCount: requestData.headers['Content-Length'],
		});

		return 201;
	}
};


/**
 * Attaches a singlefile attachment to an item saved with /saveItems or /saveSnapshot
 * If data.snapshotContent is empty, it means the save failed in the Connector
 * And we fallback to saving in Trellis
 *
 * Accepts:
 * 		sessionID
 * 		snapshotContent
 *		url - The URI of the page to be saved
 * 		title
 *		cookie - document.cookie or equivalent
 *		detailedCookies
 * 		proxy
 * Returns:
 *		Nothing (200 OK response)
 */
Trellis.Server.Connector.SaveSingleFile = function () {};
Trellis.Server.Endpoints["/connector/saveSingleFile"] = Trellis.Server.Connector.SaveSingleFile;
Trellis.Server.Connector.SaveSingleFile.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json", "multipart/form-data"],
	permitBookmarklet: true,

	/**
	 * Save SingleFile snapshot to pending attachments
	 */
	init: async function (requestData) {
		// Retrieve payload
		let data = requestData.data;

		if (!data.sessionID) {
			return [400, "application/json", JSON.stringify({ error: "SESSION_ID_NOT_PROVIDED" })];
		}

		let session = Trellis.Server.Connector.SessionManager.get(data.sessionID);
		if (!session) {
			Trellis.debug("Can't find session " + data.sessionID, 1);
			return [400, "application/json", JSON.stringify({ error: "SESSION_NOT_FOUND" })];
		}

		let { library } = Trellis.Server.Connector.getSaveTarget();
		if (!library.filesEditable) {
			return [200, 'text/plain', 'Library files are not editable.'];
		}

		// We only save the snapshot in single-item cases
		if (session._action === 'saveSnapshot') {
			const parentItemID = session.getItemByConnectorKey(data.url).id;
			// Just saves the snapshot straight up
			await Trellis.Attachments.importFromSnapshotContent({
				title: data.title,
				url: data.url,
				parentItemID,
				snapshotContent: data.snapshotContent
			});
		}
		else if (session._action === 'saveItems') {
			const parentItemID = session.getItemByConnectorKey(data.items[0].id).id;
			// Deproxifies and does some other attachment preprocessing
			await session.itemSaver.saveSnapshotAttachments({
				title: data.title,
				url: data.url,
				parentItemID,
				snapshotContent: data.snapshotContent
			});
		}

		return 201;
	}
};

/**
 * Creates a webpage item top-level item in Trellis
 * Called by the Connector when no translators are detected on the page
 *
 * Accepts:
 *		uri - The URI of the page to be saved
 *		html - document.innerHTML or equivalent
 *		cookie - document.cookie or equivalent
 * Returns:
 *		Nothing (200 OK response)
 */
Trellis.Server.Connector.SaveSnapshot = function () {};
Trellis.Server.Endpoints["/connector/saveSnapshot"] = Trellis.Server.Connector.SaveSnapshot;
Trellis.Server.Connector.SaveSnapshot.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	
	/**
	 * Save snapshot
	 */
	init: async function (requestData) {
		const response = Trellis.Server.Connector.versionWarning(requestData, true);
		if (response) {
			return response;
		}

		var data = requestData.data;
		
		var { library, collection } = Trellis.Server.Connector.getSaveTarget();
		var targetID = collection ? collection.treeViewID : library.treeViewID;
		
		try {
			var session = Trellis.Server.Connector.SessionManager.create(
				data.sessionID,
				'saveSnapshot',
				requestData
			);
		}
		catch (e) {
			Trellis.debug(e);
			return [409, "application/json", JSON.stringify({ error: "SESSION_EXISTS" })];
		}
		await session.update(collection ? collection.treeViewID : library.treeViewID);
		
		// Shouldn't happen as long as My Library exists
		if (!library.editable) {
			Trellis.logError("Can't add item to read-only library " + library.name);
			return [500, "application/json", JSON.stringify({ libraryEditable: false })];
		}
		
		try {
			await session.saveSnapshot(targetID);
		}
		catch (e) {
			Trellis.logError(e);
			return 500;
		}
		
		return [201, "application/json"];
	}
};


/**
 * Checks if the item has OA attachments (in case PDF saving in connector failed).
 * Also checks custom resolvers.
 * 
 * Accepts:
 *		sessionID - A session ID previously passed to /saveItems
 *		itemID - The ID of the item to save alternative attachment for
 */
Trellis.Server.Connector.HasAttachmentResolvers = function () {};
Trellis.Server.Endpoints["/connector/hasAttachmentResolvers"] = Trellis.Server.Connector.HasAttachmentResolvers;
Trellis.Server.Connector.HasAttachmentResolvers.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	init: async function (requestData) {
		let data = requestData.data;
		let session = Trellis.Server.Connector.SessionManager.get(data.sessionID);
		if (!session) {
			Trellis.debug("Can't find session " + data.sessionID, 1);
			return [400, "application/json", JSON.stringify({ error: "SESSION_NOT_FOUND" })];
		}
		let item = session.getItemByConnectorKey(data.itemID);
		let resolvers = Trellis.Attachments.getFileResolvers(item, ['oa', 'custom'], true);
		return [200, "application/json", JSON.stringify(resolvers.length > 0)];
	}
}


/**
 * Accepts:
 *		sessionID - A session ID previously passed to /saveItems
 *		itemID - The ID of the item to save alternative attachment for
 *
 * Returns:
 * 		400 - Bad params
 * 		201 - Created and attachment title
 * 		500 - Failed to save
 */
Trellis.Server.Connector.SaveAttachmentFromResolver = function () {};
Trellis.Server.Endpoints["/connector/saveAttachmentFromResolver"] = Trellis.Server.Connector.SaveAttachmentFromResolver;
Trellis.Server.Connector.SaveAttachmentFromResolver.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	init: async function (requestData) {
		let data = requestData.data;
		let session = Trellis.Server.Connector.SessionManager.get(data.sessionID);
		if (!session) {
			Trellis.debug("Can't find session " + data.sessionID, 1);
			return [400, "application/json", JSON.stringify({ error: "SESSION_NOT_FOUND" })];
		}
		let item = session.getItemByConnectorKey(data.itemID);
		let resolvers = Trellis.Attachments.getFileResolvers(item, ['oa', 'custom'], true);

		let attachment = await Trellis.Attachments.addFileFromURLs(item, resolvers);

		if (attachment) {
			return [201, "text/plain", attachment.getDisplayTitle()];
		}
		else {
			return [500, "text/plain", "Failed to save an attachment"];
		}
	}
}

/**
 *
 *
 * Accepts:
 *		sessionID - A session ID previously passed to /saveItems
 *		target - A treeViewID (L1, C23, etc.) for the library or collection to save to
 *		tags - A string of tags separated by commas
 *		note - A string to turn into a child note
 *
 * Returns:
 *		200 response on successful change
 *		400 on error with 'error' property in JSON
 */
Trellis.Server.Connector.UpdateSession = function () {};
Trellis.Server.Endpoints["/connector/updateSession"] = Trellis.Server.Connector.UpdateSession;
Trellis.Server.Connector.UpdateSession.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	
	init: async function (requestData) {
		var data = requestData.data
		
		if (!data.sessionID) {
			return [400, "application/json", JSON.stringify({ error: "SESSION_ID_NOT_PROVIDED" })];
		}
		
		var session = Trellis.Server.Connector.SessionManager.get(data.sessionID);
		if (!session) {
			Trellis.debug("Can't find session " + data.sessionID, 1);
			return [400, "application/json", JSON.stringify({ error: "SESSION_NOT_FOUND" })];
		}
		
		// Parse treeViewID
		var [type, id] = [data.target[0], parseInt(data.target.substr(1))];
		var tags = data.tags;
		// Older connector versions send tags as one string with comma as delimiter
		// To account for tags that contain commas, later versions send an array of strings
		if (typeof tags === 'string') {
			tags = tags.split(",");
		}
		var note = data.note;
		
		if (type == 'C') {
			let collection = await Trellis.Collections.getAsync(id);
			if (!collection) {
				return [400, "application/json", JSON.stringify({ error: "COLLECTION_NOT_FOUND" })];
			}
		}
		
		await session.update(data.target, tags, note);
		
		return [200, "application/json", JSON.stringify({})];
	}
};


Trellis.Server.Connector.DelaySync = function () {};
Trellis.Server.Endpoints["/connector/delaySync"] = Trellis.Server.Connector.DelaySync;
Trellis.Server.Connector.DelaySync.prototype = {
	supportedMethods: ["POST"],
	permitBookmarklet: true,
	
	init: function (requestData) {
		Trellis.Sync.Runner.delaySync(10000);
		return 204;
	}
};

/**
 * Translates resources using import translators
 * 	
 * Returns:
 * 	- Object[Item] an array of imported items
 */
 
Trellis.Server.Connector.Import = function () {};
Trellis.Server.Endpoints["/connector/import"] = Trellis.Server.Connector.Import;
Trellis.Server.Connector.Import.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: '*',
	permitBookmarklet: false,
	
	init: async function (requestData) {
		let dataString = requestData.data;
		if (requestData.data instanceof Ci.nsIInputStream) {
			dataString = Trellis.Server.networkStreamToString(dataString, requestData.headers['content-length']);
		}
		let translate = new Trellis.Translate.Import();
		translate.setString(dataString);
		let translators = await translate.getTranslators();
		if (!translators || !translators.length) {
			return 400;
		}
		translate.setTranslator(translators[0]);
		var { library, collection, editable } = Trellis.Server.Connector.getSaveTarget();
		var libraryID = library.libraryID;
		
		// Shouldn't happen as long as My Library exists
		if (!library.editable) {
			Trellis.logError("Can't import into read-only library " + library.name);
			return [500, "application/json", JSON.stringify({ libraryEditable: false })];
		}
		
		try {
			var session = Trellis.Server.Connector.SessionManager.create(requestData.searchParams.get('session'));
		}
		catch (e) {
			Trellis.debug(e);
			return [409, "application/json", JSON.stringify({ error: "SESSION_EXISTS" })];
		}
		await session.update(collection ? collection.treeViewID : library.treeViewID);
		
		let items = await translate.translate({
			libraryID,
			collections: collection ? [collection.id] : null,
			forceTagType: 1,
			// Import translation skips selection by default, so force it to occur
			saveOptions: {
				skipSelect: false
			}
		});
		items.forEach((item, index) => {
			session.addItem(items[index].id, item);
		});
		
		return [201, "application/json", JSON.stringify(items)];
	}
}

/**
 * Install CSL styles
 * 	
 * Returns:
 * 	- {name: styleName}
 */
 
Trellis.Server.Connector.InstallStyle = function () {};
Trellis.Server.Endpoints["/connector/installStyle"] = Trellis.Server.Connector.InstallStyle;
Trellis.Server.Connector.InstallStyle.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: '*',
	permitBookmarklet: false,
	
	init: async function (requestData) {
		let dataString = requestData.data;
		if (requestData.data instanceof Ci.nsIInputStream) {
			dataString = Trellis.Server.networkStreamToString(dataString, requestData.headers['content-length']);
		}
		try {
			var { styleTitle } = await Trellis.Styles.install(
				dataString, requestData.searchParams.get('origin') || null, true
			);
		} catch (e) {
			return [400, "text/plain", e.message];
		}
		return [201, "application/json", JSON.stringify({name: styleTitle})];
	}
};

/**
 * Get code for a translator
 *
 * Accepts:
 *		translatorID
 * Returns:
 *		code - translator code
 */
Trellis.Server.Connector.GetTranslatorCode = function () {};
Trellis.Server.Endpoints["/connector/getTranslatorCode"] = Trellis.Server.Connector.GetTranslatorCode;
Trellis.Server.Connector.GetTranslatorCode.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	
	/**
	 * Returns a 200 response to say the server is alive
	 * @param {String} data POST data or GET query string
	 * @param {Function} sendResponseCallback function to send HTTP response
	 */
	init: function (postData, sendResponseCallback) {
		var translator = Trellis.Translators.get(postData.translatorID);
		Trellis.Translators.getCodeForTranslator(translator).then(function (code) {
			sendResponseCallback(200, "application/javascript", code);
		});
	}
}

/**
 * Returns the full serialized collection tree (excluding non-editable libraries)
 * and the selected collection tree item.
 *
 * Accepts:
 *		Nothing
 * Returns:
 *		libraryID
 *      libraryName
 *      collectionID
 *      collectionName
 */
Trellis.Server.Connector.GetSelectedCollection = function () {};
Trellis.Server.Endpoints["/connector/getSelectedCollection"] = Trellis.Server.Connector.GetSelectedCollection;
Trellis.Server.Connector.GetSelectedCollection.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: true,
	
	/**
	 * Returns a 200 response to say the server is alive
	 * @param {String} data POST data or GET query string
	 * @param {Function} sendResponseCallback function to send HTTP response
	 */
	init: async function (postData, sendResponseCallback) {
		let allowReadOnly = (postData.hasOwnProperty("switchToReadableLibrary")) ? !postData.switchToReadableLibrary : true;
		var { library, collection, editable } = Trellis.Server.Connector.getSaveTarget(allowReadOnly);
		var response = {
			libraryID: library.libraryID,
			libraryName: library.name,
			libraryEditable: library.editable,
			filesEditable: library.filesEditable,
			editable
		};
		
		if(collection && collection.id) {
			response.id = collection.id;
			response.name = collection.name;
		} else {
			response.id = null;
			response.name = response.libraryName;
		}
		
		// Get list of editable libraries, collections, and tags
		var collections = [];
		let tags = {};
		var originalLibraryID = library.libraryID;
		for (let library of Trellis.Libraries.getAll()) {
			if (!library.editable) continue;
			
			tags[library.treeViewID] = await Trellis.Tags.getAll(library.libraryID);
			// Add recent: true for recent targets
			
			collections.push(
				{
					id: library.treeViewID,
					name: library.name,
					filesEditable: library.filesEditable,
					level: 0
				},
				...Trellis.Collections.getByLibrary(library.libraryID, true).map(c => ({
					id: c.treeViewID,
					name: c.name,
					filesEditable: library.filesEditable,
					level: c.level + 1 || 1 // Added by Trellis.Collections._getByContainer()
				}))
			);
		}
		response.targets = collections;
		response.tags = tags;
		
		// Mark recent targets
		try {
			let recents = Trellis.Prefs.get('recentSaveTargets');
			if (recents) {
				recents = new Set(JSON.parse(recents).map(o => o.id));
				for (let target of response.targets) {
					if (recents.has(target.id)) {
						target.recent = true;
					}
				}
			}
		}
		catch (e) {
			Trellis.logError(e);
			Trellis.Prefs.clear('recentSaveTargets');
		}
		
		sendResponseCallback(
			200,
			"application/json",
			JSON.stringify(response),
			{
				// Filter out collection names in debug output
				logFilter: function (str) {
					try {
						let json = JSON.parse(str.match(/^{"libraryID"[^]+/m)[0]);
						json.targets.forEach(t => t.name = "\u2026");
						return JSON.stringify(json);
					}
					catch (e) {
						return str;
					}
				}
			}
		);
	}
}

/**
 * Get a list of client hostnames (reverse local IP DNS)
 *
 * Accepts:
 *		Nothing
 * Returns:
 * 		{Array} hostnames
 */
Trellis.Server.Connector.GetClientHostnames = {};
Trellis.Server.Connector.GetClientHostnames = function () {};
Trellis.Server.Endpoints["/connector/getClientHostnames"] = Trellis.Server.Connector.GetClientHostnames;
Trellis.Server.Connector.GetClientHostnames.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: false,
	
	/**
	 * Returns a 200 response to say the server is alive
	 */
	init: async function (requestData) {
		try {
			var hostnames = await Trellis.Proxies.DNS.getHostnames();
		} catch(e) {
			return 500;
		}
		return [200, "application/json", JSON.stringify(hostnames)];
	}
};

/**
 * Get a list of stored proxies
 *
 * Accepts:
 *		Nothing
 * Returns:
 * 		{Array} hostnames
 */
Trellis.Server.Connector.Proxies = {};
Trellis.Server.Connector.Proxies = function () {};
Trellis.Server.Endpoints["/connector/proxies"] = Trellis.Server.Connector.Proxies;
Trellis.Server.Connector.Proxies.prototype = {
	supportedMethods: ["POST"],
	supportedDataTypes: ["application/json"],
	permitBookmarklet: false,
	
	/**
	 * Returns a 200 response to say the server is alive
	 */
	init: async function () {
		let proxies = Trellis.Proxies.proxies.map((p) => Object.assign(p.toJSON(), {hosts: p.hosts}));
		return [200, "application/json", JSON.stringify(proxies)];
	}
};


/**
 * Test connection
 *
 * Accepts:
 *		Nothing
 * Returns:
 *		Nothing (200 OK response)
 */
Trellis.Server.Connector.Ping = function () {};
Trellis.Server.Endpoints["/connector/ping"] = Trellis.Server.Connector.Ping;
Trellis.Server.Connector.Ping.prototype = {
	supportedMethods: ["GET", "POST"],
	supportedDataTypes: ["application/json", "text/plain"],
	permitBookmarklet: true,
	
	/**
	 * Sends 200 and HTML status on GET requests
	 * @param data {Object} request information defined in connector.js
	 */
	init: async function (req) {
		if (req.method == 'GET') {
			return [200, "text/html", '<!DOCTYPE html><html>'
				+ '<body>Trellis is running</body></html>'];
		} else {
			// Store the active URL so it can be used for site-specific Quick Copy
			if (req.data.activeURL) {
				//Trellis.debug("Setting active URL to " + req.data.activeURL);
				Trellis.QuickCopy.lastActiveURL = req.data.activeURL;
			}
			let translatorsHash = await Trellis.Translators.getTranslatorsHash(false);
			let sortedTranslatorHash = await Trellis.Translators.getTranslatorsHash(true);
			
			let response = {
				prefs: {
					automaticSnapshots: Trellis.Prefs.get('automaticSnapshots'),
					downloadAssociatedFiles: Trellis.Prefs.get("downloadAssociatedFiles"),
					supportsAttachmentUpload: true,
					supportsTagsAutocomplete: true,
					googleDocsAddNoteEnabled: true,
					googleDocsAddAnnotationEnabled: true,
					canUserAddNote: true,
					googleDocsCitationExplorerEnabled: false,
					translatorsHash,
					sortedTranslatorHash
				}
			};
			if (Trellis.QuickCopy.hasSiteSettings()) {
				response.prefs.reportActiveURL = true;
			}
			
			Trellis.Server.Connector.versionWarning(req);
			
			return [200, 'application/json', JSON.stringify(response)];
		}
	},
	
}
