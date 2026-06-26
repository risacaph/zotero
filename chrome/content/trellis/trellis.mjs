/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2023 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
                     https://www.trellis.org
    
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


const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

/** XPCOM files to be loaded for all modes **/
const xpcomFilesAll = [
	'trellis',
	'commandLineHandler',
	'intl',
	'prefs',
	'dataDirectory',
	'debug',
	'error',
	'utilities/date',
	'utilities/utilities',
	'utilities/utilities_item',
	'utilities/openurl',
	'utilities/xregexp-all',
	'utilities/xregexp-unicode-trellis',
	'utilities_internal',
	'translate/src/utilities_translate',
	'file',
	'http',
	'mimeTypeHandler',
	'pdfWorker/manager',
	'ipc',
	'prompt',
	'profile',
	'progressWindow',
	'proxy',
	'translate/src/translation/translate',
	'translate/src/translator',
	'translate/src/tlds',
	'translation/translate_firefox',
	'isbn',
	'preferencePanes',
	'uiProperties',
];

/** XPCOM files to be loaded only for local translation and DB access **/
const xpcomFilesLocal = [
	'collectionTreeRow',
	'annotations',
	'api',
	'attachments',
	'attachmentReadObserver',
	'browserRequest',
	'cite',
	'citeprocRsBridge',
	'data/library',
	'data/libraries',
	'data/dataObject',
	'data/dataObjects',
	'data/dataObjectUtilities',
	'data/cachedTypes',
	'data/notes',
	'data/item',
	'data/items',
	'data/collection',
	'data/collections',
	'data/feedItem',
	'data/feedItems',
	'data/feed',
	'data/feeds',
	'data/creators',
	'data/group',
	'data/groups',
	'data/itemFields',
	'data/relations',
	'data/search',
	'data/searchConditions',
	'data/searches',
	'data/tags',
	'db',
	'dictionaries',
	'duplicates',
	'editorInstance',
	'feedReader',
	'fileDragDataProvider',
	'fulltext',
	'httpIntegrationClient',
	'id',
	'integration',
	'locale',
	'locateManager',
	'mime',
	'notifier',
	'undoHistory',
	'fileHandlers',
	'osKeyStore',
	'plugins',
	'pluginAPI/menuManager',
	'pluginAPI/itemPaneManager',
	'pluginAPI/itemTreeManager',
	'sdt',
	'reader',
	'progressQueue',
	'progressQueueDialog',
	'quickCopy',
	'recognizeDocument',
	'report',
	'retractions',
	'router',
	'schema',
	'server/server',
	'server/server_integration',
	'server/server_connector',
	'server/server_connectorIntegration',
	'server/server_localAPI',
	'server/saveSession',
	'session',
	'streamer',
	'style',
	'sync',
	'sync/syncAPIClient',
	'sync/syncEngine',
	'sync/syncExceptions',
	'sync/syncEventListeners',
	'sync/syncFullTextEngine',
	'sync/syncLocal',
	'sync/syncRunner',
	'sync/syncUtilities',
	'storage',
	'storage/storageEngine',
	'storage/storageLocal',
	'storage/fileChangeWatcher',
	'storage/storageRequest',
	'storage/storageResult',
	'storage/storageUtilities',
	'storage/zfs',
	'storage/webdav',
	'syncedSettings',
	'uri',
	'users',
	'translation/translate_item',
	'translation/translators',
];

import { CommandLineOptions } from "chrome://trellis/content/modules/commandLineOptions.mjs";

var instanceID = (new Date()).getTime();
var isFirstLoadThisSession = true;
var zContext = null;
var initCallbacks = [];

// Cu.import('resource://trellis/require.js');
// Not using Cu.import here since we don't want the require module to be cached
// for includes within TrellisPane or other code, where we want the window instance available to modules.
Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
	.getService(Components.interfaces.mozIJSSubScriptLoader)
	.loadSubScript('resource://trellis/require.js');

var TrellisContext = function () {}
TrellisContext.prototype = {
	/**
	 * Shuts down Trellis, calls a callback (that may return a promise),
	 * then reinitializes Trellis. Returns a promise that is resolved
	 * when this process completes.
	 */
	reinit: function (cb, options = {}) {
		Services.obs.notifyObservers(zContext.Trellis, "trellis-before-reload");
		return zContext.Trellis.shutdown().then(function () {
			// Unregister custom protocol handler
			Services.io.unregisterProtocolHandler('trellis');
			
			return cb ? cb() : false;
		}).finally(function () {
			makeTrellisContext();
			var o = {};
			Object.assign(o, CommandLineOptions);
			Object.assign(o, options);
			return zContext.Trellis.init(o);
		});
	}
};

ChromeUtils.defineESModuleGetters(TrellisContext.prototype, {
	setTimeout: "resource://gre/modules/Timer.sys.mjs",
	clearTimeout: "resource://gre/modules/Timer.sys.mjs",
	setInterval: "resource://gre/modules/Timer.sys.mjs",
	clearInterval: "resource://gre/modules/Timer.sys.mjs",
	requestIdleCallback: "resource://gre/modules/Timer.sys.mjs",
	cancelIdleCallback: "resource://gre/modules/Timer.sys.mjs",
});

/**
 * The class from which the Trellis global XPCOM context is constructed
 *
 * @constructor
 * This runs when TrellisService is first requested to load all applicable scripts and initialize
 * Trellis. Calls to other XPCOM components must be in here rather than in top-level code, as other
 * components may not have yet been initialized.
 */
function makeTrellisContext() {
	var subscriptLoader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader);
	
	if(zContext) {
		// Swap out old zContext
		var oldzContext = zContext;
		// Create new zContext
		zContext = new TrellisContext();
		// Swap in old Trellis object, so that references don't break, but empty it
		zContext.Trellis = oldzContext.Trellis;
		for(var key in zContext.Trellis) delete zContext.Trellis[key];
	} else {
		zContext = new TrellisContext();
		zContext.Trellis = function () {};

		// Override Date prototype to follow Trellis configured locale (#3880).
		// Patch this module scope, every open chrome window, and each chrome
		// window opened in the future. Each require loader sandbox is patched
		// separately in require.js.
		let dateOverridesURL = "chrome://trellis/content/dateOverrides.js";
		subscriptLoader.loadSubScript(dateOverridesURL);
		for (let win of Services.wm.getEnumerator(null)) {
			subscriptLoader.loadSubScript(dateOverridesURL, win);
		}
		Services.ww.registerNotification({
			observe(subject, topic) {
				if (topic !== 'domwindowopened') {
					return;
				}
				subject.addEventListener('load', () => {
					subscriptLoader.loadSubScript(dateOverridesURL, subject);
				}, { once: true });
			}
		});
	}
	
	// Load trellis.js first
	subscriptLoader.loadSubScript("chrome://trellis/content/xpcom/" + xpcomFilesAll[0] + ".js", zContext, 'utf-8');
	
	// Load CiteProc into Trellis.CiteProc namespace
	zContext.Trellis.CiteProc = {"Trellis":zContext.Trellis};
	subscriptLoader.loadSubScript("chrome://trellis/content/xpcom/citeproc.js", zContext.Trellis.CiteProc, 'utf-8');
	
	// Load XRegExp object into Trellis.XRegExp
	const xregexpFiles = [
		/**Core functions**/
		'xregexp-all',
		'xregexp-unicode-trellis'				//adds support for some Unicode categories used in Trellis
	];
	for (var i=0; i<xregexpFiles.length; i++) {
		subscriptLoader.loadSubScript("chrome://trellis/content/xpcom/utilities/" + xregexpFiles[i] + ".js", zContext, 'utf-8');
	}
	
	// Load remaining xpcomFiles
	for (var i=1; i<xpcomFilesAll.length; i++) {
		try {
			subscriptLoader.loadSubScript("chrome://trellis/content/xpcom/" + xpcomFilesAll[i] + ".js", zContext, 'utf-8');
		}
		catch (e) {
			Components.utils.reportError("Error loading " + xpcomFilesAll[i] + ".js");
			throw (e);
		}
	}
	
	// Load xpcomFiles for specific mode
	for (let xpcomFile of xpcomFilesLocal) {
		try {
			subscriptLoader.loadSubScript("chrome://trellis/content/xpcom/" + xpcomFile + ".js", zContext, "utf-8");
		}
		catch (e) {
			dump("Error loading " + xpcomFile + ".js\n\n");
			dump(e + "\n\n");
			Components.utils.reportError("Error loading " + xpcomFile + ".js");
			throw (e);
		}
	}
	
	// Load platform-specific FileChangeWatcher backend
	{
		let os = Services.appinfo.OS;
		let backendFile = os == "Darwin" ? "storage/fileChangeWatcher_fsevents"
			: os == "WINNT" ? "storage/fileChangeWatcher_rdcw"
			: os == "Linux" ? "storage/fileChangeWatcher_inotify"
			: null;
		if (backendFile) {
			try {
				subscriptLoader.loadSubScript(
					"chrome://trellis/content/xpcom/" + backendFile + ".js", zContext, "utf-8"
				);
			}
			catch (e) {
				dump("Error loading " + backendFile + ".js\n\n");
				dump(e + "\n\n");
				Components.utils.reportError("Error loading " + backendFile + ".js");
			}
		}
	}

	// Load RDF files into Trellis.RDF.AJAW namespace (easier than modifying all of the references)
	const rdfXpcomFiles = [
		'rdf/init',
		'rdf/uri',
		'rdf/term',
		'rdf/identity',
		'rdf/n3parser',
		'rdf/rdfparser',
		'rdf/serialize'
	];
	zContext.Trellis.RDF = {Trellis:zContext.Trellis};
	for (var i=0; i<rdfXpcomFiles.length; i++) {
		subscriptLoader.loadSubScript("chrome://trellis/content/xpcom/translate/src/" + rdfXpcomFiles[i] + ".js", zContext.Trellis.RDF, 'utf-8');
	}
	
	subscriptLoader.loadSubScript("chrome://trellis/content/xpcom/standalone.js", zContext);
	
	// add connector-related properties
	zContext.Trellis.instanceID = instanceID;
	zContext.Trellis.__defineGetter__("isFirstLoadThisSession", function () { return isFirstLoadThisSession; });
};

/**
 * The class representing the Trellis service, and affiliated XPCOM goop
 */
try {
	var start = Date.now();
	
	if(isFirstLoadThisSession) {
		makeTrellisContext(false);
		zContext.Trellis.init(CommandLineOptions)
		.catch(function (e) {
			dump(e + "\n\n");
			Components.utils.reportError(e);
			if (!zContext.Trellis.startupError) {
				zContext.Trellis.startupError = e.stack || e;
			}
		})
		.then(async function () {
			if (zContext.Trellis.startupErrorHandler || zContext.Trellis.startupError) {
				if (zContext.Trellis.startupErrorHandler) {
					await zContext.Trellis.startupErrorHandler();
				}
				else if (zContext.Trellis.startupError) {
					// Try to repair the DB on the next startup, in case it helps resolve
					// the error
					try {
						zContext.Trellis.Schema.setIntegrityCheckRequired(true);
					}
					catch (e) {}
					
					try {
						zContext.Trellis.startupError =
							zContext.Trellis.Utilities.Internal.filterStack(
								zContext.Trellis.startupError
							);
					}
					catch (e) {}
					
					let ps = Services.prompt;
					let buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
						+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_IS_STRING);
					// Get the stringbundle manually
					let errorStr = "Error";
					let quitStr = "Quit";
					let checkForUpdateStr = "Check for Update";
					try {
						let src = 'chrome://trellis/locale/trellis.properties';
						let stringBundleService = Components.classes["@mozilla.org/intl/stringbundle;1"]
							.getService(Components.interfaces.nsIStringBundleService);
						let stringBundle = stringBundleService.createBundle(src);
						errorStr = stringBundle.GetStringFromName('general.error');
						checkForUpdateStr = stringBundle.GetStringFromName('general.checkForUpdate');
						quitStr = stringBundle.GetStringFromName('general.quit');
					}
					catch (e) {}
					let index = ps.confirmEx(
						null,
						errorStr,
						zContext.Trellis.startupError,
						buttonFlags,
						checkForUpdateStr,
						quitStr,
						null,
						null,
						{}
					);
					if (index == 0) {
						Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
							.getService(Components.interfaces.nsIWindowWatcher)
							.openWindow(null, 'chrome://trellis/content/update/updates.xhtml',
								'updateChecker', 'chrome,centerscreen,modal', null);
					}
				}
				zContext.Trellis.Utilities.Internal.quitTrellis();
			}
		});
		
		let cb;
		while (cb = initCallbacks.shift()) {
			cb(zContext.Trellis);
		}
	}
	else {
		zContext.Trellis.debug("Already initialized");
	}
	//this.wrappedJSObject = zContext.Trellis;
}
catch (e) {
	var msg = e instanceof Error
		? e.name + ': ' + e.message + '\n' + e.fileName + ':' + e.lineNumber + '\n' + e.stack
		: '' + e;
	dump(msg + '\n');
	Components.utils.reportError(e);
	throw e;
}

function addInitCallback(callback) {
	if (zContext && zContext.Trellis) {
		callback(zContext.Trellis);
	}
	else {
		initCallbacks.push(callback);
	}
}

/**
 * Determine whether Trellis Standalone is running
 */
function isStandalone() {
	return true;
}

function getOS() {
	return Services.appinfo.OS;
}

function isMac() {
	return getOS() == "Darwin";
}

function isWin() {
	return getOS() == "WINNT";
}

function isLinux() {
	return getOS() == "Linux";
}


export const Trellis = zContext.Trellis;
