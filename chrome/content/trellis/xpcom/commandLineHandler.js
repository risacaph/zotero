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
    
	
	Based on nsChromeExtensionHandler example code by Ed Anuff at
	http://kb.mozillazine.org/Dev_:_Extending_the_Chrome_Protocol
	
    ***** END LICENSE BLOCK *****
*/

Trellis.CommandLineIngester = {
	ingest: async function () {
		const { CommandLineOptions } = ChromeUtils.importESModule("chrome://trellis/content/modules/commandLineOptions.mjs");

		var mainWindow = Trellis.getMainWindow();
		var fileToOpen;
		// Handle trellis:// and file URIs
		var uri = CommandLineOptions.url;
		if (uri) {
			if (uri.schemeIs("trellis")) {
				// Check for existing window and focus it
				if (mainWindow) {
					mainWindow.focus();
					mainWindow.TrellisPane.loadURI(uri.spec);
				}
			}
			// See below
			else if (uri.schemeIs("file")) {
				fileToOpen = OS.Path.fromFileURI(uri.spec);
			}
			else {
				Trellis.debug(`Not handling URL: ${uri.spec}\n\n`);
			}
		}


		fileToOpen = fileToOpen || CommandLineOptions.file;
		if (fileToOpen) {
			var file = Trellis.File.pathToFile(fileToOpen);

			if (file.leafName.substr(-4).toLowerCase() === ".csl"
				|| file.leafName.substr(-8).toLowerCase() === ".csl.txt") {
				// Install CSL file
				Trellis.Styles.install({ file: file.path }, file.path);
			}
			else {
				// Ask before importing
				var checkState = {
					value: Trellis.Prefs.get('import.createNewCollection.fromFileOpenHandler')
				};
				if (Services.prompt.confirmCheck(null, Trellis.getString('ingester.importFile.title'),
					Trellis.getString('ingester.importFile.text', [file.leafName]),
					Trellis.getString('ingester.importFile.intoNewCollection'),
					checkState)) {
					Trellis.Prefs.set(
						'import.createNewCollection.fromFileOpenHandler', checkState.value
					);

					mainWindow.Trellis_File_Interface.importFile({
						file,
						createNewCollection: checkState.value
					});
				}
			}
		}

		CommandLineOptions.url = false;
		CommandLineOptions.file = false;
	},
};

/**
 * The object representing the Trellis command line handler.
 * It is only active after Trellis is initialized and there is initial handling
 * in app/assets/commandLineHandler.js
 */
var TrellisCommandLineHandler = {
	/* nsICommandLineHandler */
	handle: async function (cmdLine) {
		const { Trellis } = ChromeUtils.importESModule("chrome://trellis/content/trellis.mjs");
		// handler for Trellis integration commands
		// this is typically used on Windows only, via WM_COPYDATA rather than the command line
		var agent = cmdLine.handleFlagWithParam("TrellisIntegrationAgent", false);
		if (agent) {
			var command = cmdLine.handleFlagWithParam("TrellisIntegrationCommand", false);
			var docId = cmdLine.handleFlagWithParam("TrellisIntegrationDocument", false);
			var templateVersion = parseInt(cmdLine.handleFlagWithParam("TrellisIntegrationTemplateVersion", false));
			templateVersion = isNaN(templateVersion) ? 0 : templateVersion;
			
			Trellis.Integration.execCommand(agent, command, docId, templateVersion);
		}
		// Only open main window if we aren't handling an integration command
		else if (!Trellis.getMainWindow()) {
			Trellis.openMainWindow();
		}
		
		await Trellis.CommandLineIngester.ingest();
	},
	
	classID: Components.ID("{531828f8-a16c-46be-b9aa-14845c3b010f}"),
	contractID: "@trellis.org/command-line-handler;1",
	QueryInterface: ChromeUtils.generateQI(["nsISupports", "nsICommandLineHandler"]),
	createInstance(iid) {
		return this.QueryInterface(iid);
	},
};

const Cm = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
// Don't register if already registered (e.g., after a reinit() in tests)
if (!Cm.isCIDRegistered(TrellisCommandLineHandler.classID)) {
	Cm.registerFactory(
		TrellisCommandLineHandler.classID,
		"command-line-handler",
		TrellisCommandLineHandler.contractID,
		TrellisCommandLineHandler
	);
	const catman = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
	
	catman.addCategoryEntry("command-line-handler",
		"m-trellis",
		TrellisCommandLineHandler.contractID, false, true);
}
