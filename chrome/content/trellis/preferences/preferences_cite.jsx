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

"use strict";

var { FilePicker } = ChromeUtils.importESModule('chrome://trellis/content/modules/filePicker.mjs');

var React = require('react');
var ReactDOM = require('react-dom');
var VirtualizedTable = require('components/virtualized-table');
var { makeRowRenderer } = VirtualizedTable;

Trellis_Preferences.Cite = {
	styles: [],
	wordPluginResourcePaths: {
		libreOffice: 'trellis-libreoffice-integration',
		macWord: 'trellis-macword-integration',
		winWord: 'trellis-winword-integration'
	},

	init: async function () {
		// Init word plugin sections
		let wordPlugins = [];
		if (Trellis.isWin) {
			wordPlugins.push('winWord');
		}
		else if (Trellis.isMac) {
			wordPlugins.push('macWord');
		}
		wordPlugins.push('libreOffice');
		await Trellis.Promise.delay();
		for (let wordPlugin of wordPlugins) {
			// This is the weirdest indirect code, but let's not fix what's not broken
			try {
				const { Installer } = ChromeUtils.importESModule(`resource://${this.wordPluginResourcePaths[wordPlugin]}/installer.mjs`);
				(new Installer(true)).showPreferences(document);
			}
			catch (e) {
				Trellis.logError(e);
			}
		}
		await this.refreshStylesList();
		document.querySelector('#trellis-prefpane-cite').addEventListener('showing', () => {
			this._tree.invalidate();
		});
	},
	
	
	/**
	 * Refreshes the list of styles in the styles pane
	 * @param {String} cslID Style to select
	 * @return {Promise}
	 */
	refreshStylesList: async function (cslID) {
		Trellis.debug("Refreshing styles list");
		
		await Trellis.Styles.init();
		this.styles = Trellis.Styles.getVisible()
			.map((style) => {
				var updated = Trellis.Date.sqlToDate(style.updated, true);
				return {
					title: style.title,
					updated: updated ? updated.toLocaleDateString() : "",
					remove: {
						iconKey: "minus-circle",
						onClick: async (index, event) => {
							// if the clicks happened via keyboard, refocus the next row's button
							if (event.type == "keydown" && document.activeElement == event.target) {
								this._tabIntoIcon = true;
							}
							let cslID = Trellis.Styles.getVisible()[index].styleID;
							this.deleteStyle([cslID]);
						},
						isFocusable: true,
						ariaLabel: Trellis.getString("general.remove")
					}
				};
			});
		
		if (!this._tree) {
			const columns = [
				{
					dataKey: "title",
					label: "trellis.preferences.cite.styles.styleManager.title",
				},
				{
					dataKey: "updated",
					label: "trellis.preferences.cite.styles.styleManager.updated",
					fixedWidth: true,
					width: 100
				},
				{
					dataKey: "remove",
					label: Trellis.getString("preferences-styleManager-remove"),
					htmlLabel: ' ',
					fixedWidth: true,
					width: 24,
					type: "button"
				}
			];
			var handleKeyDown = (event) => {
				if (event.key == 'Delete' || Trellis.isMac && event.key == 'Backspace') {
					Trellis_Preferences.Cite.deleteStyle();
					return false;
				}
			};

			await new Promise((resolve) => {
				ReactDOM.createRoot(document.getElementById("styleManager")).render(
					<VirtualizedTable
						getRowCount={() => this.styles.length}
						id="styleManager-table"
						ref={(ref) => {
							this._tree = ref;
							resolve();
						}}
						renderItem={makeRowRenderer(index => this.styles[index])}
						showHeader={true}
						multiSelect={false}
						columns={columns}
						staticColumns={true}
						disableFontSizeScaling={true}
						onKeyDown={handleKeyDown}
						getRowString={index => this.styles[index].title}
					/>
				);
			});

			// Fix style manager showing partially blank until scrolled
			setTimeout(() => {
				this._tree.invalidate();
				// Pre-select first item if nothing is selected
				if (this._tree.selection.selected.size == 0) {
					this._tree.selection.select(0);
				}
			});
		}
		else {
			this._tree.invalidate();
		}
		if (cslID) {
			var styles = Trellis.Styles.getVisible();
			var index = styles.findIndex(style => style.styleID == cslID);
			if (index != -1) {
				this._tree.selection.select(index);
			}
		}
		else if ([...this._tree.selection.selected].some(i => i >= this.styles.length)) {
			this._tree.selection.select(this.styles.length - 1);
		}
		if (this._tabIntoIcon) {
			document.querySelector("#styleManager-table .row.selected .icon-action").focus();
			this._tabIntoIcon = false;
		}
	},
	
	
	openStylesPage: function () {
		Trellis.openInViewer("https://www.trellis.org/styles/");
	},
	
	
	/**
	 * Adds a new style to the style pane
	 **/
	addStyle: async function () {
		var fp = new FilePicker();
		fp.init(window, Trellis.getString("trellis.preferences.styles.addStyle"), fp.modeOpen);
		
		fp.appendFilter("CSL Style", "*.csl");
		
		var rv = await fp.show();
		if (rv == fp.returnOK || rv == fp.returnReplace) {
			try {
				await Trellis.Styles.install(
					{
						file: Trellis.File.pathToFile(fp.file)
					},
					fp.file,
					true
				);
			}
			catch (e) {
				(new Trellis.Exception.Alert("styles.install.unexpectedError",
					fp.file, "styles.install.title", e)).present()
			}
		}
	},
	
	
	/**
	 * Deletes selected styles from the styles pane
	 * @param {Array} cslIDs Array of CSL IDs to delete
	 **/
	deleteStyle: async function (cslIDs = []) {
		// get selected cslIDs
		var styles = Trellis.Styles.getVisible();
		// if style ids are not provided, get them from the selection
		if (cslIDs.length == 0) {
			for (let index of this._tree.selection.selected.keys()) {
				cslIDs.push(styles[index].styleID);
			}
		}
		
		if(cslIDs.length == 0) {
			return;
		} else if(cslIDs.length == 1) {
			var selectedStyle = Trellis.Styles.get(cslIDs[0])
			var text = Trellis.getString('styles.deleteStyle', selectedStyle.title);
		} else {
			var text = Trellis.getString('styles.deleteStyles');
		}
		
		var ps = Services.prompt;
		if(ps.confirm(null, '', text)) {
			// delete if requested
			if(cslIDs.length == 1) {
				await selectedStyle.remove();
			} else {
				for(var i=0; i<cslIDs.length; i++) {
					await Trellis.Styles.get(cslIDs[i]).remove();
				}
			}
			
			await this.refreshStylesList();
		}
	},
	
	resetStyles: async function () {
		var ps = Services.prompt;
		
		var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
			+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
		
		var index = ps.confirmEx(null,
			Trellis.getString('general.warning'),
			Trellis.getString('trellis.preferences.advanced.resetStyles.changesLost'),
			buttonFlags,
			Trellis.getString('trellis.preferences.advanced.resetStyles'),
			null, null, null, {});
		
		if (index == 0) {
			let button = document.getElementById('reset-styles-button');
			button.disabled = true;
			try {
				await Trellis.Schema.resetStyles()
				if (Trellis_Preferences.Export) {
					Trellis_Preferences.Export.populateQuickCopyList();
				}
			}
			finally {
				button.disabled = false;
			}
			this.refreshStylesList();
		}
	},
	
	/**
	 * Shows an error if import fails
	 **/
	styleImportError: function () {
		alert(Trellis.getString('styles.installError', "This"));
	}
}
