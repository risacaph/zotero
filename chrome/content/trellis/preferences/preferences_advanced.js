/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2006–2013 Center for History and New Media
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

const { TRELLIS_CONFIG } = ChromeUtils.importESModule('resource://trellis/config.mjs');
var { FilePicker } = ChromeUtils.importESModule('chrome://trellis/content/modules/filePicker.mjs');

Trellis_Preferences.Advanced = {	
	init: function () {
		Trellis_Preferences.Keys.init();
		
		// Show Memory Info button
		if (Trellis.Prefs.get('debug.memoryInfo')) {
			document.getElementById('memory-info').hidden = false;
		}

		// This might not work for checkboxes if we later need to create them
		// with html
		var inputs = document.querySelectorAll('input[data-preference]');
		for (let input of inputs) {
			let preferenceName = input.dataset.preference;
			input.addEventListener('change', function () {
				let value = input.value;
				Trellis.Prefs.set(preferenceName, value);
			});
			input.value = Trellis.Prefs.get(preferenceName);
		}
		
		document.getElementById('baseAttachmentPath').addEventListener('syncfrompreference',
			() => Trellis_Preferences.Attachment_Base_Directory.updateUI());
		
		this.onDataDirLoad();

		document.getElementById('fulltext-rebuildIndex').setAttribute('label',
			Trellis.getString('trellis.preferences.search.rebuildIndex')
				+ Trellis.getString('punctuation.ellipsis'));
		document.getElementById('fulltext-clearIndex').setAttribute('label',
			Trellis.getString('trellis.preferences.search.clearIndex')
				+ Trellis.getString('punctuation.ellipsis'));
		
		this.updateIndexStats();
		this.updateLocalAPIUI();
		document.getElementById('trellis-prefpane-advanced-enable-local-api').addEventListener('synctopreference', () => {
			this.updateLocalAPIUI();
		});
	},
	
	
	updateTranslators: async function () {
		var updated = await Trellis.Schema.updateFromRepository(Trellis.Schema.REPO_UPDATE_MANUAL);
		var button = document.getElementById('updateButton');
		if (button) {
			if (updated===-1) {
				var label = Trellis.getString('trellis.preferences.update.upToDate');
			}
			else if (updated) {
				var label = Trellis.getString('trellis.preferences.update.updated');
			}
			else {
				var label = Trellis.getString('trellis.preferences.update.error');
			}
			button.label = label;
			
			if (updated && Trellis_Preferences.Cite) {
				await Trellis_Preferences.Cite.refreshStylesList();
			}
		}
	},
	
	
	migrateDataDirectory: async function () {
		var currentDir = Trellis.DataDirectory.dir;
		var defaultDir = Trellis.DataDirectory.defaultDir;
		if (currentDir == defaultDir) {
			Trellis.debug("Already using default directory");
			return;
		}
		
		var ps = Services.prompt;
		
		// If there's a migration marker, point data directory back to the current location and remove
		// it to trigger the migration again
		var marker = PathUtils.join(defaultDir, Trellis.DataDirectory.MIGRATION_MARKER);
		if (await IOUtils.exists(marker)) {
			Trellis.Prefs.clear('dataDir');
			Trellis.Prefs.clear('useDataDir');
			await IOUtils.remove(marker);
			try {
				await IOUtils.remove(PathUtils.join(defaultDir, '.DS_Store'));
			}
			catch (e) {}
		}
		
		// ~/Trellis exists and is non-empty
		if (((await IOUtils.exists(defaultDir))) && !((await Trellis.File.directoryIsEmpty(defaultDir)))) {
			let buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
				+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
			let index = ps.confirmEx(
				window,
				Trellis.getString('general.error'),
				Trellis.getString('trellis.preferences.advanced.migrateDataDir.directoryExists1', defaultDir)
					+ "\n\n"
					+ Trellis.getString('trellis.preferences.advanced.migrateDataDir.directoryExists2'),
				buttonFlags,
				Trellis.getString('general.showDirectory'),
				null, null, null, {}
			);
			if (index == 0) {
				await Trellis.File.reveal(
					// Windows opens the directory, which might be confusing here, so open parent instead
					Trellis.isWin ? PathUtils.parent(defaultDir) : defaultDir
				);
			}
			return;
		}
		
		var additionalText = '';
		if (Trellis.isWin) {
			try {
				let numItems = await Trellis.DB.valueQueryAsync(
					"SELECT COUNT(*) FROM itemAttachments WHERE linkMode IN (?, ?)",
					[Trellis.Attachments.LINK_MODE_IMPORTED_FILE, Trellis.Attachments.LINK_MODE_IMPORTED_URL]
				);
				if (numItems > 100) {
					additionalText = '\n\n' + Trellis.getString(
						'trellis.preferences.advanced.migrateDataDir.manualMigration',
						[Trellis.appName, defaultDir, TRELLIS_CONFIG.CLIENT_NAME]
					);
				}
			}
			catch (e) {
				Trellis.logError(e);
			}
		}
		
		// Prompt to restart
		var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
					+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
		var index = ps.confirmEx(window,
			Trellis.getString('trellis.preferences.advanced.migrateDataDir.title'),
			Trellis.getString(
				'trellis.preferences.advanced.migrateDataDir.directoryWillBeMoved',
				[TRELLIS_CONFIG.CLIENT_NAME, defaultDir]
			) + '\n\n'
			+ Trellis.getString(
				'trellis.preferences.advanced.migrateDataDir.appMustBeRestarted', Trellis.appName
			) + additionalText,
			buttonFlags,
			Trellis.getString('general.continue'),
			null, null, null, {}
		);
		
		if (index == 0) {
			await Trellis.DataDirectory.markForMigration(currentDir);
			Trellis.Utilities.Internal.quitTrellis(true);
		}
	},
	
	
	runIntegrityCheck: async function (button) {
		button.disabled = true;
		
		try {
			let ps = Services.prompt;
			
			var ok = await Trellis.DB.integrityCheck();
			if (ok) {
				ok = await Trellis.Schema.integrityCheck();
				if (!ok) {
					var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
						+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
					var index = ps.confirmEx(window,
						Trellis.getString('general.failed'),
						Trellis.getString('db.integrityCheck.failed') + "\n\n" +
							Trellis.getString('db.integrityCheck.repairAttempt') + " " +
							Trellis.getString('db.integrityCheck.appRestartNeeded', Trellis.appName),
						buttonFlags,
						Trellis.getString('db.integrityCheck.fixAndRestart', Trellis.appName),
						null, null, null, {}
					);
					
					if (index == 0) {
						// Safety first
						await Trellis.DB.backUpDatabase();
						
						// Fix the errors
						await Trellis.Schema.integrityCheck(true);
						
						// And run the check again
						ok = await Trellis.Schema.integrityCheck();
						var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING);
						if (ok) {
							var str = 'success';
							var msg = Trellis.getString('db.integrityCheck.errorsFixed');
						}
						else {
							var str = 'failed';
							var msg = Trellis.getString('db.integrityCheck.errorsNotFixed')
										+ "\n\n" + Trellis.getString('db.integrityCheck.reportInForums');
						}
						
						ps.confirmEx(window,
							Trellis.getString('general.' + str),
							msg,
							buttonFlags,
							Trellis.getString('general.restartApp', Trellis.appName),
							null, null, null, {}
						);
						
						var appStartup = Components.classes["@mozilla.org/toolkit/app-startup;1"]
								.getService(Components.interfaces.nsIAppStartup);
						appStartup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit
							| Components.interfaces.nsIAppStartup.eRestart);
					}
					
					return;
				}
				
			}
			var str = ok ? 'passed' : 'failed';
			
			ps.alert(window,
				Trellis.getString('general.' + str),
				Trellis.getString('db.integrityCheck.' + str)
				+ (!ok ? "\n\n" + Trellis.getString('db.integrityCheck.dbRepairTool') : ''));
		}
		finally {
			button.disabled = false;
		}
	},
	
	
	resetTranslatorsAndStyles: function () {
		var ps = Services.prompt;
		
		var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
			+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
		
		var index = ps.confirmEx(null,
			Trellis.getString('general.warning'),
			Trellis.getString('trellis.preferences.advanced.resetTranslatorsAndStyles.changesLost'),
			buttonFlags,
			Trellis.getString('trellis.preferences.advanced.resetTranslatorsAndStyles'),
			null, null, null, {});
		
		if (index == 0) {
			Trellis.Schema.resetTranslatorsAndStyles()
			.then(function () {
				if (Trellis_Preferences.Export) {
					Trellis_Preferences.Export.populateQuickCopyList();
				}
			});
		}
	},
	
	
	resetTranslators: async function () {
		var ps = Services.prompt;
		
		var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
			+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
		
		var index = ps.confirmEx(null,
			Trellis.getString('general.warning'),
			Trellis.getString('trellis.preferences.advanced.resetTranslators.changesLost'),
			buttonFlags,
			Trellis.getString('trellis.preferences.advanced.resetTranslators'),
			null, null, null, {});
		
		if (index == 0) {
			let button = document.getElementById('reset-translators-button');
			button.disabled = true;
			try {
				await Trellis.Schema.resetTranslators();
				if (Trellis_Preferences.Export) {
					Trellis_Preferences.Export.populateQuickCopyList();
				}
			}
			finally {
				button.disabled = false;
			}
		}
	},
	
	onDataDirLoad: function () {
		var currentDir = Trellis.DataDirectory.dir;
		
		if (Trellis.forceDataDir) {
			document.getElementById('command-line-data-dir-path').textContent = currentDir;
			document.getElementById('command-line-data-dir').hidden = false;
		}
		
		document.getElementById('migrate-data-dir').setAttribute(
			'hidden', !Trellis.DataDirectory.canMigrate()
		);

		let changeDataDir = document.getElementById("change-data-dir");
		changeDataDir.hidden = this._usingDefaultDataDir();

		let customDataDir = document.getElementById("custom-data-dir");
		customDataDir.hidden = !this._usingDefaultDataDir();

		let revertToDefaultDir = document.getElementById("reset-data-dir");
		let revertToDefaultDirLabel = document.getElementById("default-data-dir");
		revertToDefaultDir.hidden = this._usingDefaultDataDir();
		revertToDefaultDirLabel.hidden = this._usingDefaultDataDir();
		document.l10n.setArgs(revertToDefaultDirLabel, { directory: Trellis.DataDirectory.defaultDir });
		this.setDataDirInput();
	},
	
	
	dataDirUpdate: async function (isCustomSelection) {
		if (!isCustomSelection && this._usingDefaultDataDir()) return;
		
		// This call shows a filepicker if needed, forces a restart if required, and does nothing if
		// cancel was pressed or value hasn't changed
		await Trellis.DataDirectory.choose(
			true,
			!isCustomSelection,
			() => Trellis.launchURL('https://www.trellis.org/support/trellis_data')
		);
	},
	
	
	setDataDirInput: async function () {
		var filefield = document.getElementById('data-dir-path');
		var path = Trellis.Prefs.get('dataDir');
		if (path && (await IOUtils.exists(path))) {
			filefield.style.backgroundImage = 'url(moz-icon://' + Trellis.File.pathToFileURI(path) + '?size=16)';
			filefield.value = path;
		}
		else {
			filefield.value = '';
		}
	},
	
	
	getDataDirPath: function () {
		// TEMP: lastDataDir can be removed once old persistent descriptors have been
		// converted, which they are in getTrellisDirectory() in 5.0
		var prefValue = Trellis.Prefs.get('lastDataDir') || Trellis.Prefs.get('dataDir');
		
		// Don't show path if the default
		if (prefValue == Trellis.DataDirectory.defaultDir) {
			return '';
		}
		
		return prefValue || '';
	},
	
	
	_usingDefaultDataDir: function () {
		// Legacy profile directory location
		if (!Trellis.Prefs.get('useDataDir')) {
			return true;
		}
		
		var dataDir = Trellis.Prefs.get('lastDataDir') || Trellis.Prefs.get('dataDir');
		// Default home directory location
		if (dataDir == Trellis.DataDirectory.defaultDir) {
			return true;
		}
		
		return false;
	},
	
	updateIndexStats: async function () {
		var stats = await Trellis.Fulltext.getIndexStats();
		document.getElementById('fulltext-stats-indexed')
			.setAttribute('value', stats.indexed);
		document.getElementById('fulltext-stats-partial')
			.setAttribute('value', stats.partial);
		document.getElementById('fulltext-stats-unindexed')
			.setAttribute('value', stats.unindexed);
		document.getElementById('fulltext-stats-words')
			.setAttribute('value', stats.words);
	},
	
	
	rebuildIndexPrompt: async function () {
		var buttons = [
			document.getElementById('fulltext-rebuildIndex'),
			document.getElementById('fulltext-clearIndex')
		];
		buttons.forEach(b => b.disabled = true);
		
		var ps = Services.prompt;
		var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL
			+ ps.BUTTON_POS_2 * ps.BUTTON_TITLE_IS_STRING;
		
		var index = ps.confirmEx(null,
			Trellis.getString('trellis.preferences.search.rebuildIndex'),
			Trellis.getString('trellis.preferences.search.rebuildWarning',
				Trellis.getString('trellis.preferences.search.indexUnindexed')),
			buttonFlags,
			Trellis.getString('trellis.preferences.search.rebuildIndex'),
			null,
			// Position 2 because of https://bugzilla.mozilla.org/show_bug.cgi?id=345067
			Trellis.getString('trellis.preferences.search.indexUnindexed'),
			null, {});
		
		try {
			if (index == 0) {
				await Trellis.Fulltext.rebuildIndex();
			}
			else if (index == 2) {
				await Trellis.Fulltext.rebuildIndex(true)
			}
			
			await this.updateIndexStats();
		}
		catch (e) {
			Trellis.alert(null, Trellis.getString('general.error'), e);
		}
		finally {
			buttons.forEach(b => b.disabled = false);
		}
	},

	clearIndexPrompt: async function () {
		var buttons = [
			document.getElementById('fulltext-rebuildIndex'),
			document.getElementById('fulltext-clearIndex')
		];
		buttons.forEach(b => b.disabled = true);
		
		var ps = Services.prompt;
		var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL
			+ ps.BUTTON_POS_2 * ps.BUTTON_TITLE_IS_STRING;
		
		var index = ps.confirmEx(null,
			Trellis.getString('trellis.preferences.search.clearIndex'),
			Trellis.getString('trellis.preferences.search.clearWarning',
				Trellis.getString('trellis.preferences.search.clearNonLinkedURLs')),
			buttonFlags,
			Trellis.getString('trellis.preferences.search.clearIndex'),
			null,
			// Position 2 because of https://bugzilla.mozilla.org/show_bug.cgi?id=345067
			Trellis.getString('trellis.preferences.search.clearNonLinkedURLs'), null, {});
		
		try {
			if (index == 0) {
				await Trellis.Fulltext.clearIndex();
			}
			else if (index == 2) {
				await Trellis.Fulltext.clearIndex(true);
			}
			
			await this.updateIndexStats();
		}
		catch (e) {
			Trellis.alert(null, Trellis.getString('general.error'), e);
		}
		finally {
			buttons.forEach(b => b.disabled = false);
		}
	},

	updateLocalAPIUI() {
		let serverEnabled = Trellis.Prefs.get('httpServer.enabled');
		let localAPIEnabled = Trellis.Prefs.get('httpServer.localAPI.enabled');
		
		let checkbox = document.getElementById('trellis-prefpane-advanced-enable-local-api');
		let availableMessage = document.getElementById('trellis-prefpane-advanced-local-api-available');
		let serverDisabledSection = document.getElementById('trellis-prefpane-advanced-server-disabled');
		
		if (!serverEnabled) {
			checkbox.disabled = true;
			availableMessage.hidden = true;
			serverDisabledSection.hidden = false;
			return;
		}
		
		checkbox.disabled = false;
		availableMessage.hidden = !localAPIEnabled;
		serverDisabledSection.hidden = true;
		
		document.l10n.setArgs(availableMessage, {
			url: `http://localhost:${Trellis.Server.port}/api/`
		});
	},
	
	enableServerForLocalAPI() {
		Trellis.Prefs.set('httpServer.enabled', true);
		Trellis.Utilities.Internal.quit(true);
	}
};


Trellis_Preferences.Attachment_Base_Directory = {
	getPath: function () {
		var oldPath = Trellis.Prefs.get('baseAttachmentPath');
		if (oldPath) {
			try {
				return PathUtils.normalize(oldPath);
			}
			catch (e) {
				Trellis.logError(e);
				return false;
			}
		}
	},
	
	
	choosePath: async function () {
		var oldPath = this.getPath();
		
		//Prompt user to choose new base path
		var fp = new FilePicker();
		if (oldPath) {
			fp.displayDirectory = oldPath;
		}
		fp.init(window, Trellis.getString('attachmentBasePath.selectDir'), fp.modeGetFolder);
		fp.appendFilters(fp.filterAll);
		if ((await fp.show()) != fp.returnOK) {
			return false;
		}
		var newPath = PathUtils.normalize(fp.file);
		
		if (oldPath && oldPath == newPath) {
			Trellis.debug("Base directory hasn't changed");
			return false;
		}
		
		try {
			return await this.changePath(newPath);
		}
		catch (e) {
			Trellis.logError(e);
			Trellis.alert(null, Trellis.getString('general.error'), e.message);
		}
	},
	
	
	changePath: async function (basePath) {
		Trellis.debug(`New base directory is ${basePath}`);
		
		if (Trellis.File.directoryContains(Trellis.DataDirectory.dir, basePath)) {
			throw new Error(
				Trellis.getString(
					'trellis.preferences.advanced.baseDirectory.withinDataDir',
					Trellis.appName
				)
			);
		}
		
		// Find all attachments on the new base path
		var sql = "SELECT itemID FROM itemAttachments WHERE linkMode=?";
		var params = [Trellis.Attachments.LINK_MODE_LINKED_FILE];
		var allAttachments = await Trellis.DB.columnQueryAsync(sql, params);
		var newAttachmentPaths = {};
		var numNewAttachments = 0;
		var numOldAttachments = 0;
		for (let attachmentID of allAttachments) {
			let attachmentPath;
			let relPath;
			
			try {
				let attachment = await Trellis.Items.getAsync(attachmentID);
				// This will return FALSE for relative paths if base directory
				// isn't currently set
				attachmentPath = attachment.getFilePath();
				// Get existing relative path
				let storedPath = attachment.attachmentPath;
				if (storedPath.startsWith(Trellis.Attachments.BASE_PATH_PLACEHOLDER)) {
					relPath = storedPath.substring(Trellis.Attachments.BASE_PATH_PLACEHOLDER.length);
					// Use platform-specific slashes, which PathUtils.joinRelative() requires below
					relPath = Trellis.Attachments.fixPathSlashes(relPath);
				}

				// If a file with the same relative path exists within the new base directory,
				// don't touch the attachment, since it will continue to work
				if (await IOUtils.exists(PathUtils.joinRelative(basePath, relPath))) {
					Trellis.debug(`${relPath} found within new base path -- skipping`);
					numNewAttachments++;
					continue;
				}
			}
			catch (e) {
				// Don't deal with bad attachment paths. Just skip them.
				Trellis.debug(e, 2);
				continue;
			}
			
			// Files within the new base directory need to be updated to use
			// relative paths (or, if the new base directory is an ancestor or
			// descendant of the old one, new relative paths)
			if (attachmentPath && Trellis.File.directoryContains(basePath, attachmentPath)) {
				Trellis.debug(`Converting ${attachmentPath} to relative path`);
				newAttachmentPaths[attachmentID] = relPath ? attachmentPath : null;
				numNewAttachments++;
			}
			// Existing relative attachments not within the new base directory
			// will be converted to absolute paths
			else if (relPath && Trellis.Prefs.get('baseAttachmentPath')) {
				Trellis.debug(`Converting ${relPath} to absolute path`);
				newAttachmentPaths[attachmentID] = attachmentPath;
				numOldAttachments++;
			}
			else {
				Trellis.debug(`${attachmentPath} is not within the base directory`);
			}
		}
		
		// Confirm change of the base path
		var ps = Services.prompt;
		
		var chooseStrPrefix = 'attachmentBasePath.chooseNewPath.';
		var clearStrPrefix = 'attachmentBasePath.clearBasePath.';
		var title = Trellis.getString(chooseStrPrefix + 'title');
		var msg1 = Trellis.getString(chooseStrPrefix + 'message') + "\n\n", msg2 = "", msg3 = "";
		switch (numNewAttachments) {
			case 0:
				break;
			
			case 1:
				msg2 += Trellis.getString(chooseStrPrefix + 'existingAttachments.singular') + " ";
				break;
			
			default:
				msg2 += Trellis.getString(chooseStrPrefix + 'existingAttachments.plural', numNewAttachments) + " ";
		}
		
		switch (numOldAttachments) {
			case 0:
				break;
			
			case 1:
				msg3 += Trellis.getString(clearStrPrefix + 'existingAttachments.singular');
				break;
			
			default:
				msg3 += Trellis.getString(clearStrPrefix + 'existingAttachments.plural', numOldAttachments);
		}
		
		
		var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
			+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
		var index = ps.confirmEx(
			null,
			title,
			(msg1 + msg2 + msg3).trim(),
			buttonFlags,
			Trellis.getString(chooseStrPrefix + 'button'),
			null,
			null,
			null,
			{}
		);
		
		if (index == 1) {
			return false;
		}
		
		// Set new base directory
		Trellis.debug("Setting base directory to " + basePath);
		Trellis.Prefs.set('baseAttachmentPath', basePath);
		Trellis.Prefs.set('saveRelativeAttachmentPath', true);
		// Resave all attachments on base path (so that their paths become relative)
		// and all other relative attachments (so that their paths become absolute)
		await Trellis.Utilities.Internal.forEachChunkAsync(
			Object.keys(newAttachmentPaths),
			100,
			function (chunk) {
				return Trellis.DB.executeTransaction(async function () {
					for (let id of chunk) {
						let attachment = Trellis.Items.get(id);
						if (newAttachmentPaths[id]) {
							attachment.attachmentPath = newAttachmentPaths[id];
						}
						else {
							attachment.attachmentPath = attachment.getFilePath();
						}
						await attachment.save({
							skipDateModifiedUpdate: true
						});
					}
				});
			}
		);
		
		return true;
	},
	
	
	clearPath: async function () {
		// Find all current attachments with relative paths
		var sql = "SELECT itemID FROM itemAttachments WHERE linkMode=? AND path LIKE ?";
		var params = [
			Trellis.Attachments.LINK_MODE_LINKED_FILE,
			Trellis.Attachments.BASE_PATH_PLACEHOLDER + "%"
		];
		var relativeAttachmentIDs = await Trellis.DB.columnQueryAsync(sql, params);
		
		// Prompt for confirmation
		var ps = Services.prompt;
		
		var strPrefix = 'attachmentBasePath.clearBasePath.';
		var title = Trellis.getString(strPrefix + 'title');
		var msg = Trellis.getString(strPrefix + 'message');
		switch (relativeAttachmentIDs.length) {
			case 0:
				break;
			
			case 1:
				msg += "\n\n" + Trellis.getString(strPrefix + 'existingAttachments.singular');
				break;
			
			default:
				msg += "\n\n" + Trellis.getString(strPrefix + 'existingAttachments.plural',
					relativeAttachmentIDs.length);
		}
		
		var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
			+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
		var index = ps.confirmEx(
			window,
			title,
			msg,
			buttonFlags,
			Trellis.getString(strPrefix + 'button'),
			null,
			null,
			null,
			{}
		);
		
		if (index == 1) {
			return false;
		}
		
		// Disable relative path saving and then resave all relative
		// attachments so that their absolute paths are stored
		Trellis.debug('Clearing base directory');
		Trellis.Prefs.set('saveRelativeAttachmentPath', false);
		
		await Trellis.Utilities.Internal.forEachChunkAsync(
			relativeAttachmentIDs,
			100,
			function (chunk) {
				return Trellis.DB.executeTransaction(async function () {
					for (let id of chunk) {
						let attachment = await Trellis.Items.getAsync(id);
						attachment.attachmentPath = attachment.getFilePath();
						await attachment.save({
							skipDateModifiedUpdate: true
						});
					}
				}.bind(this));
			}.bind(this)
		);
		
		Trellis.Prefs.set('baseAttachmentPath', '');
	},
	
	
	updateUI: async function () {
		var filefield = document.getElementById('baseAttachmentPath');
		var path = Trellis.Prefs.get('baseAttachmentPath');
		if (path && (await IOUtils.exists(path))) {
			filefield.style.backgroundImage = 'url(moz-icon://' + Trellis.File.pathToFileURI(path) + '?size=16)';
			filefield.value = path;
		}
		else {
			filefield.value = '';
		}
		document.getElementById('resetBasePath').disabled = !path;
	}
};


Trellis_Preferences.Keys = {
	init: function () {
		for (let label of document.querySelectorAll('#trellis-keys-grid .modifier')) {
			// Display the appropriate modifier keys for the platform
			label.textContent = Trellis.isMac ? Trellis.getString('general.keys.cmdShift') : Trellis.getString('general.keys.ctrlShift');
		}
		
		var textboxes = document.querySelectorAll('#trellis-keys-grid input');
		for (let i=0; i<textboxes.length; i++) {
			let textbox = textboxes[i];
			textbox.value = textbox.value.toUpperCase();
			// .value takes care of the initial value, and this takes care of direct pref changes
			// while the window is open
			textbox.addEventListener('syncfrompreference', () => {
				textbox.value = Trellis_Preferences.Keys.capitalizePref(textbox.id) || '';
			});
			textbox.addEventListener('input', () => {
				textbox.value = textbox.value.toUpperCase();
			});
		}
	},
	
	
	capitalizePref: function (id) {
		var elem = document.getElementById(id);
		return Trellis.Prefs.get(elem.getAttribute('preference'), true).toUpperCase();
	}
};
