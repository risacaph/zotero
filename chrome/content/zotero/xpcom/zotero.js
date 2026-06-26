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

const { BluebirdShimPromise } = ChromeUtils.importESModule('chrome://trellis/content/xpcom/bluebirdShim.mjs');
const { TRELLIS_CONFIG } = ChromeUtils.importESModule('resource://trellis/config.mjs');

// Commonly used imports accessible anywhere
Components.utils.importGlobalProperties(["XMLHttpRequest"]);
var { OS } = ChromeUtils.importESModule("chrome://trellis/content/osfile.mjs");

ChromeUtils.defineESModuleGetters(globalThis, {
	AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
	AppConstants: "resource://gre/modules/AppConstants.sys.mjs",
});
const { CommandLineOptions } = ChromeUtils.importESModule("chrome://trellis/content/modules/commandLineOptions.mjs");

/*
 * Core functions
 */
(function () {
	// Privileged (public) methods
	this.getStorageDirectory = getStorageDirectory;
	this.debug = debug;
	this.setFontSize = setFontSize;
	this.flattenArguments = flattenArguments;
	this.getAncestorByTagName = getAncestorByTagName;
	this.reinit = reinit; // defined in trellis-service.js
	
	// Public properties
	this.initialized = false;
	this.skipLoading = false;
	this.startupError;
	Object.defineProperty(this, 'startupErrorHandler', {
		get: () => _startupErrorHandler,
		enumerable: true,
		configurable: true
	});
	Object.defineProperty(this, 'resourcesDir', {
		get: () => {
			// AChrome is app/chrome
			return FileUtils.getDir('AChrom', []).parent.parent.path;
		},
		enumerable: true,
		configurable: true
	});
	this.version;
	this.platform;
	this.locale;
	this.dir; // locale direction: 'ltr' or 'rtl'
	this.isMac;
	this.isWin;
	this.initialURL; // used by Schema to show the changelog on upgrades
	this.Promise = BluebirdShimPromise;
	
	this.getMainWindow = function () {
		return Services.wm.getMostRecentWindow("navigator:browser");
	};

	/**
	 * @return {ChromeWindow[]} - An array of open windows
	 */
	this.getMainWindows = function () {
		var enumerator = Services.wm.getEnumerator("navigator:browser");
		var windows = [];
		while (enumerator.hasMoreElements()) {
			windows.push(enumerator.getNext());
		}
		return windows;
	};
	
	this.getActiveTrellisPane = function () {
		var win = Services.wm.getMostRecentWindow("navigator:browser");
		return win ? win.TrellisPane : null;
	};
	
	this.getTrellisPanes = function () {
		var enumerator = Services.wm.getEnumerator("navigator:browser");
		var zps = [];
		while (enumerator.hasMoreElements()) {
			let win = enumerator.getNext();
			if (!win.TrellisPane) continue;
			zps.push(win.TrellisPane);
		}
		return zps;
	};
	
	/**
	 * @property	{Boolean}	locked		Whether all Trellis panes are locked
	 *										with an overlay
	 */
	Object.defineProperty(
		this,
		'locked',
		{
			get: () => _locked,
			set: (lock) => {
				var wasLocked = _locked;
				_locked = lock;
				
				if (!wasLocked && lock) {
					this.unlockDeferred = Trellis.Promise.defer();
					this.unlockPromise = this.unlockDeferred.promise;
				}
				else if (wasLocked && !lock) {
					Trellis.debug("Running unlock callbacks");
					this.unlockDeferred.resolve();
				}
			},
			enumerable: true,
			configurable: true
		}
	);
	
	/**
	 * @property {Boolean} crashed - True if the application needs to be restarted
	 */
	this.crashed = false;
	
	/**
	 * @property	{Boolean}	closing		True if the application is closing.
	 */
	this.closing = false;
	
	this.unlockDeferred;
	this.unlockPromise;
	this.initializationDeferred;
	this.initializationPromise;
	
	this.hiDPISuffix = "";
	
	var _startupErrorHandler;
	var _localizedStringBundle;
	
	var _locked = false;
	var _shutdownListeners = [];
	var _progressMessage;
	var _progressMeters;
	var _progressPopup;
	var _lastPercentage;
	
	// whether we are waiting for another Trellis process to release its DB lock
	var _waitingForDBLock = false;
	
	/**
	 * Maintains nsITimers to be used when Trellis.wait() completes (to reduce performance penalty
	 * of initializing new objects)
	 */
	var _waitTimers = [];
	
	/**
	 * Maintains nsITimerCallbacks to be used when Trellis.wait() completes
	 */
	var _waitTimerCallbacks = [];
	
	/**
	 * Maintains running nsITimers in global scope, so that they don't disappear randomly
	 */
	var _runningTimers = new Map();
	
	var _startupTime = new Date();
	// Errors that were in the console at startup
	var _startupErrors = [];
	// Number of errors to maintain in the recent errors buffer
	const ERROR_BUFFER_SIZE = 25;
	// A rolling buffer of the last ERROR_BUFFER_SIZE errors
	var _recentErrors = [];
	
	/**
	 * Initialize the extension
	 *
	 * @return {Promise<Boolean>}
	 */
	this.init = async function (options) {
		if (this.initialized || this.skipLoading) {
			return false;
		}
		
		this.locked = true;
		this.initializationDeferred = Trellis.Promise.defer();
		this.initializationPromise = this.initializationDeferred.promise;
		this.uiReadyDeferred = Trellis.Promise.defer();
		this.uiReadyPromise = this.uiReadyDeferred.promise;
		this.uiReadyPromise.then(() => {
			Trellis.debug("User interface ready in " + (new Date() - _startupTime) + " ms");
		});
		this.startupSyncDeferred = Trellis.Promise.defer();
		this.startupSyncPromise = this.startupSyncDeferred.promise;
		
		if (options) {
			let opts = [
				'openPane',
				'test',
				'automatedTest',
				'skipBundledFiles'
			];
			opts.filter(opt => options[opt]).forEach(opt => this[opt] = true);
			
			this.forceDataDir = options.forceDataDir;
		}
		
		this.mainThread = Services.tm.mainThread;
		
		this.clientName = TRELLIS_CONFIG.CLIENT_NAME;
		
		this.platformVersion = Services.appinfo.platformVersion;
		this.platformMajorVersion = parseInt(this.platformVersion.match(/^[0-9]+/)[0]);
		this.isFx = true;
		this.isClient = true;
		this.isStandalone = true;
		
		this.version = Services.appinfo.version;
		this.isBetaBuild = Trellis.version.includes('-beta');
		this.isDevBuild = Trellis.version.includes('-dev');
		this.isSourceBuild = Trellis.version.includes('SOURCE');
		
		// OS platform
		var os = Services.appinfo.OS;
		this.isMac = os == 'Darwin';
		this.isWin = os == 'WINNT';
		this.isLinux = os == 'Linux';
		
		// aarch64, x86_64, x86
		this.arch = Services.appinfo.XPCOMABI.split('-')[0];
		
		// Browser
		Trellis.browser = "g";
		
		// TEMP: Disable automatic safe mode until we can figure out why some shutdowns are
		// counting as crashes
		var branch = Services.prefs.getBranch("toolkit.startup.");
		if (branch.getIntPref('recent_crashes', 0) > 2) {
			branch.clearUserPref('recent_crashes');
		}
		
		Trellis.Intl.init();
		if (this.restarting) return;
		
		await Trellis.Prefs.init();
		Trellis.Debug.init(options && options.forceDebugLog);
		
		// Make sure that Trellis isn't running as root
		if (!Trellis.isWin) _checkRoot();
		
		if (!_checkExecutableLocation()) {
			return;
		}
		
		try {
			await Trellis.DataDirectory.init();
			if (this.restarting) {
				return;
			}
			var dataDir = Trellis.DataDirectory.dir;
		}
		catch (e) {
			// Trellis dir not found
			if (e.name == 'NotFoundError') {
				let foundInDefault = false;
				try {
					foundInDefault = (await OS.File.exists(Trellis.DataDirectory.defaultDir))
						&& (await OS.File.exists(
							OS.Path.join(
								Trellis.DataDirectory.defaultDir,
								Trellis.DataDirectory.getDatabaseFilename()
							)
						));
				}
				catch (e) {
					Trellis.logError(e);
				}
				
				let previousDir = Trellis.Prefs.get('lastDataDir')
					|| Trellis.Prefs.get('dataDir')
					|| e.dataDir;
				Trellis.startupError = foundInDefault
					? Trellis.getString(
						'dataDir.notFound.defaultFound',
						[
							Trellis.clientName,
							previousDir,
							Trellis.DataDirectory.defaultDir
						]
					)
					: Trellis.getString('dataDir.notFound', Trellis.clientName);
				_startupErrorHandler = async function () {
					var ps = Services.prompt;
					var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
						+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING
						+ ps.BUTTON_POS_2 * ps.BUTTON_TITLE_IS_STRING;
					// TEMP: lastDataDir can be removed once old persistent descriptors have been
					// converted, which they are in getTrellisDirectory() in 5.0
					if (foundInDefault) {
						let index = ps.confirmEx(null,
							Trellis.getString('general.error'),
							Trellis.startupError,
							buttonFlags,
							Trellis.getString('dataDir.useNewLocation'),
							Trellis.getString('general.quit'),
							Trellis.getString('general.locate'),
							null, {}
						);
						// Revert to home directory
						if (index == 0) {
							Trellis.DataDirectory.set(Trellis.DataDirectory.defaultDir);
							Trellis.Utilities.Internal.quit(true);
							return;
						}
						// Locate data directory
						else if (index == 2) {
							await Trellis.DataDirectory.choose(true);
						}

					}
					else {
						let index = ps.confirmEx(null,
							Trellis.getString('general.error'),
							Trellis.startupError
								+ (previousDir
									? '\n\n' + Trellis.getString('dataDir.previousDir') + ' ' + previousDir
									: ''),
							buttonFlags,
							Trellis.getString('general.quit'),
							Trellis.getString('dataDir.useDefaultLocation'),
							Trellis.getString('general.locate'),
							null, {}
						);
						// Revert to home directory
						if (index == 1) {
							Trellis.DataDirectory.set(Trellis.DataDirectory.defaultDir);
							Trellis.Utilities.Internal.quit(true);
							return;
						}
						// Locate data directory
						else if (index == 2) {
							await Trellis.DataDirectory.choose(true);
						}
					}
				}
				return;
			}
			// DEBUG: handle more startup errors
			else {
				throw e;
			}
		}
		
		if (!this.forceDataDir) {
			await Trellis.DataDirectory.checkForMigration(
				dataDir, Trellis.DataDirectory.defaultDir
			);
			if (this.skipLoading) {
				return;
			}
		}
		
		// Make sure data directory isn't in Dropbox, etc.
		await Trellis.DataDirectory.checkForUnsafeLocation(dataDir);
		
		Services.obs.addObserver({
			observe: function () {
				Trellis.Session.save();
			}
		}, "quit-application-granted", false);
		
		// Register shutdown handler to call Trellis.shutdown()
		var _shutdownObserver = {observe:function () { Trellis.shutdown() }};
		Services.obs.addObserver(_shutdownObserver, "quit-application", false);
		
		// Get startup errors
		try {
			let messages = Services.console.getMessageArray();
			_startupErrors = messages.filter(msg => _shouldKeepError(msg));
		} catch(e) {
			Trellis.logError(e);
		}
		// Register error observer
		Services.console.registerListener(ConsoleListener);
		
		// Add shutdown listener to remove quit-application observer and console listener
		this.addShutdownListener(function () {
			Services.obs.removeObserver(_shutdownObserver, "quit-application", false);
			Services.console.unregisterListener(ConsoleListener);
		});
		
		var success = await _initFull();
		if (!success) {
			return false;
		}
			
		Trellis.Standalone.init();
		await Trellis.initComplete();
		// Ingest command line arguments that were not handled due to late command line handler registration.
		Trellis.CommandLineIngester.ingest();
	};
	
	/**
	 * Triggers events when initialization finishes
	 */
	this.initComplete = async function () {
		if(Trellis.initialized) return;
		
		Trellis.debug("Running initialization callbacks");
		delete this.startupError;
		this.initialized = true;
		this.initializationDeferred.resolve();
		
		if(!Trellis.isFirstLoadThisSession) {
			// trigger trellis-reloaded event
			Trellis.debug('Triggering "trellis-reloaded" event');
			Services.obs.notifyObservers(Trellis, "trellis-reloaded", null);
		}
		
		Trellis.debug('Triggering "trellis-loaded" event');
		Services.obs.notifyObservers(Trellis, "trellis-loaded", null);
		
		Trellis.debug('Initializing Word Processor plugins');
		Trellis.Integration.init();
		await Trellis.Plugins.init();
	}
	
	
	this.uiIsReady = function () {
		this.uiReadyDeferred.resolve();
	};
	
	
	/**
	 * Initialization function to be called only if Trellis is in full mode
	 *
	 * @return {Promise:Boolean}
	 */
	var _initFull = async function () {
		if (!((await _initDB()))) return false;
		
		Trellis.VersionHeader.init();
		
		// Check for data reset/restore
		var dataDir = Trellis.DataDirectory.dir;
		var restoreFile = OS.Path.join(dataDir, 'restore-from-server');
		var resetDataDirFile = OS.Path.join(dataDir, 'reset-data-directory');
		
		var result = await Promise.all([OS.File.exists(restoreFile), OS.File.exists(resetDataDirFile)]);
		if (result.some(r => r)) {
			[Trellis.restoreFromServer, Trellis.resetDataDir] = result;
			try {
				await Trellis.DB.closeDatabase();
				
				// TODO: better error handling
				
				// TODO: prompt for location
				// TODO: Back up database
				// TODO: Reset translators and styles
				
				
				
				if (Trellis.restoreFromServer) {
					let dbfile = Trellis.DataDirectory.getDatabase();
					Trellis.debug("Deleting " + dbfile);
					await OS.File.remove(dbfile, { ignoreAbsent: true });
					let storageDir = OS.Path.join(dataDir, 'storage');
					Trellis.debug("Deleting " + storageDir.path);
					OS.File.removeDir(storageDir, { ignoreAbsent: true }),
					await OS.File.remove(restoreFile);
					Trellis.restoreFromServer = true;
				}
				else if (Trellis.resetDataDir) {
					Trellis.initAutoSync = true;
					
					// Clear some user prefs
					[
						'sync.server.username',
						'sync.storage.username'
					].forEach(p => Trellis.Prefs.clear(p));
					
					// Clear data directory
					Trellis.debug("Deleting data directory files");
					let lastError;
					// Delete all files in directory rather than removing directory, in case it's
					// a symlink
					await Trellis.File.iterateDirectory(dataDir, async function (entry) {
						// Don't delete some files
						if (entry.name == 'pipes') {
							return;
						}
						Trellis.debug("Deleting " + entry.path);
						try {
							if (entry.isDir) {
								await OS.File.removeDir(entry.path);
							}
							else {
								await OS.File.remove(entry.path);
							}
						}
						// Keep trying to delete as much as we can
						catch (e) {
							lastError = e;
							Trellis.logError(e);
						}
					});
					if (lastError) {
						throw lastError;
					}
				}
				Trellis.debug("Done with reset");
				
				if (!((await _initDB()))) return false;
			}
			catch (e) {
				// Restore from backup?
				alert(e);
				return false;
			}
		}
		
		Trellis.HTTP.triggerProxyAuth();
		
		// Add notifier queue callbacks to the DB layer
		Trellis.DB.addCallback('begin', id => Trellis.Notifier.begin(id));
		Trellis.DB.addCallback('commit', id => Trellis.Notifier.commit(null, id));
		Trellis.DB.addCallback('rollback', id => Trellis.Notifier.reset(id));

		// Initialize undo history and add its callbacks to the DB layer
		Trellis.UndoHistory.init();
		Trellis.DB.addCallback('begin', id => Trellis.UndoHistory._onTransactionBegin(id));
		Trellis.DB.addCallback('commit', id => Trellis.UndoHistory._onTransactionCommit(id));
		Trellis.DB.addCallback('rollback', id => Trellis.UndoHistory._onTransactionRollback(id));
		
		try {
			// Require >=2.1b3 database to ensure proper locking
			let dbSystemVersion = await Trellis.Schema.getDBVersion('system');
			if (dbSystemVersion > 0 && dbSystemVersion < 31) {
				let ps = Services.prompt;
				var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
					+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_IS_STRING)
					+ (ps.BUTTON_POS_2) * (ps.BUTTON_TITLE_IS_STRING)
					+ ps.BUTTON_POS_2_DEFAULT;
				var index = ps.confirmEx(
					null,
					Trellis.getString('dataDir.incompatibleDbVersion.title'),
					Trellis.getString('dataDir.incompatibleDbVersion.text', Trellis.appName),
					buttonFlags,
					Trellis.getString('general.useDefault'),
					Trellis.getString('dataDir.chooseNewDataDirectory'),
					Trellis.getString('general.quit'),
					null,
					{}
				);
				
				var quit = false;
				
				// Default location
				if (index == 0) {
					Trellis.Prefs.set("useDataDir", false)
					
					Services.startup.quit(
						Components.interfaces.nsIAppStartup.eAttemptQuit
							| Components.interfaces.nsIAppStartup.eRestart
					);
				}
				// Select new data directory
				else if (index == 1) {
					let dir = await Trellis.DataDirectory.choose(true);
					if (!dir) {
						quit = true;
					}
				}
				else {
					quit = true;
				}
				
				if (quit) {
					Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
				}
				
				throw true;
			}
			
			try {
				var updated = await Trellis.Schema.updateSchema({
					onBeforeUpdate: (options = {}) => {
						if (options.minor) return;
						try {
							Trellis.showTrellisPaneProgressMeter(
								Trellis.getString('upgrade.status')
							)
						}
						catch (e) {
							Trellis.logError(e);
						}
					}
				});
			}
			catch (e) {
				Trellis.logError(e);
				
				if (e instanceof Trellis.DB.IncompatibleVersionException) {
					let kbURL = "https://www.trellis.org/support/kb/newer_db_version";
					let msg = (e.dbClientVersion
						? Trellis.getString('startupError.incompatibleDBVersion',
							[Trellis.clientName, e.dbClientVersion])
						: Trellis.getString('startupError.trellisVersionIsOlder')) + "\n\n"
						+ Trellis.getString('startupError.trellisVersionIsOlder.current', Trellis.version)
							+ "\n\n"
						+ Trellis.getString('startupError.trellisVersionIsOlder.upgrade',
							TRELLIS_CONFIG.DOMAIN_NAME);
					Trellis.startupError = msg;
					_startupErrorHandler = function () {
						var ps = Services.prompt;
						var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
							+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL)
							+ (ps.BUTTON_POS_2) * (ps.BUTTON_TITLE_IS_STRING)
							+ ps.BUTTON_POS_0_DEFAULT;
						
						var index = ps.confirmEx(
							null,
							Trellis.getString('general.error'),
							Trellis.startupError,
							buttonFlags,
							Trellis.getString('general.checkForUpdates'),
							null,
							Trellis.getString('general.moreInformation'),
							null,
							{}
						);
						
						// "Check for Update" button
						if (index === 0) {
							Trellis.openCheckForUpdatesWindow({ modal: true });
						}
						// Load More Info page
						else if (index == 2) {
							let uri = Services.io.newURI(kbURL, null, null);
							let handler = Components.classes['@mozilla.org/uriloader/external-protocol-service;1']
								.getService(Components.interfaces.nsIExternalProtocolService)
								.getProtocolHandlerInfo('http');
							handler.preferredAction = Components.interfaces.nsIHandlerInfo.useSystemDefault;
							handler.launchWithURI(uri, null);
						}
					};
					throw e;
				}
				
				let stack = e.stack ? Trellis.Utilities.Internal.filterStack(e.stack) : null;
				Trellis.startupError = Trellis.getString('startupError.databaseUpgradeError')
					+ "\n\n"
					+ (stack || e);
				throw e;
			}
			
			const { TrellisProtocolHandler } = ChromeUtils.importESModule(
				`chrome://trellis/content/TrellisProtocolHandler.mjs`
			);
			TrellisProtocolHandler.init();

			const { TrellisAutoComplete } = ChromeUtils.importESModule(
				`chrome://trellis/content/trellis-autocomplete.mjs`
			);
			
			TrellisAutoComplete.init();

			const { OptionsAutoComplete } = ChromeUtils.importESModule(
				`chrome://trellis/content/modules/optionsAutoComplete.mjs`
			);
			
			OptionsAutoComplete.init();

			await Trellis.Users.init();
			await Trellis.Libraries.init();
			
			await Trellis.ID.init();
			await Trellis.ItemTypes.init();
			await Trellis.ItemFields.init();
			await Trellis.CreatorTypes.init();
			await Trellis.FileTypes.init();
			await Trellis.CharacterSets.init();
			await Trellis.RelationPredicates.init();
			
			await Trellis.Session.init();
			
			Trellis.locked = false;
			
			// Initialize various services
			if(Trellis.Prefs.get("httpServer.enabled")) {
				Trellis.Server.init();
			}
			
			await Trellis.Fulltext.init();
			
			Trellis.Notifier.registerObserver(Trellis.Tags, 'setting', 'tags');
			
			const { registerAutoRenameFileFromParent } = ChromeUtils.importESModule(
				"chrome://trellis/content/renameFiles.mjs"
			);
			registerAutoRenameFileFromParent();
			
			await Trellis.Sync.Data.Local.init();
			await Trellis.Sync.Data.Utilities.init();
			Trellis.Sync.Storage.Local.init();
			Trellis.Sync.Storage.FileChangeWatcher.init();
			Trellis.Sync.Runner = new Trellis.Sync.Runner_Module;
			Trellis.Sync.EventListeners.init();
			Trellis.Streamer = new Trellis.Streamer_Module;
			Trellis.Streamer.init();
			
			Trellis.MIMETypeHandler.init();
			await Trellis.Proxies.init();
			
			// Initialize keyboard shortcuts
			Trellis.Keys.init();
			
			Trellis.Date.init();
			Trellis.LocateManager.init();
			await Trellis.Collections.init();
			await Trellis.Items.init();
			await Trellis.Searches.init();
			await Trellis.Tags.init();
			await Trellis.Creators.init();
			await Trellis.Groups.init();
			await Trellis.Relations.init();
			await Trellis.Retractions.init();
			await Trellis.Dictionaries.init();
			Trellis.Reader.init();
			Trellis.AttachmentReadObserver.init();
			
			// Load all library data except for items, which are loaded when libraries are first
			// clicked on or if otherwise necessary
			await Array.fromAsync(Trellis.Libraries.getAll(), async (library) => {
				await Trellis.SyncedSettings.loadAll(library.libraryID);
				if (library.libraryType != 'feed') {
					await Trellis.Collections.loadAll(library.libraryID);
					await Trellis.Searches.loadAll(library.libraryID);
				}
			});
			
			Trellis.Items.startEmptyTrashTimer();
			
			Trellis.QuickCopy.init();
			Trellis.addShutdownListener(() => Trellis.QuickCopy.uninit());
			
			Trellis.Feeds.init();
			Trellis.addShutdownListener(() => Trellis.Feeds.uninit());
			
			Trellis.Schema.schemaUpdatePromise.then(Trellis.purgeDataObjects.bind(Trellis));
			
			// Migrate fields from Extra that can be moved to item fields after a schema update
			//
			// By default this won't run until after the initial auto-sync, to allow the same
			// changes from elsewhere to be synced down. To test migration after the online library
			// has been updated by a previous run, disable auto-sync.
			Trellis.startupSyncPromise.then(async () => {
				let progressWin;
				let itemProgress;
				// Feed updates (e.g., deleting old items) can interfere with this, so pause them
				// until we're done
				let feedPauser = await Trellis.Feeds.pause();
				try {
					await Trellis.Schema.migrateExtraFields({
						onProgress: ({ progress, progressMax }) => {
							if (!progressWin) {
								progressWin = new Trellis.ProgressWindow({
									closeOnClick: false
								});
								let title = Trellis.getString('upgrade.status');
								progressWin.changeHeadline(title);
								itemProgress = new progressWin.ItemProgress(
									'journalArticle',
									Trellis.getString('migrate-extra-fields-progress-message')
								);
								progressWin.show();
							}
							
							itemProgress.setProgress(progress / progressMax * 100);
						}
					});
				}
				catch (e) {
					Trellis.logError(e);
					itemProgress.setError();
				}
				finally {
					feedPauser.resume();
				}
				if (progressWin) {
					progressWin.startCloseTimer(3000);
				}
			});
			
			return true;
		}
		catch (e) {
			Trellis.logError(e);
			if (!Trellis.startupError) {
				Trellis.startupError = Trellis.getString('startupError', Trellis.appName) + "\n\n"
					+ Trellis.getString('db.integrityCheck.reportInForums') + "\n\n"
					+ e.message ? (e.message + "\n\n" + e.stack) : e;
			}
			return false;
		}
	};
	
	/**
	 * Initializes the DB connection
	 */
	var _initDB = async function (haveReleasedLock) {
		// Initialize main database connection
		Trellis.DB = new Trellis.DBConnection('trellis');
		
		try {
			// Test read access
			await Trellis.DB.test();
			
			let dbfile = Trellis.DataDirectory.getDatabase();

			// Test write access on Trellis data directory
			if (!Trellis.File.pathToFile(PathUtils.parent(dbfile)).isWritable()) {
				var msg = 'Cannot write to ' + PathUtils.parent(dbfile) + '/';
			}
			// Test write access on Trellis database
			else if (!Trellis.File.pathToFile(dbfile).isWritable()) {
				var msg = 'Cannot write to ' + dbfile;
			}
			else {
				var msg = false;
			}
			
			if (msg) {
				var e = {
					name: 'NS_ERROR_FILE_ACCESS_DENIED',
					message: msg,
					toString: function () { return this.message; }
				};
				throw (e);
			}
		}
		catch (e) {
			if (_checkDataDirAccessError(e)) {}
			else if (_checkDataDirStorageIOError(e)) {}
			// Storage busy
			else if (e.message.includes('2153971713')) {
				Trellis.startupError = Trellis.getString('startupError.databaseInUse');
			}
			else {
				let stack = e.stack ? Trellis.Utilities.Internal.filterStack(e.stack) : null;
				Trellis.startupError = Trellis.getString('startupError', Trellis.appName) + "\n\n"
					+ Trellis.getString('db.integrityCheck.reportInForums') + "\n\n"
					+ (stack || e);
			}
			
			Trellis.debug(e.toString(), 1);
			Components.utils.reportError(e); // DEBUG: doesn't always work
			Trellis.skipLoading = true;
			return false;
		}
		
		return true;
	};
	
	
	function _checkDataDirAccessError(e) {
		if (e.name != 'NS_ERROR_FILE_ACCESS_DENIED' && !e.message.includes('2152857621')) {
			return false;
		}
		
		var msg = Trellis.getString('dataDir.databaseCannotBeOpened', Trellis.clientName)
			+ "\n\n"
			+ Trellis.getString('dataDir.checkPermissions', Trellis.clientName);
		// If already using default directory, just show it
		if (Trellis.DataDirectory.dir == Trellis.DataDirectory.defaultDir) {
			msg += "\n\n" + Trellis.getString('dataDir.location', Trellis.DataDirectory.dir);
		}
		// Otherwise suggest moving to default, since there's a good chance this is due to security
		// software preventing Trellis from accessing the selected directory (particularly if it's
		// a Firefox profile)
		else {
			msg += "\n\n"
				+ Trellis.getString('dataDir.moveToDefaultLocation', Trellis.clientName)
				+ "\n\n"
				+ Trellis.getString(
					'dataDir.migration.failure.full.current', Trellis.DataDirectory.dir
				)
				+ "\n"
				+ Trellis.getString(
					'dataDir.migration.failure.full.recommended', Trellis.DataDirectory.defaultDir
				);
		}
		Trellis.startupError = msg;
		return true;
	}


	/**
	 * Check for an SQLite I/O error when using a custom data directory, which typically means
	 * the data directory is on a network share or in a cloud storage folder, and offer the user
	 * a way to reset the data directory to the default location so they can start up without having
	 * to edit prefs.js manually.
	 */
	function _checkDataDirStorageIOError(e) {
		// NS_ERROR_STORAGE_IOERR (0x80630002)
		if (e.name != 'NS_ERROR_STORAGE_IOERR' && !e.message.includes('2153971714')) {
			return false;
		}
		// Only handle the case where a custom data directory is in use -- in the default
		// location, an I/O error is more likely something else (disk issue, antivirus, etc.)
		// and swapping locations probably won't help.
		if (Trellis.DataDirectory.dir == Trellis.DataDirectory.defaultDir) {
			return false;
		}

		Trellis.startupError = Trellis.getString('dataDir.databaseCannotBeOpened', Trellis.clientName)
			+ "\n\n"
			+ Trellis.getString('data-dir-unsupported-storage')
			+ "\n\n"
			+ Trellis.getString('dataDir.location', Trellis.DataDirectory.dir);

		_startupErrorHandler = async function () {
			let index = Trellis.Prompt.confirm({
				title: Trellis.getString('general.error'),
				text: Trellis.startupError,
				button0: Trellis.getString('dataDir.useDefaultLocation'),
				button1: Trellis.getString('general.quit'),
			});
			// Revert to default location
			if (index == 0) {
				Trellis.DataDirectory.set(Trellis.DataDirectory.defaultDir);
				Trellis.Utilities.Internal.quit(true);
			}
		};
		return true;
	}


	this.shutdown = async function () {
		Trellis.debug("Shutting down Trellis");
		
		try {
			// set closing to true
			Trellis.closing = true;
			
			// run shutdown listener
			let shutdownPromises = [];
			for (let listener of _shutdownListeners) {
				try {
					shutdownPromises.push(listener());
				}
				catch(e) {
					Trellis.logError(e);
				}
			}
			await Promise.all(shutdownPromises);
			
			if (Trellis.DB) {
				// close DB
				await Trellis.DB.closeDatabase(true)
			}
		} catch(e) {
			Trellis.logError(e);
		}
	};
	
	
	this.getProfileDirectory = function () {
		Trellis.warn("Trellis.getProfileDirectory() is deprecated -- use Trellis.Profile.dir");
		return Trellis.File.pathToFile(Trellis.Profile.dir);
	}
	
	this.getTrellisDirectory = function () {
		Trellis.warn("Trellis.getTrellisDirectory() is deprecated -- use Trellis.DataDirectory.dir");
		return Trellis.File.pathToFile(Trellis.DataDirectory.dir);
	}
	
	this.getTrellisDatabase = function (name, ext) {
		Trellis.warn("Trellis.getTrellisDatabase() is deprecated -- use Trellis.DataDirectory.getDatabase()");
		return Trellis.File.pathToFile(Trellis.DataDirectory.getDatabase(name, ext));
	}
	
	function getStorageDirectory() {
		return Trellis.File.pathToFile(Trellis.DataDirectory.getSubdirectory('storage', true));
	}

	this.getStylesDirectory = function () {
		return Trellis.File.pathToFile(Trellis.DataDirectory.getSubdirectory('styles', true));
	}
	
	this.getTranslatorsDirectory = function () {
		return Trellis.File.pathToFile(Trellis.DataDirectory.getSubdirectory('translators', true));
	}
	
	var _tmpDir;
	this.getTempDirectory = function () {
		if (_tmpDir) {
			return Trellis.File.pathToFile(_tmpDir);
		}
		var dir;
		try {
			dir = Services.dirsvc.get("TmpD", Ci.nsIFile);
			let relDir;
			if (Trellis.isWin) {
				relDir = 'Trellis';
			}
			else if (Trellis.isMac) {
				relDir = 'org.trellis.trellis';
			}
			else {
				relDir = 'trellis';
			}
			dir.append(relDir);
			Trellis.File.createDirectoryIfMissing(dir);
		}
		// If we can't use the system temp dir, fall back to 'tmp' in the data dir
		catch (e) {
			Trellis.warn(e);
			dir = Trellis.File.pathToFile(Trellis.DataDirectory.getSubdirectory('tmp', true));
		}
		
		AsyncShutdown.profileBeforeChange.addBlocker(
			"Trellis: Removing temp directory",
			() => this.removeTempDirectory()
		);
		
		_tmpDir = dir.path;
		return dir;
	};
	
	this.removeTempDirectory = async function () {
		if (!_tmpDir) return;
		try {
			Trellis.debug("Removing " + _tmpDir);
			return IOUtils.remove(_tmpDir, { recursive: true });
		}
		catch (e) {
			Trellis.logError(e);
		}
	}
	
	
	this.openMainWindow = function () {
		var chromeURI = AppConstants.BROWSER_CHROME_URL;
		var flags = "chrome,all,dialog=no,resizable=yes";
		var ww = Components.classes['@mozilla.org/embedcomp/window-watcher;1']
			.getService(Components.interfaces.nsIWindowWatcher);
		ww.openWindow(null, chromeURI, '_blank', flags, null);
	}
	
	
	this.openCheckForUpdatesWindow = function ({ modal } = {}) {
		let win = Services.wm.getMostRecentWindow('Update:Wizard');
		if (win) {
			win.focus();
		}
		else {
			let flags = 'chrome,centerscreen';
			if (modal) {
				flags += ',modal';
			}
			Services.ww.openWindow(null, 'chrome://trellis/content/update/updates.xhtml',
				'updateChecker', flags, null);
		}
	};
	
	
	/**
	 * Launch a file, the best way we can
	 */
	this.launchFile = function (file) {
		file = Trellis.File.pathToFile(file);
		
		Trellis.Utilities.Internal.Environment.clearMozillaVariables();
		
		try {
			Trellis.debug("Launching " + file.path);
			file.launch();
		}
		catch (e) {
			// macOS only: if there's no associated application, launch() will throw, but
			// the OS will show a dialog asking the user to choose an application. We don't
			// want to show the Firefox dialog in that case.
			if (Trellis.isMac && file.exists()) {
				return;
			}
			
			Trellis.debug(e, 2);
			Trellis.debug("launch() not supported -- trying fallback executable", 2);
			
			try {
				if (Trellis.isWin) {
					var pref = "fallbackLauncher.windows";
				}
				else {
					var pref = "fallbackLauncher.unix";
				}
				let launcher = Trellis.Prefs.get(pref);
				this.launchFileWithApplication(file.path, launcher);
			}
			catch (e) {
				Trellis.debug(e);
				Trellis.debug("Launching via executable failed -- passing to loadURI()");
				
				// If nsIFile.launch() isn't available and the fallback
				// executable doesn't exist, we just let the Firefox external
				// helper app window handle it
				var uri = Services.io.newFileURI(file);
				
				var nsIEPS = Components.classes["@mozilla.org/uriloader/external-protocol-service;1"].
								getService(Components.interfaces.nsIExternalProtocolService);
				nsIEPS.loadURI(
					uri,
					Services.scriptSecurityManager.getSystemPrincipal(),
				);
			}
		}
	};
	
	
	/**
	 * Launch a file with the given application
	 */
	this.launchFileWithApplication = function (filePath, applicationPath) {
		Trellis.debug(`Launching ${filePath} with ${applicationPath}`);
		
		var exec = Trellis.File.pathToFile(applicationPath);
		if (!exec.exists()) {
			throw new Error("'" + applicationPath + "' does not exist");
		}
		
		var args;
		// On macOS, if we only have an .app, launch it using 'open'
		if (Trellis.isMac && applicationPath.endsWith('.app')) {
			args = [filePath, '-a', applicationPath];
			applicationPath = '/usr/bin/open';
		}
		else {
			args = [filePath];
		}
		
		Trellis.Utilities.Internal.Environment.clearMozillaVariables();
		
		// Async, but we don't want to block
		Trellis.Utilities.Internal.exec(applicationPath, args);
	};
	
	
	/**
	 * Launch a URL externally, the best way we can
	 */
	this.launchURL = function (url) {
		if (!Trellis.Utilities.isHTTPURL(url)) {
			if (Trellis.Utilities.isHTTPURL(url, true)) {
				if (!url.startsWith('x-apple.systempreferences:')) {
					url = 'http://' + url;
				}
			}
			// Launch non-HTTP URLs
			else {
				let schemeRE = /^([a-z][a-z0-9+.-]+):/;
				let matches = url.match(schemeRE);
				if (!matches) {
					throw new Error(`Invalid URL '${url}'`);
				}
				let scheme = matches[1];
				if (['javascript', 'data', 'chrome', 'resource'].includes(scheme)) {
					throw new Error(`Invalid scheme '${scheme}'`);
				}
				let svc = Components.classes['@mozilla.org/uriloader/external-protocol-service;1']
					.getService(Components.interfaces.nsIExternalProtocolService);
				let found = {};
				let handlerInfo = svc.getProtocolHandlerInfoFromOS(scheme, found);
				if (!found.value) {
					throw new Error(`Handler not found for '${scheme}' URLs`);
				}
				if (!Trellis.isWin) {
					Trellis.Utilities.Internal.Environment.clearMozillaVariables();
				}
				
				svc.loadURI(Services.io.newURI(url, null, null));
				return;
			}
		}
		
		try {
			if (!Trellis.isWin) {
				Trellis.Utilities.Internal.Environment.clearMozillaVariables();
			}
			
			var uri = Services.io.newURI(url, null, null);
			var handler = Components.classes['@mozilla.org/uriloader/external-protocol-service;1']
							.getService(Components.interfaces.nsIExternalProtocolService)
							.getProtocolHandlerInfo('http');
			handler.preferredAction = Components.interfaces.nsIHandlerInfo.useSystemDefault;
			handler.launchWithURI(uri, null);
		}
		catch (e) {
			Trellis.debug("launchWithURI() not supported -- trying fallback executable");
			
			if (Trellis.isWin) {
				var pref = "fallbackLauncher.windows";
			}
			else {
				var pref = "fallbackLauncher.unix";
			}
			var path = Trellis.Prefs.get(pref);
			
			let exec = Trellis.File.pathToFile(path);
			if (!exec.exists()) {
				throw new Error("Fallback executable not found -- "
					+ "check extensions.trellis." + pref + " in about:config");
			}
			
			Trellis.Utilities.Internal.Environment.clearMozillaVariables();
			
			var proc = Components.classes["@mozilla.org/process/util;1"]
							.createInstance(Components.interfaces.nsIProcess);
			proc.init(exec);
			
			var args = [url];
			proc.runw(false, args, args.length);
		}
	}
	
	
	/**
	 * Opens a URL in the basic viewer, and optionally run a callback on load
	 *
	 * @param {String} uri
	 * @param {Object} [options]
	 * @param {Function} [options.onLoad] - Function to run once URI is loaded; passed the loaded document
	 * @param {Boolean} [options.allowJavaScript] - Set to false to disable JavaScript
	 * @param {Number} [options.userContextId] - To isolate the viewer's cookies
	 *     into the same jar as a Trellis.HTTP.request or HiddenBrowser using the same ID
	 * @param {String} [options.customUserAgent] - Override the User-Agent for all requests
	 *     from this viewer's browsing context
	 */
	this.openInViewer = function (uri, options) {
		if (options && !options.onLoad && typeof options === 'function') {
			Trellis.debug("Trellis.openInViewer() now takes an 'options' object for its second parameter -- update your code");
			options = { onLoad: options };
		}

		var viewerWins = Services.wm.getEnumerator("trellis:basicViewer");
		for (let existingWin of viewerWins) {
			if (existingWin.viewerOriginalURI === uri && existingWin.viewerUserContextId === options?.userContextId) {
				existingWin.focus();
				return existingWin;
			}
		}
		let ww = Components.classes['@mozilla.org/embedcomp/window-watcher;1']
			.getService(Components.interfaces.nsIWindowWatcher);
		let arg = {
			uri,
			options: {
				...options,
				onLoad: undefined
			}
		};
		arg.wrappedJSObject = arg;
		let win = ww.openWindow(null, "chrome://trellis/content/standalone/basicViewer.xhtml",
			null, "chrome,dialog=yes,resizable,centerscreen,menubar,scrollbars", arg);
		if (options?.onLoad) {
			let browser;
			let func = function () {
				win.removeEventListener("load", func);
				// <browser> is created in basicViewer.js in a window load event, so we have to
				// wait for that
				setTimeout(() => {
					browser = win.document.documentElement.getElementsByTagName('browser')[0];
					browser.addEventListener("pageshow", innerFunc);
				});
			};
			let innerFunc = function () {
				browser.removeEventListener("pageshow", innerFunc);
				options.onLoad(browser.contentDocument);
			};
			win.addEventListener("load", func);
		}
		return win;
	};
	
	
	/*
	 * Debug logging function
	 *
	 * Uses prefs e.z.debug.log and e.z.debug.level (restart required)
	 *
	 * @param {} message
	 * @param {Integer} [level=3]
	 * @param {Integer} [maxDepth]
	 * @param {Boolean|Integer} [stack] Whether to display the calling stack.
	 *   If true, stack is displayed starting from the caller. If an integer,
	 *   that many stack levels will be omitted starting from the caller.
	 */
	function debug(message, level, maxDepth, stack) {
		// Account for this alias
		if (stack === true) {
			stack = 1;
		} else if (stack >= 0) {
			stack++;
		}
		
		Trellis.Debug.log(message, level, maxDepth, stack);
	}
	
	
	/*
	 * Log a message to the Mozilla JS error console
	 *
	 * |type| is a string with one of the flag types in nsIScriptError:
	 *    'error', 'warning', 'exception', 'strict'
	 */
	this.log = function (message, type, sourceName, sourceLine, lineNumber, columnNumber) {
		var scriptError = Components.classes["@mozilla.org/scripterror;1"]
			.createInstance(Components.interfaces.nsIScriptError);
		
		if (!type) {
			type = 'warning';
		}
		var flags = scriptError[type + 'Flag'];
		
		scriptError.init(
			message,
			sourceName ? sourceName : null,
			sourceLine != undefined ? sourceLine : null,
			lineNumber != undefined ? lineNumber : null, 
			columnNumber != undefined ? columnNumber : null,
			flags,
			'system javascript',
			false,
			true
		);
		Services.console.logMessage(scriptError);
	};
	
	/**
	 * Log a JS error to the Mozilla error console and debug output
	 * @param {Exception} err
	 */
	this.logError = function (err) {
		Trellis.debug(err, 1);
		this.log(err.message ? err.message : err.toString(), "error",
			err.fileName ? err.fileName : (err.filename ? err.filename : null), null,
			err.lineNumber ? err.lineNumber : null, null);
	}
	
	
	this.warn = function (err) {
		Trellis.debug(err + "\n\n" + Trellis.Utilities.Internal.filterStack(new Error().stack), 2);
		this.log(err.message ? err.message : err.toString(), "warning",
			err.fileName ? err.fileName : (err.filename ? err.filename : null), null,
			err.lineNumber ? err.lineNumber : null, null);
	}
	
	
	/**
	 * Display an alert in a given window
	 *
	 * @param {Window}
	 * @param {String} title
	 * @param {String} msg
	 */
	this.alert = function (window, title, msg) {
		this.debug(`Alert:\n\n${msg}`);
		Services.prompt.alert(window, title, msg);
	}
	
	
	/**
	 * Display an error message saying that an error has occurred and Trellis needs to be restarted.
	 *
	 * If |popup| is TRUE, display in popup progress window; otherwise, display as items pane message
	 */
	this.crash = function (popup) {
		this.crashed = true;
		
		// Check the database after restart
		Trellis.Schema.setIntegrityCheckRequired(true).catch(e => this.logError(e));
		
		var reportErrorsStr = Trellis.getString('errorReport.reportErrors');
		var reportInstructions = Trellis.getString('errorReport.reportInstructions', reportErrorsStr);
		
		var msg;
		if (popup) {
			msg = Trellis.getString('general.pleaseRestart', Trellis.appName) + ' '
				+ reportInstructions;
		}
		else {
			msg = Trellis.getString('general.errorHasOccurred') + ' '
				+ Trellis.getString('general.pleaseRestart', Trellis.appName) + '\n\n'
				+ reportInstructions;
		}
		Trellis.logError(msg);
		Trellis.logError(new Error().stack);
		
		this.startupError = msg;
		this.startupErrorHandler = null;
		
		var enumerator = Services.wm.getEnumerator("navigator:browser");
		while (enumerator.hasMoreElements()) {
			let win = enumerator.getNext();
			if (!win.TrellisPane) continue;
			
			// Display as popup progress window
			if (popup) {
				var pw = new Trellis.ProgressWindow();
				pw.changeHeadline(Trellis.getString('general.errorHasOccurred'));
				pw.addDescription(msg);
				pw.show();
				pw.startCloseTimer(8000);
			}
			// Display as items pane message
			else {
				win.TrellisPane.setItemsPaneMessage(msg, true);
			}
		}
	};
	
	
	this.getErrors = function (asStrings) {
		var errors = [];
		
		for (let msg of _startupErrors.concat(_recentErrors)) {
			let altMessage;
			// Remove password in malformed XML errors
			if (msg.category == 'malformed-xml') {
				try {
					// msg.message is read-only, so store separately
					altMessage = msg.message.replace(/(https?:\/\/[^:]+:)([^@]+)(@[^"]+)/, "$1****$3");
				}
				catch (e) {}
			}
			
			if (asStrings) {
				errors.push(altMessage || msg.message)
			}
			else {
				errors.push(msg);
			}
		}
		return errors;
	}

	this.isWin64EmulatedOnArm = function () {
		if (!this.isWin) {
			return false;
		}

		if (Services.sysinfo.getProperty("build") < 22000) {
			// GetMachineTypeAttributes is only available on Windows 11 and later
			return false;
		}

		if (this.arch !== "x86_64") {
			// We only check if x86_64 build is running on ARM
			return false;
		}

		// https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ne-processthreadsapi-machine_attributes
		const userEnabled = 0x00000001;

		let { ctypes } = ChromeUtils.importESModule(
			"resource://gre/modules/ctypes.sys.mjs"
		);
		try {
			// https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getmachinetypeattributes
			let kernel32 = ctypes.open("Kernel32");
			let getMachineTypeAttributesC = kernel32.declare(
				"GetMachineTypeAttributes",
				ctypes.winapi_abi,
				ctypes.int,
				ctypes.unsigned_short,
				ctypes.int.ptr
			);
			let aa64 = 0xaa64;
			let output = ctypes.int();
			getMachineTypeAttributesC(aa64, output.address());
			kernel32.close();
			return !!(output.value & userEnabled);
		}
		catch (e) {
			Trellis.logError(e);
			return false;
		}
	}

	this.isLinux64EmulatedOnArm = function () {
		if (!this.isLinux) {
			return false;
		}
		
		// We only check if x86_64 build is running on ARM
		if (this.arch !== "x86_64") {
			return false;
		}
		
		try {
			const { ctypes } = ChromeUtils.importESModule(
				"resource://gre/modules/ctypes.sys.mjs"
			);
			
			let utsname = ctypes.StructType("utsname", [
				{ sysname: ctypes.ArrayType(ctypes.char, 65) },
				{ nodename: ctypes.ArrayType(ctypes.char, 65) },
				{ release: ctypes.ArrayType(ctypes.char, 65) },
				{ version: ctypes.ArrayType(ctypes.char, 65) },
				{ machine: ctypes.ArrayType(ctypes.char, 65) },
				{ domainname: ctypes.ArrayType(ctypes.char, 65) }
			]);
			
			let libc = ctypes.open("libc.so.6");
			let unameC = libc.declare(
				"uname",
				ctypes.default_abi,
				ctypes.int,
				utsname.ptr
			);
			
			let buf = utsname();
			if (unameC(buf.address()) !== 0) {
				libc.close();
				return false;
			}
			
			let machine = buf.machine.readString().trim();	// e.g., "x86_64", "aarch64"
			libc.close();
			
			return ["aarch64", "arm64"].includes(machine.toLowerCase());
		}
		catch (e) {
			Trellis.logError(e);
			return false;
		}
	};
	
	/**
	 * Get versions, platform, etc.
	 */
	this.getSystemInfo = async function () {
		var version = Trellis.version + ' (';
		
		var arch = Trellis.arch;
		if (arch == 'aarch64') {
			arch = 'ARM64';
		}
		else if (arch == 'x86_64') {
			arch = 'x64';
		}
		version += arch;
		
		if (Trellis.isWin) {
			let info = await Services.sysinfo.processInfo;
			if (info.isWowARM64 || this.isWin64EmulatedOnArm()) {
				version += " on ARM64";
			}
			else if (info.isWow64) {
				version += " on x64";
			}
		}
		version += ')';
		
		var info = {
			appName: Services.appinfo.name,
			version,
			os: await this.getOSVersion(),
			locale: Trellis.locale,
		};
		
		if (Services.appinfo.inSafeMode) {
			info.safeMode = true;
		}
		
		var extensions = await Trellis.getInstalledExtensions();
		info.extensions = extensions.join(', ');
		
		var str = '';
		for (var key in info) {
			str += key + ' => ' + info[key] + ', ';
		}
		str = str.substr(0, str.length - 2);
		return str;
	};
	
	
	/**
	 * Return OS and OS version
	 *
	 * "macOS 13.3.1"
	 * "Windows 10.0 19043"
	 * "Windows 11 22000"
	 * "Linux 5.4.0-148-generic #165-Ubuntu SMP Tue Apr 18 08:53:12 UTC 2023"
	 *
	 * @return {String}
	 */
	this.getOSVersion = async function () {
		if (Trellis.isMac) {
			try {
				return "macOS "
					+ (await Trellis.Utilities.Internal.subprocess('/usr/bin/sw_vers', ['-productVersion'])).trim();
			}
			catch (e) {
				Trellis.logError(e);
			}
		}
		
		var name = Services.sysinfo.getProperty("name");
		var version = Services.sysinfo.getProperty("version");
		var build = Services.sysinfo.getProperty("build");
		if (Trellis.isWin) {
			name = "Windows";
			// Builds above 22000 are Windows 11
			if (build >= 22000) {
				version = 11;
			}
		}
		return name + " " + version + " " + build;
	};
	
	
	/**
	 * @return {Promise<String[]>} - Promise for an array of extension names and versions
	 */
	this.getInstalledExtensions = async function () {
		var { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
		var installed = await AddonManager.getAllAddons();
	
		installed.sort(function (a, b) {
			return ((a.appDisabled || a.userDisabled) ? 1 : 0) -
				((b.appDisabled || b.userDisabled) ? 1 : 0);
		});
		var addons = [];
		var isSafeMode = Services.appinfo.inSafeMode;
		for (let addon of installed) {
			if (addon.type == "theme") {
				continue;
			}
			
			addons.push(addon.name + " (" + addon.version
				+ (addon.type != 2 ? ", " + addon.type : "")
				+ ((addon.appDisabled || addon.userDisabled || isSafeMode) ? ", disabled" : "")
				+ ")");
		}
		
		return addons;
	};
	
	this.getString = function (name, params, num) {
		return Trellis.Intl.getString(...arguments);
	}
	
	this.defineProperty = (...args) => Trellis.Utilities.Internal.defineProperty(...args);

	this.extendClass = (...args) => Trellis.Utilities.Internal.extendClass(...args);

	this.getLocaleCollation = function () {
	  return Trellis.Intl.collation;
	}

	this.localeCompare = function (...args) {
		return Trellis.Intl.compare(...args);
	}
	
	function setFontSize(rootElement) {
		return Trellis.Utilities.Internal.setFontSize(rootElement);
	}
	
	function flattenArguments(args){
		return Trellis.Utilities.Internal.flattenArguments(args);
	}
	
	function getAncestorByTagName(elem, tagName){
		return Trellis.Utilities.Internal.getAncestorByTagName(elem, tagName);
	}
	
	this.randomString = function (len, chars) {
		return Trellis.Utilities.randomString(len, chars);
	}
	
	
	this.moveToUnique = function (file, newFile) {
		Trellis.debug("Trellis.moveToUnique() is deprecated -- use Trellis.File.moveToUnique()", 2);
		newFile.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0o644);
		var newName = newFile.leafName;
		newFile.remove(null);
		
		// Move file to unique name
		file.moveTo(newFile.parent, newName);
		return file;
	}
	
	this.lazy = function (fn) {
		return Trellis.Utilities.Internal.lazy(fn);
	}
	
	this.serial = function (fn) {
		return Trellis.Utilities.Internal.serial(fn);
	}
	
	/**
	 * Show Trellis pane overlay and progress bar in all windows
	 *
	 * @param {String} msg
	 * @param {Boolean} [determinate=false]
	 * @param {Boolean} [modalOnly=false] - Don't use popup if Trellis pane isn't showing
	 * @return	void
	 */
	this.showTrellisPaneProgressMeter = function (msg, determinate, icon, modalOnly) {
		// If msg is undefined, keep any existing message. If false/null/"", clear.
		// The message is also cleared when the meters are hidden.
		_progressMessage = msg = (msg === undefined ? _progressMessage : msg) || "";
		var currentWindow = Services.wm.getMostRecentWindow("navigator:browser");
		var enumerator = Services.wm.getEnumerator("navigator:browser");
		var progressMeters = [];
		while (enumerator.hasMoreElements()) {
			var win = enumerator.getNext();
			if(!win.TrellisPane) continue;
			
			var label = win.TrellisPane.document.getElementById('trellis-pane-progress-label');
			if (!label) {
				Components.utils.reportError("label not found in " + win.document.location.href);
			}
			if (msg) {
				label.hidden = false;
				label.value = msg;
			}
			else {
				label.hidden = true;
			}
			// This is the craziest thing. In Firefox 52.6.0, the very presence of this line
			// causes Trellis on Linux to burn 5% CPU at idle, even if everything below it in
			// the block is commented out. Same if the progressmeter itself is hidden="true".
			// For some reason it also doesn't seem to work to set the progressmeter to
			// 'determined' when hiding, which we're doing in lookup.js. So instead, create a new
			// progressmeter each time and delete it in _hideWindowTrellisPaneOverlay().
			//
			//let progressMeter = win.TrellisPane.document.getElementById('trellis-pane-progressmeter');
			let doc = win.TrellisPane.document;
			let container = doc.getElementById('trellis-pane-progressmeter-container');
			let id = 'trellis-pane-progressmeter';
			let progressMeter = doc.getElementById(id);
			if (!progressMeter) {
				progressMeter = doc.createElement('progress');
				progressMeter.id = id;
			}
			if (determinate) {
				progressMeter.setAttribute('value', 0);
				progressMeter.max = 1000;
			}
			else {
				progressMeter.removeAttribute('value');
			}
			container.appendChild(progressMeter);
			
			_showWindowTrellisPaneOverlay(win.TrellisPane.document);
			win.TrellisPane.document.getElementById('trellis-pane-overlay-deck').selectedIndex = 0;
			
			progressMeters.push(progressMeter);
		}
		this.locked = true;
		_progressMeters = progressMeters;
	}
	
	
	/**
	 * @param	{Number}	percentage		Percentage complete as integer or float
	 */
	this.updateTrellisPaneProgressMeter = function (percentage) {
		if(percentage !== null) {
			if (percentage < 0 || percentage > 100) {
				Trellis.debug("Invalid percentage value '" + percentage + "' in Trellis.updateTrellisPaneProgressMeter()");
				return;
			}
			percentage = Math.round(percentage * 10);
		}
		if (percentage === _lastPercentage) {
			return;
		}
		for (let pm of _progressMeters) {
			if (percentage !== null) {
				if (!pm.hasAttribute('value')) {
					pm.max = 1000;
				}
				pm.setAttribute('value', percentage);
			}
			else if (pm.hasAttribute('value')) {
				pm.removeAttribute('value');
			}
		}
		_lastPercentage = percentage;
	}
	
	
	/**
	 * Hide Trellis pane overlay in all windows
	 */
	this.hideTrellisPaneOverlays = function () {
		this.locked = false;
		
		var enumerator = Services.wm.getEnumerator("navigator:browser");
		while (enumerator.hasMoreElements()) {
			var win = enumerator.getNext();
			if(win.TrellisPane && win.TrellisPane.document) {
				_hideWindowTrellisPaneOverlay(win.TrellisPane.document);
			}
		}
		
		if (_progressPopup) {
			_progressPopup.close();
		}
		
		_progressMessage = null;
		_progressMeters = [];
		_progressPopup = null;
		_lastPercentage = null;
	}
	
	
	/**
	 * Adds a listener to be called when Trellis shuts down (even if Firefox is not shut down)
	 */
	this.addShutdownListener = function (listener) {
		_shutdownListeners.push(listener);
	}
	
	function _showWindowTrellisPaneOverlay(doc) {
		doc.getElementById('trellis-collections-tree').disabled = true;
		doc.getElementById('trellis-items-tree').disabled = true;
		doc.getElementById('trellis-pane-overlay').hidden = false;
	}
	
	
	function _hideWindowTrellisPaneOverlay(doc) {
		doc.getElementById('trellis-collections-tree').disabled = false;
		doc.getElementById('trellis-items-tree').disabled = false;
		doc.getElementById('trellis-pane-overlay').hidden = true;
		
		// See note in showTrellisPaneProgressMeter()
		let pm = doc.getElementById('trellis-pane-progressmeter');
		if (pm) {
			pm.parentNode.removeChild(pm);
		}
	}
	
	
	this.updateQuickSearchBox = function (document) {
		var searchBox = document.getElementById('trellis-tb-search');
		if (searchBox) {
			searchBox.updateMode();
		}
	};
	
	
	/*
	 * Clear entries that no longer exist from various tables
	 */
	this.purgeDataObjects = async function () {
		var d = new Date();
		
		await Trellis.Creators.purge();
		await Trellis.DB.executeTransaction(async function () {
			return Trellis.Tags.purge();
		});
		await Trellis.Fulltext.purgeUnusedWords();
		await Trellis.Items.purge();
		// DEBUG: this might not need to be permanent
		//yield Trellis.DB.executeTransaction(async function () {
		//	return Trellis.Relations.purge();
		//});
		
		Trellis.debug("Purged data tables in " + (new Date() - d) + " ms");
	};
	
	
	this.reloadDataObjects = function () {
		return Promise.all([
			Trellis.Collections.reloadAll(),
			Trellis.Creators.reloadAll(),
			Trellis.Items.reloadAll()
		]);
	}
	
	
	/**
	 * Brings Trellis Standalone to the foreground
	 */
	this.activateStandalone = function () {
		var uri = Services.io.newURI('trellis://select', null, null);
		var handler = Components.classes['@mozilla.org/uriloader/external-protocol-service;1']
					.getService(Components.interfaces.nsIExternalProtocolService)
					.getProtocolHandlerInfo('trellis');
		handler.preferredAction = Components.interfaces.nsIHandlerInfo.useSystemDefault;
		handler.launchWithURI(uri, null);
	}
	
	/**
	 * Determines whether to keep an error message so that it can (potentially) be reported later
	 */
	function _shouldKeepError(msg) {
		const skip = ['CSS Parser', 'content javascript'];
		
		//Trellis.debug(msg);
		try {
			msg.QueryInterface(Components.interfaces.nsIScriptError);
			//Trellis.debug(msg);
			if (skip.indexOf(msg.category) != -1 || msg.flags & msg.warningFlag) {
				return false;
			}
		}
		catch (e) { }
		
		const blacklist = [
			"No chrome package registered for chrome://communicator",
			'[JavaScript Error: "Components is not defined" {file: "chrome://nightly/content/talkback/talkback.js',
			'[JavaScript Error: "document.getElementById("sanitizeItem")',
			'No chrome package registered for chrome://piggy-bank',
			'[JavaScript Error: "[Exception... "\'Component is not available\' when calling method: [nsIHandlerService::getTypeFromExtension',
			'[JavaScript Error: "this._uiElement is null',
			'Error: a._updateVisibleText is not a function',
			'[JavaScript Error: "Warning: unrecognized command line flag ',
			'LibX:',
			'function skype_',
			'[JavaScript Error: "uncaught exception: Permission denied to call method Location.toString"]',
			'CVE-2009-3555',
			'OpenGL',
			'trying to re-register CID',
			'Services.HealthReport',
			'[JavaScript Error: "this.docShell is null"',
			'[JavaScript Error: "downloadable font:',
			'[JavaScript Error: "Image corrupt or truncated:',
			'[JavaScript Error: "The character encoding of the',
			'nsLivemarkService.js',
			'Sync.Engine.Tabs',
			'content-sessionStore.js',
			'org.mozilla.appSessions',
			'bad script XDR magic number',
			'did not contain an updates property',
		];
		
		for (var i=0; i<blacklist.length; i++) {
			if (msg.message.indexOf(blacklist[i]) != -1) {
				//Trellis.debug("Skipping blacklisted error: " + msg.message);
				return false;
			}
		}
		
		return true;
	}

	/**
	 * Warn if Trellis Standalone is running as root and clobber the cache directory if it is
	 */
	function _checkRoot() {
		var env = Components.classes["@mozilla.org/process/environment;1"].
			getService(Components.interfaces.nsIEnvironment);
		var user = env.get("USER") || env.get("USERNAME");
		if(user === "root") {
			// Show warning
			if(Services.prompt.confirmEx(null, "", Trellis.getString("standalone.rootWarning"),
					Services.prompt.BUTTON_POS_0*Services.prompt.BUTTON_TITLE_IS_STRING |
					Services.prompt.BUTTON_POS_1*Services.prompt.BUTTON_TITLE_IS_STRING,
					Trellis.getString("standalone.rootWarning.exit"),
					Trellis.getString("standalone.rootWarning.continue"),
					null, null, {}) == 0) {
				const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
				var exit = Trellis.IPC.getLibc().declare("exit", ctypes.default_abi,
					                                    ctypes.void_t, ctypes.int);
				// Zap cache files
				try {
					Services.dirsvc.get("ProfLD", Components.interfaces.nsIFile).remove(true);
				} catch(e) {}
				// Exit Trellis without giving XULRunner the opportunity to figure out the
				// cache is missing. Otherwise XULRunner will zap the prefs
				exit(0);
			}
		}
	}
	
	function _checkExecutableLocation() {
		// Make sure Trellis wasn't started from a Mac disk image, which can cause bundled extensions
		// not to load and possibly other problems
		if (Trellis.isMac && OS.Constants.Path.libDir.includes('AppTranslocation')) {
			let ps = Services.prompt;
			let buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING;
			ps.confirmEx(
				null,
				Trellis.getString('general.error'),
				Trellis.getString('startupError.startedFromDiskImage1', Trellis.clientName)
					+ '\n\n'
					+ Trellis.getString('startupError.startedFromDiskImage2', Trellis.clientName),
				buttonFlags,
				Trellis.getString('general.quitApp', Trellis.clientName),
				null, null, null, {}
			);
			Trellis.Utilities.Internal.quit();
			return false;
		}
		
		return true;
	}
	
	/**
	 * Observer for console messages
	 * @namespace
	 */
	var ConsoleListener = {
		"QueryInterface":ChromeUtils.generateQI([Components.interfaces.nsIConsoleMessage,
			Components.interfaces.nsISupports]),
		"observe":function (msg) {
			if(!_shouldKeepError(msg)) return;
			if(_recentErrors.length === ERROR_BUFFER_SIZE) _recentErrors.shift();
			_recentErrors.push(msg);
		}
	};
}).call(Trellis);


/*
 * Handles keyboard shortcut initialization from preferences, optionally
 * overriding existing global shortcuts
 *
 * Actions are configured in TrellisPane.handleKeyPress()
 */
Trellis.Keys = new function () {
	this.init = init;
	this.windowInit = windowInit;
	this.getCommand = getCommand;
	
	var _keys = {};
	
	
	/*
	 * Called by Trellis.init()
	 */
	function init() {
		var cmds = Trellis.Prefs.rootBranch.getChildList(TRELLIS_CONFIG.PREF_BRANCH + 'keys', {}, {});
		
		// Get the key=>command mappings from the prefs
		for (let cmd of cmds) {
			cmd = cmd.replace(/^extensions\.trellis\.keys\./, '');
			// Remove old pref
			if (cmd == 'overrideGlobal') {
				Trellis.Prefs.clear('keys.overrideGlobal');
				continue;
			}
			_keys[this.getKeyForCommand(cmd)] = cmd;
		}
	}
	
	
	/*
	 * Called by TrellisPane.onLoad()
	 */
	function windowInit(document) {
		var globalKeys = [
			{
				name: 'saveToTrellis',
				defaultKey: 'S'
			}
		];
		
		globalKeys.forEach(function (x) {
			let keyElem = document.getElementById('key_' + x.name);
			if (keyElem) {
				let prefKey = this.getKeyForCommand(x.name);
				// Only override the default with the pref if the <key> hasn't
				// been manually changed and the pref has been
				if (keyElem.getAttribute('key') == x.defaultKey
						&& keyElem.getAttribute('modifiers') == 'accel shift'
						&& prefKey != x.defaultKey) {
					keyElem.setAttribute('key', prefKey);
				}
			}
		}.bind(this));
	}
	
	
	function getCommand(key) {
		key = key.toUpperCase();
		return _keys[key] ? _keys[key] : false;
	}
	
	
	this.getKeyForCommand = function (cmd) {
		try {
			var key = Trellis.Prefs.get('keys.' + cmd);
		}
		catch (e) {}
		return key !== undefined ? key.toUpperCase() : false;
	}
}


/**
 * Identify client when connecting to first-party domains
 *
 * @namespace
 */
Trellis.VersionHeader = {
	_plainUAHosts: new Set(),
	_uaAppSuffixRe: null,
	_uaFirefoxComponent: null,

	init: function () {
		this.register();
		Trellis.addShutdownListener(this.unregister);
	},
	
	register: function () {
		Services.obs.addObserver(this, "http-on-modify-request", false);
	},
	
	observe: function (subject, topic, data) {
		try {
			let channel = subject.QueryInterface(Components.interfaces.nsIHttpChannel);
			let domain = channel.URI.host;
			// Add X-Trellis-Version header to HTTP requests to trellis.org
			let isPrimaryDomain = domain == TRELLIS_CONFIG.DOMAIN_NAME
				|| domain.endsWith('.' + TRELLIS_CONFIG.DOMAIN_NAME);
			if (isPrimaryDomain) {
				channel.setRequestHeader("X-Trellis-Version", Trellis.version, false);
			}
			else {
				// Use "Firefox/[version]" in user agent if not a proxy check or file sync request
				let s3RE = /(trellisproxycheck|trellisfilestorage(test)?)\.s3\.(us-east-1\.)?amazonaws\.com|files\.trellis\.net/;
				let isAppNameDomain = s3RE.test(domain);
				if (!isAppNameDomain) {
					let ua = channel.getRequestHeader('User-Agent');
					ua = this.update(ua, {
						mode: this._plainUAHosts.has(domain) ? 'plain' : 'full',
					});
					channel.setRequestHeader('User-Agent', ua, false);
				}
			}
		}
		catch (e) {
			Trellis.debug(e, 1);
		}
	},
	
	/**
	 * Register a host that needs the "Trellis/[version]" component stripped
	 * from its requests' UA. Currently this is only used for hosts that we
	 * handle Cloudflare Turnstile challenges on; Turnstile won't pass with
	 * Trellis/ in the UA string, and future requests need the same UA as the
	 * one that passed Turnstile, so we have to override for all requests to
	 * the host.
	 *
	 * @param {string} host
	 */
	registerPlainUAHost: function (host) {
		this._plainUAHosts.add(host);
	},

	/**
	 * @param {String} ua
	 * @param {'full' | 'plain'} [mode='full'] If 'full', add Firefox/[version] to the default user agent. If 'plain', remove
	 * 		Trellis/[version] instead.
	 * @return {String}
	 */
	update: function (ua, { mode = 'full' } = {}) {
		var info = Services.appinfo;
		if (!this._uaAppSuffixRe) {
			this._uaAppSuffixRe = new RegExp(`\\s*${info.name}/\\S+`);
			this._uaFirefoxComponent = `Firefox/${info.platformVersion.match(/^\d+/)[0]}.0`;
		}
		if (mode === 'plain') {
			ua = ua.replace(this._uaAppSuffixRe, '');
			if (!/\bFirefox\//.test(ua)) {
				ua += ` ${this._uaFirefoxComponent}`;
			}
		}
		else {
			let pos = ua.indexOf(info.name + '/');
			// Default UA (not a faked UA from the connector)
			if (pos != -1) {
				ua = ua.substring(0, pos) + `${this._uaFirefoxComponent} ` + ua.substring(pos);
			}
		}
		return ua;
	},

	/**
	 * Plain Firefox UA, without the "Trellis/[version]" suffix.
	 *
	 * @return {String}
	 */
	getPlainFirefoxUA: function () {
		var ua = Cc["@mozilla.org/network/protocol;1?name=http"]
			.getService(Ci.nsIHttpProtocolHandler).userAgent;
		return this.update(ua, { mode: 'plain' });
	},
	
	unregister: function () {
		Services.obs.removeObserver(Trellis.VersionHeader, "http-on-modify-request");
	}
}

Trellis.DragDrop = {
	currentEvent: null,
	currentOrientation: 0,
	
	getDataFromDataTransfer: function (dataTransfer, firstOnly) {
		var dt = dataTransfer;
		
		var dragData = {
			dataType: '',
			data: [],
			dropEffect: dt.dropEffect
		};
		
		var len = firstOnly ? 1 : dt.mozItemCount;
		
		if (dt.types.includes('trellis/collection')) {
			dragData.dataType = 'trellis/collection';
			let ids = dt.getData('trellis/collection').split(",").map(id => parseInt(id));
			dragData.data = ids;
		}
		else if (dt.types.includes('trellis/item')) {
			dragData.dataType = 'trellis/item';
			let ids = dt.getData('trellis/item').split(",").map(id => parseInt(id));
			dragData.data = ids;
		}
		else if (dt.types.includes('trellis/search')) {
			dragData.dataType = 'trellis/search';
			let ids = dt.getData('trellis/search').split(",").map(id => parseInt(id));
			dragData.data = ids;
		}
		else {
			if (dt.types.includes('application/x-moz-file')) {
				dragData.dataType = 'application/x-moz-file';
				var files = [];
				for (var i = 0; i < len; i++) {
					var file = dt.mozGetDataAt("application/x-moz-file", i);
					if (!file) {
						continue;
					}
					file.QueryInterface(Components.interfaces.nsIFile);
					if (Trellis.isMac && /%[0-9A-F]{2}/.test(file.path) && !file.exists()) {
						// On macOS, Firefox reads a file URL from `public.file-url`,
						// constructs an NSURL from it, then gets its unescaped path using
						// stringByReplacingPercentEscapesUsingEncoding:
						//   https://searchfox.org/mozilla-central/rev/fcfb558f/widget/cocoa/nsCocoaUtils.mm#1668-1673
						// But that function uses a strict URI parser that chokes on things
						// like errant brackets in the file path, and when it chokes, the
						// URI is left escaped. Unescape it ourselves.
						file = Trellis.File.pathToFile(decodeURIComponent(file.path));
					}
					// Don't allow folder drag
					if (file.isDirectory()) {
						continue;
					}
					files.push(file);
				}
				dragData.data = files;
			}
			// This isn't an else because on Linux a link drag contains an empty application/x-moz-file too
			if ((!dragData.data || !dragData.data.length) && dt.types.includes('text/x-moz-url')) {
				let uri = Services.io.newURI(dt.getData('text/x-moz-url').split("\n")[0]);
				if (uri.schemeIs('file')) {
					dragData.dataType = 'application/x-moz-file';
					dragData.data = [uri.QueryInterface(Ci.nsIFileURL).file];
				}
			}
		}
		
		return dragData;
	},
	
	
	getDragSource: function () {
		return this.currentDragSource;
	},
	
	
	getDragTarget: function (event) {
		var target = event.target;
		if (target.tagName == 'treechildren') {
			var tree = target.parentNode;
			if (tree.id == 'trellis-collections-tree') {
				let { row } = tree.getCellAt(event.clientX, event.clientY);
				let win = tree.ownerDocument.defaultView;
				return win.TrellisPane.collectionsView.getRow(row);
			}
		}
		return false;
	}
}


/*
 * Implements nsIWebProgressListener
 */
Trellis.WebProgressFinishListener = function (onFinish) {
	var _request;
	var _finished = false;
	
	this.getRequest = function () {
		return _request;
	};
	
	this.onStateChange = function (wp, req, stateFlags, status) {
		//Trellis.debug('onStateChange: ' + stateFlags);
		if (stateFlags & Components.interfaces.nsIWebProgressListener.STATE_STOP
				&& stateFlags & Components.interfaces.nsIWebProgressListener.STATE_IS_NETWORK
				&& !(stateFlags & Components.interfaces.nsIWebProgressListener.STATE_IS_REQUEST)) {
			if (_finished) {
				return;
			}
			
			// Get status code and content ype
			let status = null;
			let contentType = null;
			try {
				let r = _request || req;
				if (!r) {
					Trellis.debug("WebProgressFinishListener: finished without a valid request")
				} else {
					r.QueryInterface(Components.interfaces.nsIHttpChannel);
					status = r.responseStatus;
					contentType = r.contentType;
				}
			}
			catch (e) {
				Trellis.debug(e, 2);
			}
			
			_request = null;
			onFinish({ status, contentType });
			_finished = true;
		}
		else {
			_request = req;
		}
	}
	
	this.onProgressChange = function (wp, req, curSelfProgress, maxSelfProgress, curTotalProgress, maxTotalProgress) {
		//Trellis.debug('onProgressChange');
		//Trellis.debug('Current: ' + curTotalProgress);
		//Trellis.debug('Max: ' + maxTotalProgress);
	}
	
	this.onLocationChange = function (wp, req, location) {}
	this.onSecurityChange = function (wp, req, stateFlags, status) {}
	this.onStatusChange = function (wp, req, status, msg) {}
}

/*
 * Saves or loads JSON objects.
 */
Trellis.JSON = new function () {
	this.serialize = function (arg) {
		Trellis.debug("WARNING: Trellis.JSON.serialize() is deprecated; use JSON.stringify()");
		return JSON.stringify(arg);
	}
	
	this.unserialize = function (arg) {
		Trellis.debug("WARNING: Trellis.JSON.unserialize() is deprecated; use JSON.parse()");
		return JSON.parse(arg);
	}
}
