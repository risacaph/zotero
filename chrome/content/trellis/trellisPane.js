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

const { TRELLIS_CONFIG } = ChromeUtils.importESModule('resource://trellis/config.mjs');
var { FilePicker } = ChromeUtils.importESModule('chrome://trellis/content/modules/filePicker.mjs');

/*
 * This object contains the various functions for the interface
 */
var TrellisPane = new function () {
	var _unserialized = false;
	this.collectionsView = false;
	this.itemsView = false;
	this.itemPane = false;
	this.progressWindow = false;
	this._listeners = {};
	this.__defineGetter__('loaded', function () { return _loaded; });
	var _lastSelectedItems = [];
	var lastFocusedElement = null;
	this.lastKeyPress = null;
	
	//Privileged methods
	this.destroy = destroy;
	this.isFullScreen = isFullScreen;
	this.handleKeyDown = handleKeyDown;
	this.captureKeyDown = captureKeyDown;
	this.handleKeyUp = handleKeyUp;
	this.handleKeyPress = handleKeyPress;
	this.getSelectedSavedSearch = getSelectedSavedSearch;
	this.getSortField = getSortField;
	this.getSortDirection = getSortDirection;
	this.setItemsPaneMessage = setItemsPaneMessage;
	this.clearItemsPaneMessage = clearItemsPaneMessage;
	this.viewSelectedAttachment = viewSelectedAttachment;
	this.reportErrors = reportErrors;
	
	this.document = document;

	const modifierIsNotShift = ev => ev.getModifierState("Meta") || ev.getModifierState("Alt")
	|| ev.getModifierState("Control") || ev.getModifierState("OS");
	
	const TAB_NUMBER_CODE_RE = /^(?:Numpad|Digit)([0-9])$/;

	var self = this,
		_loaded = false, _madeVisible = false,
		titlebarcolorState, titleState, observerService,
		_reloadFunctions = [], _beforeReloadFunctions = [];
	
	/**
	 * Called when the window containing Trellis pane is open
	 */
	this.init = function () {
		Trellis.debug("Initializing Trellis pane");
		
		// Set key down handler
		document.addEventListener('keydown', TrellisPane_Local.handleKeyDown);
		// Keydown handling that captures events. E.g. tab navigation
		document.addEventListener('keydown', TrellisPane.captureKeyDown, true);
		// focusout, unlike blur, bubbles up to document level
		// so handleBlur gets triggered when any field, not just the document, looses focus
		document.addEventListener('focusout', TrellisPane.handleBlur);
		
		// Init toolbar buttons for all progress queues
		let progressQueueButtons = document.getElementById('trellis-pq-buttons');
		let progressQueues = Trellis.ProgressQueues.getAll();
		for (let progressQueue of progressQueues) {
			let button = document.createXULElement('toolbarbutton');
			button.id = 'trellis-tb-pq-' + progressQueue.getID();
			button.hidden = progressQueue.getTotal() < 1;
			button.addEventListener('command', function () {
				Trellis.ProgressQueues.get(progressQueue.getID()).getDialog().open();
			}, false);
			
			progressQueue.addListener('empty', function () {
				button.hidden = true;
			});
			
			progressQueue.addListener('nonempty', function () {
				button.hidden = false;
			});
			
			progressQueueButtons.appendChild(button);
		}
		
		_loaded = true;

		// Register a window controller for global undo/redo. Appending (rather
		// than inserting at 0) ensures text-editing controllers take priority.
		window.controllers.appendController(Trellis.UndoHistory.getController(document));

		var zp = document.getElementById('trellis-pane');
		Trellis.UIProperties.registerRoot(zp);
		zp.addEventListener('UIPropertiesChanged', () => {
			this.collectionsView?.updateFontSize();
			this.itemsView?.updateFontSize();
		});
		Trellis.UIProperties.registerRoot(document.getElementById('trellis-context-pane'));
		this.itemPane = document.querySelector("#trellis-item-pane");
		TrellisPane_Local.updateLayout();
		this.updateWindow();
		window.addEventListener("resize", () => {
			this.updateWindow();
			let tabsDeck = document.querySelector('#tabs-deck')
			if (!tabsDeck || tabsDeck.getAttribute('selectedIndex') == 0) {
				this.updateLayoutConstraints();
			}
		});
		window.setTimeout(this.updateLayoutConstraints.bind(this), 0);
		
		Trellis.updateQuickSearchBox(document);
		
		if (Trellis.isMac) {
			document.getElementById('trellis-pane-stack').setAttribute('platform', 'mac');
			Trellis.getOSVersion().then((osVersion) => {
				let [_, version] = osVersion.split(' ');
				if (Services.vc.compare(version, '26.0') >= 0) {
					document.documentElement.setAttribute('macos-tahoe', 'true');
				}
			});
		} else if(Trellis.isWin) {
			document.getElementById('trellis-pane-stack').setAttribute('platform', 'win');
		}
		
		// Set the sync tooltip label
		let syncLabel = document.getElementById('trellis-tb-sync-label');
		syncLabel.value = Trellis.getString('sync.syncWith', TRELLIS_CONFIG.DOMAIN_NAME);
		let syncButton = document.querySelector("#trellis-tb-sync");
		syncButton.setAttribute("aria-label", syncLabel.value);
		// Update the aria-description on focus
		syncButton.addEventListener("focus", function (_) {
			Trellis.Sync.Runner.registerSyncStatus(this.firstChild);
			let lastSync = document.querySelector("#trellis-tb-sync-last-sync").value;
			this.setAttribute("aria-description", lastSync || "");
		});
		
		// register an observer for Trellis reload
		observerService = Components.classes["@mozilla.org/observer-service;1"]
					.getService(Components.interfaces.nsIObserverService);
		observerService.addObserver(_reloadObserver, "trellis-reloaded", false);
		observerService.addObserver(_reloadObserver, "trellis-before-reload", false);
		this.addReloadListener(_loadPane);
		
		// continue loading pane
		_loadPane();
		setUpKeyboardNavigation();
	};

	function setUpKeyboardNavigation() {
		let collectionTreeToolbar = document.getElementById("trellis-toolbar-collection-tree");
		let itemTreeToolbar = document.getElementById("trellis-toolbar-item-tree");
		let titleBar = document.getElementById("trellis-title-bar");
		let itemTree = document.getElementById("trellis-items-tree");
		let collectionsTree = document.getElementById("trellis-collections-tree");
		let tagSelector = document.getElementById("trellis-tag-selector");
		let tagContainer = document.getElementById('trellis-tag-selector-container');
		let collectionsPane = document.getElementById("trellis-collections-pane");

		// function to handle actual focusing based on a given event
		// and a mapping of event targets + keys to the focus destinations
		let moveFocus = function (actionsMap, event, verticalArrowIsTab = false) {
			var key = event.key;
			if (key === 'Tab' && modifierIsNotShift(event)) return;

			if (event.shiftKey) {
				key = 'Shift' + key;
			}
			// ArrowUp or ArrowDown act the same way as as
			// shift-tab/tab unless it is on a menu, in which case
			// it'll open the menu popup
			let isMenu = event.target.getAttribute('type') === 'menu'
						|| event.originalTarget?.getAttribute('type') === 'menu';
			if (isMenu && ['ArrowUp', 'ArrowDown'].includes(key)) {
				return;
			}
			let onInput = event.originalTarget.tagName.toLowerCase() == "input";
			if (verticalArrowIsTab && key == 'ArrowUp' && !onInput) {
				key = 'ShiftTab';
			}
			else if (verticalArrowIsTab && key == 'ArrowDown' && !onInput) {
				key = 'Tab';
			}
			if (key == Trellis.arrowPreviousKey) {
				key = 'ArrowPrevious';
			}
			else if (key == Trellis.arrowNextKey) {
				key = 'ArrowNext';
			}
			// Fetch the focusFunction by target id
			let focusFunction = actionsMap[event.target.id]?.[key];
			// If no function found by target id, try to search by class names
			if (focusFunction === undefined) {
				for (let className of event.target.classList) {
					focusFunction = actionsMap[className]?.[key];
					if (focusFunction) break;
				}
			}
			// If the focusFunction is undefined, nothing was found
			// for this combination of keys, so do nothing
			if (focusFunction === undefined) {
				return;
			}
			// Otherwise, fetch the target to focus on
			let target = focusFunction(event);
			// If returned target is false, focusing was not handled,
			// so fallback to default focus target
			if (target === false) {
				return;
			}
			// If target is undefined, the actionsMap's function
			// handled focus by itself (e.g. by calling .click)
			if (target) {
				// If desired target is hidden/disabled, create a fake event
				// and dispatch it on the hidden target to rerun moveFocus
				// and place focus on the next non-hidden node
				if (target.disabled || target.hidden || target.parentNode.hidden
						|| getComputedStyle(target).display === 'none') {
					event.target = target;
					let fakeEventCopy = new KeyboardEvent('keydown', {
						key: event.key,
						shiftKey: event.shiftKey,
						bubbles: true
					});
					target.dispatchEvent(fakeEventCopy);
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				target.focus();
			}
			event.preventDefault();
			event.stopPropagation();
		};

		titleBar.addEventListener("keydown", (event) => {
			let cmdOrCtrlOnly = e => (Trellis.isMac ? (e.metaKey && !e.ctrlKey) : e.ctrlKey) && !e.shiftKey && !e.altKey;

			// Mapping of target ids and possible key presses to desired focus outcomes
			let actionsMap = {
				'trellis-tb-tabs-menu': {
					ArrowNext: () => null,
					ArrowPrevious: () => null,
					Tab: () => document.getElementById('trellis-tb-sync-error'),
					ShiftTab: () => {
						Trellis_Tabs.moveFocus("current");
					},
				},
				'trellis-tb-sync': {
					ArrowNext: () => null,
					ArrowPrevious: () => null,
					Tab: () => {
						Trellis_Tabs.focusFirst();
						return null;
					},
					ShiftTab: () => document.getElementById('trellis-tb-sync-error')
				},
				'trellis-tb-sync-error': {
					ArrowNext: () => null,
					ArrowPrevious: () => null,
					Tab: () => document.getElementById('trellis-tb-sync'),
					ShiftTab: () => document.getElementById('trellis-tb-tabs-menu'),
					Enter: () => document.getElementById("trellis-tb-sync-error")
						.dispatchEvent(new MouseEvent("click", { target: event.target })),
					' ': () => document.getElementById("trellis-tb-sync-error")
						.dispatchEvent(new MouseEvent("click", { target: event.target }))
				},
				tab: {
					// keyboard navigation for tabs. 'tab' is the class, not the id
					Tab: () => document.getElementById('trellis-tb-tabs-menu'),
					ShiftTab: Trellis_Tabs.focusWrapAround,
					ArrowNext: (e) => {
						if (cmdOrCtrlOnly(e)) {
							Trellis_Tabs.moveFocus("next");
						}
						else {
							Trellis_Tabs.selectNext({ keepTabFocused: true });
						}
					},
					ArrowPrevious: (e) => {
						if (cmdOrCtrlOnly(e)) {
							Trellis_Tabs.moveFocus("previous");
						}
						else {
							Trellis_Tabs.selectPrev({ keepTabFocused: true });
						}
					},
					Enter: (e) => {
						Trellis_Tabs.select(e.target.getAttribute('data-id'), false, { keepTabFocused: false });
					},
					' ': (e) => {
						Trellis_Tabs.select(e.target.getAttribute('data-id'), false, { keepTabFocused: false });
					}
				}
			};
			moveFocus(actionsMap, event, true);
		});

		let collectionsSearchField = document.getElementById("trellis-collections-search");
		let clearCollectionSearch = () => {
			// If empty filter - just focus the collectionTree
			if (collectionsSearchField.value.length == 0) {
				return document.getElementById("collection-tree");
			}
			// Clear the search field and focus collection tree
			if (collectionsSearchField.value.length) {
				collectionsSearchField.value = '';
				TrellisPane.collectionsView.setFilter("", true);
			}
			TrellisPane.hideCollectionSearch();
			return null;
		};
		let focusCollectionTree = () => {
			// Prevent Enter/Tab pressed before the filtering ran from doing anything
			if (!TrellisPane.collectionsView.filterEquals(collectionsSearchField.value)) {
				return null;
			}
			// If the current row passes the filter, make sure it is visible and focus collectionTree
			if (TrellisPane.collectionsView.focusedRowMatchesFilter()) {
				TrellisPane.collectionsView.ensureRowIsVisible(TrellisPane.collectionsView.selection.focused);
				return document.getElementById('collection-tree');
			}
			// Otherwise, focus the first row passing the filter
			TrellisPane.collectionsView.focusFirstMatchingRow(false);
			return null;
		};
		collectionTreeToolbar.addEventListener("keydown", (event) => {
			let actionsMap = {
				'trellis-tb-collection-add': {
					ArrowNext: () => null,
					ArrowPrevious: () => null,
					Tab: () => document.getElementById('trellis-tb-collections-search').click(),
					ShiftTab: () => document.getElementById('trellis-tb-sync')
				},
				'trellis-collections-search': {
					Tab: focusCollectionTree,
					ShiftTab: () => document.getElementById('trellis-tb-collection-add'),
					Enter: focusCollectionTree,
					Escape: clearCollectionSearch
				},
			};
			moveFocus(actionsMap, event, true);
		});

		itemTreeToolbar.addEventListener("keydown", (event) => {
			let actionsMap = {
				'trellis-tb-add': {
					ArrowNext: () => document.getElementById("trellis-tb-lookup"),
					ArrowPrevious: () => null,
					Tab: () => document.getElementById("trellis-tb-search").focus(),
					ShiftTab: () => {
						if (collectionsPane.getAttribute("collapsed")) {
							return document.getElementById('trellis-tb-sync');
						}
						if (tagContainer.getAttribute('collapsed') == "true") {
							return focusCollectionTree();
						}
						return document.querySelector("#trellis-tag-selector button");
					}
				},
				'trellis-tb-lookup': {
					ArrowNext: () => document.getElementById("trellis-tb-attachment-add"),
					ArrowPrevious: () => document.getElementById("trellis-tb-add"),
					Tab: () => document.getElementById("trellis-tb-search").focus(),
					ShiftTab: () => document.getElementById('trellis-tb-collections-search').click(),
					Enter: () => Trellis_Lookup.showPanel(event.target),
					' ': () => Trellis_Lookup.showPanel(event.target)
				},
				'trellis-tb-attachment-add': {
					ArrowNext: () => document.getElementById("trellis-tb-note-add"),
					ArrowPrevious: () => document.getElementById("trellis-tb-lookup"),
					Tab: () => document.getElementById("trellis-tb-search").focus(),
					ShiftTab: () => document.getElementById('trellis-tb-collections-search').click()
				},
				'trellis-tb-note-add': {
					ArrowNext: () => null,
					ArrowPrevious: () => document.getElementById("trellis-tb-attachment-add"),
					Tab: () => document.getElementById("trellis-tb-search").focus(),
					ShiftTab: () => document.getElementById('trellis-tb-collections-search').click()
				},
				'trellis-tb-search-dropmarker': {
					ArrowNext: () => null,
					ArrowPrevious: () => null,
					Tab: () => document.getElementById("trellis-tb-search-textbox"),
					ShiftTab: () => document.getElementById('trellis-tb-add')
				},
				'advanced-collapse-button': {
					ShiftTab: () => document.getElementById('trellis-tb-add')
				},
				'trellis-tb-search-textbox': {
					Tab: () => document.getElementById("trellis-tb-search-advanced-button"),
					ShiftTab: () => document.getElementById("trellis-tb-search").focus()
				},
				'trellis-tb-search-advanced-button': {
					Tab: () => document.getElementById("trellis-tb-toggle-item-pane-stacked"),
					ShiftTab: () => document.getElementById("trellis-tb-search-textbox")
				},
				'trellis-tb-toggle-item-pane-stacked': {
					Tab: () => itemTree.querySelector(".virtualized-table"),
					ShiftTab: () => document.getElementById("trellis-tb-search-advanced-button")
				},
			};
			moveFocus(actionsMap, event, true);
		});

		collectionsTree.addEventListener("keydown", (event) => {
			let actionsMap = {
				'collection-tree': {
					ShiftTab: () => document.getElementById('trellis-tb-collections-search').click(),
					Tab: () => {
						if (tagContainer.getAttribute('collapsed') == "true") {
							return document.getElementById('trellis-tb-add');
						}
						// If tag selector is collapsed, go to "New item" button, otherwise focus tag selector
						if (TrellisPane.tagSelector.isTagListEmpty()) {
							return tagSelector.querySelector(".search-input");
						}
						TrellisPane.tagSelector.focusTagList();
						return null;
					},
					Escape: clearCollectionSearch
				}
			};
			moveFocus(actionsMap, event);
		});

		itemTree.addEventListener("keydown", (event) => {
			let actionsMap = {
				// The item tree's DOM id has a view-specific suffix, so key on the current view's id
				[TrellisPane.itemsView?.id]: {
					ShiftTab: () => {
						let advancedSearchDeck = document.getElementById('trellis-advanced-search-pane-deck');
						// Advanced Search open - focus the last focusable element of the deck
						if (advancedSearchDeck?.state === 'open') {
							Services.focus.moveFocus(
								window,
								document.getElementById('trellis-items-pane'),
								Services.focus.MOVEFOCUS_BACKWARD,
								0
							);
							return null;
						}
						// Advanced Search collapsed - focus the close button
						if (advancedSearchDeck?.state === 'collapsed') {
							return document.querySelector('#trellis-tb-search .advanced-close-button');
						}
						return document.getElementById('trellis-tb-toggle-item-pane-stacked');
					}
				}
			};
			moveFocus(actionsMap, event);
		});

		tagSelector.addEventListener("keydown", (e) => {
			let actionsMap = {
				'search-input': {
					Tab: () => tagSelector.querySelector('.tag-selector-actions'),
					ShiftTab: () => {
						if (TrellisPane.tagSelector.isTagListEmpty()) {
							return document.getElementById("collection-tree");
						}
						TrellisPane.tagSelector.focusTagList();
						return null;
					},
				},
				'tag-selector-item': {
					Tab: () => tagSelector.querySelector(".search-input"),
					ShiftTab: () => document.getElementById("collection-tree"),
				},
				'tag-selector-actions': {
					Tab: () => document.getElementById('trellis-tb-add'),
					ShiftTab: () => tagSelector.querySelector(".search-input")
				},
				'tag-selector-list': {
					Tab: () => tagSelector.querySelector(".search-input"),
					ShiftTab: () => document.getElementById("collection-tree"),
				}
			};
			moveFocus(actionsMap, e);
		});
	}

	function addFocusHandlers() {
		// When the item type menupopup from itemBoxshows,
		// hide the focus ring around the currently focused element
		document.addEventListener("popupshowing", (e) => {
			if (e.target.tagName == "menupopup" && e.target.parentNode.id == "item-type-menu") {
				document.activeElement.style.setProperty('--width-focus-border', '0');
				document.activeElement.classList.add("hidden-focus");
			}
		});

		// When a panel popup hides, refocus the previous element
		// When a menupopup hides, stop hiding the focus-ring
		document.addEventListener("popuphiding", (e) => {
			if (TrellisPane.lastFocusedElement
					&& !Components.utils.isDeadWrapper(TrellisPane.lastFocusedElement)
					&& e.target.tagName == "panel"
					&& document.activeElement && e.target.contains(document.activeElement)) {
				TrellisPane.lastFocusedElement.focus();
			}
			let noFocus = [...document.querySelectorAll(".hidden-focus")];
			for (let node of noFocus) {
				node.style.removeProperty('--width-focus-border');
				node.classList.remove("hidden-focus");
			}
		});
	}

	/**
	 * Called on window load or when pane has been reloaded after switching into or out of connector
	 * mode
	 */
	async function _loadPane() {
		if (!Trellis || !Trellis.initialized) return;
		
		// Set flags for hi-res displays
		Trellis.hiDPI = window.devicePixelRatio > 1;
		Trellis.hiDPISuffix = Trellis.hiDPI ? "@2x" : "";
		
		// Show warning in toolbar for 'dev' channel builds and troubleshooting mode
		try {
			let afterElement = 'trellis-tb-tabs-menu';
			let isDevBuild = Trellis.isDevBuild;
			let isSafeMode = Services.appinfo.inSafeMode;
			// Uncomment to test
			//isDevBuild = true;
			//isSafeMode = true;
			if (isDevBuild || isSafeMode) {
				let label = document.createElement('div');
				label.className = "toolbar-mode-warning";
				let msg = '';
				if (isDevBuild) {
					label.onclick = function () {
						Trellis.launchURL('https://www.trellis.org/support/kb/test_builds');
					};
					msg = 'TEST BUILD — DO NOT USE';
				}
				else if (isSafeMode) {
					label.classList.add('safe-mode');
					label.onclick = function () {
						Trellis.Utilities.Internal.quit(true);
					};
					msg = 'Troubleshooting Mode';
				}
				label.textContent = msg;
				document.getElementById(afterElement).after(label);
			}
		}
		catch (e) {
			Trellis.logError(e);
		}
			
		Trellis_Tabs.init();
		TrellisContextPane.init();
		await TrellisPane.initCollectionsTree();
		await TrellisPane.initItemsTree();
		TrellisPane.initCollectionTreeSearch();
		
		// Add a default progress window
		TrellisPane.progressWindow = new Trellis.ProgressWindow({ window });
		
		TrellisPane.setItemsPaneMessage(Trellis.getString('pane.items.loading'));
		
		Trellis.Keys.windowInit(document);
		
		if (Trellis.restoreFromServer) {
			Trellis.restoreFromServer = false;
			
			setTimeout(function () {
				var ps = Services.prompt;
				var buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
									+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
				var index = ps.confirmEx(
					null,
					"Trellis Restore",
					"The local Trellis database has been cleared."
						+ " "
						+ "Would you like to restore from the Trellis server now?",
					buttonFlags,
					"Sync Now",
					null, null, null, {}
				);
				
				if (index == 0) {
					Trellis.Sync.Server.sync({
						onSuccess: function () {
							Trellis.Sync.Runner.updateIcons([]);
							
							ps.alert(
								null,
								"Restore Completed",
								"The local Trellis database has been successfully restored."
							);
						},
						
						onError: function (msg) {
							ps.alert(
								null,
								"Restore Failed",
								"An error occurred while restoring from the server:\n\n"
									+ msg
							);
							
							Trellis.Sync.Runner.error(msg);
						}
					});
				}
			}, 1000);
		}
		// If the database was initialized or there are no sync credentials and
		// Trellis hasn't been run before in this profile, display the start page
		// -- this way the page won't be displayed when they sync their DB to
		// another profile or if the DB is initialized erroneously (e.g. while
		// switching data directory locations)
		else if (Trellis.Prefs.get('firstRun2')) {
			if (Trellis.Schema.dbInitialized || !Trellis.Sync.Server.enabled) {
				setTimeout(function () {
					TrellisPane_Local.loadURI(TRELLIS_CONFIG.START_URL);
				}, 400);
			}
			Trellis.Prefs.set('firstRun2', false);
			try {
				Trellis.Prefs.clear('firstRun');
			}
			catch (e) {}
		}
		
		if (Trellis.openPane) {
			Trellis.openPane = false;
			setTimeout(function () {
				TrellisPane_Local.show();
			}, 0);
		}
		
		setTimeout(function () {
			TrellisPane.setBannerZIndexes();
			TrellisPane.showPostUpgradeBanner();
			TrellisPane.showRetractionBanner();
			TrellisPane.showArchitectureWarning();
			TrellisPane.showFileRenamingBanner();
			TrellisPane.initSyncReminders(true);

			if (Trellis.Prefs.get('reopenAccountPrefsOnRestart')) {
				Trellis.Prefs.clear('reopenAccountPrefsOnRestart');
				Trellis.Utilities.Internal.openPreferences('trellis-prefpane-account');
			}
		});
		
		// TEMP: Clean up extra files from Mendeley imports <5.0.51
		setTimeout(async function () {
			var needsCleanup = await Trellis.DB.valueQueryAsync(
				"SELECT COUNT(*) FROM settings WHERE setting='mImport' AND key='cleanup'"
			)
			if (!needsCleanup) return;
			
			var { Trellis_Import_Mendeley } = ChromeUtils.importESModule(
				"chrome://trellis/content/import/mendeley/mendeleyImport.mjs"
			);
			var importer = new Trellis_Import_Mendeley();
			importer.deleteNonPrimaryFiles();
		}, 10000)
		
		// Restore pane state
		try {
			let state = Trellis.Session.state.windows.find(x => x.type == 'pane');
			if (state) {
				Trellis_Tabs.restoreState(state.tabs);
			}
		}
		catch (e) {
			Trellis.logError(e);
		}
		addFocusHandlers();
	}
	
	
	this.initContainers = function () {
		this.initTagSelector();
	};
	
	
	this.uninitContainers = function () {
		if (this.tagSelector) this.tagSelector.uninit();
	};
	
	
	var _lastPrimaryTypes;
	this.updateNewItemTypes = function () {
		var primaryTypes = Trellis.ItemTypes.getPrimaryTypes();
		var primaryTypesJoined = primaryTypes.join(',');
		if (_lastPrimaryTypes == primaryTypesJoined) {
			return;
		}
		
		var addMenu = document.getElementById('trellis-tb-add').firstElementChild;
		
		// Remove all nodes so we can regenerate
		addMenu.replaceChildren();
		
		// Primary types from MRU
		let primaryItemTypes = primaryTypes.map((type) => {
			return {
				id: type.id,
				name: type.name,
				localized: Trellis.ItemTypes.getLocalizedString(type.id)
			};
		});
		// Item types not in the MRU list
		let secondaryItemTypes = Trellis.ItemTypes.getSecondaryTypes().map((type) => {
			return {
				id: type.id,
				name: type.name,
				localized: Trellis.ItemTypes.getLocalizedString(type.id)
			};
		});

		let allItemTypes = [...primaryItemTypes, ...secondaryItemTypes];
		
		var collation = Trellis.getLocaleCollation();
		primaryItemTypes.sort(function (a, b) {
			return collation.compareString(1, a.localized, b.localized);
		});
		allItemTypes.sort(function (a, b) {
			return collation.compareString(1, a.localized, b.localized);
		});
		// The array of all item types with MRU prepended to the top
		let itemTypes = primaryItemTypes.concat(allItemTypes);
		for (let itemType of itemTypes) {
			let menuitem = document.createXULElement("menuitem");
			menuitem.setAttribute("label", itemType.localized);
			menuitem.setAttribute("tooltiptext", "");
			let type = itemType.id;
			menuitem.addEventListener("command", function () {
				TrellisPane.newItem(type, {}, null, true);
			});
			addMenu.appendChild(menuitem);
			// Add a separator between primary and secondary types
			if (addMenu.childElementCount == primaryItemTypes.length) {
				let separator = document.createXULElement("menuseparator");
				addMenu.appendChild(separator);
			}
		}
	}
	
	
	/*
	 * Called when the window closes
	 */
	function destroy()
	{
		if (!Trellis || !Trellis.initialized || !_loaded) {
			return;
		}
		
		this.serializePersist();

		if(this.collectionsView) this.collectionsView.unregister();
		if(this.itemsView) this.itemsView.unregister();
		if (_syncRemindersObserverID) {
			Trellis.Notifier.unregisterObserver(_syncRemindersObserverID);
		}
		
		this.uninitContainers();
		
		observerService.removeObserver(_reloadObserver, "trellis-reloaded");
		
		TrellisContextPane.destroy();
		Trellis_Tabs.destroy();

		if (!Trellis.getTrellisPanes().length) {
			Trellis.Session.setLastClosedTrellisPaneState(this.getState());
		}

		Trellis_Tabs.closeAll();
	}
	
	/**
	 * Called before Trellis pane is to be made visible
	 * @return {Boolean} True if Trellis pane should be loaded, false otherwise (if an error
	 * 		occurred)
	 */
	this.makeVisible = async function () {
		if (Trellis.locked) {
			Trellis.showTrellisPaneProgressMeter();
		}
		
		await Trellis.unlockPromise;
		
		// The items pane is hidden initially to avoid showing column lines
		Trellis.hideTrellisPaneOverlays();
		
		// If pane not loaded, load it or display an error message
		if (!TrellisPane_Local.loaded) {
			TrellisPane_Local.init();
		}
		
		// If Trellis could not be initialized, display an error message and return
		if (!Trellis || Trellis.skipLoading || Trellis.crashed) {
			this.displayStartupError();
			return false;
		}
		
		_madeVisible = true;

		this.unserializePersist();
		this.updateLayout();
		this.initContainers();
		
		// Focus the quicksearch on pane open
		var searchBar = document.getElementById('trellis-tb-search');
		setTimeout(function () {
			searchBar.searchTextbox.select();
		}, 1);
		
		if (Trellis.proxyFailure) {
			try {
				Trellis.Sync.Runner.updateIcons(Trellis.proxyFailure);
			}
			catch (e) {
				Trellis.logError(e);
			}
		}
		
		// Auto-sync on pane open or if new account
		let startupSync = false;
		if (Trellis.Prefs.get('sync.autoSync') || Trellis.initAutoSync) {
			await Trellis.proxyAuthComplete;
			await Trellis.uiReadyPromise;
			
			if (!Trellis.Sync.Runner.enabled) {
				Trellis.debug('Sync not enabled -- skipping auto-sync', 4);
			}
			else if (Trellis.Sync.Runner.syncInProgress) {
				Trellis.debug('Sync already running -- skipping auto-sync', 4);
			}
			else if (Trellis.Sync.Server.manualSyncRequired) {
				Trellis.debug('Manual sync required -- skipping auto-sync', 4);
			}
			else {
				startupSync = true;
				Trellis.Sync.Runner.sync({
					background: true
				})
				.then(() => {
					Trellis.initAutoSync = false;
					Trellis.startupSyncDeferred.resolve();
				});
			}
		}
		if (!startupSync) {
			Trellis.startupSyncDeferred.resolve();
		}
		
		// Set sync icon to spinning if there's an existing sync
		//
		// We don't bother setting an existing error state at open
		if (Trellis.Sync.Runner.syncInProgress) {
			Trellis.Sync.Runner.updateIcons('animate');
		}

		return true;
	};
	
	
	function isFullScreen() {
		return document.getElementById('trellis-pane-stack').getAttribute('fullscreenmode') == 'true';
	}
	
	/**
	 * Capturing listener to handle shortcut-related keypresses when we need
	 * to be sure that the events are not handled by any other lower-level component.
	 * E.g. tab navigation hotkeys should work regardless of which component is focused.
	 */
	function captureKeyDown(event) {
		TrellisPane.lastKeyPress = (event.shiftKey ? "Shift" : "") + event.key;
		const cmdOrCtrlOnly = Trellis.isMac
			? (event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey)
			: (event.ctrlKey && !event.shiftKey && !event.altKey);
		
		// Close current tab
		if (event.key == 'w') {
			if (cmdOrCtrlOnly) {
				if (Trellis_Tabs.selectedIndex > 0) {
					Trellis_Tabs.close();
					event.preventDefault();
					event.stopPropagation();
				}
				return;
			}
		}

		// Undo closed tabs
		if ((Trellis.isMac && event.metaKey || !Trellis.isMac && event.ctrlKey)
				&& event.shiftKey && !event.altKey && event.key.toLowerCase() == 't') {
			Trellis_Tabs.undoClose();
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		
		// Tab navigation: Ctrl-PageUp / PageDown
		// TODO: Select across tabs without selecting with Ctrl-Shift, as in Firefox?
		if (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
			if (event.key == 'PageUp') {
				Trellis_Tabs.selectPrev();
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			else if (event.key == 'PageDown') {
				Trellis_Tabs.selectNext();
				event.preventDefault();
				event.stopPropagation();
				return;
			}
		}
		
		// Tab navigation: Cmd-Shift-[ / ]
		// Common shortcut on macOS, but typically only supported on that platform to match OS
		// conventions users expect from other macOS apps.
		if (Trellis.isMac) {
			if (event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey) {
				if (event.key == '[') {
					Trellis_Tabs.selectPrev();
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				else if (event.key == ']') {
					Trellis_Tabs.selectNext();
					event.preventDefault();
					event.stopPropagation();
					return;
				}
			}
			else if (event.metaKey && event.altKey) {
				if (event.key == Trellis.arrowPreviousKey) {
					Trellis_Tabs.selectPrev();
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				else if (event.key == Trellis.arrowNextKey) {
					Trellis_Tabs.selectNext();
					event.preventDefault();
					event.stopPropagation();
					return;
				}
			}
		}
		
		// Tab navigation: Ctrl-Tab / Ctrl-Shift-Tab
		if (event.ctrlKey && !event.altKey && !event.metaKey && event.key == 'Tab') {
			if (event.shiftKey) {
				Trellis_Tabs.selectPrev();
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			else {
				Trellis_Tabs.selectNext();
				event.preventDefault();
				event.stopPropagation();
				return;
			}
		}
		
		// Tab navigation: CmdOrCtrl-1 through 9
		// Jump to tab N (or to the last tab if there are less than N tabs)
		// CmdOrCtrl-9 is specially defined to jump to the last tab no matter how many there are.
		if (cmdOrCtrlOnly) {
			let tabNumberMatch = event.code.match(TAB_NUMBER_CODE_RE);
			if (tabNumberMatch) {
				let tabNumber = tabNumberMatch[1];
				switch (tabNumber) {
					case '1':
					case '2':
					case '3':
					case '4':
					case '5':
					case '6':
					case '7':
					case '8':
						Trellis_Tabs.jump(parseInt(tabNumber) - 1);
						event.preventDefault();
						event.stopPropagation();
						return;
					case '9':
						Trellis_Tabs.selectLast();
						event.preventDefault();
						event.stopPropagation();
						return;
				}
			}
		}

	}
	
	/*
	 * Bubbling listener for navigation or shortcuts keydown events that should be
	 * handled only if no lower-level element overrode it by stopping event propagation.
	 * E.g. Escape when reader is opened refocuses the scrollable area of the reader. This should
	 * not happen if Escape was pressed when a menupopup is opened - just let menupopup handle the
	 * Escape and close the popup.
	 */
	function handleKeyDown(event, from) {
		if (Trellis_Tabs.selectedIndex > 0) {
			// Escape from outside of the reader will focus reader's scrollable area
			if (event.key === 'Escape') {
				if (!document.activeElement.classList.contains('reader')) {
					let reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
					if (reader) {
						reader.focus();
					}
				}
			}
			// Tab into the reader from outside of it (e.g. from the contextPane)
			// will focus the scrollable area
			else if (event.key === 'Tab') {
				if (!document.activeElement.classList.contains('reader')) {
					setTimeout(() => {
						if (document.activeElement.classList.contains('reader')) {
							let reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
							if (reader) {
								reader.focus();
							}
						}
					});
				}
			}
		}
		
		let tgt = event.target;
		if ([" ", "Enter"].includes(event.key)
			&& (["button", "toolbarbutton"].includes(tgt.tagName)
				|| tgt.classList.contains("keyboard-clickable"))) {
			event.target.click();
			// Some menus have a history of not opening on programmatic click
			// If event.target.click above worked, this will be a noop.
			if (event.target.menupopup) {
				event.target.open = true;
			}
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		try {
			// Ignore keystrokes outside of Trellis pane
			if (!(event.originalTarget.ownerDocument instanceof HTMLDocument)) {
				return;
			}
		}
		catch (e) {
			Trellis.debug(e);
		}
		
		if (Trellis.locked) {
			event.preventDefault();
			return;
		}

		if (from == 'trellis-pane') {
			// Highlight collections containing selected items
			//
			// We use Control (17) on Windows and Linux because Alt triggers the menubar;
			// On Mac, we use Option (18)
			let enableHighlight = false;
			if (Trellis.isMac) {
				enableHighlight = !event.shiftKey && !event.metaKey && event.key == "Alt" && !event.ctrlKey;
			}
			else {
				enableHighlight = !event.shiftKey && !event.metaKey && event.key == "Control" && !event.altKey;
			}
			// The item tree's DOM id has a view-specific suffix (e.g. "item-tree-main-default",
			// "item-tree-main-recentlyRead"), so match on the prefix to cover all views
			let isItemTreeFocused = document.activeElement.id.startsWith("item-tree-main");
			// Only highlight collections when itemTree is focused to try to avoid
			// conflicts with other shortcuts
			if (enableHighlight && isItemTreeFocused) {
				// On windows, the event is re-triggered multiple times
				// for as long as Control is held.
				// To account for that, stop if a highlight timer already exists.
				if (this.highlightTimer) {
					return;
				}
				this.highlightTimer = Components.classes["@mozilla.org/timer;1"].
					createInstance(Components.interfaces.nsITimer);
				// {} implements nsITimerCallback
				this.highlightTimer.initWithCallback({
					notify: () => this._setHighlightedRowsCallback()
				}, 225, Components.interfaces.nsITimer.TYPE_ONE_SHOT);
			}
			// If anything but Ctlr/Options was pressed, most likely a different shortcut using Ctlr/Options
			// is being used (e.g. Ctrl-Shift-A on windows). In that case, stop highlighting
			else if ((Trellis.isMac && event.altKey) || (!Trellis.isMac && event.ctrlKey)) {
				if (this.highlightTimer) {
					this.highlightTimer.cancel();
					this.highlightTimer = null;
				}
				TrellisPane.collectionsView.setHighlightedRows();
			}
		}
	}
	
	this.handleBlur = (event) => {
		// If one tabs through the item/context pane all the way to the end and
		// the focus leaves the pane, wrap it around to refocus the selected tab
		let itemPane = document.getElementById("trellis-item-pane");
		let contextPane = document.getElementById("trellis-context-pane");
		let loosingFocus = event.target;
		let receivingFocus = event.relatedTarget;
		let itemPaneLostFocus = itemPane.contains(loosingFocus) && !itemPane.contains(receivingFocus);
		let contextPaneLostFocus = contextPane.contains(loosingFocus) && !contextPane.contains(receivingFocus);
		// Do not do anything if the window lost focus or if the last
		// keypress was anything but a Tab. That way, it won't interfere with other navigation such as
		// Shift-tab from the header into the itemsView.
		if (Services.focus.activeWindow === window && this.lastKeyPress === "Tab"
			&& (itemPaneLostFocus || contextPaneLostFocus)) {
			// event.relatedTarget is null when moving focus in or out of <iframe> or <browser>
			// so make sure to not refocus tabs when focusing inside of note-editor or reader
			if (receivingFocus) {
				Trellis_Tabs.moveFocus("current");
			}
			this.lastKeyPress = null;
		}
		// When focus shifts, unless we are inside of a panel, save
		// the last focused element to be able to return focus to it when the panel closes
		if (!event.target.closest("panel")) {
			this.lastFocusedElement = event.target;
			// Special treatment to focus on quick-search dropmarker inside of the shadow DOM
			if (this.lastFocusedElement.id == "trellis-tb-search-dropmarker") {
				this.lastFocusedElement = document.getElementById("trellis-tb-search")._searchModePopup.parentElement;
			}
		}
		if (this.highlightTimer) {
			this.highlightTimer.cancel();
			this.highlightTimer = null;
		}
		TrellisPane_Local.collectionsView.setHighlightedRows();
	}

	this.hideCollectionSearch = function () {
		let collectionSearchField = document.getElementById("trellis-collections-search");
		let collectionSearchButton = document.getElementById("trellis-tb-collections-search");
		if (!collectionSearchField.value.length && collectionSearchField.classList.contains("visible")) {
			collectionSearchField.classList.remove("visible");
			collectionSearchField.setAttribute("disabled", true);
			setTimeout(() => {
				collectionSearchButton.style.display = '';
				collectionSearchField.style.visibility = 'hidden';
				collectionSearchField.style.removeProperty('max-width');
			}, 50);
		}
	}

	this.initCollectionTreeSearch = function () {
		let collectionSearchField = document.getElementById("trellis-collections-search");
		let collectionSearchButton = document.getElementById("trellis-tb-collections-search");
		collectionSearchField.style.visibility = 'hidden';
		collectionSearchField.addEventListener("blur", TrellisPane.hideCollectionSearch);
		collectionSearchButton.addEventListener("click", (_) => {
			if (!collectionSearchField.classList.contains("visible")) {
				collectionSearchButton.style.display = 'none';
				// If the collectionPane is narrow, set smaller max-width
				let maxWidth = collectionSearchField.getAttribute("data-expanded-width");
				if (maxWidth) {
					collectionSearchField.style.maxWidth = `${maxWidth}px`;
				}
				collectionSearchField.style.visibility = 'visible';
				collectionSearchField.classList.add("visible", "expanding");
				// Enable and focus the field only after it was revealed to prevent the cursor
				// from changing between 'text' and 'pointer' back and forth as the input field expands
				setTimeout(() => {
					collectionSearchField.removeAttribute("disabled");
					collectionSearchField.classList.remove("expanding");
					collectionSearchField.focus();
				}, 250);
				return;
			}
			collectionSearchField.focus();
		});
	};

	
	function handleKeyUp(event) {
		// When Option/Control is released, clear collection highlighting
		if ((Trellis.isMac && event.key == "Alt")
				|| (!Trellis.isMac && event.key == "Control")) {
			if (this.highlightTimer) {
				this.highlightTimer.cancel();
				this.highlightTimer = null;
			}
			TrellisPane_Local.collectionsView.setHighlightedRows();
			return;
		}
	}
	
	
	this.handleClose = function (event) {
		// Don't close the window from the first tab if other tabs are open
		if (Trellis_Tabs.numTabs > 1) {
			return;
		}
		window.close();
	};
	
	
	/*
	 * Highlights collections containing selected items on Ctrl (Win) or
	 * Option/Alt (Mac/Linux) press
	 */
	this._setHighlightedRowsCallback = async function () {
		var objects = this.getSelectedObjects();
		
		// If no items or an unreasonable number, don't try
		if (!objects.length || objects.length > 100) return;
		
		var collections = objects.filter(o => o instanceof Trellis.Collection);
		var items = objects.filter(o => o instanceof Trellis.Item);
		
		// Get parent collections of collections
		var toHighlight = [];
		for (let collection of collections) {
			if (collection.parentID) {
				toHighlight.push(collection.parentID);
			}
		}
		// Get collections containing items
		toHighlight.push(...(await Trellis.Collections.getCollectionsContainingItems(
			items.map(x => x.id),
			true
		)));
		var treeViewIDs = toHighlight.map(id => 'C' + id);
		var userLibraryID = Trellis.Libraries.userLibraryID;
		// If no collections selected and every item is in My Publications, highlight that
		var allInPublications = !collections.length && items.every((item) => {
			return item.libraryID == userLibraryID && item.inPublications;
		});
		if (allInPublications) {
			treeViewIDs.push("P" + Trellis.Libraries.userLibraryID);
		}
		if (treeViewIDs.length) {
			await this.collectionsView.setHighlightedRows(treeViewIDs);
		}
	};
	
	
	function handleKeyPress(event) {
		var from = event.originalTarget.id;
		
		if (Trellis.locked) {
			event.preventDefault();
			return;
		}

		if (this.itemsView && from == this.itemsView.id) {
			// Focus TinyMCE explicitly on tab key, since the normal focusing doesn't work right
			if (!event.shiftKey && event.keyCode == event.DOM_VK_TAB) {
				if (TrellisPane.itemPane.mode == "note") {
					document.getElementById('trellis-note-editor').focus();
					event.preventDefault();
					return;
				}
			}
			else if ((event.keyCode == event.DOM_VK_BACK_SPACE && Trellis.isMac) ||
					event.keyCode == event.DOM_VK_DELETE) {
				// If Cmd/Shift delete, use forced mode, which does different
				// things depending on the context
				var force = event.metaKey || (!Trellis.isMac && event.shiftKey);
				TrellisPane_Local.deleteSelectedItems(force);
				event.preventDefault();
				return;
			}
		}
		
		var command = Trellis.Keys.getCommand(event.key);
		if (!command) {
			return;
		}

		// Ignore modifiers other than Ctrl-Shift/Cmd-Shift
		if (!((Trellis.isMac ? event.metaKey : event.ctrlKey) && event.shiftKey)) {
			return;
		}
		
		Trellis.debug('Keyboard shortcut: ' + command);
		
		// Errors don't seem to make it out otherwise
		try {
			switch (command) {
				case 'library':
					document.getElementById(TrellisPane.collectionsView.id).focus();
					break;
				case 'quicksearch':
					document.getElementById('trellis-tb-search-textbox').select();
					break;
				case 'newItem':
					(async function () {
						// Default to most recent item type from here or the New Type menu,
						// or fall back to 'book'
						var mru = Trellis.Prefs.get('newItemTypeMRU');
						var type = mru ? mru.split(',')[0] : 'book';
						await TrellisPane.newItem(Trellis.ItemTypes.getID(type));
						let itemBox = document.getElementById('trellis-editpane-info-box');
						// Ensure itemBox is opened
						itemBox.open = true;
						var menu = itemBox.itemTypeMenu;
						// If the new item's type is changed immediately, update the MRU
						var handleTypeChange = function () {
							this.addItemTypeToNewItemTypeMRU(Trellis.ItemTypes.getName(menu.getAttribute('value')));
							itemBox.removeHandler('itemtypechange', handleTypeChange);
						}.bind(this);
						// Don't update the MRU on subsequent opens of the item type menu
						var removeTypeChangeHandler = function () {
							itemBox.removeHandler('itemtypechange', handleTypeChange);
							itemBox.itemTypeMenu.firstChild.removeEventListener('popuphiding', removeTypeChangeHandler);
						};
						itemBox.addHandler('itemtypechange', handleTypeChange);
						itemBox.itemTypeMenu.firstChild.addEventListener('popuphiding', removeTypeChangeHandler);
						
						Services.focus.setFocus(menu, Services.focus.FLAG_SHOWRING);
						itemBox.itemTypeMenu.menupopup.openPopup(menu, "before_start", 0, 0);
					}.bind(this)());
					break;
				case 'newNote':
					// If a regular item is selected, use that as the parent.
					// If a child item is selected, use its parent as the parent.
					// Otherwise create a standalone note.
					var parentKey = false;
					var items = TrellisPane_Local.getSelectedItems();
					if (items.length == 1) {
						if (items[0].isRegularItem()) {
							parentKey = items[0].key;
						}
						else {
							parentKey = items[0].parentItemKey;
						}
					}
					// Use key that's not the modifier as the popup toggle
					TrellisPane_Local.newNote(event.altKey, parentKey);
					break;
				case 'sync':
					Trellis.Sync.Runner.sync();
					break;
				case 'saveToTrellis':
					var collectionTreeRow = this.getCollectionTreeRow();
					if (collectionTreeRow.isFeedsOrFeed()) {
						this.itemPane.translateSelectedItems();
					} else {
						Trellis.debug(command + ' does not do anything in non-feed views')
					}
					break;
				case 'toggleAllRead':
					var collectionTreeRows = this.getCollectionTreeRows();
					if (collectionTreeRows[0].isFeed()) {
						this.markFeedRead();
					}
					break;
				case 'toggleRead': {
					// Toggle read/unread
					let rows = this.getCollectionTreeRows();
					if (!rows.some(row => row.isFeedsOrFeed())) return;
					this.toggleSelectedItemsRead();
					if (itemReadTimeout) {
						clearTimeout(itemReadTimeout);
						itemReadTimeout = null;
					}
					break;
				}
				
				// Handled by <key>s in standalone.js, pointing to <command>s in trellisPane.xul,
				// which are enabled or disabled by this.updateQuickCopyCommands(), called by
				// this.itemSelected()
				case 'copySelectedItemCitationsToClipboard':
				case 'copySelectedItemsToClipboard':
					return;
				
				default:
					throw new Error('Command "' + command + '" not found in TrellisPane_Local.handleKeyPress()');
			}
		}
		catch (e) {
			Trellis.debug(e, 1);
			Components.utils.reportError(e);
		}
		
		event.preventDefault();
	}
	
	
	/*
	 * Create a new item
	 *
	 * _data_ is an optional object with field:value for itemData
	 */
	this.newItem = async function (typeID, data, row, manual) {
		// Shouldn't be reachable with multiple libraries selected (toolbar is disabled),
		// but just in case
		let rows = this.getCollectionTreeRows();
		if (new Set(rows.map(r => r.ref.libraryID)).size > 1) {
			return;
		}

		if ((row === undefined || row === null) && this.getCollectionTreeRow()) {
			row = this.collectionsView.selection.focused;
			
			// Make sure currently selected view is editable
			if (!this.canEdit(row)) {
				this.displayCannotEditLibraryMessage();
				return;
			}
		}
		
		await this.itemPane.handleBlur();
		
		if (row !== undefined && row !== null) {
			var collectionTreeRow = this.collectionsView.getRow(row);
			var libraryID = collectionTreeRow.ref.libraryID;
		}
		else {
			var libraryID = Trellis.Libraries.userLibraryID;
			var collectionTreeRow = null;
		}
		
		let selectedCollectionTreeRows = rows.filter(r => r.isCollection());

		let itemID;
		await Trellis.DB.executeTransaction(async function () {
			var item = new Trellis.Item(typeID);
			item.libraryID = libraryID;
			for (var i in data) {
				item.setField(i, data[i]);
			}
			itemID = await item.save();
			
			for (let r of selectedCollectionTreeRows) {
				await r.ref.addItem(itemID);
			}
		});
		
		// Expand the item pane if it's closed
		if (this.itemPane.getAttribute("collapsed") == "true") {
			this.itemPane.setAttribute("collapsed", false);
		}
		
		//set to Info tab
		document.getElementById('trellis-view-item').selectedIndex = 0;
		
		// Ensure item is visible
		await this.selectItem(itemID);

		if (manual) {
			// Update most-recently-used list for New Item menu
			this.addItemTypeToNewItemTypeMRU(Trellis.ItemTypes.getName(typeID));
			let itemBox = TrellisPane.itemPane.querySelector("info-box");
			// Make sure the item box is opened
			itemBox.open = true;
			// Focus the title field
			itemBox.getTitleField().focus();
		}
		
		return Trellis.Items.getAsync(itemID);
	};
	
	
	this.addItemTypeToNewItemTypeMRU = function (itemType) {
		if (!itemType) {
			throw new Error(`Item type not provided`);
		}
		var mru = Trellis.Prefs.get('newItemTypeMRU');
		if (mru) {
			var mru = mru.split(',');
			var pos = mru.indexOf(itemType);
			if (pos != -1) {
				mru.splice(pos, 1);
			}
			mru.unshift(itemType);
		}
		else {
			var mru = [itemType];
		}
		Trellis.Prefs.set('newItemTypeMRU', mru.slice(0, 5).join(','));
	}
	
	
	this.newCollection = async function (parentKey = null) {
		if (!this.canEditLibrary()) {
			this.displayCannotEditLibraryMessage();
			return null;
		}
		
		var libraryID = this.getSelectedLibraryID();
		
		// Get a unique "Untitled" name for this level in the collection hierarchy
		var collections;
		var parentCollectionID = null;
		if (parentKey) {
			let parent = Trellis.Collections.getIDFromLibraryAndKey(libraryID, parentKey);
			collections = Trellis.Collections.getByParent(parent);
			parentCollectionID = parent;
		}
		else {
			collections = Trellis.Collections.getByLibrary(libraryID);
		}
		var prefix = Trellis.getString('pane.collections.untitled');
		var name = Trellis.Utilities.Internal.getNextName(
			prefix,
			collections.map(c => c.name).filter(n => n.startsWith(prefix))
		);
		
		var io = { name, libraryID, parentCollectionID };
		window.openDialog("chrome://trellis/content/newCollectionDialog.xhtml",
			"_blank", "chrome,modal,centerscreen,resizable=no", io);
		var dataOut = io.dataOut;
		if (!dataOut) {
			return null;
		}
		
		if (!dataOut.name) {
			dataOut.name = name;
		}
		
		var collection = new Trellis.Collection();
		collection.libraryID = dataOut.libraryID;
		collection.name = dataOut.name;
		collection.parentID = dataOut.parentCollectionID;
		return collection.saveTx();
	};
	
	this.importFeedsFromOPML = async function (event) {
		while (true) {
			let fp = new FilePicker();
			fp.init(window, Trellis.getString('fileInterface.importOPML'), fp.modeOpen);
			fp.appendFilter(Trellis.getString('fileInterface.OPMLFeedFilter'), '*.opml; *.xml');
			fp.appendFilters(fp.filterAll);
			if ((await fp.show()) == fp.returnOK) {
				var contents = await Trellis.File.getContentsAsync(fp.file);
				var success = await Trellis.Feeds.importFromOPML(contents);
				if (success) {
					return true;
				}
				// Try again
				Trellis.alert(window, Trellis.getString('general.error'), Trellis.getString('fileInterface.unsupportedFormat'));
			} else {
				return false;
			}
		}
	};
	
	
	this.newFeedFromURL = async function () {
		let data = {};
		window.openDialog('chrome://trellis/content/feedSettings.xhtml',
			null, 'centerscreen, modal', data);
		if (!data.cancelled) {
			let feed = new Trellis.Feed();
			feed.url = data.url;
			feed.name = data.title;
			feed.refreshInterval = data.ttl;
			feed.cleanupReadAfter = data.cleanupReadAfter;
			feed.cleanupUnreadAfter = data.cleanupUnreadAfter;
			await feed.saveTx();
			await feed.updateFeed();
		}
	};
	
	this.newGroup = function () {
		this.loadURI(Trellis.Groups.addGroupURL);
	}
	
	this.setVirtual = function (libraryID, type, show, select) {
		return this.collectionsView.toggleVirtualCollection(libraryID, type, show, select);
	};

	this.initItemsTree = async function () {
		try {
			const CollectionViewItemTree = require('trellis/collectionViewItemTree');
			var itemsTree = document.getElementById('trellis-items-tree');
			TrellisPane.itemsView = await CollectionViewItemTree.init(itemsTree, {
				id: "main",
				dragAndDrop: true,
				columnPicker: true,
				onSelectionChange: selection => TrellisPane.itemSelected(selection),
				onContextMenu: (...args) => TrellisPane.onItemsContextMenuOpen(...args),
				onActivate: (event, items) => TrellisPane.onItemTreeActivate(event, items),
				emptyMessage: Trellis.getString('pane.items.loading')
			});
			TrellisPane.itemsView.onRefresh.addListener(() => TrellisPane.setTagScope());
			// Update itemPane on initial load
			TrellisPane.itemsView.onRefresh.addListener(async () => {
				await TrellisPane.itemSelected();
			}, true);
			TrellisPane.itemsView.waitForLoad().then(() => Trellis.uiIsReady());

			ItemTreeMenuBar.setItemTreeSortKeys(TrellisPane.itemsView);
		}
		catch (e) {
			Trellis.logError(e);
			Trellis.debug(e, 1);
		}
	}

	this.initCollectionsTree = async function () {
		try {
			const CollectionTree = require('trellis/collectionTree');
			var collectionsTree = document.getElementById('trellis-collections-tree');
			TrellisPane.collectionsView = await CollectionTree.init(collectionsTree, {
				onSelectionChange: prevSelection => TrellisPane.onCollectionSelected(prevSelection),
				onContextMenu: (...args) => TrellisPane.onCollectionsContextMenuOpen(...args),
				dragAndDrop: true,
				multiSelect: true
			});
			collectionsTree.firstChild.addEventListener("focus", TrellisPane.collectionsView.recordCollectionTreeFocus);
		}
		catch (e) {
			Trellis.logError(e);
			Trellis.debug(e, 1);
		}
	};

	this.initTagSelector = async function () {
		try {
			var container = document.getElementById('trellis-tag-selector-container');
			if (!container.hasAttribute('collapsed') || container.getAttribute('collapsed') == 'false') {
				this.tagSelector = await Trellis.TagSelector.init(
					document.getElementById('trellis-tag-selector'),
					{
						container: 'trellis-tag-selector-container',
						onSelection: this.updateTagFilter.bind(this),
					}
				);
				// Occasionally, when the app is first opened, the scrollable tag list doesn't
				// occupy the full height of the tag selector. This ensures that it occupies all
				// available space.
				setTimeout(() => {
					this.tagSelector.handleResize();
				}, 100);
			}
		}
		catch (e) {
			Trellis.logError(e);
			Trellis.debug(e, 1);
		}
	};
	
	
	this.handleTagSelectorResize = Trellis.Utilities.debounce(async function () {
		if (this.tagSelectorShown()) {
			// Initialize if dragging open after startup
			if (!this.tagSelector) {
				await this.setTagScope();
			}
			this.tagSelector.handleResize();
		}
		if (this.collectionsView) {
			this.collectionsView.updateHeightDebounced();
		}
	}, 100);
	
	
	/*
	 * Sets the tag filter on the items view
	 */
	this.updateTagFilter = async function () {
		if (this.itemsView) {
			await this.itemsView.setFilter('tags', TrellisPane_Local.tagSelector.getTagSelection());
		}
	};
	
	
	// Keep in sync with TrellisStandalone.updateViewOption()
	this.toggleTagSelector = async function () {
		var container = document.getElementById('trellis-tag-selector-container');
		var showing = container.getAttribute('collapsed') == 'true';
		container.setAttribute('collapsed', !showing);
		
		// If showing, set scope to items in current view
		// and focus filter textbox
		if (showing) {
			await this.setTagScope();
			TrellisPane.tagSelector.focusTextbox();
		}
		// If hiding, clear selection
		else {
			TrellisPane.tagSelector.uninit();
			TrellisPane.tagSelector = null;
		}
	};
	
	
	this.tagSelectorShown = function () {
		var collectionTreeRows = this.getCollectionTreeRows();
		if (!collectionTreeRows.length) return;
		var tagSelector = document.getElementById('trellis-tag-selector-container');
		return !tagSelector.hasAttribute('collapsed')
			|| tagSelector.getAttribute('collapsed') == 'false';
	};


	this.updateTagSelectorViewSettingsMenu = async function () {
		document.getElementById('show-automatic').setAttribute('checked', TrellisPane.tagSelector.showAutomatic);
		document.getElementById('display-all-tags').setAttribute('checked', TrellisPane.tagSelector.displayAllTags);
		document.getElementById('num-selected').label = TrellisPane.tagSelector.label;
		var libraryID = TrellisPane.tagSelector.libraryID;
		var library = Trellis.Libraries.get(libraryID);
		// 'Delete Automatic Tags in This Library' is per-library, so disable it when the
		// selection spans multiple libraries
		var enabled = !TrellisPane.tagSelector.multiLibrary
			&& library.editable
			&& (await Trellis.Tags.getAutomaticInLibrary(libraryID)).length > 0;
		document.getElementById('delete-automatic-tags').disabled = !enabled;
	};
	
	
	/*
	 * Set the tags scope to the items in the current view
	 *
	 * Passed to the items tree to trigger on changes
	 */
	this.setTagScope = async function () {
		var collectionTreeRows = this.getCollectionTreeRows();
		if (self.tagSelectorShown()) {
			if (!TrellisPane.tagSelector) {
				await this.initTagSelector();
			}
			if (collectionTreeRows.every(o => o.editable)) {
				TrellisPane_Local.tagSelector.setMode('edit');
			}
			else {
				TrellisPane_Local.tagSelector.setMode('view');
			}
			TrellisPane_Local.tagSelector.onItemViewChanged({
				libraryID: collectionTreeRows[0].ref && collectionTreeRows[0].ref.libraryID,
				collectionTreeRows
			});
		}
	};
	
	this.onCollectionSelected = Trellis.serial(async function () {
		var collectionTreeRows = this.getCollectionTreeRows();
		if (!collectionTreeRows.length) {
			Trellis.debug('TrellisPane.onCollectionSelected: No selected collection found');
			return;
		}

		// Only certain combinations of rows can be shown together in one items view.
		// Collections, saved searches, and library roots can be mixed freely, within or
		// across libraries, except that a library root can't be combined with a collection
		// or saved search -- a library already shows all of its items, so pairing it with
		// one of its own child collections/searches has no use case. Recently Read can be
		// combined only with other Recently Read rows (across libraries). All other special
		// views (Trash, Duplicates, etc.) can't be shown alongside anything else. The
		// visibility-group check enforces both the Recently Read restriction and the
		// feed/non-feed split: Recently Read and feeds are each their own group, so pairing
		// one with a collection (or with each other) spans two groups, which can't share an
		// items view. When the selected rows can't be shown together, drop everything except
		// the focused row and show just that. Selections spanning multiple libraries are
		// shown grouped by library in the items list.
		if (collectionTreeRows.length > 1) {
			let combinable = collectionTreeRows.every(
				row => row.isCollection() || row.isSearch() || row.isLibrary(true)
					|| row.isFeeds() || row.isRecentlyRead()
			);
			let mixesVisibilityGroups = new Set(
				collectionTreeRows.map(row => row.visibilityGroup)
			).size > 1;
			// A library root already shows all of its items, so don't combine it with a
			// collection or saved search (which share its visibility group)
			let mixesLibraryAndCollection = collectionTreeRows.some(row => row.isLibrary(true))
				&& collectionTreeRows.some(row => row.isCollection() || row.isSearch());
			if (!combinable || mixesVisibilityGroups || mixesLibraryAndCollection) {
				Trellis.debug("TrellisPane.onCollectionSelected: Selected rows can't be shown "
					+ "together -- keeping only the focused row");
				// Drop all but the focused row. Don't await selectByID() here: it awaits
				// waitForSelect(), whose 'select' event can't fire until this handler
				// returns, so it would deadlock. Reducing the selection directly
				// re-triggers onCollectionSelected() with the single row.
				this.collectionsView.selection.select(this.collectionsView.selection.focused);
				return;
			}
		}

		if (this.itemsView?.collectionTreeRows
				&& Trellis.Utilities.arrayEquals(
					collectionTreeRows.map(r => r.id).sort(),
					this.itemsView.collectionTreeRows.map(r => r.id).sort()
				)) {
			Trellis.debug("TrellisPane.onCollectionSelected: Collection selection hasn't changed");

			// Update enabled actions, in case editability has changed
			this._updateEnabledActionsForCollectionTreeRows(collectionTreeRows);
			return;
		}
		
		let advancedSearchDeck = document.getElementById('trellis-advanced-search-pane-deck');
		if (this.itemsView.collectionTreeRow?.isSearch()
				&& advancedSearchDeck.state === 'open'
				&& advancedSearchDeck.selectedSearchType === 'saved') {
			// If the saved search being edited was deleted, close the editor without
			// prompting to save changes -- there's nothing left to save them to
			if (!Trellis.Searches.get(advancedSearchDeck.pane.editedSearchID)) {
				await advancedSearchDeck.pane.cancel();
			}
			else {
				let result = Services.prompt.confirmEx(window,
					Trellis.getString('saved-search-close-confirmation-title'),
					Trellis.getString('saved-search-close-confirmation-body'),
					Ci.nsIPromptService.BUTTON_POS_0_DEFAULT
						| Ci.nsIPrompt.BUTTON_TITLE_SAVE * Ci.nsIPrompt.BUTTON_POS_0
						| Ci.nsIPrompt.BUTTON_TITLE_CANCEL * Ci.nsIPrompt.BUTTON_POS_1
						| Ci.nsIPrompt.BUTTON_TITLE_DONT_SAVE * Ci.nsIPrompt.BUTTON_POS_2,
					null, null, null,
					null, {});
				switch (result) {
					case 0:
						await advancedSearchDeck.pane.save();
						return;
					case 1: {
						// Revert to just the search being edited. Use selection.select()
						// directly rather than selectByID(): the latter awaits
						// waitForSelect() (which would deadlock here) and no-ops when the
						// row is already selected -- which it is, as part of the new
						// multi-selection -- leaving the change in place and re-prompting.
						this.collectionsView.selection.selectEventsSuppressed = true;
						try {
							let index = this.collectionsView.getRowIndexByID(this.itemsView.collectionTreeRow.id);
							if (index !== false) {
								this.collectionsView.selection.select(index);
							}
						}
						finally {
							this.collectionsView.selection.selectEventsSuppressed = false;
						}
						return;
					}
					case 2:
						await advancedSearchDeck.pane.cancel();
						break;
				}
			}
		}
		
		// Rename tab
		let tabName = collectionTreeRows.length == 1
			? collectionTreeRows[0].getName()
			: Trellis.getString('tab-title-multiple-collections');
		Trellis_Tabs.rename('trellis-pane', tabName);
		
		// Clear quick search and tag selector when switching views
		document.getElementById('trellis-tb-search').onCollectionSelected();
		if (TrellisPane.tagSelector) {
			TrellisPane.tagSelector.clearTagSelection();
		}
		
		this._refreshAdvancedSearchPane(collectionTreeRows);
		this._updateEnabledActionsForCollectionTreeRows(collectionTreeRows);
		
		for (let collectionTreeRow of collectionTreeRows) {
			collectionTreeRow.setSearch('');
			if (TrellisPane.tagSelector) {
				collectionTreeRow.setTags(TrellisPane.tagSelector.getTagSelection());
			}

			// If item data not yet loaded for library, load it now.
			// Other data types are loaded at startup
			if (collectionTreeRow.isFeeds()) {
				var feedsToLoad = Trellis.Feeds.getAll().filter(feed => !feed.getDataLoaded('item'));
				if (feedsToLoad.length) {
					Trellis.debug("Waiting for items to load for feeds " + feedsToLoad.map(feed => feed.libraryID));
					TrellisPane_Local.setItemsPaneMessage(Trellis.getString('pane.items.loading'));
					for (let feed of feedsToLoad) {
						await feed.waitForDataLoad('item');
					}
				}
			}
			else {
				var library = Trellis.Libraries.get(collectionTreeRow.ref.libraryID);
				if (!library.getDataLoaded('item')) {
					Trellis.debug("Waiting for items to load for library " + library.libraryID);
					TrellisPane_Local.setItemsPaneMessage(Trellis.getString('pane.items.loading'));
					await library.waitForDataLoad('item');
				}
			}
		}
		
		await this.itemsView.changeCollectionTreeRows(collectionTreeRows);
		
		Trellis.Prefs.set('lastViewedFolder', collectionTreeRows[0].id);
	});


	/**
	 * @param {Trellis.CollectionTreeRow[]} [collectionTreeRows] - During collection selection,
	 *     the newly selected rows, which aren't in the items view yet
	 */
	this._refreshAdvancedSearchPane = function (collectionTreeRows) {
		let deck = document.getElementById('trellis-advanced-search-pane-deck');

		deck.pane.refresh();

		let search = deck.state === 'closed' || deck.selectedSearchType !== 'temporary' || !deck.pane.active
			? null
			: deck.pane.search;
		if (collectionTreeRows) {
			for (let collectionTreeRow of collectionTreeRows) {
				collectionTreeRow.setAdvancedSearch(search);
			}
			return undefined;
		}
		// Apply via the items view, whose rows can be different objects from the
		// collection tree's current rows
		return this.itemsView.setFilter('advanced-search', search);
	};


	/**
	 * @param {'open' | 'collapsed' | 'closed'} state
	 */
	this.setAdvancedSearchState = async function (state) {
		let deck = document.getElementById('trellis-advanced-search-pane-deck');
		let oldState = deck.state;
		deck.selectedSearchType = 'temporary';
		deck.state = state;
		
		let advancedSearchPane = deck.pane;

		document.getElementById('trellis-tb-search').updateMode();
		let refreshPromise;
		if (state === 'open' && oldState === 'collapsed'
				|| state === 'collapsed' && oldState === 'open') {
			// State change only causes visual refresh - update the tree height
			this.itemsView.updateHeight();
		}
		else {
			// State change changes displayed items - refresh the tree
			refreshPromise = this._refreshAdvancedSearchPane();
		}
		
		// Update the pane state synchronously, so that a state change initiated
		// while the refresh below is pending doesn't see a stale search
		if (state === 'closed') {
			advancedSearchPane.search = null;
		}
		else if (state === 'open') {
			Trellis_Tabs.select('trellis-pane');
			advancedSearchPane.focus();
		}
		
		await refreshPromise;
	};
	
	
	/**
	 * @param {'open' | 'collapsed' | 'closed'} state
	 */
	this.toggleAdvancedSearchState = async function (state) {
		let deck = document.getElementById('trellis-advanced-search-pane-deck');
		if (state === deck.state && deck.selectedSearchType !== 'saved') {
			// If we're trying to open the pane, and it's already open but not focused,
			// focus it
			if (state === 'open' && !deck.pane.matches(':focus-within')) {
				deck.pane.focus();
				return;
			}
			
			// Flip the state
			switch (state) {
				case 'open':
					state = 'closed';
					break;
				case 'collapsed':
				case 'closed':
					state = 'open';
					break;
			}
		}
		await this.setAdvancedSearchState(state);
	};


	/**
	 * Open the Advanced Search pane seeded from the quick search text, reproducing
	 * the current quick search mode as editable conditions.
	 *
	 * The quick search field is cleared, since its text now lives in the Advanced
	 * Search. Closing the Advanced Search resets to an unfiltered view rather than
	 * restoring the quick search.
	 *
	 * @param {String} searchText
	 * @param {String} [mode='fields'] - The quick search mode to reproduce
	 */
	this.openAdvancedSearchFromQuickSearch = async function (searchText, mode = 'fields') {
		// Split into words (keeping quoted phrases intact), as the quick search does
		let parts = Trellis.SearchConditions.parseSearchString(searchText);
		if (!parts.length) {
			await this.toggleAdvancedSearchState('open');
			return;
		}

		let deck = document.getElementById('trellis-advanced-search-pane-deck');
		let search = new Trellis.Search();
		let libraryID = this.getSelectedLibraryID();
		if (libraryID) {
			search.libraryID = libraryID;
		}

		// Reproduce the quick search mode as editable conditions, one per word joined
		// with "all": Title/Creator/Year and All Fields & Tags each map to a single
		// condition, Everything to an "any" group of Any Field plus full-text.
		// Title/Creator/Year matches only top-level items, so set the result level to item.
		if (mode === 'titleCreatorYear') {
			search.addCondition('resultLevel', 'item');
		}
		for (let part of parts) {
			if (mode === 'everything') {
				search.addCondition('groupStart', 'true', '');
				search.addCondition('joinMode', 'any');
				search.addCondition('anyField', 'contains', part.text);
				search.addCondition('fulltextContent', 'contains', part.text);
				search.addCondition('groupEnd', 'true', '');
			}
			else if (mode === 'titleCreatorYear') {
				search.addCondition('titleCreatorYear', 'contains', part.text);
			}
			else {
				search.addCondition('anyField', 'contains', part.text);
			}
		}

		// Show the Advanced Search and seed it, without yet touching the items list,
		// so that the quick search results stay visible until they're replaced below
		deck.selectedSearchType = 'temporary';
		deck.state = 'open';
		deck.pane.search = search;
		deck.pane.refresh();

		// Clear the quick search text and the row's filter (without its own refresh),
		// so the field doesn't flash empty and closing Advanced Search returns to an
		// unfiltered view. The submit() below replaces the results in place.
		let searchBox = document.getElementById('trellis-tb-search');
		searchBox.updateMode();
		searchBox.value = '';
		this.itemsView.collectionTreeRow.setSearch('');

		Trellis_Tabs.select('trellis-pane');
		// Keep focus in the builder (on the first condition) rather than the results,
		// so the user can refine the seeded search
		await deck.pane.submit({ focusResults: false });
		deck.pane.focus();
	};


	/**
	 * @param {'open' | 'closed'} state
	 */
	this.setSavedSearchEditorState = async function (state) {
		let collectionTreeRow = this.getCollectionTreeRow();
		if (state === 'open' && !collectionTreeRow.isSearch()) {
			throw new Error('Cannot show saved search editor outside search row');
		}
		
		let deck = document.getElementById('trellis-advanced-search-pane-deck');
		deck.selectedSearchType = 'saved';
		deck.state = state;
		
		if (state === 'open') {
			deck.pane.search = collectionTreeRow.ref;
		}

		document.getElementById('trellis-tb-search').updateMode();
		let refreshPromise = this._refreshAdvancedSearchPane();
		if (state === 'open') {
			deck.pane.focus();
		}
		await refreshPromise;
	};


	this.openAdvancedSearchWindow = function () {
		Trellis.debug(`TrellisPane.openAdvancedSearchWindow() is deprecated -- use TrellisPane.toggleAdvancedSearchState() instead`);
		this.toggleAdvancedSearchState('open');
	};
	
	
	/**
	 * Enable or disable toolbar icons, menu options, and commands as necessary
	 */
	this._updateEnabledActionsForCollectionTreeRows = function (collectionTreeRows) {
		const disableIfNoEdit = [
			"menu_newItem",
			"cmd_trellis_addByIdentifier",
			"menu_attachmentAdd",
			"menu_noteAdd",
			
			"cmd_trellis_newCollection",
			"cmd_trellis_import",
			"cmd_trellis_importFromClipboard",
			
			"cmd_trellis_newStandaloneFileAttachment",
			"cmd_trellis_newStandaloneLinkedFileAttachment",
			"cmd_trellis_newChildFileAttachment",
			"cmd_trellis_newChildLinkedFileAttachment",
			"cmd_trellis_newChildURLAttachment",
			"cmd_trellis_newStandaloneNote",
			"cmd_trellis_newChildNote",
			
			"trellis-tb-add",
			"trellis-tb-lookup",
			"trellis-tb-attachment-add",
			"trellis-tb-note-add",
		];
		// Disable item/collection creation when selected rows span multiple libraries
		let multipleLibraries = new Set(
			collectionTreeRows.map(o => (o.isFeeds() ? -1 : o.ref.libraryID))
		).size > 1;

		for (let i = 0; i < disableIfNoEdit.length; i++) {
			let command = disableIfNoEdit[i];
			let el = document.getElementById(command);
			if (!el) continue;
			
			// If a trash is selected, new collection depends on the
			// editability of the library
			if (collectionTreeRows[0].isTrash() && command == 'cmd_trellis_newCollection') {
				var overrideEditable = Trellis.Libraries.get(collectionTreeRows[0].ref.libraryID).editable;
			}
			else {
				var overrideEditable = false;
			}
			
			// Don't allow normal buttons in My Publications, because things need to
			// be dragged and go through the wizard
			let forceDisable = collectionTreeRows[0].isPublications()
				&& command != 'cmd_trellis_newCollection'
				&& command != 'trellis-tb-note-add';
			
			if ((collectionTreeRows.every(o => o.editable) || overrideEditable)
					&& !forceDisable && !multipleLibraries) {
				if(el.hasAttribute("disabled")) el.removeAttribute("disabled");
			} else {
				el.setAttribute("disabled", "true");
			}
		}
	};
	
	
	this.getCollectionTreeRow = function () {
		Trellis.debug("TrellisPane.getCollectionTreeRow() is deprecated -- use TrellisPane.getCollectionTreeRows()");
		return this.collectionsView && this.collectionsView.selection.count
			&& this.collectionsView.getRow(this.collectionsView.selection.focused);
	}
	
	
	/**
	 * return {CollectionTreeRow[]}
	 */
	this.getCollectionTreeRows = function () {
		if (!this.collectionsView) {
			return [];
		}
		// selection.selected is in click order -- return rows in collections-list order
		return [...this.collectionsView.selection.selected]
			.sort((a, b) => a - b)
			.map(index => this.collectionsView.getRow(index));
	}
	
	
	/**
	 * @return {Promise<Boolean>} - Promise that resolves to true if an item was selected,
	 *                              or false if not (used for tests, though there could possibly
	 *                              be a better test for whether the item pane changed)
	 */
	this.itemSelected = function () {
		return async function () {
			if (!this.itemsView || !this.itemsView.selection) {
				Trellis.debug("Items view not available in itemSelected", 2);
				return false;
			}
			let collectionTreeRows = this.getCollectionTreeRows();
			// I don't think this happens in normal usage, but it can happen during tests
			if (!collectionTreeRows.length) {
				return false;
			}
			
			var selectedItems = this.itemsView.getSelectedObjects();
			
			// Display buttons at top of item pane depending on context. This needs to run even if the
			// selection hasn't changed, because the selected items might have been modified.
			this.itemPane.data = selectedItems;
			this.itemPane.collectionTreeRows = collectionTreeRows;
			this.itemPane.itemsView = this.itemsView;
			this.itemPane.editable = this.collectionsView.editable;
			this.itemPane.updateItemPaneButtons(selectedItems);
			
			// Tab selection observer in standalone.js makes sure that
			// updateQuickCopyCommands is called
			if (Trellis_Tabs.selectedType == 'library') {
				this.updateQuickCopyCommands(selectedItems);
			}
			
			// Check if selection has actually changed. The onselect event that calls this
			// can be called in various situations where the selection didn't actually change,
			// such as whenever selectEventsSuppressed is set to false.
			var ids = selectedItems.map(item => item.treeViewID);
			ids.sort();
			if (ids.length && Trellis.Utilities.arrayEquals(_lastSelectedItems, ids)) {
				return false;
			}
			_lastSelectedItems = ids;
			
			return this.itemPane.render();
		}.bind(this)()
		.catch((e) => {
			Trellis.logError(e);
			Trellis.crash();
			throw e;
		});
	}
	
	this.updateAddAttachmentMenu = function (event, popup) {
		if (event.target !== popup) {
			return;
		}
		if (!this.canEdit()) {
			for (let node of popup.childNodes) {
				if (node.tagName == 'menuitem') {
					node.disabled = true;
				}
			}
			return;
		}
		
		var items = TrellisPane.getSelectedItems();
		var oneItemSelected = items.length == 1 && items[0].isRegularItem();
		var canEditFiles = this.canEditFiles();
		var commandsEnabled = [
			['cmd_trellis_newStandaloneFileAttachment', canEditFiles],
			['cmd_trellis_newStandaloneLinkedFileAttachment', canEditFiles],
			['cmd_trellis_newChildFileAttachment', oneItemSelected && canEditFiles],
			['cmd_trellis_newChildLinkedFileAttachment', oneItemSelected && canEditFiles],
			['cmd_trellis_newChildURLAttachment', oneItemSelected],
		];
		for (let command of commandsEnabled) {
			document.getElementById(command[0]).setAttribute('disabled', !command[1]);
		}

		Trellis.MenuManager.updateMenuPopup(
			popup,
			"main/library/addAttachment",
			{
				event,
				getContext: () => ({
					items,
					tabType: "library",
					tabSubType: undefined,
					tabID: "trellis-pane",
				})
			}
		);
	};
	
	/**
	 * @return {Promise}
	 */
	this.updateNewNoteMenu = function (event, popup) {
		if (event.target !== popup) {
			return;
		}
		var items = TrellisPane_Local.getSelectedItems();
		var cmd = document.getElementById('cmd_trellis_newChildNote');
		cmd.setAttribute("disabled", !this.canEdit() ||
			!(items.length == 1 && (items[0].isRegularItem() || !items[0].isTopLevelItem())));
		
		Trellis.MenuManager.updateMenuPopup(
			popup,
			"main/library/addNote",
			{
				event,
				getContext: () => ({
					items,
					tabType: "library",
					tabSubType: undefined,
					tabID: "trellis-pane",
				})
			}
		);
	};
	
	/**
	 * Update the <command> elements that control the shortcut keys and the enabled state of the
	 * "Copy Citation"/"Copy Bibliography"/"Copy as"/"Copy Note" menu options. When disabled, the shortcuts are
	 * still caught in handleKeyPress so that we can show an alert about not having references selected.
	 */
	this.updateQuickCopyCommands = function (selectedItems) {
		let canCopy = false;
		// If all items are notes/attachments and at least one note is not empty
		if (selectedItems.every(item => item.isNote() || item.isAttachment())) {
			if (selectedItems.some(item => item.note)) {
				canCopy = true;
			}
		}
		else {
			let format = Trellis.QuickCopy.getFormatFromURL(Trellis.QuickCopy.lastActiveURL);
			format = Trellis.QuickCopy.unserializeSetting(format);
			if (format.mode == 'bibliography') {
				canCopy = selectedItems.some(item => item.isRegularItem() || item.isAnnotation());
			}
			else {
				canCopy = true;
			}
		}
		
		document.getElementById('cmd_trellis_copyCitation').setAttribute('disabled', !canCopy);
		document.getElementById('cmd_trellis_copyBibliography').setAttribute('disabled', !canCopy);
		document.getElementById('cmd_trellis_copyAnnotation').setAttribute('disabled', !canCopy);
	};
	
	
	/**
	 * @return {Promise}
	 */
	this.reindexItem = async function () {
		var items = this.getSelectedItems();
		if (!items) {
			return;
		}
		
		var itemIDs = [];

		for (var i=0; i<items.length; i++) {
			itemIDs.push(items[i].id);
		}
		
		await Trellis.FullText.indexItems(itemIDs, { complete: true });
		await document.getElementById('trellis-attachment-box').updateItemIndexedState();
	};
	
	
	/**
	 * @return {Promise<Trellis.Item>} - The new Trellis.Item
	 */
	this.duplicateSelectedItem = async function () {
		var self = this;
		if (!self.canEdit()) {
			self.displayCannotEditLibraryMessage();
			return;
		}
		
		var item = self.getSelectedItems()[0];
		if (item.isNote()
			&& !((await Trellis.Notes.ensureEmbeddedImagesAreAvailable(item)))
			&& !Trellis.Notes.promptToIgnoreMissingImage()) {
			return;
		}
		
		var newItem;
		
		await Trellis.DB.executeTransaction(async function () {
			newItem = item.clone();
			// If in collections, add new item to all selected collections
			// that the original item belongs to
			if (newItem.isTopLevelItem()) {
				let collectionIDs = self.getCollectionTreeRows()
					.filter(r => r.isCollection() && item.inCollection(r.ref.id))
					.map(r => r.ref.id);
				if (collectionIDs.length) {
					newItem.setCollections(collectionIDs);
				}
			}
			await newItem.save();
			if (item.isNote() && Trellis.Libraries.get(newItem.libraryID).filesEditable) {
				await Trellis.Notes.copyEmbeddedImages(item, newItem);
			}
			for (let relItemKey of item.relatedItems) {
				try {
					let relItem = await Trellis.Items.getByLibraryAndKeyAsync(item.libraryID, relItemKey);
					if (relItem.addRelatedItem(newItem)) {
						await relItem.save({
							skipDateModifiedUpdate: true
						});
					}
				}
				catch (e) {
					Trellis.logError(e);
				}
			}
		});
		
		await self.selectItem(newItem.id);
		
		return newItem;
	};
	

	this.duplicateAndConvertSelectedItem = async function () {
		if (this.getSelectedItems().length != 1
				|| !['book', 'bookSection'].includes(this.getSelectedItems()[0].itemType)) {
			throw new Error('duplicateAndConvertSelectedItem requires a single book or bookSection to be selected');
		}

		let authorCreatorType = Trellis.CreatorTypes.getID('author');
		let bookAuthorCreatorType = Trellis.CreatorTypes.getID('bookAuthor');
		
		let original = this.getSelectedItems()[0];
		let duplicate = await this.duplicateSelectedItem();
		if (!duplicate) return null;
		
		// TODO: Move this logic to duplicateSelectedItem() with a `targetItemType` flag to avoid
		// extra saves?
		if (duplicate.itemType == 'book') {
			duplicate.setType(Trellis.ItemTypes.getID('bookSection'));
			for (let i = 0; i < duplicate.numCreators(); i++) {
				let creator = duplicate.getCreator(i);
				if (creator.creatorTypeID == authorCreatorType) {
					creator.creatorTypeID = bookAuthorCreatorType;
				}
				duplicate.setCreator(i, creator);
			}
			// Remove related-item relations to other book sections of this book
			for (let relItemKey of [...duplicate.relatedItems]) {
				let relItem = await Trellis.Items.getByLibraryAndKeyAsync(
					duplicate.libraryID, relItemKey
				);
				if (relItem.itemType == 'bookSection'
						&& relItem.getField('bookTitle') == original.getField('title')) {
					duplicate.removeRelatedItem(relItem);
					relItem.removeRelatedItem(duplicate);
					await relItem.saveTx();
				}
			}
		}
		else {
			duplicate.setField('title', false); // So bookTitle becomes title
			duplicate.setType(Trellis.ItemTypes.getID('book'));
			// Get creators from the original item because setType() will have changed the types
			let creators = original.getCreators()
				// Remove authors of the individual book section
				.filter(creator => creator.creatorTypeID !== authorCreatorType);
			for (let creator of creators) {
				if (creator.creatorTypeID == bookAuthorCreatorType) {
					creator.creatorTypeID = authorCreatorType;
				}
			}
			duplicate.setCreators(creators);
		}
		
		duplicate.setField('abstractNote', '');
		duplicate.setField('DOI', '');

		duplicate.addRelatedItem(original);
		original.addRelatedItem(duplicate);
		
		await original.saveTx({ skipDateModifiedUpdate: true });
		await duplicate.saveTx();
		
		TrellisPane.itemPane.querySelector("info-box").getTitleField().focus();
		return duplicate;
	};
	

	/**
	 * Return whether every selected item can be deleted from the current
	 * collection context (library, trash, collection, etc.).
	 *
	 * @return {Boolean}
	 */
	this.canDeleteSelectedItems = function () {
		let collectionTreeRows = this.getCollectionTreeRows();
		if (collectionTreeRows[0].isTrash()) {
			for (let index of this.itemsView.selection.selected) {
				while (index != -1 && !this.itemsView.getRow(index).ref.deleted) {
					index = this.itemsView.getParentIndex(index);
				}
				if (index == -1) {
					return false;
				}
			}
		}
		else if (collectionTreeRows[0].isShare()) {
			return false;
		}
		// If multiple items are selected and only some are annotations, disallow delete unless we
		// are in the trash, in which case any selected item can be erased
		let selected = this.itemsView.getSelectedItems();
		if (!selected.every(item => item.isAnnotation())
			&& selected.some(item => item.isAnnotation())) {
			return collectionTreeRows[0].isTrash();
		}
		return true;
	};

	
	this.deleteSelectedItem = function () {
		Trellis.debug("TrellisPane_Local.deleteSelectedItem() is deprecated -- use TrellisPane_Local.deleteSelectedItems()");
		this.deleteSelectedItems();
	}
	
	/*
	 * Remove, trash, or delete item(s), depending on context
	 *
	 * @param  {Boolean}  [force=false]     Trash or delete even if in a collection or search,
	 *                                      or trash without prompt in library
	 * @param  {Boolean}  [fromMenu=false]  If triggered from context menu, which always prompts for deletes
	 */
	this.deleteSelectedItems = async function (force, fromMenu) {
		if (!this.itemsView || !this.itemsView.selection.count) {
			return;
		}
		var collectionTreeRows = this.getCollectionTreeRows();
		
		if (!collectionTreeRows[0].isTrash() && !collectionTreeRows[0].isBucket() && !this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		
		var toTrash = {
			title: Trellis.getString('pane.items.trash.title'),
			text: Trellis.getString(
				'pane.items.trash' + (this.itemsView.selection.count > 1 ? '.multiple' : '')
			)
		};
		var toDelete = {
			title: Trellis.getString('pane.items.delete.title'),
			text: Trellis.getString(
				'pane.items.delete' + (this.itemsView.selection.count > 1 ? '.multiple' : '')
			)
		};
		var toRemove = {
			title: Trellis.getString('pane.items.remove.title'),
			text: Trellis.getString(
				'pane.items.remove' + (this.itemsView.selection.count > 1 ? '.multiple' : '')
			)
		};

		if (!this.canDeleteSelectedItems()) {
			return;
		}
		var prompt;
		// Backspace on annotation items = prompt to erase
		if (this.itemsView.getSelectedItems().every(item => item.isAnnotation())) {
			prompt = toDelete;
		}
		else if (collectionTreeRows[0].isPublications()) {
			let toRemoveFromPublications = {
				title: Trellis.getString('pane.items.removeFromPublications.title'),
				text: Trellis.getString(
					'pane.items.removeFromPublications' + (this.itemsView.selection.count > 1 ? '.multiple' : '')
				)
			};
			prompt = force ? toTrash : toRemoveFromPublications;
		}
		else if (collectionTreeRows[0].isRecentlyRead()) {
			prompt = force ? toTrash : toRemove;
		}
		else if (collectionTreeRows[0].isLibrary(true)
				|| collectionTreeRows[0].isSearch()
				|| collectionTreeRows[0].isUnfiled()
				|| collectionTreeRows[0].isRetracted()
				|| collectionTreeRows[0].isDuplicates()) {
			// In library, don't prompt if meta key was pressed
			prompt = (force && !fromMenu) ? false : toTrash;
		}
		else if (collectionTreeRows[0].isCollection()) {
			if (force) {
				prompt = toTrash;
			}
			else {
				// Ignore unmodified action if only child items are selected
				if (this.itemsView.getSelectedItems().every(item => !item.isTopLevelItem())) {
					return;
				}

				// If unmodified, recursiveCollections is true, and items are in
				// descendant collections (even if also in the selected collection),
				// prompt to remove from all
				if (Trellis.Prefs.get('recursiveCollections')) {
					// Removal recurses into the descendants of every selected collection
					// (see CollectionViewItemTree), so check all of them when deciding
					// whether to show the recursive-removal prompt
					let descendantIDs = collectionTreeRows
						.filter(row => row.isCollection())
						.flatMap(row => row.ref.getDescendents(false, 'collection').map(({ id }) => id));
					let inSubcollection = descendantIDs
						.some(id => this.itemsView.getSelectedItems()
							.some(item => item.inCollection(id)));
					if (inSubcollection) {
						var prompt = {
							title: Trellis.getString('pane.items.removeRecursive.title'),
							text: Trellis.getString(
								'pane.items.removeRecursive' + (this.itemsView.selection.count > 1 ? '.multiple' : '')
							)
						};
					}
					else {
						var prompt = toRemove;
					}
				}
				else {
					prompt = toRemove;
				}
			}
		}
		else if (collectionTreeRows[0].isTrash() || collectionTreeRows[0].isBucket()) {
			prompt = toDelete;
		}
		
		if (!prompt || Services.prompt.confirm(window, prompt.title, prompt.text)) {
			await this.itemsView.deleteSelection(force);
		}
	}
	
	
	this.mergeSelectedItems = function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		
		this.itemPane.mode = "duplicates";
		
		// Initialize the merge pane with the selected items
		this.itemPane._duplicatesPane.setItems(this.getSelectedItems());
	};
	
	
	this.relateSelectedItems = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		
		let selectedItems = this.getSelectedItems();
		let saveOptions = {
			skipDateModifiedUpdate: true
		};
		await Trellis.DB.executeTransaction(async () => {
			Trellis.UndoHistory.stageAction('undo-action-add-related');
			for (let index1 = 0; index1 < selectedItems.length; index1++) {
				for (let index2 = index1 + 1; index2 < selectedItems.length; index2++) {
					let item1 = selectedItems[index1];
					let item2 = selectedItems[index2];
					item1.addRelatedItem(item2);
					item2.addRelatedItem(item1);
					await item1.save(saveOptions);
					await item2.save(saveOptions);
				}
			}
		});
	};
	
	
	this.deleteSelectedCollection = async function (deleteItems) {
		var collectionTreeRows = this.getCollectionTreeRows();
		if (!collectionTreeRows.length) {
			return;
		}
		
		// Don't allow deleting libraries
		if (collectionTreeRows.some(o => o.isLibrary(true)) && !collectionTreeRows.every(o => o.isFeed())) {
			return;
		}
		
		// Remove virtual duplicates collection
		if (collectionTreeRows[0].isDuplicates()) {
			this.setVirtual(collectionTreeRows[0].ref.libraryID, 'duplicates', false);
			return;
		}
		// Remove virtual unfiled collection
		else if (collectionTreeRows[0].isUnfiled()) {
			this.setVirtual(collectionTreeRows[0].ref.libraryID, 'unfiled', false);
			return;
		}
		// Remove virtual recently read collection
		else if (collectionTreeRows[0].isRecentlyRead()) {
			this.setVirtual(collectionTreeRows[0].ref.libraryID, 'recentlyRead', false);
			return;
		}
		// Remove virtual retracted collection
		else if (collectionTreeRows[0].isRetracted()) {
			this.setVirtual(collectionTreeRows[0].ref.libraryID, 'retracted', false);
			return;
		}
		// Hide "My Publications"
		else if (collectionTreeRows[0].isPublications()) {
			this.setVirtual(collectionTreeRows[0].ref.libraryID, 'publications', false);
			return;
		}
		
		if (!this.canEdit() && !collectionTreeRows[0].isFeedsOrFeed()) {
			this.displayCannotEditLibraryMessage();
			return;
		}

		// A mixed-type selection (e.g., a collection and a saved search) has no
		// coherent confirmation, so only delete a homogeneous selection
		if (collectionTreeRows.length > 1
				&& !collectionTreeRows.every(r => r.type === collectionTreeRows[0].type)) {
			return;
		}

		var ps = Services.prompt;
		buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL;
		var title, message;
		var count = collectionTreeRows.length;
		// Work out the required title and message
		if (collectionTreeRows[0].isCollection()) {
			if (deleteItems) {
				[title, message] = await document.l10n.formatValues([
					{ id: 'collections-delete-with-items-title', args: { count } },
					{ id: 'collections-delete-with-items-message', args: { count } },
				]);
			}
			else {
				let keepItems;
				[title, message, keepItems] = await document.l10n.formatValues([
					{ id: 'collections-delete-title', args: { count } },
					{ id: 'collections-delete-message', args: { count } },
					{ id: 'collections-delete-keep-items', args: { count } },
				]);
				message = message + "\n\n" + keepItems;
			}
		}
		else if (collectionTreeRows[0].isFeed()) {
			title = Trellis.getString('pane.feed.deleteWithItems.title');
			message = Trellis.getString('pane.feed.deleteWithItems');
		}
		else if (collectionTreeRows[0].isSearch()) {
			[title, message] = await document.l10n.formatValues([
				{ id: 'collections-delete-search-title', args: { count } },
				{ id: 'collections-delete-search-message', args: { count } },
			]);
		}
			
		// Display prompt
		var index = ps.confirmEx(
			null,
			title,
			message,
			buttonFlags,
			title,
			"", "", "", {}
		);
		if (index == 0) {
			return this.collectionsView.deleteSelection(deleteItems);
		}
	}

	/**
	 * Check whether every selected item can be restored from trash
	 *
	 * @return {Boolean}
	 */
	this.canRestoreSelectedItems = function () {
		if (!this.getCollectionTreeRows()[0].isTrash()) {
			return false;
		}

		return this.getSelectedObjects().some(o => o.deleted);
	};
	
	
	/**
	 * @return {Promise}
	 */
	this.restoreSelectedItems = async function () {
		let selectedObjects = this.getSelectedObjects();
		if (!selectedObjects.length) {
			return;
		}

		let isSelected = object => selectedObjects.includes(object);

		await Trellis.DB.executeTransaction(async () => {
			let undoAction;
			if (selectedObjects.every(o => o instanceof Trellis.Item)) {
				undoAction = 'undo-action-restore-items';
			}
			else if (selectedObjects.every(o => o instanceof Trellis.Collection)) {
				undoAction = 'undo-action-restore-collection';
			}
			else {
				undoAction = 'undo-action-restore-objects';
			}
			Trellis.UndoHistory.stageAction(undoAction, { count: selectedObjects.length });

			for (let row = 0; row < this.itemsView.rowCount; row++) {
				// Only look at top-level items
				if (this.itemsView.getLevel(row) !== 0) {
					continue;
				}

				let parent = this.itemsView.getRow(row).ref;
				let childIDs = [];
				let subcollections = [];
				if (parent instanceof Trellis.Collection) {
					// If the restored item is a collection, restore its subcollections too
					if (isSelected(parent)) {
						subcollections = parent.getDescendents(false, 'collection', true).map(col => col.id);
					}
				}
				else {
					if (!parent.isNote()) {
						childIDs.push(...parent.getNotes(true));
					}
					if (!parent.isAttachment()) {
						childIDs.push(...parent.getAttachments(true));
					}
				}
				let childItems = Trellis.Items.get(childIDs);
				if (isSelected(parent)) {
					if (parent.deleted) {
						parent.deleted = false;
						await parent.save();
					}

					let noneSelected = !childItems.some(isSelected);
					let allChildren = childItems.concat(Trellis.Collections.get(subcollections));
					for (let child of allChildren) {
						if ((noneSelected || isSelected(child)) && child.deleted) {
							child.deleted = false;
							await child.save();
						}
					}
				}
				else {
					for (let child of childItems) {
						if (isSelected(child) && child.deleted) {
							child.deleted = false;
							await child.save();
						}
					}
				}
			}
		});
	};
	
	
	/**
	 * @return {Promise}
	 */
	this.emptyTrash = async function () {
		var libraryID = this.getSelectedLibraryID();
		
		var result = Services.prompt.confirm(
			null,
			"",
			Trellis.getString('pane.collections.emptyTrash') + "\n\n"
				+ Trellis.getString('general.actionCannotBeUndone')
		);
		if (result) {
			Trellis.showTrellisPaneProgressMeter(null, true);
			try {
				let deletedSearches = await Trellis.Searches.getDeleted(libraryID, true);
				await Trellis.Searches.erase(deletedSearches);
				let deletedCollections = await Trellis.Collections.getDeleted(libraryID, true);
				await Trellis.Collections.erase(deletedCollections);
				let deleted = await Trellis.Items.emptyTrash(
					libraryID,
					{
						onProgress: (progress, progressMax) => {
							var percentage = Math.round((progress / progressMax) * 100);
							Trellis.updateTrellisPaneProgressMeter(percentage);
						}
					}
				);
			}
			finally {
				Trellis.hideTrellisPaneOverlays();
			}
			await Trellis.purgeDataObjects();
			Trellis.UndoHistory.clear();
		}
	};
	
	
	// Currently only works on searches
	this.duplicateSelectedCollection = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}

		var row = this.getCollectionTreeRow();
		if (!row) {
			return;
		}
		
		let o = row.ref.clone();
		o.name = await row.ref.ObjectsClass.getNextName(row.ref.libraryID, o.name);
		await o.saveTx();
	};
	
	
	this.editSelectedCollection = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}

		var row = this.getCollectionTreeRow();
		if (row) {
			if (row.isCollection()) {
				this.collectionsView.startEditing(row);
			}
			else {
				this.setSavedSearchEditorState('open');
			}
		}
	};

	// Move selected collection to specified target collection or library.
	// Target has to be in the same library as the currently selected collection.
	this.moveCollection = async (target) => {
		let selected = this.getSelectedCollection();
		if (!selected) return;

		if (target.libraryID !== selected.libraryID) {
			throw new Error("Moving collections is only possible within the same library.");
		}
		if (target instanceof Trellis.Library) {
			selected.parentID = null;
		}
		else {
			selected.parentID = target.id;
		}
		
		await selected.saveTx({ undoAction: 'undo-action-move-collection' });
	};

	// Copy selected collection into another collection or library.
	// Partially, a replication of drag-drop mechanism from CollectionTree.onDrop.
	this.copyCollection = async (target) => {
		let selected = this.getSelectedCollection();
		if (!selected) return;

		let targetTreeRowID = `L${target.libraryID}`;
		if (target instanceof Trellis.Collection) {
			targetTreeRowID = `C${target.id}`;
			// Make sure the row is actually visible
			await TrellisPane.collectionsView.expandToCollection(target.id);
		}
		let targetTreeRowIndex = TrellisPane.collectionsView.getRowIndexByID(targetTreeRowID);
		let targetTreeRow = TrellisPane.collectionsView.getRow(targetTreeRowIndex);
		let copyOptions = {
			tags: Trellis.Prefs.get('groups.copyTags'),
			childNotes: Trellis.Prefs.get('groups.copyChildNotes'),
			childLinks: Trellis.Prefs.get('groups.copyChildLinks'),
			childFileAttachments: Trellis.Prefs.get('groups.copyChildFileAttachments'),
			annotations: Trellis.Prefs.get('groups.copyAnnotations'),
		};
		TrellisPane.collectionsView.executeCollectionCopy({
			collection: selected,
			targetCollectionID: target instanceof Trellis.Collection ? target.id : null,
			targetLibraryID: target.libraryID,
			targetTreeRow,
			copyOptions
		});
	};

	this.toggleSelectedItemsRead = async function () {
		await Trellis.FeedItems.toggleReadByID(this.getSelectedItems(true));
	};

	this.markFeedRead = async function () {
		var rows = this.getCollectionTreeRows();
		if (!rows.length) return;

		let feeds = rows.some(row => row.isFeeds()) ? Trellis.Feeds.getAll() : rows.map(row => row.ref);
		for (let feed of feeds) {
			let feedItemIDs = await Trellis.FeedItems.getAll(feed.libraryID, true, false, true);
			await Trellis.FeedItems.toggleReadByID(feedItemIDs, true);
		}
	};

	
	this.editSelectedFeed = async function () {
		var rows = this.getCollectionTreeRows();
		if (!rows.length) return;
		var row = rows[0];
		
		let feed = row.ref;
		let data = {
			url: feed.url,
			title: feed.name,
			ttl: feed.refreshInterval,
			cleanupReadAfter: feed.cleanupReadAfter,
			cleanupUnreadAfter: feed.cleanupUnreadAfter
		};
		
		window.openDialog('chrome://trellis/content/feedSettings.xhtml',
			null, 'centerscreen, modal', data);
		if (data.cancelled) return;
		
		feed.name = data.title;
		feed.refreshInterval = data.ttl;
		feed.cleanupReadAfter = data.cleanupReadAfter;
		feed.cleanupUnreadAfter = data.cleanupUnreadAfter;
		await feed.saveTx();
		Trellis_Tabs.rename("trellis-pane", feed.name);
	};
	
	this.refreshFeed = function () {
		var row = this.getCollectionTreeRow();
		if (!row) return;
		
		let feed = row.ref;
		
		return feed.updateFeed();
	}
	
	
	this.copySelectedItemsToClipboard = function (asCitations) {
		var items = [];
		let itemIDs = this.getSelectedItems(true);
		// Get selected item IDs in the item tree order
		itemIDs = this.getSortedItems(true).filter(id => itemIDs.includes(id));
		items = Trellis.Items.get(itemIDs);
		
		if (!items.length) {
			return;
		}
		
		var format = Trellis.QuickCopy.getFormatFromURL(Trellis.QuickCopy.lastActiveURL);
		if (items.every(item => item.isNote() || item.isAttachment())) {
			format = Trellis.QuickCopy.getNoteFormat();
		}
		// To copy annotations, wrap them in a temp note
		if (items.every(item => item.isAnnotation())) {
			format = Trellis.QuickCopy.getNoteFormat();
			items = [Trellis.QuickCopy.annotationsToNote(items)];
		}
		format = Trellis.QuickCopy.unserializeSetting(format);
		
		// In bibliography mode, remove notes and attachments
		if (format.mode == 'bibliography') {
			items = items.filter(item => item.isRegularItem());
		}
		
		// DEBUG: We could copy notes via keyboard shortcut if we altered
		// Z_F_I.copyItemsToClipboard() to use Z.QuickCopy.getContentFromItems(),
		// but 1) we'd need to override that function's drag limit and 2) when I
		// tried it the OS X clipboard seemed to be getting text vs. HTML wrong,
		// automatically converting text/html to plaintext rather than using
		// text/unicode. (That may be fixable, however.)
		//
		// This isn't currently shown, because the commands are disabled when not relevant, so this
		// function isn't called
		if (!items.length) {
			Services.prompt.alert(null, "", Trellis.getString("fileInterface.noReferencesError"));
			return;
		}
		
		// determine locale preference
		var locale = format.locale ? format.locale : Trellis.Prefs.get('export.quickCopy.locale');
		
		if (format.mode == 'bibliography') {
			Trellis_File_Interface.copyItemsToClipboard(
				items, format.id, locale, format.contentType == 'html', asCitations
			);
		}
		else if (format.mode == 'export') {
			// Copy citations doesn't work in export mode
			if (asCitations) {
				return;
			}
			else {
				Trellis_File_Interface.exportItemsToClipboard(items, format);
			}
		}
	}
	
	
	this.clearQuicksearch = async function (skipSearchRun) {
		var search = document.getElementById('trellis-tb-search');
		if (search.searchTextbox.value !== '') {
			search.searchTextbox.value = '';
			if (!skipSearchRun) {
				await this.search();
			}
			return true;
		}
		return false;
	};
	
	
	/**
	 * Some keys trigger an immediate search
	 */
	this.handleSearchKeypress = function (textbox, event) {
		if (event.keyCode == event.DOM_VK_ESCAPE) {
			if (textbox.searchTextbox.value) {
				textbox.searchTextbox.value = '';
				this.search();
			}
			else {
				this.itemsView?.focus();
			}
		}
		else if (event.keyCode == event.DOM_VK_RETURN) {
			this.search(true);
		}
	}


	this.handleCollectionSearchInput = function () {
		let collectionsSearchField = document.getElementById("trellis-collections-search");
		this.collectionsView.setFilter(collectionsSearchField.value);
		// Make sure that the filter ends up being hidden if the value is cleared
		// after the blur event fires. This happens on windows on cross icon click.
		if (collectionsSearchField.value.length == 0
				&& document.activeElement !== collectionsSearchField) {
			this.hideCollectionSearch();
		}
	}
	
	
	this.handleSearchInput = function (textbox, event) {
		if (textbox.searchTextbox.value.indexOf('"') != -1) {
			this.setItemsPaneMessage(Trellis.getString('advancedSearchMode'));
		}
	}
	
	
	/**
	 * @return {Promise}
	 */
	this.search = async function (runAdvanced) {
		if (!this.itemsView) {
			return;
		}
		var search = document.getElementById('trellis-tb-search');
		var searchVal = search.searchTextbox.value;
		if (!runAdvanced && searchVal.indexOf('"') != -1) {
			return;
		}
		var spinner = document.getElementById('trellis-tb-search-spinner');
		spinner.setAttribute("status", "animate");
		spinner.style.visibility = 'visible';
		await this.itemsView.setFilter('search', searchVal);
		spinner.style.removeProperty("visibility");
		spinner.removeAttribute("status");
		if (runAdvanced) {
			this.clearItemsPaneMessage();
		}
	};
	
	
	this.sync = function () {
		if (Trellis.Sync.Runner.syncInProgress) {
			Trellis.Sync.Runner.stop();
		}
		else {
			this.hideSyncReminder();

			Trellis.Sync.Server.canAutoResetClient = true;
			Trellis.Sync.Server.manualSyncRequired = false;
			Trellis.Sync.Runner.sync();
		}
	};


	var _syncRemindersObserverID = null;
	this.initSyncReminders = function (startup) {
		if (startup) {
			Trellis.Notifier.registerObserver(
				{
					notify: (event) => {
						// When the API Key is deleted we need to add an observer
						if (event === 'delete') {
							Trellis.Prefs.set('sync.reminder.setUp.enabled', true);
							Trellis.Prefs.set('sync.reminder.setUp.lastDisplayed', Math.round(Date.now() / 1000));
							TrellisPane.initSyncReminders(false);
						}
						// When API Key is added we can remove the observer
						else if (event === 'add') {
							TrellisPane.initSyncReminders(false);
						}
					}
				},
				'api-key');
		}

		// If both reminders are disabled, we don't need an observer
		if (!Trellis.Prefs.get('sync.reminder.setUp.enabled')
				&& !Trellis.Prefs.get('sync.reminder.autoSync.enabled')) {
			if (_syncRemindersObserverID) {
				Trellis.Notifier.unregisterObserver(_syncRemindersObserverID);
				_syncRemindersObserverID = null;
			}
			return;
		}

		// If we are syncing and auto-syncing then no need for observer
		if (Trellis.Sync.Runner.enabled && Trellis.Prefs.get('sync.autoSync')) {
			if (_syncRemindersObserverID) {
				Trellis.Notifier.unregisterObserver(_syncRemindersObserverID);
				_syncRemindersObserverID = null;
			}
			return;
		}

		// If we already have an observer don't add another one
		if (_syncRemindersObserverID) {
			return;
		}

		const eventTypes = ['add', 'modify', 'delete'];
		_syncRemindersObserverID = Trellis.Notifier.registerObserver(
			{
				notify: (event) => {
					if (!eventTypes.includes(event)) {
						return;
					}
					setTimeout(() => {
						this.showSetUpSyncReminder();
						this.showAutoSyncReminder();
					}, 5000);
				}
			},
			'item',
			'syncReminder');
	};

	this.showSetUpSyncReminder = function () {
		const sevenDays = 60 * 60 * 24 * 7;

		// Reasons not to show reminder:
		// - User turned reminder off
		// - Sync is enabled
		if (!Trellis.Prefs.get('sync.reminder.setUp.enabled')
				|| Trellis.Sync.Runner.enabled) {
			return;
		}

		// Check lastDisplayed was 7+ days ago
		let lastDisplayed = Trellis.Prefs.get('sync.reminder.setUp.lastDisplayed');
		if (lastDisplayed > Math.round(Date.now() / 1000) - sevenDays) {
			return;
		}

		this.showSyncReminder('setUp', { learnMoreURL: TRELLIS_CONFIG.SYNC_INFO_URL });
	};


	this.showAutoSyncReminder = function () {
		const sevenDays = 60 * 60 * 24 * 7;

		// Reasons not to show reminder:
		// - User turned reminder off
		// - Sync is not enabled
		// - Auto-Sync is enabled
		// - Last sync for all libraries was within 7 days
		if (!Trellis.Prefs.get('sync.reminder.autoSync.enabled')
				|| !Trellis.Sync.Runner.enabled
				|| Trellis.Prefs.get('sync.autoSync')
				|| Trellis.Libraries.getAll()
					.every(library => !library.syncable
						|| (library.lastSync
							&& library.lastSync.getTime() > Date.now() - 1000 * sevenDays))) {
			return;
		}

		// Check lastDisplayed was 7+ days ago
		let lastDisplayed = Trellis.Prefs.get('sync.reminder.autoSync.lastDisplayed');
		if (lastDisplayed > Math.round(Date.now() / 1000) - sevenDays) {
			return;
		}
		
		this.showSyncReminder('autoSync');
	};


	/**
	 * Configure the UI and show the sync reminder panel for a given type of reminder
	 *
	 * @param {String} reminderType - Possible values: 'setUp' or 'autoSync'
	 * @param {Object} [options]
	 * @param {String} [options.learnMoreURL] - Show "Learn More" link to this URL
	 */
	this.showSyncReminder = function (reminderType, options = {}) {
		if (!['setUp', 'autoSync'].includes(reminderType)) {
			throw new Error(`Invalid reminder type: ${reminderType}`);
		}

		let panel = document.getElementById('sync-reminder-container');
		panel.setAttribute('data-reminder-type', reminderType);

		let message = document.getElementById('sync-reminder-message');
		message.textContent = Trellis.getString(`sync.reminder.${reminderType}.message`, Trellis.appName);

		let actionLink = document.getElementById('sync-reminder-action');
		switch (reminderType) {
			case 'autoSync':
				var actionStr = Trellis.getString('general.enable');
				break;
			
			default:
				var actionStr = Trellis.getString(`sync.reminder.${reminderType}.action`);
				break;
		}
		actionLink.textContent = actionStr;
		actionLink.onclick = () => {
			this.hideSyncReminder();

			switch (reminderType) {
				case 'setUp':
					Trellis.Utilities.Internal.openPreferences('trellis-prefpane-account');
					break;
				case 'autoSync':
					Trellis.Prefs.set(`sync.autoSync`, true);
					break;
			}
		};

		let learnMoreLink = document.getElementById('sync-reminder-learn-more');
		learnMoreLink.textContent = Trellis.getString('general.learnMore');
		learnMoreLink.hidden = !options.learnMoreURL;
		learnMoreLink.onclick = () => Trellis.launchURL(options.learnMoreURL);
		
		let dontShowAgainLink = document.getElementById('sync-reminder-disable');
		dontShowAgainLink.textContent = Trellis.getString('general.dontAskAgain');
		dontShowAgainLink.onclick = () => {
			this.hideSyncReminder();
			Trellis.Prefs.set(`sync.reminder.${reminderType}.enabled`, false);
			// Check if we no longer need to observe item modifications
			TrellisPane.initSyncReminders(false);
		};

		let remindMeLink = document.getElementById('sync-reminder-remind');
		remindMeLink.textContent = Trellis.getString('general.remindMeLater');
		remindMeLink.onclick = () => this.hideSyncReminder();

		let closeButton = document.getElementById('sync-reminder-close');
		closeButton.onclick = () => this.hideSyncReminder();

		panel.removeAttribute('collapsed');
	};


	/**
	 * Hide the currently displayed sync reminder and update its associated
	 * lastDisplayed time.
	 */
	this.hideSyncReminder = function () {
		let panel = document.getElementById('sync-reminder-container');
		let reminderType = panel.getAttribute('data-reminder-type');
		panel.setAttribute('collapsed', true);
		panel.removeAttribute('data-reminder-type');

		if (['setUp', 'autoSync'].includes(reminderType)) {
			Trellis.Prefs.set(`sync.reminder.${reminderType}.lastDisplayed`, Math.round(Date.now() / 1000));
		}
	};


	this.selectItem = async function (itemID, options) {
		if (!itemID) {
			return false;
		}
		return this.selectItems([itemID], options);
	};
	
	
	this.selectItems = async function (itemIDs, options = {}) {
		if (typeof options == "boolean") {
			Trellis.warn("TrellisPane.selectItems() now takes an 'options' object -- update your code");
			options = { inLibraryRoot: options };
		}
		let { inLibraryRoot, noTabSwitch, noWindowRestore } = options;
		if (!itemIDs.length) {
			return false;
		}
		
		var items = await Trellis.Items.getAsync(itemIDs);
		if (!items.length) {
			return false;
		}
		
		// Restore window if it's in the dock
		if (window.windowState == window.STATE_MINIMIZED && !noWindowRestore) {
			window.restore();
		}
		
		if (!this.collectionsView) {
			throw new Error("Collections view not loaded");
		}
		
		var found = await this.collectionsView.selectItems(itemIDs, inLibraryRoot);
		
		// Focus the items pane
		if (found) {
			document.getElementById(TrellisPane.itemsView.id).focus();
		}
		
		if (!noTabSwitch) {
			Trellis_Tabs.select('trellis-pane', false, { focusElementID: TrellisPane.itemsView.id });
		}
		return true;
	};
	
	this.selectAll = function () {
		if (this.itemsView.domEl.contains(document.activeElement)) {
			this.itemsView.selection.selectAll();
		}
		else {
			const command = "cmd_selectAll";
			let controller = document.commandDispatcher.getControllerForCommand(command);
			if (controller && controller.isCommandEnabled(command)) {
				controller.doCommand(command);
			}
		}
	};
	
	this.getSelectedLibraryID = function () {
		return this.collectionsView.getSelectedLibraryID();
	}
	
	
	this.getSelectedCollection = function (asID) {
		Trellis.debug("TrellisPane.getSelectedCollection() is deprecated -- use getSelectedCollections()");
		return this.getSelectedCollections(asID)[0];
	}
	
	
	this.getSelectedCollections = function (asID) {
		return this.collectionsView.getSelectedCollections(asID);
	}
	
	
	function getSelectedSavedSearch(asID) {
		return this.collectionsView.getSelectedSearch(asID);
	}
	
	
	this.getSelectedGroup = function (asID) {
		return this.collectionsView.getSelectedGroup(asID);
	}
	
	
	this.getSelectedObjects = function () {
		if (!this.itemsView) return [];
		return this.itemsView.getSelectedObjects();
	};
	
	
	/*
	 * Return an array of Item objects for selected items
	 *
	 * If asIDs is true, return an array of itemIDs instead
	 */
	this.getSelectedItems = function (asIDs) {
		switch (Trellis_Tabs.selectedType) {
			case 'library':
				if (!this.itemsView) {
					return [];
				}
				return this.itemsView.getSelectedItems(asIDs);
			case 'reader': {
				let reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
				if (reader) {
					let item = Trellis.Items.get(reader.itemID);
					if (item.parentItem) {
						item = item.parentItem;
					}
					return asIDs ? [item.id] : [item];
				}
				return [];
			}
			case 'note': {
				let tab = Trellis_Tabs.getTabInfo(Trellis_Tabs.selectedID);
				if (tab) {
					let item = Trellis.Items.get(tab.data.itemID);
					return asIDs ? [item.id] : [item];
				}
				return [];
			}
			default:
				return [];
		}
	};
	

	/*
	 * Returns an array of Trellis.Item objects of visible items in current sort order
	 *
	 * If asIDs is true, return an array of itemIDs instead
	 */
	this.getSortedItems = function (asIDs) {
		switch (Trellis_Tabs.selectedType) {
			case 'library':
				if (!this.itemsView) {
					return [];
				}
				return this.itemsView.getSortedItems(asIDs);
			default:
				// ALl non-library tabs: Visible items == "selected" items
				return this.getSelectedItems(asIDs);
		}
	};


	/**
	 * Returns all items in the selected collection tree rows, ignoring quicksearch,
	 * tag, and advanced search filters
	 *
	 * @return {Promise<Trellis.Item[]>}
	 */
	this.getUnfilteredItems = async function () {
		var itemSet = new Set();
		for (let row of this.getCollectionTreeRows()) {
			for (let item of await row.getItems({ unfiltered: true })) {
				itemSet.add(item);
			}
		}
		return [...itemSet];
	};
	
	
	function getSortField() {
		if (!this.itemsView) {
			return false;
		}
		
		return this.itemsView.getSortField();
	}
	
	
	function getSortDirection() {
		if (!this.itemsView) {
			return false;
		}
		
		return this.itemsView.getSortDirection();
	}


	function openPopup(popup, screenX, screenY) {
		popup.openPopupAtScreen(screenX + 1, screenY + 1, true);
	}
	
	
	/**
	 * Show context menu once it's ready
	 */
	this.onCollectionsContextMenuOpen = async function (event, x, y) {
		await TrellisPane.buildCollectionContextMenu();
		x = x || event.screenX;
		y = y || event.screenY;
		// TEMP: Quick fix for https://forums.trellis.org/discussion/105103/
		if (Trellis.isWin) {
			x += 10;
		}
		openPopup(document.getElementById('trellis-collectionmenu'), x, y);
	};
	
	
	/**
	 * Show context menu once it's ready
	 */
	this.onItemsContextMenuOpen = async function (event, x, y) {
		// Library section headers (in a grouped cross-library view) aren't items, so
		// don't show the item context menu when one is right-clicked
		if (event.target?.closest?.('.library-header-row')) {
			return;
		}
		await TrellisPane.buildItemContextMenu();
		x = x || event.screenX;
		y = y || event.screenY;
		// TEMP: Quick fix for https://forums.trellis.org/discussion/105103/
		if (Trellis.isWin) {
			x += 10;
		}
		openPopup(document.getElementById('trellis-itemmenu'), x, y);
	};
	
	
	this.onCollectionContextMenuSelect = function (event) {
		event.stopPropagation();
		var o = _collectionContextMenuOptions.find(o => o.id == event.target.id)
		if (o?.oncommand) {
			o.oncommand();
		}
	};
	
	
	// menuitem configuration
	//
	// This has to be kept in sync with trellis-collectionmenu in trellisPane.xhtml. We could do this
	// entirely in JS, but various localized strings are only in trellis.dtd, and they're used in
	// standalone.xul as well, so for now they have to remain as XML entities.
	var _collectionContextMenuOptions = [
		{
			id: "sync",
			label: Trellis.getString('sync.sync'),
			oncommand: () => {
				Trellis.Sync.Runner.sync({
					libraries: [this.getSelectedLibraryID()],
				});
			}
		},
		{
			id: "sep1",
		},
		{
			id: "newCollection",
			command: "cmd_trellis_newCollection"
		},
		{
			id: "newSubcollection",
			oncommand: () => {
				this.newCollection(this.getSelectedCollection().key);
			}
		},
		{
			id: "refreshFeed",
			oncommand: () => this.refreshFeed()
		},
		{
			id: "sep2",
		},
		{
			id: "showDuplicates",
			oncommand: () => {
				this.setVirtual(this.getSelectedLibraryID(), 'duplicates', true, true);
			}
		},
		{
			id: "showUnfiled",
			oncommand: () => {
				this.setVirtual(this.getSelectedLibraryID(), 'unfiled', true, true);
			}
		},
		{
			id: "showRecentlyRead",
			oncommand: () => {
				this.setVirtual(this.getSelectedLibraryID(), 'recentlyRead', true, true);
			}
		},
		{
			id: "showRetracted",
			oncommand: () => {
				this.setVirtual(this.getSelectedLibraryID(), 'retracted', true, true);
			}
		},
		{
			id: "showPublications",
			oncommand: () => {
				this.setVirtual(this.getSelectedLibraryID(), 'publications', true, true);
			}
		},
		{
			id: "editSelectedCollection",
			oncommand: () => this.editSelectedCollection()
		},
		{
			id: "moveCollection",
		},
		{
			id: "copyCollection"
		},
		{
			id: "duplicate",
			oncommand: () => this.duplicateSelectedCollection()
		},
		{
			id: "markReadFeed",
			oncommand: () => this.markFeedRead()
		},
		{
			id: "editSelectedFeed",
			oncommand: () => this.editSelectedFeed()
		},
		{
			id: 'addFeed'
		},
		{
			id: "deleteCollection",
			oncommand: () => this.deleteSelectedCollection()
		},
		{
			id: "deleteCollectionAndItems",
			oncommand: () => this.deleteSelectedCollection(true)
		},
		{
			id: "sep3",
		},
		{
			id: "exportCollection",
			oncommand: () => Trellis_File_Interface.exportCollection()
		},
		{
			id: "createBibCollection",
			oncommand: () => Trellis_File_Interface.bibliographyFromCollection()
		},
		{
			id: "exportFile",
			oncommand: () => Trellis_File_Interface.exportFile()
		},
		{
			id: "loadReport",
			oncommand: () => Trellis_Report_Interface.loadCollectionReport()
		},
		{
			id: "emptyTrash",
			oncommand: () => this.emptyTrash()
		},
		{
			id: "removeLibrary",
			label: Trellis.getString('pane.collections.menu.remove.library'),
			oncommand: () => {
				let library = Trellis.Libraries.get(this.getSelectedLibraryID());
				let ps = Services.prompt;
				let buttonFlags = (ps.BUTTON_POS_0) * (ps.BUTTON_TITLE_IS_STRING)
					+ (ps.BUTTON_POS_1) * (ps.BUTTON_TITLE_CANCEL);
				let index = ps.confirmEx(
					null,
					Trellis.getString('pane.collections.removeLibrary'),
					Trellis.getString('pane.collections.removeLibrary.text', library.name),
					buttonFlags,
					Trellis.getString('general.remove'),
					null,
					null, null, {}
				);
				if (index == 0) {
					library.eraseTx();
				}
			}
		},
	];
	
	this.buildCollectionContextMenu = async function () {
		var libraryID = this.getSelectedLibraryID();
		var options = _collectionContextMenuOptions;
		
		var collectionTreeRows = this.getCollectionTreeRows();
		// This can happen if selection is changing during delayed second call below
		if (!collectionTreeRows.length) {
			return;
		}
		let libraryIDs = new Set(collectionTreeRows.map(o => o.ref.libraryID));
		let multipleLibraries = libraryIDs.size > 1;
		
		// If the items view isn't initialized, this was a right-click on a different collection
		// and the new collection's items are still loading, so continue menu after loading is
		// done. This causes some menu items (e.g., export/createBib/loadReport) to appear gray
		// in the menu at first and then turn black once there are items
		if (!collectionTreeRows[0].isHeader() && !this.itemsView.initialized) {
			await this.itemsView.waitForLoad();
		}
		
		// Set attributes on the menu from the configuration object
		var menu = document.getElementById('trellis-collectionmenu');
		var m = {};
		for (let i = 0; i < options.length; i++) {
			let option = options[i];
			let menuitem = menu.childNodes[i];
			m[option.id] = menuitem;
			
			menuitem.id = option.id;
			if (!menuitem.classList.contains('menuitem-iconic')) {
				menuitem.classList.add('menuitem-iconic');
			}
			if (option.label) {
				menuitem.setAttribute('label', option.label);
			}
			if (option.command) {
				menuitem.setAttribute('command', option.command);
			}
		}
		
		// By default things are hidden and visible, so we only need to record
		// when things are visible and when they're visible but disabled
		var show = [], disable = [];
		
		let useHideOrDelete = "delete";
		if (collectionTreeRows[0].isCollection()) {
			show = [
				'newSubcollection',
				'sep2',
				'editSelectedCollection',
				'moveCollection',
				'copyCollection',
				'deleteCollection',
				'deleteCollectionAndItems',
				'sep3',
				'exportCollection',
				'createBibCollection',
				'loadReport'
			];
			
			if (!this.itemsView.rowCount) {
				disable = ['createBibCollection', 'loadReport'];
				
				// If no items in any of the collections' subcollections either, disable export
				if (!(await Promise.all(collectionTreeRows.map(o => o.ref.getDescendents(false, 'item', false)))).flat().length) {
					disable.push('exportCollection');
				}
			}
			
			// Adjust labels
			document.l10n.setAttributes(m.editSelectedCollection, 'collections-menu-rename');
			document.l10n.setAttributes(m.moveCollection, 'collections-menu-move-collection');
			document.l10n.setAttributes(m.copyCollection, 'collections-menu-copy-collection');
			
			document.l10n.setAttributes(m.deleteCollection, 'collections-menu-delete', { count: collectionTreeRows.length });
			document.l10n.setAttributes(m.deleteCollectionAndItems, 'collections-menu-delete-with-items', { count: collectionTreeRows.length });
			document.l10n.setAttributes(m.exportCollection, 'collections-menu-export');
			document.l10n.setAttributes(m.createBibCollection, 'collections-menu-create-bibliography');
			document.l10n.setAttributes(m.loadReport, 'collections-menu-generate-report');

			// New Subcollection and Rename act on a single collection, so hide them
			// when more than one row is selected
			if (collectionTreeRows.length > 1) {
				show = show.filter(id => id != 'newSubcollection' && id != 'editSelectedCollection');
			}
			// A mixed-type selection has no coherent delete confirmation, so hide the
			// delete actions unless every selected row is a collection
			if (!collectionTreeRows.every(r => r.isCollection())) {
				show = show.filter(id => id != 'deleteCollection' && id != 'deleteCollectionAndItems');
			}

			// Hide move/copy when collections span multiple libraries, and disable
			// the report (its URL is scoped to a single library)
			if (multipleLibraries) {
				show = show.filter(id => id != 'moveCollection' && id != 'copyCollection');
				disable.push('loadReport');
			}
		}
		else if (collectionTreeRows[0].isFeed()) {
			show = [
				'refreshFeed',
				'sep2',
				'markReadFeed',
				'deleteCollectionAndItems',
			];
			if (collectionTreeRows.length == 1) {
				show.push('editSelectedFeed');
			}
			
			if (collectionTreeRows.every(o => o.ref.unreadCount == 0)) {
				disable = ['markReadFeed'];
			}
			
			// Adjust labels
			m.refreshFeed.setAttribute('label', Trellis.getString('pane.collections.menu.refresh.feed'));
			m.markReadFeed.setAttribute('label', Trellis.getString('pane.collections.menu.markAsRead.feed'));
			document.l10n.setAttributes(m.deleteCollectionAndItems, 'collections-menu-unsubscribe');
		}
		else if (collectionTreeRows.some(row => row.isFeeds())) {
			show = [
				'refreshFeed',
				'sep2',
				'markReadFeed',
				'addFeed',
			];

			if (collectionTreeRows.every(row => row.ref.unreadCount === 0)) {
				disable = ['markReadFeed'];
			}

			// Adjust labels
			m.refreshFeed.setAttribute('label', Trellis.getString('pane.collections.menu.refresh.allFeeds'));
			m.markReadFeed.setAttribute('label', Trellis.getString('pane.collections.menu.markAsRead.allFeeds'));
		}
		else if (collectionTreeRows[0].isSearch()) {
			show = [
				'deleteCollection',
				'sep3',
				'exportCollection',
				'createBibCollection',
				'loadReport'
			];
			if (collectionTreeRows.length == 1) {
				show.push('editSelectedCollection', 'duplicate');
			}
			
			if (!this.itemsView.rowCount) {
				disable.push('exportCollection', 'createBibCollection', 'loadReport');
			}
			
			// Adjust labels
			document.l10n.setAttributes(m.editSelectedCollection, 'collections-menu-edit-search');
			document.l10n.setAttributes(m.duplicate, 'collections-menu-duplicate-search');
			m.duplicate.classList.add('trellis-menuitem-duplicate-saved-search');
			m.duplicate.classList.remove('trellis-menuitem-duplicate-collection');
			document.l10n.setAttributes(m.deleteCollection, 'collections-menu-delete-search', { count: collectionTreeRows.length });
			document.l10n.setAttributes(m.exportCollection, 'collections-menu-export');
			document.l10n.setAttributes(m.createBibCollection, 'collections-menu-create-bibliography');
			document.l10n.setAttributes(m.loadReport, 'collections-menu-generate-report');

			// Hide delete for a mixed-type selection (see the collection branch)
			if (!collectionTreeRows.every(r => r.isSearch())) {
				show = show.filter(id => id != 'deleteCollection');
			}
		}
		else if (collectionTreeRows[0].isTrash()) {
			show = ['emptyTrash'];
		}
		else if (collectionTreeRows[0].isDuplicates() || collectionTreeRows[0].isUnfiled() || collectionTreeRows[0].isRecentlyRead()
				|| collectionTreeRows[0].isRetracted()) {
			show = ['deleteCollection'];
			
			m.deleteCollection.setAttribute('label', Trellis.getString('general.hide'));
			useHideOrDelete = "hide";
		}
		else if (collectionTreeRows[0].isHeader()) {
		}
		else if (collectionTreeRows[0].isPublications()) {
			show = ['exportFile', 'deleteCollection'];
			m.deleteCollection.setAttribute('label', Trellis.getString('general.hide'));
			useHideOrDelete = "hide";
		}
		// Library
		else {
			let library = Trellis.Libraries.get(libraryID);
			show = [];
			if (!library.archived) {
				show.push(
					'sync',
					'sep1',
					'newCollection'
				);
			}
				// Only show "Show Duplicates", "Show Unfiled Items", and "Show Retracted" if rows are hidden
			let duplicates = Trellis.Prefs.getVirtualCollectionStateForLibrary(
				libraryID, 'duplicates'
			);
			let unfiled = Trellis.Prefs.getVirtualCollectionStateForLibrary(
				libraryID, 'unfiled'
			);
			let recentlyRead = Trellis.Prefs.getVirtualCollectionStateForLibrary(
				libraryID, 'recentlyRead'
			);
			let retracted = Trellis.Prefs.getVirtualCollectionStateForLibrary(
				libraryID, 'retracted'
			);
			let publications = Trellis.Prefs.getVirtualCollectionStateForLibrary(
				libraryID, 'publications'
			);
			if (!duplicates || !unfiled || !recentlyRead || !retracted || !publications) {
				if (!library.archived) {
					show.push('sep2');
				}
				if (!duplicates) {
					show.push('showDuplicates');
				}
				if (!unfiled) {
					show.push('showUnfiled');
				}
				if (!recentlyRead) {
					show.push('showRecentlyRead');
				}
				if (!retracted) {
					show.push('showRetracted');
				}
				if (!publications) {
					show.push('showPublications');
				}
			}
			if (!library.archived) {
				show.push('sep3');
			}
			show.push(
				'exportFile'
			);
			if (library.archived) {
				show.push('removeLibrary');
			}
		}

		if (useHideOrDelete === 'delete') {
			m.deleteCollection.classList.add('trellis-menuitem-delete-collection');
			m.deleteCollection.classList.remove('trellis-menuitem-hide-collection');
		}
		else {
			m.deleteCollection.classList.add('trellis-menuitem-hide-collection');
			m.deleteCollection.classList.remove('trellis-menuitem-delete-collection');
		}
		
		// Disable some actions if user doesn't have write access
		//
		// Some actions are disabled via their commands in onCollectionSelected()
		if (collectionTreeRows[0].isWithinGroup()
				&& collectionTreeRows.every(o => !o.editable)
				&& !collectionTreeRows[0].isDuplicates()
				&& !collectionTreeRows[0].isUnfiled()
				&& !collectionTreeRows[0].isRetracted()) {
			disable.push(
				'newSubcollection',
				'editSelectedCollection',
				'duplicate',
				'deleteCollection',
				'deleteCollectionAndItems'
			);
		}
		
		// If within non-editable group or trash it empty, disable Empty Trash
		if (collectionTreeRows[0].isTrash()) {
			if ((collectionTreeRows[0].isWithinGroup() && !collectionTreeRows[0].isWithinEditableGroup()) || !this.itemsView.rowCount) {
				disable.push('emptyTrash');
			}
		}
		
		// Hide and enable all actions by default (so if they're shown they're enabled)
		for (let i in m) {
			m[i].setAttribute('hidden', true);
			m[i].setAttribute('disabled', false);
		}
		
		for (let id of show) {
			m[id].setAttribute('hidden', false);
		}
		
		for (let id of disable) {
			m[id].setAttribute('disabled', true);
		}

		Trellis.MenuManager.updateMenuPopup(
			menu,
			"main/library/collection",
			{
				getContext: () => ({
					// collectionTreeRow is the primary (first) selected row, kept for
					// backward compatibility; collectionTreeRows is the full selection
					collectionTreeRow: collectionTreeRows[0],
					collectionTreeRows,
					tabType: "library",
					tabSubType: undefined,
					tabID: "trellis-pane",
				})
			}
		);
	};
	
	
	this.buildItemContextMenu = async function () {
		var options = [
			'showInLibrary',
			'sep1',
			'addNote',
			'createNoteFromAnnotations',
			'addAttachments',
			'sep2',
			'findFile',
			'sep3',
			'toggleRead',
			'changeParentItem',
			'addToCollection',
			'removeItems',
			'duplicateAndConvert',
			'duplicateItem',
			'restoreToLibrary',
			'moveToTrash',
			'deleteFromLibrary',
			'mergeItems',
			'relateItems',
			'sep4',
			'exportItems',
			'createBib',
			'loadReport',
			'sep5',
			'recognizePDF',
			'unrecognize',
			'createParent',
			'reindexItem',
		];
		
		var m = {};
		for (let i = 0; i < options.length; i++) {
			m[options[i]] = i;
		}
		
		var menu = document.getElementById('trellis-itemmenu');
		
		// remove old locate menu items
		while(menu.firstChild && menu.firstChild.getAttribute("trellis-locate")) {
			menu.removeChild(menu.firstChild);
		}
		
		var disable = new Set(), show = new Set(), multiple = '';
		
		if (!this.itemsView) {
			return;
		}
		
		var collectionTreeRows = this.getCollectionTreeRows();
		var isTrash = collectionTreeRows[0].isTrash();
		
		if (isTrash) {
			show.add(m.deleteFromLibrary);
			show.add(m.restoreToLibrary);
			if (!TrellisPane_Local.canDeleteSelectedItems()) {
				disable.add(m.deleteFromLibrary);
			}
			if (!TrellisPane_Local.canRestoreSelectedItems()) {
				disable.add(m.restoreToLibrary);
			}
		}
		else if (!collectionTreeRows[0].isFeedsOrFeed()) {
			show.add(m.moveToTrash);
		}

		if (!collectionTreeRows[0].isFeedsOrFeed()) {
			show.add(m.sep4);
			show.add(m.exportItems);
			show.add(m.createBib);
			show.add(m.loadReport);
		}
		
		var items = this.getSelectedItems();

		// A report URL is scoped to a single library, so disable it when the selected
		// items span libraries (possible in a cross-library items list)
		if (new Set(items.map(item => item.libraryID)).size > 1) {
			disable.add(m.loadReport);
		}

		if (items.length > 0) {
			// Multiple items selected
			if (items.length > 1) {
				multiple = '.multiple';
				
				var canMerge = true,
					showRelate = true, canRelate = true,
					canIndex = true,
					canRecognize = true,
					canUnrecognize = true;
				var canMarkRead = collectionTreeRows[0].isFeedsOrFeed();
				var markUnread = true;
				
				for (let item of items) {
					if (canMerge && (!item.isRegularItem() || item.isFeedItem || collectionTreeRows[0].isDuplicates())) {
						canMerge = false;
					}
					
					if (showRelate) {
						if (item.isFeedItem) {
							showRelate = false;
						}
						else if (canRelate && items.every(otherItem => otherItem === item || otherItem.relatedItems.includes(item.key))) {
							canRelate = false;
						}
					}
					
					if (canIndex && !((await Trellis.Fulltext.canReindex(item)))) {
						canIndex = false;
					}
					
					if (canRecognize && !Trellis.RecognizeDocument.canRecognize(item)) {
						canRecognize = false;
					}
					
					if (canUnrecognize && !Trellis.RecognizeDocument.canUnrecognize(item)) {
						canUnrecognize = false;
					}
					
					if (canMarkRead && markUnread && !item.isRead) {
						markUnread = false;
					}
				}
				
				if (canMerge) {
					show.add(m.mergeItems);
				}

				if (showRelate) {
					show.add(m.relateItems);
					if (!canRelate) {
						disable.add(m.relateItems);
					}
				}
				
				if (canIndex) {
					show.add(m.reindexItem);
				}
				
				if (canRecognize) {
					show.add(m.recognizePDF);
				}
				
				if (canUnrecognize) {
					show.add(m.unrecognize);
				}
				
				if (canMarkRead) {
					show.add(m.toggleRead);
					if (markUnread) {
						menu.childNodes[m.toggleRead].setAttribute('label', Trellis.getString('pane.item.markAsUnread'));
					} else {
						menu.childNodes[m.toggleRead].setAttribute('label', Trellis.getString('pane.item.markAsRead'));
					}
				}
				
				// "Add/Create Note from Annotations" and "Find Available PDFs"
				if (collectionTreeRows[0].filesEditable
						&& !collectionTreeRows[0].isDuplicates()
						&& !collectionTreeRows[0].isFeedsOrFeed()) {
					if (items.some(item => attachmentsWithExtractableAnnotations(item).length)
							|| items.some(item => isAttachmentWithExtractableAnnotations(item))
							|| items.some(item => item.isAnnotation())) {
						let menuitem = menu.childNodes[m.createNoteFromAnnotations];
						show.add(m.createNoteFromAnnotations);
						let key;
						// If all from a single item, show "Add Note from Annotations"
						if (Trellis.Items.getTopLevel(items).length == 1) {
							key = 'addNoteFromAnnotations';
							menuitem.setAttribute('oncommand', 'TrellisPane.addNoteFromAnnotationsFromSelected()');
						}
						// Otherwise show "Create Note from Annotations"
						else {
							key = 'createNoteFromAnnotations';
							menuitem.setAttribute('oncommand', 'TrellisPane.createStandaloneNoteFromAnnotationsFromSelected()');
						}
						menuitem.setAttribute(
							'label',
							Trellis.getString('pane.items.menu.' + key)
						);
						show.add(m.sep3);
					}
					
					if (items.some(item => item.isRegularItem())) {
						show.add(m.findFile);
						show.add(m.sep3);
					}
				}

				let canCreateParent = true;
				for (let i = 0; i < items.length; i++) {
					let item = items[i];
					if (!item.isTopLevelItem() || !item.isAttachment() || item.isFeedItem) {
						canCreateParent = false;
						break;
					}
				}
				if (canCreateParent) {
					show.add(m.createParent);
				}

				
				// Add in attachment separator
				if (canCreateParent || canRecognize || canUnrecognize || canIndex) {
					show.add(m.sep5);
				}
				
				// Block certain actions on files if no access and at least one item is a file
				// attachment
				if (!collectionTreeRows[0].filesEditable) {
					for (let item of items) {
						if (item.isFileAttachment()) {
							disable.add(m.moveToTrash);
							disable.add(m.createParent);
							break;
						}
					}
				}
				
			}
			
			// Single item selected
			else
			{
				let item = items[0];
				menu.setAttribute('itemID', item.id);
				menu.setAttribute('itemKey', item.key);
				
				if (!isTrash) {
					// Show in Library
					if (!collectionTreeRows.every(o => o.isLibrary(true))) {
						show.add(m.showInLibrary);
						show.add(m.sep1);
					}
					
					// Show "Add Note from Annotations" on parent item with any extractable annotations
					if (item.isRegularItem() && !item.isFeedItem) {
						show.add(m.addNote);
						show.add(m.addAttachments);
						show.add(m.sep2);
						
						let attachmentsWithAnnotations = Trellis.Items.get(item.getAttachments())
							.filter(item => isAttachmentWithExtractableAnnotations(item));
						if (attachmentsWithAnnotations.length) {
							show.add(m.createNoteFromAnnotations);
						}
					}
					// Show "(Create|Add) Note from Annotations" on attachment with extractable annotations
					else if (isAttachmentWithExtractableAnnotations(item) || item.isAnnotation()) {
						show.add(m.createNoteFromAnnotations);
						show.add(m.sep2);
					}
					if (show.has(m.createNoteFromAnnotations)) {
						let menuitem = menu.childNodes[m.createNoteFromAnnotations];
						let str;
						// Show "Create" on standalone attachments
						if (item.isAttachment() && item.isTopLevelItem()) {
							str = 'pane.items.menu.createNoteFromAnnotations';
							menuitem.setAttribute('oncommand', 'TrellisPane.createStandaloneNoteFromAnnotationsFromSelected()');
						}
						// And "Add" otherwise
						else {
							str = 'pane.items.menu.addNoteFromAnnotations';
							menuitem.setAttribute('oncommand', 'TrellisPane.addNoteFromAnnotationsFromSelected()');
						}
						menuitem.setAttribute('label', Trellis.getString(str));
					}
					
					if (Trellis.Attachments.canFindFileForItem(item)) {
						show.add(m.findFile);
						show.add(m.sep3);
						if (!collectionTreeRows[0].filesEditable) {
							disable.add(m.findFile);
						}
					}
					
					if (Trellis.RecognizeDocument.canUnrecognize(item)) {
						show.add(m.sep5);
						show.add(m.unrecognize);
					}
					
					if (item.isAttachment()) {
						var showSep5 = false;
						
						if (Trellis.RecognizeDocument.canRecognize(item)) {
							show.add(m.recognizePDF);
							showSep5 = true;
						}
						
						// Allow parent item creation for standalone attachments
						if (item.isTopLevelItem()) {
							show.add(m.createParent);
							showSep5 = true;
						}
						
						// If not linked URL, show reindex line
						if (await Trellis.Fulltext.canReindex(item)) {
							show.add(m.reindexItem);
							showSep5 = true;
						}
						
						if (showSep5) {
							show.add(m.sep5);
						}
					}
					else if (item.isAnnotation()) {
						// Some annotation specific menus?
					}
					else if (item.isFeedItem) {
						show.add(m.toggleRead);
						if (item.isRead) {
							menu.childNodes[m.toggleRead].setAttribute('label', Trellis.getString('pane.item.markAsUnread'));
						} else {
							menu.childNodes[m.toggleRead].setAttribute('label', Trellis.getString('pane.item.markAsRead'));
						}
					}
					else if (!collectionTreeRows[0].isPublications()) {
						if (item.itemType == 'book' || item.itemType == 'bookSection') {
							let toBookMenuItem = menu.childNodes[m.duplicateAndConvert];
							toBookMenuItem.setAttribute('label', Trellis.getString('pane.items.menu.duplicateAndConvert.'
								+ (item.itemType == 'book' ? 'toBookSection' : 'toBook')));
							if (item.itemType === 'book') {
								toBookMenuItem.classList.add('trellis-menuitem-convert-to-book-section');
								toBookMenuItem.classList.remove('trellis-menuitem-convert-to-book');
							}
							else {
								toBookMenuItem.classList.add('trellis-menuitem-convert-to-book');
								toBookMenuItem.classList.remove('trellis-menuitem-convert-to-book-section');
							}
							show.add(m.duplicateAndConvert);
						}

						show.add(m.duplicateItem);
					}
				}
				
				// Update attachment submenu
				var popup = document.getElementById('trellis-add-attachment-popup');
				popup.addEventListener('popupshowing', (event) => {
					this.updateAddAttachmentMenu(event, popup);
				});
				
				// Block certain actions on files if no access
				if (item.isFileAttachment() && !collectionTreeRows[0].filesEditable) {
					[m.moveToTrash, m.createParent]
						.forEach(function (x) {
							disable.add(x);
						});
				}
			}
		}
		// No items selected
		else
		{
			// Show in Library
			if (!collectionTreeRows.every(o => o.isLibrary(true))) {
				show.add(m.showInLibrary);
				show.add(m.sep1);
			}
			
			[
				m.showInLibrary,
				m.duplicateItem,
				m.removeItems,
				m.moveToTrash,
				m.deleteFromLibrary,
				m.exportItems,
				m.createBib,
				m.loadReport
			].forEach(x => disable.add(x));
			
		}
		
		// Show "Export Note…" if all notes or attachments
		var noteExport = items.every(item => item.isNote() || item.isAttachment());
		// Disable export if all notes are empty
		if (noteExport) {
			// If no non-empty notes, hide if all attachments and disable if all notes or a mixture
			// of notes and attachments
			if (!items.some(item => item.note)) {
				if (items.every(item => item.isAttachment())) {
					show.delete(m.exportItems);
				}
				else {
					disable.add(m.exportItems);
				}
			}
		}
		
		// Disable Create Bibliography if no regular items
		if (show.has(m.createBib) && !items.some(item => item.isRegularItem())) {
			show.delete(m.createBib);
		}
		
		if ((!collectionTreeRows[0].editable || collectionTreeRows[0].isPublications()) && !collectionTreeRows[0].isFeedsOrFeed()) {
			for (let i in m) {
				// Still allow some options for non-editable views
				switch (i) {
					case 'showInLibrary':
					case 'exportItems':
					case 'createBib':
					case 'loadReport':
					case 'toggleRead':
						continue;
				}
				if (isTrash) {
					switch (i) {
					case 'restoreToLibrary':
					case 'deleteFromLibrary':
						continue;
					}
				}
				else if (collectionTreeRows[0].isPublications()) {
					switch (i) {
					case 'addNote':
					case 'removeItems':
					case 'moveToTrash':
						continue;
					}
				}
				disable.add(m[i]);
			}
		}

		// Add to collection
		if (!collectionTreeRows[0].isFeedsOrFeed()
			&& collectionTreeRows[0].editable
			&& Trellis.Items.keepTopLevel(items).every(item => item.isTopLevelItem())
		) {
			menu.childNodes[m.addToCollection].setAttribute('label', Trellis.getString('pane.items.menu.addToCollection'));
			show.add(m.addToCollection);
		}
		
		// Remove from collection / Recently Read
		menu.childNodes[m.removeItems].removeAttribute('data-l10n-id');
		if (collectionTreeRows[0].isCollection() && items.every(item => item.isTopLevelItem())) {
			menu.childNodes[m.removeItems].setAttribute('label', Trellis.getString('pane.items.menu.remove' + multiple));
			show.add(m.removeItems);
		}
		else if (collectionTreeRows[0].isPublications()) {
			menu.childNodes[m.removeItems].setAttribute('label', Trellis.getString('pane.items.menu.removeFromPublications' + multiple));
			show.add(m.removeItems);
		}
		else if (collectionTreeRows[0].isRecentlyRead()) {
			// Disable for child items that aren't attachments with lastRead
			let canRemove = items.every((item) => {
				if (item.isTopLevelItem()) return true;
				return item.isAttachment() && item.attachmentLastRead;
			});
			menu.childNodes[m.removeItems].removeAttribute('label');
			menu.childNodes[m.removeItems].setAttribute('data-l10n-id', 'item-menu-remove-from-recently-read');
			show.add(m.removeItems);
			if (!canRemove) {
				disable.add(m.removeItems);
			}
		}
		
		// Show in library
		if (collectionTreeRows[0].isFeeds()) {
			menu.childNodes[m.showInLibrary].setAttribute('label', Trellis.getString('pane.items.menu.showInFeed'));
		}
		else {
			menu.childNodes[m.showInLibrary].setAttribute('label', Trellis.getString('general.showInLibrary'));
		}
		// For collections and search, only keep restore/delete options
		if (items.some(item => item instanceof Trellis.Collection || item instanceof Trellis.Search)) {
			for (let option of options) {
				if (!['restoreToLibrary', 'deleteFromLibrary'].includes(option)) {
					show.delete(m[option]);
				}
			}
		}
		
		// Update parent item of notes/attachments
		if (items.every(item => item.isNote() || item.isAttachment())) {
			show.add(m.changeParentItem);
		}

		// Only keep annotation-specific options if annotations are selected
		let annotationsSelected = items.some(item => item.isAnnotation());
		if (annotationsSelected) {
			let menuItemsForAnnotations = [
				'createNoteFromAnnotations',
				'deleteFromLibrary'
			];
			for (let i in m) {
				if (menuItemsForAnnotations.includes(i)) continue;
				show.delete(m[i]);
			}
		}

		// Set labels, plural if necessary
		menu.childNodes[m.findFile].setAttribute('label', Trellis.getString('pane.items.menu.findAvailableFile'));
		menu.childNodes[m.moveToTrash].setAttribute('label', Trellis.getString('pane.items.menu.moveToTrash' + multiple));
		menu.childNodes[m.deleteFromLibrary].setAttribute('label', Trellis.getString('pane.items.menu.delete'));
		menu.childNodes[m.exportItems].setAttribute('label', Trellis.getString(`pane.items.menu.export${noteExport ? 'Note' : ''}` + multiple));
		menu.childNodes[m.createBib].setAttribute('label', Trellis.getString('pane.items.menu.createBib' + multiple));
		menu.childNodes[m.loadReport].setAttribute('label', Trellis.getString('pane.items.menu.generateReport' + multiple));
		menu.childNodes[m.createParent].setAttribute('label', Trellis.getString('pane.items.menu.createParent' + multiple));
		menu.childNodes[m.recognizePDF].setAttribute('label', Trellis.getString('pane.items.menu.recognizeDocument'));
		menu.childNodes[m.reindexItem].setAttribute('label', Trellis.getString('pane.items.menu.reindexItem' + multiple));
		
		// Hide and enable all actions by default (so if they're shown they're enabled)
		for (let i in m) {
			let pos = m[i];
			menu.childNodes[pos].setAttribute('hidden', true);
			menu.childNodes[pos].setAttribute('disabled', false);
		}
		
		for (let x of disable) {
			menu.childNodes[x].setAttribute('disabled', true);
		}
		
		for (let x of show) {
			menu.childNodes[x].setAttribute('hidden', false);
		}

		// No locate menu options if annotations are selected
		if (annotationsSelected) return;

		// add locate menu options
		await Trellis_LocateMenu.buildContextMenu(menu, true);

		Trellis.MenuManager.updateMenuPopup(
			menu,
			"main/library/item",
			{
				getContext: () => ({
					// collectionTreeRow is the primary (first) selected row, kept for
					// backward compatibility; collectionTreeRows is the full selection
					collectionTreeRow: collectionTreeRows[0],
					collectionTreeRows,
					items,
					tabType: "library",
					tabSubType: undefined,
					tabID: "trellis-pane",
				})
			}
		);
	};


	// Build a menu to move or copy a collection into another collection and library.
	// Alternative to dropping collection into another collection or group
	this.buildMoveCollectionMenu = function (event) {
		if (event.target !== event.currentTarget) return;
		let popup = event.target;
		popup.replaceChildren();

		let selected = this.getSelectedCollections();

		// Add current library at the top to be able to move collections into it
		let library = Trellis.Libraries.get(TrellisPane.getSelectedLibraryID());
		let libraryMenuItem = document.createXULElement("menuitem");
		libraryMenuItem.setAttribute("label", library.name);
		libraryMenuItem.setAttribute("image", library.treeViewImage);
		libraryMenuItem.setAttribute("value", library.treeViewID);
		libraryMenuItem.addEventListener("command", (event) => {
			if (event.target.tagName == 'menuitem') {
				this.moveCollection(library);
				event.stopPropagation();
			}
		});
		// Disable if all collections are already top-level collections
		libraryMenuItem.disabled = selected.every(o => !o.parentID);
		libraryMenuItem.classList.add('menuitem-iconic');
		popup.appendChild(libraryMenuItem);
		popup.appendChild(document.createXULElement("menuseparator"));
		
		// Build menus for each top-level collection of this library
		let collections = Trellis.Collections.getByLibrary(this.getSelectedLibraryID());
		for (let col of collections) {
			let menuItem = Trellis.Utilities.Internal.createMenuForTarget(
				col,
				popup,
				null,
				(event, collection) => {
					if (event.target.tagName == 'menuitem') {
						this.moveCollection(collection);
						event.stopPropagation();
					}
				},
				
				(target) => {
					// can't move collection into itself, its parent or its children
					return selected.some((c) => {
						return c == target
							|| c.parentKey == target.key
							|| c.hasDescendent('collection', target.id);
					});
				}
			);
			popup.append(menuItem);
		}
	};


	this.buildCopyCollectionMenu = function (event) {
		if (event.target !== event.currentTarget) return;
		let popup = document.getElementById("trellis-copy-collection-popup");
		popup.replaceChildren();
		let selected = this.getSelectedCollection();

		// Fetch all libraries
		let topLevelEntries = Trellis.Libraries.getAll().filter(lib => !(lib instanceof Trellis.Feed));

		// Check which libraries have collections linked to the selected collection
		// and disable their menuitems. Same logic as in CollectionTree.canDropCheckAsync.
		let linkedCollectionsExist = {};
		(async () => {
			for (let library of topLevelEntries) {
				if (library.libraryID == selected.libraryID) continue;
				// Check which library has a collection linked to the selected collection
				let linkedCollection = await selected.getLinkedCollection(library.libraryID, true);
				linkedCollectionsExist[library.libraryID] = linkedCollection;
				// Also check which library has collections linked to a subcollection of the selected collection
				for (let descendent of selected.getDescendents(false, 'collection')) {
					let subcollection = Trellis.Collections.get(descendent.id);
					let linkedSubcollection = await subcollection.getLinkedCollection(library.libraryID, true);
					if (linkedSubcollection) {
						linkedCollectionsExist[library.libraryID] = linkedSubcollection;
					}
				}
			}
			// Libraries that have linked collections have their menus disabled
			for (let libraryMenuItem of [...popup.childNodes]) {
				let menuItemLibID = libraryMenuItem.getAttribute("value").substring(1);
				if (linkedCollectionsExist[menuItemLibID]) {
					libraryMenuItem.disabled = true;
				}
			}
		})();
		
		// If there is only one library, display its collections as top-level menuitems
		if (topLevelEntries.length == 1) {
			// Manually add My Library menuitem at the top, so one can still copy into it
			let myLibrary = topLevelEntries[0];
			let myLibraryMenuItem = document.createXULElement("menuitem");
			myLibraryMenuItem.setAttribute("label", myLibrary.name);
			myLibraryMenuItem.setAttribute("image", myLibrary.treeViewImage);
			myLibraryMenuItem.setAttribute("value", myLibrary.treeViewID);
			myLibraryMenuItem.classList.add('menuitem-iconic');
			myLibraryMenuItem.addEventListener("command", (event) => {
				if (event.target.tagName == 'menuitem') {
					this.copyCollection(myLibrary);
					event.stopPropagation();
				}
			});
			popup.appendChild(myLibraryMenuItem);
			popup.appendChild(document.createXULElement("menuseparator"));

			// Top-level collections used to construct the menus
			topLevelEntries = Trellis.Collections.getByLibrary(topLevelEntries[0].id);
		}
		
		// Build menus for all libraries (or collections)
		for (let obj of topLevelEntries) {
			let menuItem = Trellis.Utilities.Internal.createMenuForTarget(
				obj,
				popup,
				null,
				(event, collection) => {
					if (event.target.tagName == 'menuitem') {
						this.copyCollection(collection);
						event.stopPropagation();
					}
				},
				
				(target) => {
					// can't copy collection into itself or into non-editable groups
					return selected == target
						|| (target instanceof Trellis.Group && !target.editable);
				}
			);
			popup.append(menuItem);
		}
	};

	this.buildAddItemToCollectionMenu = function (event, items = this.getSelectedItems()) {
		if (event.target !== event.currentTarget) return;
		let popup = event.target;

		items = Trellis.Items.keepTopLevel(items);
		
		let newCollectionMenuitem = document.createXULElement('menuitem');
		document.l10n.setAttributes(newCollectionMenuitem, 'menu-new-collection');
		newCollectionMenuitem.classList.add('menuitem-iconic');
		newCollectionMenuitem.classList.add('trellis-menuitem-new-collection');
		newCollectionMenuitem.addEventListener('command', () => this.addItemsToCollection(items, null, true));
		let separator = document.createXULElement('menuseparator');
		popup.replaceChildren(newCollectionMenuitem, separator);
		
		if (!items.length) {
			separator.hidden = true;
			return;
		}

		let libraryID = items[0].libraryID;
		if (items.some(item => item.libraryID !== libraryID)) {
			throw new Error('All items must be the same library');
		}
		
		let collections = Trellis.Collections.getByLibrary(libraryID);
		for (let col of collections) {
			let menuItem = Trellis.Utilities.Internal.createMenuForTarget(
				col,
				popup,
				null,
				(event, collection) => {
					if (event.target.tagName == 'menuitem') {
						this.addItemsToCollection(items, collection);
						event.stopPropagation();
					}
				},
				collection => items.every(item => collection.hasItem(item))
			);
			popup.append(menuItem);
		}

		separator.hidden = !collections.length;
	};


	this.addItemsToCollection = async function (items, collection, createNew = false) {
		items = Trellis.Items.keepTopLevel(items);

		if (createNew) {
			if (collection) {
				throw new Error('collection must be null if createNew is true');
			}
			// Only allow targets within the current library for now
			// TODO: Come back to this once we support copying items between libraries from the Add to Collection menu
			let id = await this.newCollection(this.getSelectedCollection()?.key);
			if (!id) {
				return;
			}
			collection = Trellis.Collections.get(id);
		}

		let ids = items.map(item => item.id);
		await Trellis.DB.executeTransaction(async () => {
			Trellis.UndoHistory.stageAction(
				'undo-action-add-to-collection',
				{ count: ids.length }
			);
			await collection.addItems(ids);
		});
	};


	this.addSelectedItemsToCollection = function (collection, createNew = false) {
		return this.addItemsToCollection(this.getSelectedItems(), collection, createNew);
	};

	
	this.onItemTreeActivate = function (event, items) {
		var viewOnDoubleClick = Trellis.Prefs.get('viewOnDoubleClick');
		// Mouse event
		if (event.button && items.length == 1 && viewOnDoubleClick) {
			TrellisPane.viewItems([items[0]], event);
		}
		// Keyboard event
		else if (items.length < 20) {
			TrellisPane_Local.viewItems(items, event);
		}
	};
	
	
	function attachmentsWithExtractableAnnotations(item) {
		if (!item.isRegularItem()) return [];
		return Trellis.Items.get(item.getAttachments())
			.filter(item => isAttachmentWithExtractableAnnotations(item));
	}
	
	
	function isAttachmentWithExtractableAnnotations(item) {
		// For now, consider all PDF attachments eligible, since we want to extract external
		// annotations in unprocessed files if present
		// item.isPDFAttachment() && item.getAnnotations().some(x => x.annotationType != 'ink');
		return item.isPDFAttachment()
			|| (item.isEPUBAttachment() || item.isSnapshotAttachment()) && item.getAnnotations().length;
	}
	
	
	this.openPreferences = function (paneID) {
		Trellis.warn("TrellisPane.openPreferences() is deprecated"
			+ " -- use Trellis.Utilities.Internal.openPreferences() instead");
		Trellis.Utilities.Internal.openPreferences(paneID);
	}
	
	
	/*
	 * Loads a URL following the standard modifier key behavior
	 *  (e.g. meta-click == new background tab, meta-shift-click == new front tab,
	 *  shift-click == new window, no modifier == frontmost tab
	 */
	this.loadURI = function (uris, event) {
		if(typeof uris === "string") {
			uris = [uris];
		}
		
		for (let i = 0; i < uris.length; i++) {
			let uri = uris[i];
			// Ignore javascript: and data: URIs
			if (uri.match(/^(javascript|data):/)) {
				return;
			}
			
			if (uri.match(/^(chrome|resource):/)) {
				Trellis.openInViewer(uri);
				continue;
			}
			
			// Handle no-content trellis: URLs (e.g., trellis://select) without opening viewer
			if (uri.startsWith('trellis:')) {
				let nsIURI = Services.io.newURI(uri, null, null);
				let handler = Services.io.getProtocolHandler("trellis").wrappedJSObject;
				let extension = handler.getExtension(nsIURI);
				if (extension.noContent) {
					extension.doAction(nsIURI);
					return;
				}
			}
			
			try {
				Trellis.launchURL(uri);
			}
			catch (e) {
				Trellis.logError(e);
			}
		}
	}
	
	// TODO upon electron:
	// Technically just forwards to the react itemsView
	// but it is not as robust as XUL. Unfortunately we cannot use the original XUL
	// version since it causes terrible layout issues when mixing XUL and HTML
	// Keeping this function here since setting this message is technically
	// the responsibility of the TrellisPane and should be independent upon itemsView,
	// which hopefully we will fix once electronero arrives
	function setItemsPaneMessage(content, lock) {
		if (this._itemsPaneMessageLocked) {
			return;
		}

		// Make message permanent
		if (lock) {
			this._itemsPaneMessageLocked = true;
		}

		if (this.itemsView) {
			this.itemsView.setItemsPaneMessage(content, lock);
		}
	}
	
	function clearItemsPaneMessage() {
		// If message box is locked, don't clear
		if (this._itemsPaneMessageLocked) {
			return;
		}
		
		if (this.itemsView) {
			this.itemsView.clearItemsPaneMessage();
		}
	}
	
	
	/**
	 * @return {Promise<Integer|null|false>} - The id of the new note in non-popup mode, null in
	 *     popup mode (where a note isn't created immediately), or false if library isn't editable
	 */
	this.newNote = async function (popup, parentKey, text, citeURI) {
		// Shouldn't be reachable with multiple libraries selected (toolbar is disabled),
		// but just in case
		let rows = this.getCollectionTreeRows();
		if (new Set(rows.map(r => r.ref.libraryID)).size > 1) {
			return;
		}

		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return false;
		}
		
		if (popup) {
			// TODO: _text_
			this.openNote(null, { parentKey });
			return null;
		}
		
		if (!text) {
			text = '';
		}
		text = text.trim();
		
		if (text) {
			text = '<blockquote'
					+ (citeURI ? ' cite="' + citeURI + '"' : '')
					+ '>' + Trellis.Utilities.text2html(text) + "</blockquote>";
		}
		
		var item = new Trellis.Item('note');
		item.libraryID = this.getSelectedLibraryID();
		item.setNote(text);
		if (parentKey) {
			item.parentKey = parentKey;
		}
		else if (this.getCollectionTreeRows().every(row => row.isCollection())) {
			for (let row of this.getCollectionTreeRows()) {
				item.addToCollection(row.ref.id);
			}
		}
		var itemID = await item.saveTx({
			notifierData: {
				autoSyncDelay: Trellis.Notes.AUTO_SYNC_DELAY
			}
		});
		
		await this.selectItem(itemID);
		
		document.getElementById('trellis-note-editor').focus();
		
		return itemID;
	};
	
	
	/**
	 * Creates a child note for the selected item or the selected item's parent
	 *
	 * @return {Promise}
	 */
	this.newChildNote = function (popup) {
		var selected = this.getSelectedItems()[0];
		var parentKey = selected.parentItemKey;
		parentKey = parentKey ? parentKey : selected.key;
		this.newNote(popup, parentKey);
	}
	
	
	// TODO: Move to server_connector
	this.addSelectedTextToCurrentNote = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		
		var text = event.currentTarget.ownerDocument.popupNode.ownerDocument.defaultView.getSelection().toString();
		var uri = event.currentTarget.ownerDocument.popupNode.ownerDocument.location.href;
		
		if (!text) {
			return false;
		}
		
		text = text.trim();
		
		if (!text.length) {
			return false;
		}
		
		text = '<blockquote' + (uri ? ' cite="' + uri + '"' : '') + '>'
			+ Trellis.Utilities.text2html(text) + "</blockquote>";
		
		var items = this.getSelectedItems();
		
		if (this.itemsView.selection.count == 1 && items[0] && items[0].isNote()) {
			var note = items[0].note;
			
			items[0].setNote(note + text);
			await items[0].saveTx();
			
			var noteElem = document.getElementById('trellis-note-editor')
			noteElem.focus();
			return true;
		}
		
		return false;
	};
	
	
	this.openNote = function (itemID, options = {
		parentKey: undefined,
		openInWindow: undefined
	}) {
		let {
			parentKey,
			openInWindow,
		} = options;
		if (openInWindow === undefined) {
			openInWindow = Trellis.Prefs.get('openNoteInNewWindow');
		}

		return Trellis.Notes.open(itemID, undefined, {
			openInWindow,
		});
	};

	/**
	 * Opens a note in a new window
	 * @deprecated - use openNote() with openInWindow option
	 */
	this.openNoteWindow = function (itemID, col, parentKey) {
		return this.openNote(itemID, { col, parentKey, openInWindow: true });
	};
	
	this.findNoteWindow = function (itemID) {
		var name = 'trellis-note-' + itemID;
		var wm = Services.wm;
		var e = wm.getEnumerator('trellis:note');
		while (e.hasMoreElements()) {
			var w = e.getNext();
			if (w.name == name) {
				return w;
			}
		}
	};
	
	
	this.addAttachmentFromURI = async function (link, itemID) {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		
		var io = {};
		window.openDialog('chrome://trellis/content/attachLink.xhtml',
			'trellis-attach-uri-dialog', 'centerscreen, modal', io);
		if (!io.out) return;
		let item = await Trellis.Attachments.linkFromURL({
			url: io.out.link,
			parentItemID: itemID,
			title: io.out.title
		});
		await this.selectItem(item.id);
	};
	
	/**
	 * @param {Boolean} [link]
	 * @param {Number} [parentItemID]
	 * @param {String[]} [files] Used instead of showing a file picker - for tests
	 * @returns {Promise<Trellis.Item[] | null>}
	 */
	this.addAttachmentFromDialog = async function (link, parentItemID, files = null) {
		var libraryID;
		if (Trellis_Tabs.selectedType === 'library') {
			// Shouldn't be reachable with multiple libraries selected (toolbar is disabled),
			// but just in case
			let rows = this.getCollectionTreeRows();
			if (new Set(rows.map(r => r.ref.libraryID)).size > 1) {
				return null;
			}
			let collectionTreeRow = rows[0];
			if (link && collectionTreeRow.isPublications()) {
				Trellis.alert(
					null,
					Trellis.getString('general.error'),
					Trellis.getString('publications.error.linkedFilesCannotBeAdded')
				);
				return null;
			}
			libraryID = collectionTreeRow.ref.libraryID;
		}
		else {
			libraryID = Trellis.Items.get(parentItemID).libraryID;
		}
		
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return null;
		}
		// TODO: disable in menu
		if (!this.canEditFiles()) {
			this.displayCannotEditLibraryFilesMessage();
			return null;
		}
		if (link && Trellis.Libraries.get(libraryID).isGroup) {
			Trellis.alert(null, "", "Linked files cannot be added to group libraries.");
			return null;
		}
		
		if (!files) {
			var fp = new FilePicker();
			fp.init(window, Trellis.getString('pane.item.attachments.select'), fp.modeOpenMultiple);
			fp.appendFilters(fp.filterAll);

			if ((await fp.show()) != fp.returnOK) {
				return null;
			}

			files = fp.files;
		}
		var addedItems = [];
		var notifierQueue = new Trellis.Notifier.Queue();
		var collections;
		var fileBaseName;

		try {
			if (parentItemID) {
				// If only one item is being added, automatic renaming is enabled, and the parent item
				// doesn't have any other non-HTML file attachments, rename the file.
				// This should be kept in sync with itemTreeView::drop().
				if (files.length == 1 && Trellis.Attachments.shouldAutoRenameFile(link, libraryID)) {
					let parentItem = Trellis.Items.get(parentItemID);
					if (!parentItem.numNonHTMLFileAttachments()) {
						fileBaseName = await Trellis.Attachments.getRenamedFileBaseNameIfAllowedType(
							parentItem, files[0]
						);
					}
				}
			}
			// If not adding to an item, add to all selected collections
			else {
				collections = this.getSelectedCollections(true);
			}

			// If we have more than one file, we only want to call setAutoAttachmentTitle()
			// at the end, once the attachments know whether they have siblings
			let delaySetAutoAttachmentTitle = files.length > 1;

			for (let file of files) {
				let item;

				if (link) {
					// Rename linked file, with unique suffix if necessary
					try {
						if (fileBaseName) {
							let ext = Trellis.File.getExtension(file);
							let newName = await Trellis.File.rename(
								file,
								fileBaseName + (ext ? '.' + ext : ''),
								{
									unique: true
								}
							);
							// Update path in case the name was changed to be unique
							file = PathUtils.join(PathUtils.parent(file), newName);
						}
					}
					catch (e) {
						Trellis.logError(e);
					}

					item = await Trellis.Attachments.linkFromFile({
						file,
						title: delaySetAutoAttachmentTitle ? '' : undefined,
						parentItemID,
						collections: collections && collections.length ? collections : undefined,
						saveOptions: {
							notifierQueue
						},
					});
				}
				else {
					if (file.endsWith(".lnk")) {
						let win = Services.wm.getMostRecentWindow("navigator:browser");
						win.TrellisPane.displayCannotAddShortcutMessage(file);
						continue;
					}

					item = await Trellis.Attachments.importFromFile({
						file,
						libraryID,
						fileBaseName,
						title: delaySetAutoAttachmentTitle ? '' : undefined,
						parentItemID,
						collections: collections && collections.length ? collections : undefined,
						saveOptions: {
							notifierQueue
						},
					});
				}

				addedItems.push(item);
			}

			if (delaySetAutoAttachmentTitle) {
				for (let item of addedItems) {
					item.setAutoAttachmentTitle();
					await item.saveTx({ notifierQueue });
				}
			}
		}
		finally {
			await Trellis.Notifier.commit(notifierQueue);
		}
		
		// Select added child attachments
		if (parentItemID && addedItems.length) {
			await this.selectItems(addedItems.map(item => item.id));
		}
		// Automatically retrieve metadata for top-level PDFs
		if (!parentItemID) {
			Trellis.RecognizeDocument.autoRecognizeItems(addedItems);
		}
		
		return addedItems;
	};
	
	
	this.findFilesForSelectedItems = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		await Trellis.Attachments.addAvailableFiles(this.getSelectedItems());
	};
	
	
	/**
	 * Shows progress dialog for a webpage/snapshot save request
	 */
	function _showPageSaveStatus(title) {
		var progressWin = new Trellis.ProgressWindow();
		progressWin.changeHeadline(Trellis.getString('ingester.scraping'));
		var icon = 'chrome://trellis/skin/treeitem-webpage.png';
		progressWin.addLines(title, icon)
		progressWin.show();
		progressWin.startCloseTimer();
	}
	
	/**
	 * @param	{Document}			doc
	 * @param	{String|Integer}	[itemType='webpage']	Item type id or name
	 * @param	{Boolean}			[saveSnapshot]			Force saving or non-saving of a snapshot,
	 *														regardless of automaticSnapshots pref
	 * @return {Promise<Trellis.Item>|false}
	 */
	this.addItemFromDocument = async function (doc, itemType, saveSnapshot, row) {
		_showPageSaveStatus(doc.title);
		
		// Save snapshot if explicitly enabled or automatically pref is set and not explicitly disabled
		saveSnapshot = saveSnapshot || (saveSnapshot !== false && Trellis.Prefs.get('automaticSnapshots'));
		
		// Save web page item by default
		if (!itemType) {
			itemType = 'webpage';
		}
		var data = {
			title: doc.title,
			url: doc.location.href,
			accessDate: "CURRENT_TIMESTAMP"
		}
		itemType = Trellis.ItemTypes.getID(itemType);
		var item = await this.newItem(itemType, data, row);
		var filesEditable = Trellis.Libraries.get(item.libraryID).filesEditable;
		
		if (saveSnapshot) {
			var link = false;
			
			if (link) {
				await Trellis.Attachments.linkFromDocument({
					document: doc,
					parentItemID: item.id
				});
			}
			else if (filesEditable) {
				await Trellis.Attachments.importFromDocument({
					document: doc,
					parentItemID: item.id
				});
			}
		}
		
		return item;
	};
	
	
	/**
	 * @return {Trellis.Item|false} - The saved item, or false if item can't be saved
	 */
	this.addItemFromURL = async function (url, itemType, saveSnapshot, row) {
		url = Trellis.Utilities.Internal.resolveIntermediateURL(url);
		
		let [mimeType, hasNativeHandler] = await Trellis.MIME.getMIMETypeFromURL(url);
		
		// If native type, save using a hidden browser
		if (hasNativeHandler) {
			var deferred = Trellis.Promise.defer();
			
			var processor = function (doc) {
				return TrellisPane_Local.addItemFromDocument(doc, itemType, saveSnapshot, row)
				.then(function (item) {
					deferred.resolve(item)
				});
			};
			try {
				await Trellis.HTTP.processDocuments([url], processor);
			} catch (e) {
				Trellis.debug(e, 1);
				deferred.reject(e);
			}
			
			return deferred.promise;
		}
		// Otherwise create placeholder item, attach attachment, and update from that
		else {
			if (!itemType) {
				itemType = 'webpage';
			}
			
			var item = await TrellisPane_Local.newItem(itemType, {}, row)
			var filesEditable = Trellis.Libraries.get(item.libraryID).filesEditable;
			
			// Save snapshot if explicitly enabled or automatically pref is set and not explicitly disabled
			if (saveSnapshot || (saveSnapshot !== false && Trellis.Prefs.get('automaticSnapshots'))) {
				var link = false;
				
				if (link) {
					//Trellis.Attachments.linkFromURL(doc, item.id);
				}
				else if (filesEditable) {
					var attachmentItem = await Trellis.Attachments.importFromURL({
						url,
						parentItemID: item.id,
						contentType: mimeType
					});
					if (attachmentItem) {
						item.setField('title', attachmentItem.getField('title'));
						item.setField('url', attachmentItem.getField('url'));
						item.setField('accessDate', attachmentItem.getField('accessDate'));
						await item.saveTx();
					}
				}
			}
			
			return item;
		}
	};
	
	
	this.viewItems = async function (items, event, options = {}) {
		let { noLocateOnMissing } = options;
		for (let i = 0; i < items.length; i++) {
			let item = items[i];
			if (item.isRegularItem()) {
				// Prefer local file attachments
				let attachment = await item.getBestAttachment();
				if (attachment) {
					await this.viewAttachment(attachment.id, event, noLocateOnMissing, options);
					continue;
				}
				
				// Fall back to URI field, then DOI
				var uri = item.getField('url');
				if (!uri) {
					var doi = item.getField('DOI');
					if (doi) {
						// Pull out DOI, in case there's a prefix
						doi = Trellis.Utilities.cleanDOI(doi);
						if (doi) {
							uri = "https://doi.org/" + encodeURIComponent(doi);
						}
					}
				}
				
				// Fall back to first attachment link
				if (!uri) {
					let attachmentID = item.getAttachments()[0];
					if (attachmentID) {
						let attachment = await Trellis.Items.getAsync(attachmentID);
						if (attachment) uri = attachment.getField('url');
					}
				}
				
				if (uri) {
					this.loadURI(uri, event);
				}
			}
			else if (item.isNote()) {
				if (!this.collectionsView.editable) {
					continue;
				}
				let openInWindow = event?.shiftKey || options.forceAlternateWindowBehavior;
				TrellisPane.openNote(item.id, { openInWindow });
			}
			else if (item.isAttachment()) {
				await this.viewAttachment(item.id, event, noLocateOnMissing, options);
			}
			else if (item.isAnnotation()) {
				this.viewAttachment(item.parentItemID, event, false,
					Object.assign(
						{ location: { annotationID: item.key } }, options
					));
			}
		}
	};
	
	
	this.viewAttachment = Trellis.serial(async function (itemIDs, event, noLocateOnMissing, extraData) {
		// If view isn't editable, don't show Locate button, since the updated
		// path couldn't be sent back up
		if (!this.collectionsView.editable) {
			noLocateOnMissing = true;
		}
		
		if(typeof itemIDs != "object") itemIDs = [itemIDs];
		
		var launchFile = async (path, item) => {
			let contentType = item.attachmentContentType;
			// Fix blank/incorrect EPUB and PDF content types
			let sniffType = async () => {
				let path = await item.getFilePathAsync();
				return Trellis.MIME.sniffForMIMEType(await Trellis.File.getSample(path));
			};
			if (!contentType || contentType === 'application/octet-stream') {
				let sniffedType = await sniffType();
				if (sniffedType === 'application/pdf' || sniffedType === 'application/epub+zip') {
					contentType = sniffedType;
				}
			}
			else if (contentType === 'application/epub' && (await sniffType()) === 'application/epub+zip') {
				contentType = 'application/epub+zip';
			}
			if (item.attachmentContentType !== contentType) {
				item.attachmentContentType = contentType;
				await item.saveTx();
			}

			let openInWindow = Trellis.Prefs.get('openReaderInNewWindow');
			let useAlternateWindowBehavior = event?.shiftKey || extraData?.forceAlternateWindowBehavior;
			if (useAlternateWindowBehavior) {
				openInWindow = !openInWindow;
			}
			await Trellis.FileHandlers.open(item, {
				location: extraData?.location,
				openInWindow,
			});
		};
		
		for (let i = 0; i < itemIDs.length; i++) {
			let itemID = itemIDs[i];
			let item = await Trellis.Items.getAsync(itemID);
			if (!item.isAttachment()) {
				throw new Error("Item " + itemID + " is not an attachment");
			}
			
			Trellis.debug("Viewing attachment " + item.libraryKey);
			
			if (item.attachmentLinkMode == Trellis.Attachments.LINK_MODE_LINKED_URL) {
				this.loadURI(item.getField('url'), event);
				continue;
			}
			
			let isLinkedFile = !item.isStoredFileAttachment();
			let path = item.getFilePath();
			if (!path) {
				TrellisPane_Local.showAttachmentNotFoundDialog(
					item,
					path,
					{
						noLocate: true,
						notOnServer: true,
						linkedFile: isLinkedFile
					}
				);
				return;
			}
			let fileExists;
			let pathIsValid;
			try {
				fileExists = await IOUtils.exists(path);
				pathIsValid = true;
			}
			catch (e) {
				Trellis.logError(e);
				fileExists = false;
				pathIsValid = false;
			}
			
			// If the file is an evicted iCloud Drive file, launch that to trigger a download.
			// As of 10.13.6, launching an .icloud file triggers the download and opens the
			// associated program (e.g., Preview) but won't actually open the file, so we wait a bit
			// for the original file to exist and then continue with regular file opening below.
			//
			// To trigger eviction for testing, use Cirrus from https://eclecticlight.co/downloads/
			if (!fileExists && pathIsValid && Trellis.isMac && isLinkedFile) {
				// Get the path to the .icloud file
				let iCloudPath = Trellis.File.getEvictedICloudPath(path);
				if (await IOUtils.exists(iCloudPath)) {
					Trellis.debug("Triggering download of iCloud file");
					await launchFile(iCloudPath, item);
					let time = new Date();
					let maxTime = 5000;
					let revealed = false;
					while (true) {
						// If too much time has elapsed, just reveal the file in Finder instead
						if (new Date() - time > maxTime) {
							Trellis.debug(`File not available after ${maxTime} -- revealing instead`);
							try {
								Trellis.File.reveal(iCloudPath);
								revealed = true;
							}
							catch (e) {
								Trellis.logError(e);
								// In case the main file became available
								try {
									Trellis.File.reveal(path);
									revealed = true;
								}
								catch (e) {
									Trellis.logError(e);
								}
							}
							break;
						}
						
						// Wait a bit for the download and check again
						await Trellis.Promise.delay(250);
						Trellis.debug("Checking for downloaded file");
						if (await IOUtils.exists(path)) {
							Trellis.debug("File is ready");
							fileExists = true;
							break;
						}
					}
					
					if (revealed) {
						continue;
					}
				}
			}
			
			let fileSyncingEnabled = Trellis.Sync.Storage.Local.getEnabledForLibrary(item.libraryID);
			let redownload = false;
			
			// TEMP: If file is queued for download, download first. Starting in 5.0.85, files
			// modified remotely get marked as SYNC_STATE_FORCE_DOWNLOAD, causing them to get
			// downloaded at sync time even in download-as-needed mode, but this causes files
			// modified previously to be downloaded on open.
			if (fileExists
					&& !isLinkedFile
					&& fileSyncingEnabled
					&& ([
							Trellis.Sync.Storage.Local.SYNC_STATE_TO_DOWNLOAD,
							Trellis.Sync.Storage.Local.SYNC_STATE_FORCE_DOWNLOAD
					].includes(item.attachmentSyncState))) {
				Trellis.debug("File exists but is queued for download -- re-downloading");
				redownload = true;
			}
			
			if (fileExists && !redownload) {
				Trellis.debug("Opening " + path);
				Trellis.Notifier.trigger('open', 'file', item.id);
				await launchFile(path, item);
				continue;
			}
			
			if (isLinkedFile || !fileSyncingEnabled) {
				this.showAttachmentNotFoundDialog(
					item,
					path,
					{
						noLocate: noLocateOnMissing,
						notOnServer: false,
						linkedFile: isLinkedFile
					}
				);
				return;
			}
			
			try {
				let results = await Trellis.Sync.Runner.downloadFile(item);
				if (!results || !results.localChanges) {
					Trellis.debug("Download failed -- opening existing file");
				}
			}
			catch (e) {
				// TODO: show error somewhere else
				Trellis.logError(e);
				Trellis.Sync.Runner.alert(e);
				return;
			}
			
			if (!(await item.getFilePathAsync())) {
				TrellisPane_Local.showAttachmentNotFoundDialog(
					item,
					path,
					{
						noLocate: noLocateOnMissing,
						notOnServer: true
					}
				);
				return;
			}
			
			Trellis.Notifier.trigger('redraw', 'item', []);
			
			Trellis.debug("Opening " + path);
			Trellis.Notifier.trigger('open', 'file', item.id);
			await launchFile(path, item);
		}
	});
	
	this.viewPDF = async function (itemID, location) {
		await this.viewAttachment(itemID, null, false, { location });
	};
	
	
	/**
	 * Update the parent of the selected items
	 *
	 * An accessible alternative to dragging/dropping a child item between top-level items
	*/
	this.changeParentItem = async function () {
		let selectedItems = this.getSelectedItems();
		// Only applies when selected items are not top level items
		if (selectedItems.some(item => item.isRegularItem())) return;

		let libraryID = this.getSelectedLibraryID();
		let shouldConvertToStandaloneAttachment = false;
		let extraButtons = [];
		// Keep in sync with Trellis.RecognizeDocument.canRecognize()
		let canBeMovedOutOfParent = !selectedItems.some(item => item.isWebAttachment() && !item.isPDFAttachment() && !item.isEPUBAttachment());
		// Add a button to the dialog to make items standalone, if applicable
		if (canBeMovedOutOfParent) {
			// Determine which label to show. "Convert to standalone attachment(s)/note(s)"
			let allNotes = selectedItems.every(item => item.isNote());
			let allAttachments = selectedItems.every(item => item.isAttachment());
			let l10nId = `select-items-convertToStandalone${allNotes ? "Note" : ""}${allAttachments ? "Attachment" : ""}`;
			extraButtons = [{
				type: "extra1",
				l10nLabel: l10nId,
				l10nArgs: { count: selectedItems.length },
				onclick: function (event) {
					shouldConvertToStandaloneAttachment = true;
					let doc = event.target.ownerDocument;
					// if accept button is disabled, dialog cannot be accepted
					doc.querySelector("dialog button[dlgtype='accept']").removeAttribute("disabled");
					doc.querySelector("dialog").acceptDialog();
				},
				isHidden: function () {
					return selectedItems.every(item => !item.parentID);
				}
			}];
		}
		let io = {
			dataIn: null,
			dataOut: null,
			itemTreeID: 'change-parent-item-select-item-dialog',
			filterLibraryIDs: [libraryID],
			singleSelection: true,
			onlyRegularItems: true,
			hideCollections: ['duplicates', 'trash', 'feeds', 'unfiled', 'retracted', 'publications'],
			extraButtons: extraButtons
		};
		// The new parent needs to be selected in the dialog
		window.openDialog('chrome://trellis/content/selectItemsDialog.xhtml', '',
			'chrome,dialog=no,modal,centerscreen,resizable=yes', io);

		// If "Convert to Standalone Attachment" is selected, make all attachments top-level items
		if (shouldConvertToStandaloneAttachment) {
			await Trellis.DB.executeTransaction(async () => {
				Trellis.UndoHistory.stageAction(
					'undo-action-convert-to-standalone',
					{ count: selectedItems.length }
				);

				for (let item of selectedItems) {
					let parent = Trellis.Items.get(item.parentID);
					if (parent) {
						// Place attachment into the same collections as the old parent item
						for (let collectionID of parent.getCollections()) {
							item.addToCollection(collectionID);
						}
					}
					// Unlink parent item
					item.parentID = null;
					await item.save({ skipSelect: true });
				}
			});
			return;
		}
		if (!io.dataOut?.length) return;

		let newParentItem = Trellis.Items.get(io.dataOut);
		
		if (!newParentItem.length) return;

		await Trellis.DB.executeTransaction(async () => {
			Trellis.UndoHistory.stageAction(
				'undo-action-change-parent-item',
				{ count: selectedItems.length }
			);

			for (let item of selectedItems) {
				item.parentID = newParentItem[0].id;
				await item.save({ skipSelect: true });
			}
		});
	};
	/**
	 * @deprecated
	 */
	this.launchFile = function (file) {
		Trellis.debug("TrellisPane.launchFile() is deprecated -- use Trellis.launchFile()", 2);
		Trellis.launchFile(file);
	}
	
	
	/**
	 * @deprecated
	 */
	this.launchURL = function (url) {
		Trellis.debug("TrellisPane.launchURL() is deprecated -- use Trellis.launchURL()", 2);
		return Trellis.launchURL(url);
	}
	
	
	this.showInLibrary = function () {
		switch (Trellis_Tabs.selectedType) {
			case 'reader': {
				let reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
				if (reader) {
					let item = Trellis.Items.get(reader.itemID);
					let itemID = item.parentID || item.id;
					return TrellisPane.selectItems([itemID]);
				}
				return;
			}
			case 'note': {
				let tab = Trellis_Tabs.getTabInfo(Trellis_Tabs.selectedID);
				if (tab.data.itemID) {
					return TrellisPane.selectItems([tab.data.itemID]);
				}
				return;
			}
			default:
				return;
		}
	};
	
	
	function viewSelectedAttachment(event, noLocateOnMissing)
	{
		if (this.itemsView && this.itemsView.selection.count == 1) {
			this.viewAttachment(this.getSelectedItems(true)[0], event, noLocateOnMissing);
		}
	}
	
	
	this.canShowItemInFilesystem = function (item) {
		return (item.isRegularItem() && item.numFileAttachments()) || item.isFileAttachment();
	};
	
	
	this.showItemsInFilesystem = async function (items = this.getSelectedItems()) {
		let attachments = (await Promise.all(
			items.map((item) => {
				if (item.isRegularItem()) {
					return item.getBestAttachment();
				}
				else if (item.isFileAttachment()) {
					return item;
				}
				else {
					return null;
				}
			})
		)).filter(Boolean);
		for (let attachment of attachments) {
			await this.showAttachmentInFilesystem(attachment.id);
		}
	};
	
	
	this.showAttachmentInFilesystem = async function (itemID, noLocateOnMissing) {
		var attachment = await Trellis.Items.getAsync(itemID)
		if (attachment.attachmentLinkMode == Trellis.Attachments.LINK_MODE_LINKED_URL) return;
		
		var path = attachment.getFilePath();
		
		let fileExists;
		let pathIsValid;
		try {
			fileExists = await IOUtils.exists(path);
			pathIsValid = true;
		}
		catch (e) {
			Trellis.logError(e);
			fileExists = false;
			pathIsValid = false;
		}
		
		// If file doesn't exist but an evicted iCloud Drive file does, reveal that instead
		if (!fileExists && pathIsValid && Trellis.isMac && !attachment.isStoredFileAttachment()) {
			let iCloudPath = Trellis.File.getEvictedICloudPath(path);
			if (await IOUtils.exists(iCloudPath)) {
				path = iCloudPath;
				fileExists = true;
			}
		}
		
		if (!fileExists) {
			this.showAttachmentNotFoundDialog(
				attachment,
				path,
				{
					noLocate: noLocateOnMissing,
					notOnServer: false,
					linkedFile: attachment.isLinkedFileAttachment()
				}
			);
			return;
		}
		
		let file = Trellis.File.pathToFile(path);
		try {
			Trellis.debug("Revealing " + file.path);
			file.reveal();
		}
		catch (e) {
			// On platforms that don't support nsIFile.reveal() (e.g. Linux),
			// launch the parent directory
			Trellis.launchFile(file.parent);
		}
		Trellis.Notifier.trigger('open', 'file', attachment.id);
	};
	
	
	this.showPublicationsWizard = function (items) {
		var io = {
			hasFiles: false,
			hasNotes: false,
			hasRights: null // 'all', 'some', or 'none'
		};
		var allItemsHaveRights = true;
		var noItemsHaveRights = true;
		// Determine whether any/all items have files, notes, or Rights values
		for (let i = 0; i < items.length; i++) {
			let item = items[i];
			
			// Files
			if (!io.hasFiles && item.numAttachments()) {
				let attachmentIDs = item.getAttachments();
				io.hasFiles = Trellis.Items.get(attachmentIDs).some(
					attachment => attachment.isStoredFileAttachment()
				);
			}
			// Notes
			if (!io.hasNotes && item.numNotes()) {
				io.hasNotes = true;
			}
			// Rights
			if (item.getField('rights')) {
				noItemsHaveRights = false;
			}
			else {
				allItemsHaveRights = false;
			}
		}
		io.hasRights = allItemsHaveRights ? 'all' : (noItemsHaveRights ? 'none' : 'some');
		window.openDialog('chrome://trellis/content/publicationsDialog.xhtml', '', 'chrome,modal,centerscreen', io);
		return io.keepRights !== undefined ? io : false;
	};
	
	
	/**
	 * Test if the user can edit the currently selected view
	 *
	 * @param {Integer} [row] Row index - ignored if not in library tab
	 * @return {Boolean} TRUE if user can edit, FALSE if not
	 */
	this.canEdit = function (row) {
		switch (Trellis_Tabs.selectedType) {
			case 'library':
			{
				// Currently selected row
				if (row === undefined) {
					row = this.collectionsView.selection.focused;
				}
				return this.collectionsView.getRow(row).editable;
			}
			default:
			{
				let tabInfo = Trellis_Tabs.getTabInfo();
				let item = Trellis.Items.get(tabInfo.data?.itemID);
				if (item) {
					return item.isEditable();
				}
				return false;
			}
		}
	};
	
	
	/**
	 * Test if the user can edit the parent library of the selected view
	 *
	 * @param {Integer} [row] Row index - ignored if not in library tab
	 * @return {Boolean} TRUE if user can edit, FALSE if not
	 */
	this.canEditLibrary = function (row) {
		switch (Trellis_Tabs.selectedType) {
			case 'library': // Currently selected row
				if (row === undefined) {
					row = this.collectionsView.selection.focused;
				}
				return Trellis.Libraries.get(this.collectionsView.getRow(row).ref.libraryID).editable;
			default:
				// All non-library tabs: canEditLibrary() == canEdit()
				return this.canEdit(row);
		}
	};
	
	
	/**
	 * Test if the user can edit the currently selected library/collection
	 *
	 * @param	{Integer}	[row]
	 *
	 * @return	{Boolean}		TRUE if user can edit, FALSE if not
	 */
	this.canEditFiles = function (row) {
		switch (Trellis_Tabs.selectedType) {
			case 'library':
				// Currently selected row
				if (row === undefined) {
					row = this.collectionsView.selection.focused;
				}
				return this.collectionsView.getRow(row).filesEditable;
			case 'reader': {
				let itemID = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID)?.itemID;
				if (!itemID) {
					throw new Error('Reader tab has no itemID');
				}
				return Trellis.Items.get(itemID).library.filesEditable;
			}
			default:
				return false;
		}
	};
	
	
	this.displayCannotEditLibraryMessage = function () {
		Services.prompt.alert(null, "", Trellis.getString('save.error.cannotMakeChangesToCollection'));
	}
	
	
	this.displayCannotEditLibraryFilesMessage = function () {
		Services.prompt.alert(null, "", Trellis.getString('save.error.cannotAddFilesToCollection'));
	}
	
	
	this.displayCannotAddToMyPublicationsMessage = function () {
		Services.prompt.alert(null, "", Trellis.getString('save.error.cannotAddToMyPublications'));
	}
	
	
	// TODO: Figure out a functioning way to get the original path and just copy the real file
	this.displayCannotAddShortcutMessage = function (path) {
		Trellis.alert(
			null,
			Trellis.getString("general.error"),
			Trellis.getString("file.error.cannotAddShortcut") + (path ? "\n\n" + path : "")
		);
	}
	
	
	this.showAttachmentNotFoundDialog = async function (item, path, options = {}) {
		var { noLocate, notOnServer, linkedFile } = options;

		if (item.isLinkedFileAttachment() && (await this.checkForLinkedFilesToRelink(item))) {
			return;
		}

		var title = Trellis.getString('pane.item.attachments.fileNotFound.title');
		var text = Trellis.getString(
				'pane.item.attachments.fileNotFound.text1' + (path ? '.path' : '')
			)
			+ (path ? "\n\n" + path : '')
			+ "\n\n"
			+ Trellis.getString(
				'pane.item.attachments.fileNotFound.text2.'
					+ (options.linkedFile
						? 'linked'
						: 'stored' + (notOnServer ? '.notOnServer' : '')
					),
				[TRELLIS_CONFIG.CLIENT_NAME, TRELLIS_CONFIG.DOMAIN_NAME]
			);
		var supportURL = linkedFile
			? 'https://www.trellis.org/support/kb/missing_linked_file'
			: 'https://www.trellis.org/support/kb/files_not_syncing';
		
		var ps = Services.prompt;
		
		// Don't show Locate button
		if (noLocate) {
			let buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_OK
				+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING;
			let index = ps.confirmEx(null,
				title,
				text,
				buttonFlags,
				null,
				Trellis.getString('general.moreInformation'),
				null, null, {}
			);
			if (index == 1) {
				this.loadURI(supportURL, { metaKey: true, shiftKey: true });
			}
			return;
		}
		
		var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL
			+ ps.BUTTON_POS_2 * ps.BUTTON_TITLE_IS_STRING;
		var index = ps.confirmEx(null,
			title,
			text,
			buttonFlags,
			Trellis.getString('general.locate'),
			null,
			Trellis.getString('general.moreInformation')
			, null, {}
		);
		
		if (index == 0) {
			this.relinkAttachment(item.id);
		}
		else if (index == 2) {
			this.loadURI(supportURL, { metaKey: true, shiftKey: true });
		}
	}


	/**
	 * Prompt the user to relink one or all of the attachment files found in
	 * the LABD.
	 *
	 * @param {Trellis.Item} item
	 * @param {String} path Path to the file matching `item`
	 * @param {Number} numOthers If zero, "Relink All" option is not offered
	 * @return {'one' | 'all' | 'manual' | 'cancel'}
	 */
	this.showLinkedFileFoundAutomaticallyDialog = function (item, path, numOthers) {
		let ps = Services.prompt;

		let title = Trellis.getString('pane.item.attachments.autoRelink.title');
		let text = Trellis.getString('pane.item.attachments.autoRelink.text1') + '\n\n'
			+ Trellis.getString('pane.item.attachments.autoRelink.text2', item.getFilePath()) + '\n\n'
			+ Trellis.getString('pane.item.attachments.autoRelink.text3', path) + '\n\n'
			+ Trellis.getString('pane.item.attachments.autoRelink.text4', Trellis.appName);
		let buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL
			+ ps.BUTTON_POS_2 * ps.BUTTON_TITLE_IS_STRING;
		let index = ps.confirmEx(null,
			title,
			text,
			buttonFlags,
			Trellis.getString('pane.item.attachments.autoRelink.relink'),
			null,
			Trellis.getString('pane.item.attachments.autoRelink.locateManually'),
			null, {}
		);
		
		if (index == 1) {
			// Cancel
			return 'cancel';
		}
		else if (index == 2) {
			// Locate Manually...
			return 'manual';
		}
		
		// Relink
		if (!numOthers) {
			return 'one';
		}

		title = Trellis.getString('pane.item.attachments.autoRelinkOthers.title');
		text = Trellis.getString('pane.item.attachments.autoRelinkOthers.text', numOthers, numOthers);
		buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL;
		index = ps.confirmEx(null,
			title,
			text,
			buttonFlags,
			Trellis.getString(
				numOthers == 1
					? 'pane.item.attachments.autoRelink.relink'
					: 'pane.item.attachments.autoRelink.relinkAll'
			),
			null, null, null, {}
		);
		
		return index == 0 ? 'all' : 'one';
	};
	
	
	this.recognizeSelected = function () {
		Trellis.RecognizeDocument.recognizeItems(TrellisPane.getSelectedItems());
		Trellis.ProgressQueues.get('recognize').getDialog().open();
	};
	
	
	this.unrecognizeSelected = async function () {
		var items = TrellisPane.getSelectedItems();
		for (let item of items) {
			await Trellis.RecognizeDocument.unrecognize(item);
		}
	};
	
	
	this.createParentItemsFromSelected = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		
		let items = this.getSelectedItems();

		if (items.length > 1) {
			for (let i = 0; i < items.length; i++) {
				let item = items[i];
				if (!item.isTopLevelItem() || item.isRegularItem()) {
					throw new Error('Item ' + item.id + ' is not a top-level attachment');
				}

				await this.createEmptyParent(item);
			}
		}
		else {
			// Ask for an identifier if there is only one item
			let item = items[0];
			if (!item.isAttachment() || !item.isTopLevelItem()) {
				throw new Error('Item ' + item.id + ' is not a top-level attachment');
			}

			let io = { dataIn: { item }, dataOut: null };
			window.openDialog('chrome://trellis/content/createParentDialog.xhtml', '', 'chrome,modal,centerscreen', io);
			if (!io.dataOut) {
				return false;
			}

			// If we made a parent, attach the child
			if (io.dataOut.parent) {
				await Trellis.DB.executeTransaction(async function () {
					item.parentID = io.dataOut.parent.id;
					await item.save();
				});
			}
			// If they clicked manual entry then make a dummy parent
			else {
				await this.createEmptyParent(item);
			}
		}

		for (let item of items) {
			if (Trellis.Attachments.shouldAutoRenameAttachment(item)) {
				let path = item.getFilePath();
				if (!path) {
					Trellis.debug('No path for attachment ' + item.key);
					continue;
				}
				let fileBaseName = Trellis.Attachments.getFileBaseNameFromItem(item.parentItem, { attachmentTitle: item.getField('title') });
				let ext = Trellis.Attachments.getCorrectFileExtension(item);
				let newName = fileBaseName + (ext ? '.' + ext : '');
				let result = await item.renameAttachmentFile(newName, { overwrite: false, unique: true });
				if (result !== true) {
					throw new Error('Error renaming ' + path);
				}
				item.setAutoAttachmentTitle();
				await item.saveTx();
			}
		}
	};
	
	
	this.addNoteFromAnnotationsForAttachment = async function (attachment, { skipSelect } = {}) {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		if (attachment.isPDFAttachment()) {
			await Trellis.PDFWorker.import(attachment.id, true);
		}
		var annotations = attachment.getAnnotations().filter(x => x.annotationType != 'ink');
		if (!annotations.length) {
			return;
		}
		var note = await Trellis.EditorInstance.createNoteFromAnnotations(
			annotations,
			{
				parentID: attachment.parentID
			}
		);
		if (!skipSelect) {
			await this.selectItem(note.id);
		}
		return note;
	};
	
	
	/**
	 * Add a single child note with the annotations from all selected items, including from all
	 * child attachments of a selected regular item
	 *
	 * Selected items must all have the same top-level item
	 */
	this.addNoteFromAnnotationsFromSelected = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		var items = this.getSelectedItems();
		var topLevelItems = [...new Set(Trellis.Items.getTopLevel(items))];
		if (topLevelItems.length > 1) {
			throw new Error("Can't create child attachment from different top-level items");
		}
		var topLevelItem = topLevelItems[0];
		if (!topLevelItem.isRegularItem()) {
			throw new Error("Can't add note to standalone attachment");
		}
		
		// Ignore top-level item if specific child items are also selected
		if (items.length > 1) {
			items = items.filter(item => !item.isRegularItem());
		}
		
		var attachments = [];
		var annotations = [];
		for (let item of items) {
			if (item.isRegularItem()) {
				// Find all child items with extractable annotations
				attachments.push(
					...Trellis.Items.get(item.getAttachments())
						.filter(item => isAttachmentWithExtractableAnnotations(item))
				);
			}
			else if (isAttachmentWithExtractableAnnotations(item)) {
				attachments.push(item);
			}
			else if (item.isAnnotation() && item.annotationType != 'ink') {
				annotations.push(item);
			}
			else {
				continue;
			}
		}
		
		if (!attachments.length && !annotations.length) {
			Trellis.debug("No attachments found", 2);
			return;
		}
		
		for (let attachment of attachments) {
			if (attachment.isPDFAttachment()) {
				try {
					await Trellis.PDFWorker.import(attachment.id, true);
				}
				catch (e) {
					Trellis.logError(e);
				}
			}
			annotations.push(...attachment.getAnnotations().filter(x => x.annotationType != 'ink'));
		}
		var note = await Trellis.EditorInstance.createNoteFromAnnotations(
			annotations,
			{
				parentID: topLevelItem.id
			}
		);
		await this.selectItem(note.id);
	};
	
	
	/**
	 * Create separate child notes for each selected item, including all child attachments of
	 * selected regular items
	 *
	 * No longer exposed via UI
	 */
	this.addNotesFromAnnotationsFromSelected = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		var items = this.getSelectedItems();
		var itemIDsToSelect = [];
		for (let item of items) {
			let attachments = [];
			if (item.isRegularItem()) {
				// Find all child attachments with extractable annotations
				attachments.push(
					...Trellis.Items.get(item.getAttachments())
						.filter(item => isAttachmentWithExtractableAnnotations(item))
				);
			}
			else if (item.isFileAttachment() && !item.isTopLevelItem()) {
				attachments.push(item);
			}
			else if (items.length == 1) {
				throw new Error("Not a regular item or child file attachment");
			}
			else {
				continue;
			}
			for (let attachment of attachments) {
				let note = await this.addNoteFromAnnotationsForAttachment(
					attachment,
					{ skipSelect: true }
				);
				if (note) {
					itemIDsToSelect.push(note.id);
				}
			}
		}
		await this.selectItems(itemIDsToSelect);
	};
	
	
	this.createStandaloneNoteFromAnnotationsFromSelected = async function () {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		var items = this.getSelectedItems();
		
		// Ignore selected top-level items if any descendant items are also selected
		var topLevelOfSelectedDescendants = new Set();
		for (let item of items) {
			if (!item.isTopLevelItem()) {
				topLevelOfSelectedDescendants.add(item.topLevelItem);
			}
		}
		items = items.filter(item => !topLevelOfSelectedDescendants.has(item));
		
		var annotations = [];
		for (let item of items) {
			let attachments = [];
			if (item.isRegularItem()) {
				// Find all child attachments with extractable annotations
				attachments.push(
					...Trellis.Items.get(item.getAttachments())
						.filter(item => isAttachmentWithExtractableAnnotations(item))
				);
			}
			else if (isAttachmentWithExtractableAnnotations(item)) {
				attachments.push(item);
			}
			else if (item.isAnnotation()) {
				annotations.push(item);
			}
			else {
				continue;
			}
			for (let attachment of attachments) {
				if (attachment.isPDFAttachment()) {
					try {
						await Trellis.PDFWorker.import(attachment.id, true);
					}
					catch (e) {
						Trellis.logError(e);
					}
				}
				annotations.push(...attachment.getAnnotations().filter(x => x.annotationType != 'ink'));
			}
		}
		
		if (!annotations.length) {
			Trellis.debug("No annotations found", 2);
			return;
		}
		
		var note = await Trellis.EditorInstance.createNoteFromAnnotations(
			annotations,
			{
				collectionID: this.getSelectedCollection(true)
			}
		);
		await this.selectItem(note.id);
	};
	
	
	this.createEmptyParent = async function (item) {
		await Trellis.DB.executeTransaction(async function () {
			// TODO: remove once there are no top-level web attachments
			if (item.isWebAttachment()) {
				var parent = new Trellis.Item('webpage');
			}
			else {
				var parent = new Trellis.Item('document');
			}
			parent.libraryID = item.libraryID;
			
			let title = item.getField('title');
			// If the attachment was named after its filename, remove the extension
			if (title === item.attachmentFilename) {
				title = title.replace(/\.[^.]+$/, '');
			}
			parent.setField('title', title);
			
			if (item.isWebAttachment()) {
				parent.setField('accessDate', item.getField('accessDate'));
				parent.setField('url', item.getField('url'));
			}
			
			let itemID = await parent.save();
			item.parentID = itemID;
			await item.save();
		});
	};
	
	
	this.exportPDF = async function (itemID) {
		let item = await Trellis.Items.getAsync(itemID);
		if (!item || !item.isPDFAttachment()) {
			throw new Error('Item ' + itemID + ' is not a PDF attachment');
		}
		let filename = item.attachmentFilename;
		
		var fp = new FilePicker();
		// TODO: Localize
		fp.init(window, "Export File", fp.modeSave);
		fp.appendFilter("PDF", "*.pdf");
		fp.defaultString = filename;
		
		var rv = await fp.show();
		if (rv === fp.returnOK || rv === fp.returnReplace) {
			let outputFile = fp.file;
			await Trellis.PDFWorker.export(item.id, outputFile, true);
		}
	};
	
	
	// TEMP: Quick implementation
	this.exportSelectedFiles = async function () {
		var items = TrellisPane.getSelectedItems()
			.reduce((arr, item) => {
				if (item.isPDFAttachment()) {
					return arr.concat([item]);
				}
				if (item.isRegularItem()) {
					return arr.concat(item.getAttachments()
						.map(x => Trellis.Items.get(x))
						.filter(x => x.isPDFAttachment()));
				}
				return arr;
			}, []);
		// Deduplicate, in case parent and child items are both selected
		items = [...new Set(items)];
		
		if (!items.length) return;
		if (items.length == 1) {
			await this.exportPDF(items[0].id);
			return;
		}
		
		var fp = new FilePicker();
		// TODO: Localize
		fp.init(window, "Export Files", fp.modeGetFolder);
		
		var rv = await fp.show();
		if (rv === fp.returnOK || rv === fp.returnReplace) {
			let folder = fp.file;
			for (let item of items) {
				let outputFile = PathUtils.join(folder, item.attachmentFilename);
				if (await IOUtils.exists(outputFile)) {
					let newNSIFile = Trellis.File.pathToFile(outputFile);
					newNSIFile.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0o644);
					outputFile = newNSIFile.path;
					newNSIFile.remove(null);
				}
				await Trellis.PDFWorker.export(item.id, outputFile, true);
			}
		}
	};
	
	this.convertLinkedFilesToStoredFiles = async function () {
		if (!this.canEdit() || !this.canEditFiles()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		
		var items = this.getSelectedItems();
		var attachments = new Set();
		for (let item of items) {
			// Add all child link attachments of regular items
			if (item.isRegularItem()) {
				for (let id of item.getAttachments()) {
					let attachment = await Trellis.Items.getAsync(id);
					if (attachment.isLinkedFileAttachment()) {
						attachments.add(attachment);
					}
				}
			}
			// And all selected link attachments
			else if (item.isLinkedFileAttachment()) {
				attachments.add(item);
			}
		}
		var num = attachments.size;
		
		var ps = Services.prompt;
		var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL;
		var deleteOriginal = {};
		var index = ps.confirmEx(null,
			Trellis.getString('attachment.convertToStored.title', [num], num),
			Trellis.getString('attachment.convertToStored.text', [num], num),
			buttonFlags,
			Trellis.getString('general.continue'),
			null,
			null,
			Trellis.getString('attachment.convertToStored.deleteOriginal', [num], num),
			deleteOriginal
		);
		if (index != 0) {
			return;
		}
		for (let item of attachments) {
			try {
				let converted = await Trellis.Attachments.convertLinkedFileToStoredFile(
					item,
					{
						move: deleteOriginal.value
					}
				);
				if (!converted) {
					// Not found
					continue;
				}
			}
			catch (e) {
				Trellis.logError(e);
				continue;
			}
		}
	};


	/**
	 * Attempt to find a file in the LABD matching the passed attachment
	 * by searching successive subdirectories. Prompt the user if a match is
	 * found and offer to relink one or all matching files in the directory.
	 * The user can also choose to relink manually, which opens a file picker.
	 *
	 * If the synced path is 'C:\Users\user\Documents\Dissertation\Files\Paper.pdf',
	 * the LABD is '/Users/user/Documents', and the (not yet known) correct local
	 * path is '/Users/user/Documents/Dissertation/Files/Paper.pdf', check:
	 *
	 * 1. /Users/user/Documents/Users/user/Documents/Dissertation/Files/Paper.pdf
	 * 2. /Users/user/Documents/user/Documents/Dissertation/Files/Paper.pdf
	 * 3. /Users/user/Documents/Documents/Dissertation/Files/Paper.pdf
	 * 4. /Users/user/Documents/Dissertation/Files/Paper.pdf
	 *
	 * If line 4 had not been the correct local path (in other words, if no file
	 * existed at that path), we would have continued on to check
	 * '/Users/user/Documents/Dissertation/Paper.pdf'. If that did not match,
	 * with no more segments in the synced path to drop, we would have given up.
	 *
	 * Once we find the file, check for other linked files beginning with
	 * C:\Users\user\Documents\Dissertation\Files and see if they exist relative
	 * to /Users/user/Documents/Dissertation/Files, and prompt to relink them
	 * all if so.
	 *
	 * @param {Trellis.Item} item
	 * @return {Promise<Boolean>} True if relinked successfully or canceled
	 */
	this.checkForLinkedFilesToRelink = async function (item) {
		const PATH_SEP = Trellis.isWin ? '\\' : '/';
		
		// Split on any separator, join with the platform separator for PathUtils
		let split = path => path.split(/[/\\]/);
		let join = (base, ...segments) => [base.replace(/\//g, PATH_SEP), ...segments].join(PATH_SEP);
		
		Trellis.debug('Attempting to relink automatically');
		
		let basePath = Trellis.Prefs.get('baseAttachmentPath');
		if (!basePath) {
			Trellis.debug('No LABD');
			return false;
		}
		basePath = Trellis.File.normalizeToUnix(basePath);
		Trellis.debug('LABD path: ' + basePath);

		let syncedPath = item.getFilePath();
		if (!syncedPath) {
			Trellis.debug('No synced path');
			return false;
		}
		syncedPath = Trellis.File.normalizeToUnix(syncedPath);
		Trellis.debug('Synced path: ' + syncedPath);

		if (Trellis.File.directoryContains(basePath, syncedPath)) {
			// Already in the LABD - nothing to do
			Trellis.debug('Synced path is already within LABD');
			return false;
		}

		// We can't use PathUtils.parent because that function expects paths valid for the current platform...
		// but we can't normalize first because we're going to be comparing it to other un-normalized paths
		let unNormalizedDirname = item.getFilePath();
		let lastSlash = Math.max(
			unNormalizedDirname.lastIndexOf('/'),
			unNormalizedDirname.lastIndexOf('\\')
		);
		if (lastSlash != -1) {
			unNormalizedDirname = unNormalizedDirname.substring(0, lastSlash + 1);
		}

		let parts = split(syncedPath);
		for (let segmentsToDrop = 0; segmentsToDrop < parts.length; segmentsToDrop++) {
			let correctedPath = join(basePath, ...parts.slice(segmentsToDrop));

			try {
				if (!(await IOUtils.exists(correctedPath))) {
					Trellis.debug('Does not exist: ' + correctedPath);
					continue;
				}
			}
			catch (e) {
				// IOUtils.exists() throws if the path is invalid - suppress that
				if (e.message.includes('Could not parse path')) {
					Trellis.debug('Invalid path: ' + correctedPath);
					continue;
				}
				// Otherwise this could be a meaningful filesystem error, so re-throw
				throw e;
			}
			Trellis.debug('Exists! ' + correctedPath);

			let otherUnlinked = await Trellis.Items.findMissingLinkedFiles(
				item.libraryID,
				unNormalizedDirname
			);
			let othersToRelink = new Map();
			for (let otherItem of otherUnlinked) {
				if (otherItem.id === item.id) continue;
				let otherParts = split(otherItem.getFilePath())
					// Slice as much off the beginning as when creating correctedPath
					.slice(segmentsToDrop);
				if (!otherParts.length) continue;
				let otherCorrectedPath = join(basePath, ...otherParts);
				if (await IOUtils.exists(otherCorrectedPath)) {
					othersToRelink.set(otherItem, otherCorrectedPath);
				}
			}

			let choice = this.showLinkedFileFoundAutomaticallyDialog(item, correctedPath, othersToRelink.size);
			switch (choice) {
				case 'one':
					await item.relinkAttachmentFile(correctedPath);
					return true;
				case 'all':
					await item.relinkAttachmentFile(correctedPath);
					for (let [otherItem, otherCorrectedPath] of othersToRelink) {
						await otherItem.relinkAttachmentFile(otherCorrectedPath);
					}
					return true;
				case 'manual':
					await this.relinkAttachment(item.id);
					return true;
				case 'cancel':
					return true;
			}
		}
		
		Trellis.debug('No segments left to drop; match not found in LABD');
		return false;
	};
	
	
	this.relinkAttachment = async function (itemID) {
		if (!this.canEdit()) {
			this.displayCannotEditLibraryMessage();
			return;
		}
		
		var item = Trellis.Items.get(itemID);
		if (!item) {
			throw new Error('Item ' + itemID + ' not found in TrellisPane_Local.relinkAttachment()');
		}

		while (true) {
			let fp = new FilePicker();
			fp.init(window, Trellis.getString('pane.item.attachments.select'), fp.modeOpen);
			
			var file = item.getFilePath();
			if (!file) {
				Trellis.debug("Invalid path", 2);
				break;
			}
			
			var dir = await Trellis.File.getClosestDirectory(file);
			if (dir) {
				try {
					fp.displayDirectory = dir;
				}
				catch (e) {
					// Directory is invalid; ignore and go with the home directory
					fp.displayDirectory = OS.Constants.Path.homeDir;
				}
			}
			
			fp.appendFilters(fp.filterAll);
			
			if ((await fp.show()) == fp.returnOK) {
				let file = Trellis.File.pathToFile(fp.file);
				
				// Disallow hidden files
				// TODO: Display a message
				if (file.leafName.startsWith('.')) {
					continue;
				}
				
				// Disallow Windows shortcuts
				if (file.leafName.endsWith(".lnk")) {
					this.displayCannotAddShortcutMessage(file.path);
					continue;
				}
				
				await item.relinkAttachmentFile(file.path);
				break;
			}
			
			break;
		}
	};
	
	this.normalizeAttachmentTitles = async function () {
		let result = Trellis.Prompt.confirm({
			title: Trellis.getString('normalize-attachment-titles-title'),
			text: Trellis.getString('normalize-attachment-titles-text'),
			button0: Trellis.getString('general-continue'),
			button1: Trellis.Prompt.BUTTON_TITLE_CANCEL,
			button2: Trellis.getString('general.moreInformation'),
		});
		if (result == 1) {
			return;
		}
		if (result == 2) {
			Trellis.launchURL('https://www.trellis.org/support/kb/attachment_title_vs_filename');
			return;
		}
		let attachments = new Set(this.getSelectedItems().flatMap((item) => {
			if (item.isRegularItem()) {
				return Trellis.Items.get(item.getAttachments());
			}
			if (item.isAttachment()) {
				return [item];
			}
			return [];
		}));
		await Trellis.DB.executeTransaction(async () => {
			Trellis.UndoHistory.stageAction('undo-action-normalize-attachment-titles');
			for (let attachment of attachments) {
				if (attachment.getField('title').replace(/\.[^.]+$/, '') !== attachment.attachmentFilename.replace(/\.[^.]+$/, '')) {
					Trellis.debug(`Skipping attachment with modified title: ${attachment.getField('title')}`);
					continue;
				}

				let forceFirstOfType = !!attachment.parentItemID
					&& await attachment.parentItem.getBestAttachment() === attachment;
				attachment.setAutoAttachmentTitle({ forceFirstOfType });
				await attachment.save();
			}
		});
	};
	
	var itemReadTimeout = null;
	this.startItemReadTimeout = function (feedItemID) {
		if (itemReadTimeout) {
			clearTimeout(itemReadTimeout);
			itemReadTimeout = null;
		}
		
		const FEED_READ_TIMEOUT = 1000;
		
		itemReadTimeout = setTimeout(async () => {
			itemReadTimeout = null;
			
			// Check to make sure we're still on the same item
			var items = this.getSelectedItems();
			if (items.length != 1 || items[0].id != feedItemID) {
				return;
			}
			var feedItem = items[0];
			if (!(feedItem instanceof Trellis.FeedItem)) {
				throw new Trellis.Promise.CancellationError('Not a FeedItem');
			}
			if (feedItem.isRead) {
				return;
			}
			
			await feedItem.toggleRead(true);
			this.itemPane.setReadLabel(true);
		}, FEED_READ_TIMEOUT);
	};
	
	
	function reportErrors() {
		var ww = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
				   .getService(Components.interfaces.nsIWindowWatcher);
		var data = {
			msg: Trellis.getString('errorReport.followingReportWillBeSubmitted'),
			errorData: Trellis.getErrors(true),
			askForSteps: true
		};
		var io = { wrappedJSObject: { Trellis: Trellis, data:  data } };
		var win = ww.openWindow(null, "chrome://trellis/content/errorReport.xhtml",
					"trellis-error-report", "chrome,centerscreen,modal", io);
	}
	
	this.displayErrorMessage = function (popup) {
		Trellis.debug("TrellisPane.displayErrorMessage() is deprecated -- use Trellis.crash() instead");
		Trellis.crash(popup);
	}
	
	this.displayStartupError = function (asPaneMessage) {
		if (Trellis) {
			var errMsg = Trellis.startupError;
			var errFunc = Trellis.startupErrorHandler;
		}
		
		var stringBundleService = Services.strings;
		var src = 'chrome://trellis/locale/trellis.properties';
		var stringBundle = stringBundleService.createBundle(src);
		
		var title = stringBundle.GetStringFromName('general.error');
		if (!errMsg) {
			var appName = Trellis && Trellis.appName
				? Trellis.appName
				: stringBundleService
					.createBundle('chrome://branding/locale/brand.properties')
					.GetStringFromName('brandShortName');
			var errMsg = stringBundle.formatStringFromName('startupError', [appName], 1);
		}
		
		if (errFunc) {
			errFunc();
		}
		else {
			// TODO: Add a better error page/window here with reporting
			// instructions
			// window.loadURI('chrome://trellis/content/error.xul');
			//if(asPaneMessage) {
			//	TrellisPane_Local.setItemsPaneMessage(errMsg, true);
			//} else {
			if (Trellis.test) {
				// During testing, throw an error so the actual error message is logged
				throw new Error(`Startup error: ${errMsg}`);
			}
			Trellis.alert(null, title, errMsg);
			//}
		}
	}
	
	
	/**
	 * Set descending z-index on banner containers so drop-shadow works when multiple are visible
	 */
	this.setBannerZIndexes = function () {
		var containers = document.querySelectorAll('.banner-container');
		var max = containers.length;
		for (let container of containers) {
			container.style.zIndex = max--;
		}
	};
	
	
	/**
	 * Show a retraction banner if there are retracted items that we haven't warned about
	 */
	this.showRetractionBanner = async function (items) {
		var items;
		try {
			items = JSON.parse(Trellis.Prefs.get('retractions.recentItems'));
		}
		catch (e) {
			Trellis.Prefs.clear('retractions.recentItems');
			Trellis.logError(e);
			return;
		}
		if (!items.length) {
			return;
		}
		items = await Trellis.Items.getAsync(items);
		if (!items.length) {
			return;
		}
		
		document.getElementById('retracted-items-container').removeAttribute('collapsed');
		
		var message = document.getElementById('retracted-items-message');
		var link = document.getElementById('retracted-items-link');
		var close = document.getElementById('retracted-items-close');
		
		var suffix = items.length > 1 ? 'multiple' : 'single';
		message.textContent = Trellis.getString('retraction.alert.' + suffix);
		link.textContent = Trellis.getString('retraction.alert.view.' + suffix);
		link.onclick = async function () {
			this.hideRetractionBanner();
			// Select newly detected item if only one
			if (items.length == 1) {
				await this.selectItem(items[0].id);
			}
			// Otherwise select Retracted Items collection
			else {
				let libraryID = this.getSelectedLibraryID();
				await this.collectionsView.selectByID("R" + libraryID);
			}
		}.bind(this);
		
		close.onclick = function () {
			this.hideRetractionBanner();
		}.bind(this);
	};
	
	
	this.hideRetractionBanner = function () {
		document.getElementById('retracted-items-container').setAttribute('collapsed', true);
		Trellis.Prefs.clear('retractions.recentItems');
	};
	
	
	this.promptToHideRetractionForReplacedItem = function (item) {
		var ps = Services.prompt;
		var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL;
		let index = ps.confirmEx(
			null,
			Trellis.getString('retraction.replacedItem.title'),
			Trellis.getString('retraction.replacedItem.text1')
				+ "\n\n"
				+ Trellis.getString('retraction.replacedItem.text2'),
			buttonFlags,
			Trellis.getString('retraction.replacedItem.button'),
			null,
			null,
			null,
			{}
		);
		if (index == 0) {
			Trellis.Retractions.hideRetraction(item);
			this.hideRetractionBanner();
		}
	};

	/**
	 * Shows a Mac Word plugin installation warning (intended to be used with Sequoia and up)
	 * before the installer displays the "scary" OS prompt to access other application data.
	 * @returns {Promise<Object>} Object with either install, dismiss or remindLater set to true.
	 */
	this.showMacWordPluginInstallWarning = function (options = {}) {
		return new Promise((resolve) => {
			const panel = document.getElementById('mac-word-plugin-install-container');
			const message = document.querySelector('#mac-word-plugin-install-banner .message');
			const action = document.getElementById('mac-word-plugin-install-action');
			const remind = document.getElementById('mac-word-plugin-install-remind-later');
			const dontAskAgain = document.getElementById('mac-word-plugin-install-dont-ask-again');

			// On macOS 27 (Golden Gate) and later, the user allows the installation in a
			// folder-selection dialog rather than approving an OS permission prompt
			message.dataset.l10nId = options.folderAccess
				? 'mac-word-plugin-install-folder-message'
				: 'mac-word-plugin-install-message';
			
			// TODO: Replace with ftl string
			dontAskAgain.label = Trellis.getString('general.dontAskAgain');
			
			panel.removeAttribute('collapsed');
			action.onclick = () => {
				this.hideMacWordPluginInstallWarning();
				resolve({ install: true });
			};
			remind.onclick = () => {
				this.hideMacWordPluginInstallWarning();
				resolve({ remindLater: true });
			};
			dontAskAgain.onclick = () => {
				this.hideMacWordPluginInstallWarning();
				resolve({ dontAskAgain: true });
			};
		});
	};
	
	this.hideMacWordPluginInstallWarning = function () {
		document.querySelector('#mac-word-plugin-install-container').setAttribute('collapsed', true);
	};

	this.showArchitectureWarning = async function () {
		const remindInterval = 60 * 60 * 24 * 30;
		const lastDisplayed = Trellis.Prefs.get('architecture.warning.lastDisplayed') ?? 0;
		
		if (lastDisplayed > Math.round(Date.now() / 1000) - remindInterval) {
			return;
		}
		
		const isWow64 = (await Services.sysinfo.processInfo).isWow64;
		const isX64OnArm = Trellis.isWin64EmulatedOnArm() || Trellis.isLinux64EmulatedOnArm();
		
		if ((Trellis.isWin && isWow64) || isX64OnArm) {
			let panel = document.getElementById('architecture-warning-container');
			let action = document.getElementById('architecture-warning-action');
			let close = document.getElementById('architecture-warning-close');
			let remind = document.getElementById('architecture-warning-remind');
			let message = document.getElementById('architecture-warning-message');

			if (isWow64) {
				message.dataset.l10nId = 'architecture-win32-warning-message';
				action.dataset.l10nId = 'architecture-warning-action';
			}
			else if (isX64OnArm) {
				message.dataset.l10nId = 'architecture-x64-on-arm64-message';
				action.dataset.l10nId = 'architecture-x64-on-arm64-action';
			}
			
			panel.removeAttribute('collapsed');
			action.onclick = function () {
				let url = Trellis.isBetaBuild
					? 'https://www.trellis.org/support/beta_builds'
					: 'https://www.trellis.org/download/';
				Trellis.launchURL(url);
			};
			close.onclick = function () {
				this.hideArchitectureWarning();
			}.bind(this);
			remind.onclick = function () {
				Trellis.Prefs.set(`architecture.warning.lastDisplayed`, Math.round(Date.now() / 1000));
				this.hideArchitectureWarning();
			}.bind(this);
		}
	};

	this.hideArchitectureWarning = function () {
		document.getElementById('architecture-warning-container').setAttribute('collapsed', true);
	};

	
	this.showPostUpgradeBanner = function () {
		// Don't show for non-release builds or if disabled
		if (Trellis.isBetaBuild || Trellis.isDevBuild || Trellis.isSourceBuild
				|| !Trellis.Prefs.get('showPostUpgradeBanner')) {
			return;
		}
		// Don't show if we've already shown a banner for this or a higher major version
		let versionShown = Trellis.Prefs.get('postUpgradeBannerVersionShown') || 0;
		let majorVersion = parseInt(Trellis.version.split('.')[0]);
		if (versionShown >= majorVersion) {
			return;
		}
		
		// Set message and link to current version
		let div = document.getElementById('post-upgrade-message');
		document.l10n.setArgs(div, { version: majorVersion });
		let link = document.getElementById('post-upgrade-new-features-link');
		link.href = TRELLIS_CONFIG.NEW_FEATURES_URL.replace('{version}', majorVersion);
		document.getElementById('post-upgrade-container').removeAttribute('collapsed');

		// Workaround for a Fluent issue (possibly triggered by plugin localizations) where
		// $version isn't substituted, leaving "{$version}" visible in the banner. The same issue
		// can cause other problems, and it would be good to figure out what's triggering it, but
		// this one is visible enough that it's worth fixing manually.
		document.l10n.translateElements([div]).then(() => {
			let span = document.getElementById('post-upgrade-appver');
			if (span.textContent.includes('$version')) {
				span.textContent = span.textContent
					.replace(/\{\s*\$version\s*\}/g, majorVersion);
			}
		});
	};
	
	
	this.hidePostUpgradeBanner = function (remindMeLater = false) {
		document.getElementById('post-upgrade-container').setAttribute('collapsed', true);
		if (remindMeLater) {
			setTimeout(() => {
				this.showPostUpgradeBanner();
			}, 1000 * 60 * 60 * 24); // 24 hours
		}
		else {
			let majorVersion = parseInt(Trellis.version.split('.')[0]);
			Trellis.Prefs.set('postUpgradeBannerVersionShown', majorVersion);
		}
	};

	this.showFileRenamingBanner = function () {
		if (Trellis.Prefs.get('autoRenameFiles.bannerShown')) {
			return;
		}
		if (Trellis.Prefs.prefHasUserValue('autoRenameFiles.bannerDisplayTime')) {
			const week = 7 * 24 * 60 * 60 * 1000;
			if (Date.now() > parseInt(Trellis.Prefs.get('autoRenameFiles.bannerDisplayTime')) + week) {
				Trellis.Prefs.clear('autoRenameFiles.bannerDisplayTime');
				Trellis.Prefs.set('autoRenameFiles.bannerShown', true);
				return;
			}
		}
		else {
			Trellis.Prefs.set('autoRenameFiles.bannerDisplayTime', Date.now().toString());
		}
		
		document.getElementById('file-renaming-documentation-link').onclick = () => {
			Trellis.launchURL("https://www.trellis.org/support/file_renaming");
			// Do this in the next loop to avoid a visual glitch in Fx140.3 where the background
			// color of the banner remains in part of the item pane header until switching to a
			// different tab and back
			setTimeout(() => {
				this.hideFileRenamingBanner();
			});
		};
		
		this.document.getElementById('file-renaming-banner-close').onclick = () => {
			this.hideFileRenamingBanner();
		};

		this.document.getElementById('file-renaming-banner-container').removeAttribute('collapsed');
	};

	this.hideFileRenamingBanner = function () {
		document.getElementById('file-renaming-banner-container').setAttribute('collapsed', true);
		Trellis.Prefs.clear('autoRenameFiles.bannerDisplayTime');
		Trellis.Prefs.set('autoRenameFiles.bannerShown', true);
	};

	
	/**
	 * Sets the layout to either a three-vertical-pane layout and a layout where itemsPane is above itemPane
	 */
	this.updateLayout = function () {
		var layoutSwitcher = document.getElementById("trellis-layout-switcher");
		var itemsSplitter = document.getElementById("trellis-items-splitter");
		var sidenav = document.getElementById("trellis-view-item-sidenav");

		if (Trellis.Prefs.get("layout") === "stacked") { // itemsPane above itemPane
			layoutSwitcher.setAttribute("orient", "vertical");
			itemsSplitter.setAttribute("orient", "vertical");
			sidenav.classList.add("stacked");
			this.itemPane.classList.add("stacked");
			document.documentElement.classList.add("stacked");
		}
		else {  // three-vertical-pane
			layoutSwitcher.setAttribute("orient", "horizontal");
			itemsSplitter.setAttribute("orient", "horizontal");
			sidenav.classList.remove("stacked");
			this.itemPane.classList.remove("stacked");
			document.documentElement.classList.remove("stacked");
		}

		this.updateLayoutConstraints();
		if (TrellisPane.itemsView) {
			// Need to immediately rerender the items here without any debouncing
			// since tree height will have changed
			TrellisPane.itemsView.updateHeight();
		}
		TrellisContextPane.update();
		Trellis_Tabs.updateSidebarLayout();
	};
	
	
	this.getState = function () {
		return {
			type: 'pane',
			tabs: Trellis_Tabs.getState()
		};
	};
	
	/**
	 * Unserializes trellis-persist elements from preferences
	 */
	this.unserializePersist = function () {
		_unserialized = true;
		var serializedValues = Trellis.Prefs.get("pane.persist") || "{}";
		serializedValues = JSON.parse(serializedValues);
		
		for (var id in serializedValues) {
			var el = document.getElementById(id);
			if (!el) {
				Trellis.debug(`Trying to restore persist data for #${id} but elem not found`, 5);
				continue;
			}
			
			let allowedAttributes = (el.getAttribute('trellis-persist') || '').split(/[\s,]+/);
			
			var elValues = serializedValues[id];
			for (var attr in elValues) {
				// For some reason, the persisted state of the splitter is empty. This will cause
				// the splitter to behave unexpectedly. We set it to 'collapsed' here.
				if (["trellis-context-splitter-stacked", "trellis-context-splitter"].includes(el.id)
						&& attr === 'state' && elValues[attr] === '') {
					elValues[attr] = 'collapsed';
				}
				// Ignore attributes that are no longer persisted for the element
				if (!allowedAttributes.includes(attr)) {
					Trellis.debug(`Not restoring '${attr}' for #${id}`);
					continue;
				}
				if (["width", "height"].includes(attr)) {
					el.style[attr] = `${elValues[attr]}px`;
				}
				el.setAttribute(attr, elValues[attr]);
			}
		}
		
		if (this.itemsView) {
			// may not yet be initialized
			try {
				this.itemsView.sort();
			}
			catch (e) {}
		}
	};

	/**
	 * Serializes trellis-persist attributes to preferences
	 */
	this.serializePersist = function () {
		if (!_unserialized) return;
		try {
			var serializedValues = JSON.parse(Trellis.Prefs.get('pane.persist'));
		}
		catch (e) {
			serializedValues = {};
		}
		var persistedElements = new Set();
		for (let el of document.querySelectorAll("[trellis-persist]")) {
			if (!el.getAttribute) continue;
			var id = el.getAttribute("id");
			if (!id) continue;
			var elValues = {};
			for (let attr of el.getAttribute("trellis-persist").split(/[\s,]+/)) {
				if (el.hasAttribute(attr)) {
					elValues[attr] = el.getAttribute(attr);
					persistedElements.add(id);
				}
			}
			serializedValues[id] = elValues;
		}
		// Remove elements that no longer persist anything
		for (let i in serializedValues) {
			if (!persistedElements.has(i)) {
				delete serializedValues[i];
			}
		}
		Trellis.Prefs.set("pane.persist", JSON.stringify(serializedValues));
	}
	
	
	this.updateWindow = function () {
		var trellisPane = document.getElementById('trellis-pane');
		// Must match value in overlay.css
		var breakpoint = 1000;
		var className = `width-${breakpoint}`;
		if (window.innerWidth >= breakpoint) {
			trellisPane.classList.add(className);
		}
		else {
			trellisPane.classList.remove(className);
		}
	};
	
	
	/**
	 * Update the window min-width/height, collections search width, tag selector, and sidenav
	 * when the window or elements within it are resized.
	 */
	this.updateLayoutConstraints = function () {
		var paneStack = document.getElementById("trellis-pane-stack");
		if (paneStack.hidden) return;

		var titlebar = document.getElementById('trellis-title-bar');
		var trees = document.getElementById('trellis-trees');
		var itemsPaneContainer = document.getElementById('trellis-items-pane-container');
		var collectionsPane = document.getElementById("trellis-collections-pane");
		var tagSelector = document.getElementById("trellis-tag-selector");
		let layoutModeMenus = [
			document.getElementById("view-menuitem-standard"),
			document.getElementById("view-menuitem-stacked"),
		];

		let isStackedMode = Trellis.Prefs.get('layout') === 'stacked';
		let isTempStackedMode = Trellis.Prefs.get('tempStackedMode');
		let isItemPaneCollapsed = TrellisPane.itemPane.collapsed && TrellisContextPane.collapsed;

		// Keep in sycn with abstracts/variables.scss > $min-width-collections-pane
		const collectionsPaneMinWidth = collectionsPane.hasAttribute("collapsed") ? 0 : 200;
		// Keep in sycn with abstracts/variables.scss > $min-width-item-pane
		const itemPaneMinWidth = (isStackedMode || isItemPaneCollapsed) ? 0 : 320;
		const libraryItemPaneMinWidth = (isStackedMode || TrellisPane.itemPane.collapsed) ? 0 : 320;
		// Keep in sycn with abstracts/variables.scss > $width-sidenav
		const sideNavMinWidth = isStackedMode ? 0 : 37;
		// Keep in sycn with abstracts/variables.scss > $min-width-items-pane
		const itemsPaneMinWidth = 370;

		let fixedComponentWidth = collectionsPaneMinWidth + itemPaneMinWidth + sideNavMinWidth;

		// Calculate the heights of the components that aren't able to shrink automatically
		// when the window is resized
		let fixedComponentHeight = titlebar.scrollHeight + trees.scrollHeight - itemsPaneContainer.scrollHeight;
		document.documentElement.style.setProperty('--width-of-fixed-components', `${fixedComponentWidth}px`);
		document.documentElement.style.setProperty('--height-of-fixed-components', `${fixedComponentHeight}px`);

		let layoutChanged = false;
		// Collections pane + items pane + items pane + sidenav + 3px for draggability
		const windowAutoStackMinWidth = 930;
		if (window.innerWidth < windowAutoStackMinWidth) {
			// Disable layout mode menus because the standard mode is not available
			layoutModeMenus.forEach(menu => menu.setAttribute("disabled", "true"));
			// If the window is too small in standard mode, enter stack mode temporarily
			if (!isStackedMode && !isTempStackedMode) {
				Trellis.Prefs.set('tempStackedMode', true);
				Trellis.Prefs.set('layout', 'stacked');
				layoutChanged = true;
			}
		}
		else {
			layoutModeMenus.forEach(menu => menu.removeAttribute("disabled"));
			if (isTempStackedMode) {
				Trellis.Prefs.clear('tempStackedMode');
				Trellis.Prefs.set('layout', 'standard');
				layoutChanged = true;
			}
		}

		if (layoutChanged) {
			// Compute the layout constraints again after the layout change to avoid weirdness
			setTimeout(() => {
				this.updateLayoutConstraints();
			}, 0);
		}

		// This is important to avoid other panes be pushed out of the window
		collectionsPane.style.setProperty(
			"--max-width-collections-pane",
			`${window.innerWidth - libraryItemPaneMinWidth - sideNavMinWidth - itemsPaneMinWidth}px`);

		var collectionsPaneWidth = collectionsPane.getBoundingClientRect().width;
		tagSelector.style.maxWidth = collectionsPaneWidth + 'px';
		if (TrellisPane.itemsView) {
			TrellisPane.itemsView.updateHeightDebounced();
		}

		this.handleTagSelectorResize();

		this.itemPane.handleResize();
	};
	
	
	this.toggleItemPane = function () {
		this.itemPane.collapsed = !this.itemPane.collapsed;
		this.updateLayoutConstraints();
	};
	
	
	// Set the label of the dynamic tooltip. Can be used when we cannot set .tooltiptext
	// property, e.g. if we don't want the tooltip to be announced by screenreaders.
	this.setDynamicTooltip = function (event) {
		let tooltip = event.target;
		let triggerNode = tooltip.triggerNode;
		if (!triggerNode || !triggerNode.getAttribute("dynamic-tooltiptext")) {
			event.preventDefault();
			return;
		}
		tooltip.setAttribute("label", triggerNode.getAttribute("dynamic-tooltiptext"));
	};

	/**
	 * Opens the about dialog
	 */
	this.openAboutDialog = function () {
		let flags = 'chrome,centerscreen';
		if (Trellis.isMac) {
			flags += ',dialog=yes';
		}
		window.openDialog('chrome://trellis/content/about.xhtml', 'about', flags);
	}
	
	/**
	 * Adds or removes a function to be called when Trellis is reloaded by switching into or out of
	 * the connector
	 */
	this.addReloadListener = function (/** @param {Function} **/func) {
		if(_reloadFunctions.indexOf(func) === -1) _reloadFunctions.push(func);
	}
	
	/**
	 * Adds or removes a function to be called just before Trellis is reloaded by switching into or
	 * out of the connector
	 */
	this.addBeforeReloadListener = function (/** @param {Function} **/func) {
		if(_beforeReloadFunctions.indexOf(func) === -1) _beforeReloadFunctions.push(func);
	}
	
	/**
	 * Implements nsIObserver for Trellis reload
	 */
	var _reloadObserver = {

		/**
		 * Called when Trellis is reloaded (i.e., if it is switched into or out of connector mode)
		 */
		observe: function (aSubject, aTopic, aData) {
			if (aTopic == "trellis-reloaded") {
				Trellis.debug("Reloading Trellis pane");
				for (let func of _reloadFunctions) func(aData);
			}
			else if (aTopic == "trellis-before-reload") {
				Trellis.debug("Trellis pane caught before-reload event");
				for (let func of _beforeReloadFunctions) func(aData);
			}
		}
	};

	this.buildFieldTransformMenu = function ({ target, onTransform }) {
		let doc = target.ownerDocument;
		let values = target.values;
		let valuesTitleCased = values.map(v => Trellis.Utilities.capitalizeTitle(v, true));
		let valuesSentenceCased = values.map(v => Trellis.Utilities.sentenceCase(v));

		let menupopup = doc.createXULElement('menupopup');

		let titleCase = doc.createXULElement('menuitem');
		titleCase.setAttribute('label', Trellis.getString('trellis.item.textTransform.titlecase'));
		titleCase.addEventListener('command', () => {
			onTransform(valuesTitleCased);
		});
		titleCase.disabled = values.every((v, i) => valuesTitleCased[i] === v);
		menupopup.append(titleCase);

		let sentenceCase = doc.createXULElement('menuitem');
		sentenceCase.setAttribute('label', Trellis.getString('trellis.item.textTransform.sentencecase'));
		sentenceCase.addEventListener('command', () => {
			onTransform(valuesSentenceCased);
		});
		sentenceCase.disabled = values.every((v, i) => valuesSentenceCased[i] === v);
		menupopup.append(sentenceCase);

		Trellis.Utilities.Internal.updateEditContextMenu(menupopup, target);
	
		return menupopup;
	};
};

/**
 * Keep track of which TrellisPane was local (since TrellisPane object might get swapped out for a
 * tab's TrellisPane)
 */
var TrellisPane_Local = TrellisPane;
