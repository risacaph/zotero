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

var { XPCOMUtils } = ChromeUtils.importESModule("resource://gre/modules/XPCOMUtils.sys.mjs");

/*
 * This object contains the various functions for the interface
 */
var Trellis_LocateMenu = new function () {
	XPCOMUtils.defineLazyServiceGetter(this, "ios", "@mozilla.org/network/io-service;1", "nsIIOService");
	
  	/**
  	 * Clear and build the locate menu
  	 */
	this.buildLocateMenu = async function (locateMenu, { locateMode } = {}) {
		// clear menu
		while(locateMenu.childElementCount > 0) {
			locateMenu.removeChild(locateMenu.firstChild);
		}
		
		var selectedItems = await _getSelectedItems();
		
		if(selectedItems.length) {
			await _addViewOptions(locateMenu, selectedItems, true, true, {
				locateMode, isToolbarMenu: true
			});
			
			var availableEngines = _getAvailableLocateEngines(selectedItems);
			// add engines that are available for selected items
			if(availableEngines.length) {
				Trellis_LocateMenu.addLocateEngines(locateMenu, availableEngines, null, true);
			}
		}
		else {
			// add "no items selected"
			menuitem = document.createXULElement("menuitem");
			document.l10n.setAttributes(menuitem, "item-pane-message-items-selected", { count: 0 });
			locateMenu.appendChild(menuitem);
			menuitem.disabled = true;
		}
					
		// add separator at end if necessary
		if(locateMenu.lastChild && locateMenu.lastChild.tagName !== "menuseparator") {
			locateMenu.appendChild(document.createXULElement("menuseparator"));
		}
		
		// add installable locate menus, if there are any
		if(window.Trellis_Browser) {
			var installableLocateEngines = _getInstallableLocateEngines();
		} else {
			var installableLocateEngines = [];
		}
		
		if(installableLocateEngines.length) {
			for (let locateEngine of installableLocateEngines) {
				var menuitem = document.createXULElement("menuitem");
				menuitem.setAttribute("label", locateEngine.label);
				menuitem.setAttribute("class", "menuitem-iconic");
				menuitem.setAttribute("image", locateEngine.image);
				menuitem.trellisLocateInfo = locateEngine;
				menuitem.addEventListener("command", _addLocateEngine, false);
				
				locateMenu.appendChild(menuitem);
			}
		}
		
		menuitem = _createMenuItem(Trellis.getString("locate.manageLocateEngines"), "trellis-manage-locate-menu");
		menuitem.addEventListener("command", _openLocateEngineManager, false);
		locateMenu.appendChild(menuitem);
		
		await document.l10n.translateFragment(locateMenu);
	}
	
	/**
	 * Clear the bottom part of the context menu and add locate options
	 * @param {menupopup} menu The menu to add context menu items to
	 * @param {Boolean} showIcons Whether menu items should have associated icons
	 * @return {Promise}
	 */
	this.buildContextMenu = async function (menu, showIcons) {
		// get selected items
		var selectedItems = await _getSelectedItems();
		
		// if no items selected or >20 items selected, stop now
		if(!selectedItems.length || selectedItems.length > 20) return;
		
		// add view options
		await _addViewOptions(menu, selectedItems, showIcons);
		
		/*// look for locate engines
		var availableEngines = _getAvailableLocateEngines(selectedItems);
		if(availableEngines.length) {
			// if locate engines are available, make a new submenu
			var submenu = document.createXULElement("menu");
			submenu.setAttribute("trellis-locate", "true");
			submenu.setAttribute("label", Trellis.getString("locate.locateEngines"));
			
			// add locate engines to the submenu
			_addLocateEngines(submenuPopup, availableEngines, true);
			
			submenu.appendChild(submenuPopup);
			menu.appendChild(submenu);
		}*/
		
		await document.l10n.translateFragment(menu);
	};
	
	function _addViewOption(selectedItems, optionName, optionObject, showIcons) {
		var menuitem;
		if (optionObject.l10nId) {
			menuitem = _createMenuItem('', null, null); // Set by Fluent
			menuitem.dataset.l10nId = optionObject.l10nId;
			let l10nArgs = optionObject.l10nArgs;
			if (l10nArgs) {
				menuitem.dataset.l10nArgs = JSON.stringify(l10nArgs);
			}
		}
		else {
			menuitem = _createMenuItem(optionObject.label || Trellis.getString(`locate.${optionName}.label`),
				null, null);
		}
		if (optionObject.className && showIcons) {
			menuitem.setAttribute("class", `menuitem-iconic ${optionObject.className}`);
		}
		menuitem.setAttribute("trellis-locate", "true");
		
		menuitem.addEventListener("command", function (event) {
			optionObject.handleItems(selectedItems, event);
		}, false);
		return menuitem;
	}
	
	/**
	 * Add view options to a menu
	 * @param {menupopup} locateMenu The menu to add menu items to
	 * @param {Trellis.Item[]} selectedItems The items to create view options based upon
	 * @param {Boolean} showIcons Whether menu items should have associated icons
	 * @param {Boolean} addExtraOptions Whether to add options that start with "_" below the separator
	 * @param {Boolean} isToolbarMenu Whether the menu being populated is displayed in the toolbar
	 * 		(and not the item tree context menu)
	 * @param {"tab" | "window"} locateMode Whether the menu being populated is displayed in a tab or window
	 */
	var _addViewOptions = async function (locateMenu, selectedItems, showIcons, addExtraOptions, options = {}) {
		let { isToolbarMenu, locateMode } = options;
		var optionsToShow = {};
		
		// check which view options are available
		for (let item of selectedItems) {
			for(var viewOption in ViewOptions) {
				if (!optionsToShow[viewOption]
						&& (!isToolbarMenu || !ViewOptions[viewOption].hideInToolbar)) {
					optionsToShow[viewOption] = await ViewOptions[viewOption].canHandleItem(item, { locateMode });
				}
			}
		}
		
		// Let the ViewOptions update their display properties
		for (let viewOption in optionsToShow) {
			await ViewOptions[viewOption].updateMenuItem?.(selectedItems);
		}
		
		// add available view options to menu
		var lastNode = locateMenu.hasChildNodes() ? locateMenu.firstChild : null;
		var haveOptions = false;
		for(var viewOption in optionsToShow) {
			if(viewOption[0] === "_" || !optionsToShow[viewOption]) continue;
			locateMenu.insertBefore(_addViewOption(selectedItems, viewOption,
				ViewOptions[viewOption], showIcons), lastNode);
			haveOptions = true;
		}
		
		if(haveOptions) {
			var sep = document.createXULElement("menuseparator");
			sep.setAttribute("trellis-locate", "true");
			locateMenu.insertBefore(sep, lastNode);
		}
		
		if(addExtraOptions) {
			for (let viewOption in optionsToShow) {
				if(viewOption[0] !== "_" || !optionsToShow[viewOption]) continue;
				locateMenu.insertBefore(_addViewOption(selectedItems, viewOption.substr(1),
					ViewOptions[viewOption], showIcons), lastNode);
			}
		}
	};
	
	/**
	 * Get available locate engines that can handle a set of items 
	 * @param {Trellis.Item[]} selectedItems The items to look or locate engines for
	 * @return {Trellis.LocateManater.LocateEngine[]} An array of locate engines capable of handling
	 *	the given items
	 */
	function _getAvailableLocateEngines(selectedItems) {
		// check for custom locate engines
		var customEngines = Trellis.LocateManager.getVisibleEngines();
		var availableEngines = [];
		
		// check which engines can translate an item
		for (let engine of customEngines) {
			// require a submission for at least one selected item
			for (let item of selectedItems) {
				if(engine.getItemSubmission(item)) {
					availableEngines.push(engine);
					break;
				}
			}
		}
		
		return availableEngines;
	}
	
	/**
	 * Add locate engine options to a menu
	 * @param {menupopup} menu The menu to add menu items to
	 * @param {Trellis.LocateManager.LocateEngine[]} engines The list of engines to add to the menu
	 * @param {Function|null} items Function to call to locate items
	 * @param {Boolean} showIcons Whether menu items should have associated icons
	 */
	this.addLocateEngines = function (menu, engines, locateFn, showIcons) {
		if(!locateFn) {
			locateFn = this.locateItem;
		}
		
		for (let engine of engines) {
			var menuitem = _createMenuItem(engine.name, null, engine.description);
			menuitem.setAttribute("class", "menuitem-iconic");
			menuitem.setAttribute("image", engine.icon);
			menu.appendChild(menuitem);
			menuitem.addEventListener("command", locateFn, false);
		}
	}
	
	/**
	 * Create a new menuitem XUL element
	 */
	function _createMenuItem( label, id, tooltiptext ) {
		var menuitem = document.createXULElement("menuitem");
		menuitem.setAttribute("label", label);
		if(id) menuitem.setAttribute("id", id);
		if(tooltiptext) menuitem.setAttribute("tooltiptext", tooltiptext);
		
		return menuitem;
	}
	
	/**
	 * Get any locate engines that can be installed from the current page
	 */
	function _getInstallableLocateEngines() {
		var locateEngines = [];
		if(!window.Trellis_Browser || !window.Trellis_Browser.tabbrowser) return locateEngines;
		
		var links = Trellis_Browser.tabbrowser.selectedBrowser.contentDocument.getElementsByTagName("link");
		for (let link of links) {
			if(!link.getAttribute) continue;
			var rel = link.getAttribute("rel");
			if(rel && rel === "search") {
				var type = link.getAttribute("type");
				if(type && type === "application/x-openurl-opensearchdescription+xml") {
					var label = link.getAttribute("title");
					if(label) {
						if(Trellis.LocateManager.getEngineByName(label)) {
							label = 'Update "'+label+'"';
						} else {
							label = 'Add "'+label+'"';
						}
					} else {
						label = 'Add Locate Engine';
					}
					
					locateEngines.push({'label':label,
						'href':link.getAttribute("href"),
						'image':Trellis_Browser.tabbrowser.selectedTab.image});
				}
			}
		}
		
		return locateEngines;
	}
	
	/**
	 * Locate selected items
	 */
	this.locateItem = async function (event, selectedItems) {
		if(!selectedItems) {
			selectedItems = await _getSelectedItems();
		}
		
		// find selected engine
		var selectedEngine = Trellis.LocateManager.getEngineByName(event.target.label);
		if(!selectedEngine) throw "Selected locate engine not found";
		
		var urls = [];
		var postDatas = [];
		for (let item of selectedItems) {
			var submission = selectedEngine.getItemSubmission(item);
			if(submission) {
				urls.push(submission.uri.spec);
				postDatas.push(submission.postData);
			}
		}
		
		Trellis.debug("Loading using "+selectedEngine.name);
		Trellis.debug(urls);
		TrellisPane_Local.loadURI(urls, event, postDatas);
	}
	
  	/**
  	 * Add a new locate engine
  	 */
	function _addLocateEngine(event) {
		Trellis.LocateManager.addEngine(event.target.trellisLocateInfo.href,
			Components.interfaces.nsISearchEngine.TYPE_OPENSEARCH,
			event.target.trellisLocateInfo.image, false);
	}
	
  	/**
  	 * Open the locate manager
  	 */
	function _openLocateEngineManager(event) {
		window.openDialog('chrome://trellis/content/locateManager.xhtml',
			'Trellis Locate Engine Manager',
			'chrome,centerscreen'
		);
	}
	
	/**
	 * Get the first 50 selected items
	 */
	async function _getSelectedItems() {
		var allSelectedItems = TrellisPane.getSelectedItems();
		var selectedItems = [];
		while (selectedItems.length < 50 && allSelectedItems.length) {
			var item = allSelectedItems.shift();
			if (item.isAnnotation()) {
				let attachment = item.parentItem;
				if (attachment.parentItem && attachment === (await attachment.parentItem.getBestAttachment())) {
					selectedItems.push(attachment.parentItem);
				}
				else {
					selectedItems.push(attachment);
				}
			}
			selectedItems.push(item);
		}
		return selectedItems;
	}
	
	var ViewOptions = {};
	
	/**
	 * "Open * in <tab/window>"
	 *
	 * Only for built-in tab item types: PDF, EPUB, Snapshot, Note
	 */
	function ViewItem(alternateWindowBehavior) {
		this._viewItemType = "mixed";
		this._numItems = 0;
		Object.defineProperty(this, "className", {
			get() {
				switch (this._viewItemType) {
					case "pdf":
						return "trellis-menuitem-attachments-pdf";
					case "epub":
						return "trellis-menuitem-attachments-epub";
					case "snapshot":
						return "trellis-menuitem-attachments-snapshot";
					case "note":
						return "trellis-menuitem-attach-note";
					default: {
						let openInNewWindow = Trellis.Prefs.get("openReaderInNewWindow");
						if (alternateWindowBehavior) {
							openInNewWindow = !openInNewWindow;
						}
						return openInNewWindow ? "trellis-menuitem-new-window" : "trellis-menuitem-new-tab";
					}
				}
			},
		});
		
		this.l10nId = "item-menu-viewAttachment";
		Object.defineProperty(this, "l10nArgs", {
			get: () => {
				let openIn;
				if (this._viewItemType !== "mixed" && Trellis.Prefs.get(`fileHandler.${this._viewItemType}`)) {
					openIn = "external";
				}
				else {
					let openInNewWindow = Trellis.Prefs.get("openReaderInNewWindow");
					if (alternateWindowBehavior) {
						openInNewWindow = !openInNewWindow;
					}
					openIn = openInNewWindow ? "window" : "tab";
				}
				return {
					attachmentType: this._viewItemType,
					numAttachments: this._numItems,
					openIn,
				};
			}
		});
		
		this.canHandleItem = async function (item, { locateMode } = {}) {
			const usableItem = await _getFirstUsableItem(item);
			if (!usableItem) {
				return false;
			}
			// Don't show alternate-behavior option when using an external PDF viewer
			if (!item.isNote()
				&& Trellis.Prefs.get(`fileHandler.${usableItem.attachmentReaderType}`)
				&& alternateWindowBehavior) {
				return false;
			}
			if ((locateMode === "tab" && !alternateWindowBehavior)
				|| (locateMode === "window" && alternateWindowBehavior)) {
				// Don't show option if it would open in the same type of the current context
				return false;
			}
			return usableItem;
		};
		
		this.updateMenuItem = async function (items) {
			let viewItemType = null;
			let numItems = 0;
			for (let item of items) {
				let usableItem = await _getFirstUsableItem(item);
				if (!usableItem) {
					continue;
				}
				let thisViewItemType = usableItem.isNote() ? "note" : usableItem?.attachmentReaderType;
				if (!thisViewItemType) {
					continue;
				}
				
				if (viewItemType === null) {
					viewItemType = thisViewItemType;
				}
				else if (viewItemType !== thisViewItemType) {
					viewItemType = "mixed";
				}
				
				numItems++;
			}
			this._viewItemType = viewItemType;
			this._numItems = numItems;
		};
		
		this.handleItems = async function (items, event) {
			let usableItems = [];
			for (let item of items) {
				let usableItem = await _getFirstUsableItem(item);
				if (usableItem) usableItems.push(usableItem);
			}
			
			TrellisPane.viewItems(usableItems, event,
				{
					noLocateOnMissing: false,
					forceAlternateWindowBehavior: alternateWindowBehavior
				});
		};
		
		var _getFirstUsableItem = async function (item) {
			if (item.isNote()) {
				return item;
			}
			let attachments = item.isAttachment() ? [item] : ((await item.getBestAttachments()));
			for (let i = 0; i < attachments.length; i++) {
				let attachment = attachments[i];
				if (attachment.attachmentReaderType
						&& attachment.attachmentLinkMode !== Trellis.Attachments.LINK_MODE_LINKED_URL) {
					return attachment;
				}
			}
			return null;
		};
	}

	ViewOptions.viewItemInTab = new ViewItem(false);
	ViewOptions.viewItemInWindow = new ViewItem(true);

	/**
	 * "View Online" option
	 *
	 * Should appear only when an item or an attachment has a URL
	 */
	ViewOptions.online = new function () {
		this.className = "trellis-menuitem-view-online";
		
		this.canHandleItem = function (item) {
			return _getURL(item).then((val) => val !== false);
		}
		this.handleItems = async function (items, event) {
			var urls = await Promise.all(items.map(item => _getURL(item)));
			TrellisPane_Local.loadURI(urls.filter(url => !!url), event);
		};
		
		var _getURL = async function (item) {
			// try url field for item and for attachments
			var itemURL = item.getField('url');
			if (itemURL) {
				var uri;
				try {
					uri = Trellis_LocateMenu.ios.newURI(itemURL, null, null);
					if (uri && uri.host && uri.scheme !== 'file') {
						return itemURL;
					}
				}
				catch (e) {
				}
			}
			
			// if no url field, try DOI field
			var doi = item.getField('DOI');
			if (doi) {
				doi = Trellis.Utilities.cleanDOI(doi);
				if (doi) {
					return "https://doi.org/" + encodeURIComponent(doi);
				}
			}
			
			// Try attachment url fields
			if (item.isRegularItem()) {
				for (let attachment of Trellis.Items.get(item.getAttachments())) {
					let attachmentURL = attachment.getField('url');
					if (attachmentURL) {
						return attachmentURL;
					}
				}
			}
			
			return false;
		};
	};

	/**
	 * "Open in External Viewer" option
	 *
	 * Should appear only when an item or a linked or attached file or web attachment can be 
	 * viewed by an internal non-native handler and "launchNonNativeFiles" pref is disabled
	 */
	ViewOptions.externalViewer = new function () {
		this.className = "trellis-menuitem-view-external";
		this.useExternalViewer = true;
		
		this.canHandleItem = async function (item) {
			//return (this.useExternalViewer ^ Trellis.Prefs.get('launchNonNativeFiles'))
			//	&& (yield _getBestNonNativeAttachment(item));
			return false;
		};
		
		this.handleItems = async function (items, event) {
			var attachments = [];
			for (let item of items) {
				var attachment = await _getBestNonNativeAttachment(item);
				if(attachment) attachments.push(attachment.id);
			}
			
			TrellisPane_Local.viewAttachment(attachments, event, false, this.useExternalViewer);
		};
		
		var _getBestNonNativeAttachment = async function (item) {
			var attachments = item.isAttachment() ? [item] : ((await item.getBestAttachments()));
			for (let i = 0; i < attachments.length; i++) {
				let attachment = attachments[i];
				if(attachment.attachmentLinkMode !== Trellis.Attachments.LINK_MODE_LINKED_URL) {
					var path = await attachment.getFilePathAsync();
					if (path) {
						try {
							var ext = Trellis.File.getExtension(Trellis.File.pathToFile(path));
						}
						catch (e) {
							Trellis.logError(e);
							return false;
						}
						if(!attachment.attachmentContentType ||
								Trellis.MIME.hasNativeHandler(attachment.attachmentContentType, ext)) {
							return false;
						}
						return attachment;
					}
				}
			}
			return false;
		};
	};
	
	/**
	 * "Open in Internal Viewer" option
	 *
	 * Should appear only when an item or a linked or attached file or web attachment can be 
	 * viewed by an internal non-native handler and "launchNonNativeFiles" pref is enabled
	 */
	ViewOptions.internalViewer = new function () {
		this.icon = "chrome://trellis/skin/locate-internal-viewer.png";
		this.useExternalViewer = false;
		this.canHandleItem = ViewOptions.externalViewer.canHandleItem;
		this.handleItems = ViewOptions.externalViewer.handleItems;
	};
	
	/**
	 * "Show File" option
	 *
	 * Should appear only when an item is a file or web attachment, or has a linked or attached
	 * file or web attachment
	 */
	ViewOptions.showFile = new function () {
		this.className = "trellis-menuitem-show-file";
		this.hideInToolbar = true;
		
		this.canHandleItem = function (item) {
			return TrellisPane.canShowItemInFilesystem(item);
		};
		
		this.updateMenuItem = function (items) {
			if (Trellis.isMac) {
				this.l10nId = 'menu-file-show-in-finder';
			}
			else {
				// We only care about showing 1 or many
				let count = Trellis.Items.numDistinctFileAttachmentsForLabel(items) > 1 ? 2 : 1;
				this.l10nId = count > 1 ? 'menu-file-show-files' : 'menu-file-show-file';
			}
		};
		
		this.handleItems = async function (items) {
			await TrellisPane.showItemsInFilesystem(items);
		};
	};
	
	/**
	 * "Library Lookup" Option
	 *
	 * Should appear only for regular items
	 */
	ViewOptions._libraryLookup = new function () {
		this.className = "trellis-menuitem-library-lookup";
		this.canHandleItem = function (item) { return Promise.resolve(item.isRegularItem()); };
		this.handleItems = async function (items, event) {
			// If no resolver configured, show error
			if (!Trellis.Prefs.get('openURL.resolver')) {
				let paneName = Trellis.Intl.strings['trellis.preferences.prefpane.general'];
				let [noResolverStr, openSettingsStr] = await document.l10n.formatValues(
					[
						{ id: 'locate-library-lookup-no-resolver', args: { pane: paneName } },
						{ id: 'general-open-settings' }
					]
				);
				let ps = Services.prompt;
				let buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
					+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
				let index = ps.confirmEx(
					null,
					Trellis.getString('locate.libraryLookup.noResolver.title'),
					noResolverStr,
					buttonFlags,
					openSettingsStr,
					null, null, null, {}
				);
				if (index == 0) {
					Trellis.Utilities.Internal.openPreferences('trellis-prefpane-general', {
						scrollTo: '#trellis-prefpane-locate-groupbox'
					});
				}
				return;
			}
			var urls = [];
			for (let item of items) {
				if(!item.isRegularItem()) continue;
				var url = Trellis.Utilities.Internal.OpenURL.resolve(item);
				if(url) urls.push(url);
			}
			TrellisPane_Local.loadURI(urls, event);
		};
	};
}
