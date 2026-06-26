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


/**
 * This object contains the various functions for the interface
 */
const TrellisStandalone = new function () {
	const { TRELLIS_CONFIG } = ChromeUtils.importESModule('resource://trellis/config.mjs');

	const FONT_SIZES = [
		"0.77", // 10
		"0.85", // 11
		"0.92", // 12
		"1.00", // 13px
		"1.08", // 14
		"1.15", // 15
		"1.23", // 16
		"1.38", // 18
		"1.54", // 20
		"1.85", // 24
	];
	
	//const NOTE_FONT_SIZES = ["11", "12", "13", "14", "18", "24", "36", "48", "64", "72", "96"];
	const NOTE_FONT_SIZE_DEFAULT = "14";
	const NOTE_TAB_FONT_SIZE_DEFAULT = "16";

	Object.defineProperty(this, 'currentReader', {
		get: () => Trellis.Reader.getByTabID(Trellis_Tabs.selectedID)
	});

	/**
	 * Run when standalone window first opens
	 */
	this.onLoad = function () {
		this.switchMenuType('library');
		this._notifierID = Trellis.Notifier.registerObserver(
			{
				notify: async (action, type, ids, extraData) => {
					if (['select', 'load'].includes(action)) {
						// Reader doesn't have tabID yet
						setTimeout(async () => {
							// Item and other things might not be loaded yet when reopening tabs
							await Trellis.Schema.schemaUpdatePromise;
							this.updateQuickCopyOptions();
						}, 0);
						// "library", "reader" or "note"
						let type = extraData[ids[0]].type;
						this.switchMenuType(type);
						if (type === 'reader') {
							let reader = Trellis.Reader.getByTabID(ids[0]);
							if (reader) {
								// "pdf", "epub", "snapshot"
								let subtype = reader.type;
								this.switchReaderSubtype(subtype);
							}
						}
						setTimeout(() => TrellisPane.updateLayoutConstraints(), 0);
					}
				}
			},
			['tab'],
			'tab'
		);
		
		Promise.try(function () {
			if(!Trellis) {
				throw true;
			}
			if(!Trellis.initialized) {
				Trellis.showTrellisPaneProgressMeter();
			}
			return Trellis.initializationPromise;
		})
		.then(async function () {
			document.getElementById('key_copyCitation')
				.setAttribute('key', Trellis.Keys.getKeyForCommand('copySelectedItemCitationsToClipboard'));
			document.getElementById('key_copyBibliography')
				.setAttribute('key', Trellis.Keys.getKeyForCommand('copySelectedItemsToClipboard'));
			document.getElementById('key_showTabsMenu')
				.setAttribute('key', Trellis.Keys.getKeyForCommand('showTabsMenu'));
			// Force menu to update with shortcut key at startup -- as of fx128, this is necessary
			// to get the shortcut to reliably appear for the menu item without switching tabs
			document.getElementById('show-tabs-menu').hidden = true;
			document.getElementById('show-tabs-menu').hidden = false;
			
			if (Trellis.isMac) {
				document.getElementById('menu_openHelp').setAttribute('key', 'key_openHelpMac');
			}
			
			TrellisStandalone.DebugOutput.init();
			
			Trellis.hideTrellisPaneOverlays();
			TrellisPane.init();
			TrellisPane.makeVisible();
			
			// Don't ask before handing http and https URIs
			var eps = Components.classes['@mozilla.org/uriloader/external-protocol-service;1']
					.getService(Components.interfaces.nsIExternalProtocolService);
			var hs = Components.classes["@mozilla.org/uriloader/handler-service;1"]
					.getService(Components.interfaces.nsIHandlerService);
			for (let scheme of ["http", "https"]) {
				var handlerInfo = eps.getProtocolHandlerInfo(scheme);
				handlerInfo.preferredAction = Components.interfaces.nsIHandlerInfo.useSystemDefault;
				handlerInfo.alwaysAskBeforeHandling = false;
				hs.store(handlerInfo);
			}
			
			// Add add-on listeners (not yet hooked up)
			Services.obs.addObserver(gXPInstallObserver, "addon-install-disabled", false);
			Services.obs.addObserver(gXPInstallObserver, "addon-install-started", false);
			Services.obs.addObserver(gXPInstallObserver, "addon-install-blocked", false);
			Services.obs.addObserver(gXPInstallObserver, "addon-install-failed", false);
			Services.obs.addObserver(gXPInstallObserver, "addon-install-complete", false);
		})
		.catch(function (e) {
			try { Trellis.debug(e, 1); } catch (e) {}
			Components.utils.reportError(e);
			TrellisPane.displayStartupError();
			window.close();
			return;
		});
		
		// Switch to library tab if dragging over PDF/EPUB/HTML file(s)
		window.addEventListener('dragover', function (event) {
			// TODO: Consider allowing more (or all) file types, although shouldn't interfere with image dragging to note editor
			if (Trellis_Tabs.selectedID != 'trellis-pane'
					&& event.dataTransfer.items
					&& event.dataTransfer.items.length
					&& !Array.from(event.dataTransfer.items).find(x =>
						!['application/pdf', 'application/epub+zip', 'text/html'].includes(x.type))) {
				Trellis_Tabs.select('trellis-pane');
			}
		}, true);
	}

	this.switchMenuType = function (type) {
		document.querySelectorAll('.menu-type-library, .menu-type-reader, .menu-type-note').forEach(el => el.hidden = true);
		document.querySelectorAll('.menu-type-' + type).forEach(el => el.hidden = false);
	};

	this.switchReaderSubtype = function (subtype) {
		document.querySelectorAll(
			'.menu-type-reader.pdf, .menu-type-reader.epub, .menu-type-reader.snapshot'
		).forEach(el => el.hidden = true);
		document.querySelectorAll('.menu-type-reader.' + subtype).forEach(el => el.hidden = false);
	};

	this.onFileMenuOpen = function (event) {
		let reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
		
		// PDF annotation transfer ("Import Annotation"/"Store Annotations in File")
		if (reader) {
			let item = Trellis.Items.get(reader.itemID);
			let library = Trellis.Libraries.get(item.libraryID);
			if (item
					&& library.filesEditable
					&& library.editable
					&& !(item.deleted || item.parentItem && item.parentItem.deleted)) {
				let annotations = item.getAnnotations();
				let canTransferFromPDF = annotations.find(x => x.annotationIsExternal);
				this.updateMenuItemEnabled('menu_transferFromPDF', canTransferFromPDF);
			}
			else {
				this.updateMenuItemEnabled('menu_transferFromPDF', false);
			}
		}
		
		let selectedItems = TrellisPane.getSelectedItems();
		
		let showFileMenuitem = document.getElementById('menu_showFile');
		let showFileLabel = "";
		let numFiles = Trellis.Items.numDistinctFileAttachmentsForLabel(selectedItems);
		if (Trellis.isMac) {
			showFileLabel = "menu-file-show-in-finder";
		}
		else {
			showFileLabel = numFiles > 1 ? 'menu-file-show-files' : 'menu-file-show-file';
		}
		document.l10n.setAttributes(showFileMenuitem, showFileLabel);
		showFileMenuitem.disabled = !numFiles;

		// TEMP: Quick implementation
		try {
			let menuitem = document.getElementById('menu_export_files');
			// Library tab
			if (!reader) {
				let numFiles = Trellis.Items.numDistinctFileAttachmentsForLabel(
					selectedItems,
					item => item.isPDFAttachment()
				);
				if (numFiles) {
					menuitem.hidden = false;
					menuitem.label = Trellis.getString(
						'pane.items.menu.exportPDF' + (numFiles == 1 ? '' : '.multiple')
					);
				}
				else {
					menuitem.hidden = true;
				}
			}
			// Reader tab
			else {
				menuitem.hidden = true;
			}
		}
		catch (e) {
			Trellis.logError(e);
		}

		this.onUpdateCustomMenus(event, 'file');
	};

	this.onEditMenuOpen = function (event) {
		this.updateQuickCopyOptions();
		// goUpdateGlobalEditMenuItems(true) is necessary to update Edit menu when contenteditable is focused
		window.goUpdateGlobalEditMenuItems(true);
		this._updateUndoRedoLabels();

		this.onUpdateCustomMenus(event, 'edit');
	};

	this._updateUndoRedoLabels = function () {
		let undoItem = document.getElementById('menu_undo');
		let redoItem = document.getElementById('menu_redo');
		if (!undoItem || !redoItem) return;

		// When a native text-editing controller handles undo/redo
		// (e.g. focused input), show generic labels and let it take over
		let nativeUndo = Trellis.UndoHistory.hasNativeUndo(document);
		let nativeRedo = Trellis.UndoHistory.hasNativeRedo(document);

		let undoAction = !nativeUndo && Trellis.UndoHistory.getUndoAction();
		if (undoAction) {
			let actionLabel = Trellis.ftl.formatValueSync(
				undoAction.action, undoAction.actionArgs || undefined
			);
			let fullLabel = Trellis.ftl.formatValueSync(
				'menu-edit-undo-action', { action: actionLabel }
			);
			undoItem.removeAttribute('data-l10n-id');
			undoItem.setAttribute('label', fullLabel);
		}
		else {
			document.l10n.setAttributes(undoItem, 'text-action-undo');
		}

		let redoAction = !nativeRedo && Trellis.UndoHistory.getRedoAction();
		if (redoAction) {
			let actionLabel = Trellis.ftl.formatValueSync(
				redoAction.action, redoAction.actionArgs || undefined
			);
			let fullLabel = Trellis.ftl.formatValueSync(
				'menu-edit-redo-action', { action: actionLabel }
			);
			redoItem.removeAttribute('data-l10n-id');
			redoItem.setAttribute('label', fullLabel);
		}
		else {
			document.l10n.setAttributes(redoItem, 'text-action-redo');
		}
	};
	
	/**
	 * Builds new item menu
	 */
	this.buildNewItemMenu = function () {
		var addMenu = document.getElementById('menu_NewItemPopup');
		
		// Remove all nodes so we can regenerate
		while(addMenu.hasChildNodes()) addMenu.removeChild(addMenu.firstChild);
		
		var typeSets = [Trellis.ItemTypes.getPrimaryTypes(), Trellis.ItemTypes.getSecondaryTypes()];
		for(var j=0; j<typeSets.length; j++) {
			var t = typeSets[j];
			
			// Sort by localized name
			var itemTypes = [];
			for (var i=0; i<t.length; i++) {
				itemTypes.push({
					id: t[i].id,
					name: t[i].name,
					localized: Trellis.ItemTypes.getLocalizedString(t[i].id)
				});
			}
			var collation = Trellis.getLocaleCollation();
			itemTypes.sort(function (a, b) {
				return collation.compareString(1, a.localized, b.localized);
			});
			
			for (var i = 0; i<itemTypes.length; i++) {
				var menuitem = document.createXULElement("menuitem");
				menuitem.setAttribute("label", itemTypes[i].localized);
				menuitem.setAttribute("tooltiptext", "");
				let type = itemTypes[i].id;
				menuitem.addEventListener("command", function () {
					TrellisPane_Local.newItem(type, null, null, true);
				}, false);
				menuitem.className = "trellis-tb-add";
				addMenu.appendChild(menuitem);
			}
			
			// add separator between sets
			if(j !== typeSets.length-1) {
				addMenu.appendChild(document.createXULElement("menuseparator"));
			}
		}
	}
	
	
	this.onManageAttachmentsMenuOpen = function () {
		// Convert Linked Files to Stored Files
		var enableConvertToStored = false;
		try {
			enableConvertToStored = TrellisPane.getSelectedItems().some((item) => {
				return item.isLinkedFileAttachment()
					|| (item.isRegularItem()
						&& Trellis.Items.get(item.getAttachments())
							.some(att => att.isLinkedFileAttachment()));
			});
		}
		catch (e) {}
		this.updateMenuItemEnabled('file-menuitem-convert-to-stored', enableConvertToStored);
		
		var enableNormalizeAttachmentTitles = false;
		try {
			enableNormalizeAttachmentTitles = TrellisPane.getSelectedItems()
				.some(item => item.isFileAttachment()
					|| (item.isRegularItem()
						&& Trellis.Items.get(item.getAttachments())
							.some(att => att.isFileAttachment())));
		}
		catch (e) {}
		this.updateMenuItemEnabled('file-menuitem-normalize-attachment-titles', enableNormalizeAttachmentTitles);
	};
	
	
	this.onManageAttachmentsMenuItemClick = function (event) {
		var menuitem = event.originalTarget;
		var id = menuitem.id;
		var prefix = 'file-menuitem-';
		if (menuitem.disabled || !id.startsWith(prefix)) {
			return;
		}
		id = id.substr(prefix.length);
		
		switch (id) {
			case 'convert-to-stored':
				TrellisPane.convertLinkedFilesToStoredFiles();
				break;
			case 'normalize-attachment-titles':
				TrellisPane.normalizeAttachmentTitles();
				break;
		}
	};
	
	
	this.updateQuickCopyOptions = function () {
		var selected = [];

		let win = Trellis.getMainWindow();
		if (win) {
			try {
				selected = win.TrellisPane.getSelectedItems();
			}
			catch (e) {
			}
			win.TrellisPane.updateQuickCopyCommands(selected);
		}

		var format = Trellis.QuickCopy.getFormatFromURL(Trellis.QuickCopy.lastActiveURL);
		var exportingNotes = selected.every(item => item.isNote() || item.isAttachment());
		var exportingAnnotations = selected.every(item => item.isAnnotation());
		if (exportingNotes || exportingAnnotations) {
			format = Trellis.QuickCopy.getNoteFormat();
		}
		format = Trellis.QuickCopy.unserializeSetting(format);
		
		var copyCitation = document.getElementById('menu_copyCitation');
		var copyBibliography = document.getElementById('menu_copyBibliography');
		var copyExport = document.getElementById('menu_copyExport');
		var copyNote = document.getElementById('menu_copyNote');
		var copyAnnotation = document.getElementById('menu_copyAnnotation');
		
		copyCitation.hidden = !selected.length || format.mode != 'bibliography';
		copyBibliography.hidden = !selected.length || format.mode != 'bibliography';
		copyExport.hidden = !selected.length || format.mode != 'export' || exportingNotes;
		copyNote.hidden = !selected.length || format.mode != 'export' || !exportingNotes;
		copyAnnotation.hidden = !selected.length || format.mode != 'export' || !exportingAnnotations;
		document.l10n.setAttributes(copyAnnotation, "menu-edit-copy-annotation", { count: selected.length });
		
		if (format.mode == 'export') {
			try {
				let obj = Trellis.Translators.get(format.id);
				if (obj) {
					copyExport.label = Trellis.getString('quickCopy.copyAs', obj.label);
				}
				else {
					copyExport.hidden = true;
				}
			}
			catch (e) {
				if (!(e instanceof Trellis.Exception.UnloadedDataException && e.dataType == 'translators')) {
					Trellis.logError(e);
				}
				copyExport.hidden = true;
			}
		}
	};
	
	
	this.onGoMenuOpen = function (event) {
		var keyBack = document.getElementById('key_back');
		var keyForward = document.getElementById('key_forward');

		if (Trellis.isMac) {
			keyBack.setAttribute('key', '[');
			keyBack.setAttribute('modifiers', 'meta');
			keyForward.setAttribute('key', ']');
			keyForward.setAttribute('modifiers', 'meta');
		}
		else {
			keyBack.setAttribute('keycode', 'VK_LEFT');
			keyBack.setAttribute('modifiers', 'alt');
			keyForward.setAttribute('keycode', 'VK_RIGHT');
			keyForward.setAttribute('modifiers', 'alt');
		}

		// `key` attribute needs to be dynamically set for `menuitem` when
		// the key changes after DOM initialization
		var menuItemBack = document.getElementById('go-menuitem-back');
		var menuItemForward = document.getElementById('go-menuitem-forward');
		menuItemBack.setAttribute('key', 'key_back');
		menuItemForward.setAttribute('key', 'key_forward');

		var reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
		if (reader) {
			if (['pdf', 'epub'].includes(reader.type)) {
				this.updateMenuItemEnabled('go-menuitem-first-page', reader.canNavigateToFirstPage);
				this.updateMenuItemEnabled('go-menuitem-last-page', reader.canNavigateToLastPage);
			}
			this.updateMenuItemEnabled('go-menuitem-back', reader.canNavigateBack);
			this.updateMenuItemEnabled('go-menuitem-forward', reader.canNavigateForward);
		}

		this.onUpdateCustomMenus(event, 'go');
	};
	
	
	this.onViewMenuOpen = function (event) {
		// PDF Reader
		var reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
		if (reader) {
			if (reader.type === 'pdf' || reader.type === 'epub') {
				this.updateMenuItemCheckmark('view-menuitem-no-spreads', reader.spreadMode === 0);
				this.updateMenuItemCheckmark('view-menuitem-odd-spreads', reader.spreadMode === 1);
				this.updateMenuItemCheckmark('view-menuitem-even-spreads', reader.spreadMode === 2);
			}
			if (reader.type === 'pdf') {
				this.updateMenuItemCheckmark('view-menuitem-hand-tool', reader.toolType === 'hand');
				this.updateMenuItemCheckmark('view-menuitem-vertical-scrolling', reader.scrollMode === 0);
				this.updateMenuItemCheckmark('view-menuitem-horizontal-scrolling', reader.scrollMode === 1);
				this.updateMenuItemCheckmark('view-menuitem-wrapped-scrolling', reader.scrollMode === 2);
				this.updateMenuItemCheckmark('view-menuitem-zoom-auto', reader.zoomAutoEnabled);
				this.updateMenuItemCheckmark('view-menuitem-zoom-page-width', reader.zoomPageWidthEnabled);
				this.updateMenuItemCheckmark('view-menuitem-zoom-page-height', reader.zoomPageHeightEnabled);
			}
			else if (reader.type === 'epub') {
				this.updateMenuItemCheckmark('view-menuitem-scrolled', reader.flowMode === 'scrolled');
				this.updateMenuItemCheckmark('view-menuitem-paginated', reader.flowMode === 'paginated');
			}
			this.updateMenuItemCheckmark('view-menuitem-split-vertically', reader.splitType === 'vertical');
			this.updateMenuItemCheckmark('view-menuitem-split-horizontally', reader.splitType === 'horizontal');
		}
	
		// Layout mode
		var mode = Trellis.Prefs.get('layout');
		this.updateMenuItemCheckmark('view-menuitem-standard', mode != 'stacked');
		this.updateMenuItemCheckmark('view-menuitem-stacked', mode == 'stacked');
		
		// Density
		let density = Trellis.Prefs.get('uiDensity');
		this.updateMenuItemCheckmark('view-menuitem-ui-density-compact', density == 'compact');
		this.updateMenuItemCheckmark('view-menuitem-ui-density-comfortable', density == 'comfortable');
		
		// Panes
		this.updateMenuItemCheckmark(
			'view-menuitem-collections-pane',
			document.getElementById('trellis-collections-pane').getAttribute('collapsed') != 'true'
		);
		this.updateMenuItemCheckmark(
			'view-menuitem-item-pane',
			document.getElementById('trellis-item-pane').getAttribute('collapsed') != 'true'
		);
		this.updateMenuItemCheckmark(
			'view-menuitem-tag-selector',
			document.getElementById('trellis-tag-selector-container').getAttribute('collapsed') != 'true'
		);
		
		// Font size
		var fontSize = Trellis.Prefs.get('fontSize');
		this.updateMenuItemEnabled('view-menuitem-font-size-bigger', fontSize < FONT_SIZES[FONT_SIZES.length - 1]);
		this.updateMenuItemEnabled('view-menuitem-font-size-smaller', fontSize > FONT_SIZES[0]);
		this.updateMenuItemEnabled('view-menuitem-font-size-reset', fontSize != "1.00");
		
		var noteFontSize = Trellis.Prefs.get('note.fontSize');
		for (let menuitem of document.querySelectorAll(`#note-font-size-menu menuitem`)) {
			if (parseInt(menuitem.getAttribute('label')) == noteFontSize) {
				menuitem.setAttribute('checked', true);
			}
			else {
				menuitem.removeAttribute('checked');
			}
		}
		this.updateMenuItemEnabled(
			'view-menuitem-note-font-size-reset',
			noteFontSize != NOTE_FONT_SIZE_DEFAULT
		);

		let noteTabFontSize = Trellis.Prefs.get('note.tabFontSize');
		for (let menuitem of document.querySelectorAll(`#note-tab-font-size-menu menuitem`)) {
			if (parseInt(menuitem.getAttribute('label')) == noteTabFontSize) {
				menuitem.setAttribute('checked', true);
			}
			else {
				menuitem.removeAttribute('checked');
			}
		}
		this.updateMenuItemEnabled(
			'view-menuitem-note-tab-font-size-reset',
			noteTabFontSize != NOTE_TAB_FONT_SIZE_DEFAULT
		);

		// Recursive collections
		this.updateMenuItemCheckmark(
			'view-menuitem-recursive-collections',
			Trellis.Prefs.get('recursiveCollections')
		);

		// Hide context rows
		this.updateMenuItemCheckmark(
			'view-menuitem-hide-context-annotation-rows',
			Trellis.Prefs.get('hideContextAnnotationRows')
		);

		this.onUpdateCustomMenus(event, 'view');
	};

	this.onToolsMenuOpen = function (event) {
		this.onUpdateCustomMenus(event, 'tools');
	};

	this.onHelpMenuOpen = function (event) {
		this.onUpdateCustomMenus(event, 'help');
	};

	this.onUpdateCustomMenus = function (event, type) {
		let { type: tabType, subType: tabSubType, id: tabID } = Trellis_Tabs.getTabInfo();

		const POPUP_SELECTOR_MAP = {
			file: '#menu_FilePopup',
			edit: '#menu_EditPopup',
			go: '#menu_goPopup',
			view: '#menu_viewPopup',
			tools: '#menu_ToolsPopup',
			help: '#menu_HelpPopup'
		};
		let popup = document.querySelector(POPUP_SELECTOR_MAP[type]);
		if (event.target !== popup) {
			return;
		}
		Trellis.MenuManager.updateMenuPopup(popup, `main/menubar/${type}`, {
			event,
			tabID,
			tabType,
			tabSubType,
			getContext: () => ({
				items: tabType === 'library'
					? TrellisPane.getSelectedItems()
					: [Trellis.Items.get(Trellis_Tabs._getTab(Trellis_Tabs.selectedID).tab?.data?.itemID)],
				tabType,
				tabSubType,
				tabID: Trellis_Tabs.selectedID
			})
		});
	};
	
	this.onViewMenuItemClick = function (event) {
		var menuitem = event.originalTarget;
		var id = menuitem.id;
		var prefix = 'view-menuitem-';
		if (menuitem.disabled || !id.startsWith(prefix)) {
			return;
		}
		id = id.substr(prefix.length);
		
		switch (id) {
			case 'standard':
				Trellis.Prefs.set('layout', 'standard');
				break;
			
			case 'stacked':
				Trellis.Prefs.set('layout', 'stacked');
				break;
			
			case 'ui-density-comfortable':
				Trellis.Prefs.set('uiDensity', 'comfortable');
				break;
			
			case 'ui-density-compact':
				Trellis.Prefs.set('uiDensity', 'compact');
				break;
			
			case 'collections-pane':
				var collectionsPane = document.getElementById('trellis-collections-pane');
				// Show
				if (collectionsPane.getAttribute('collapsed') == 'true') {
					document.getElementById('trellis-collections-splitter').setAttribute('state', 'open');
					collectionsPane.setAttribute('collapsed', false);
				}
				// Hide
				else {
					document.getElementById('trellis-collections-splitter').setAttribute('state', 'collapsed');
					collectionsPane.setAttribute('collapsed', true);
				}
				TrellisPane.updateLayoutConstraints();
				break;
			
			case 'item-pane':
				var itemPane = document.getElementById('trellis-item-pane');
				// Show
				if (itemPane.getAttribute('collapsed') == 'true') {
					document.getElementById('trellis-items-splitter').setAttribute('state', 'open');
					itemPane.setAttribute('collapsed', false);
				}
				// Hide
				else {
					document.getElementById('trellis-items-splitter').setAttribute('state', 'collapsed');
					itemPane.setAttribute('collapsed', true);
				}
				TrellisPane.updateLayoutConstraints();
				break;
			
			case 'tag-selector':
				TrellisPane.toggleTagSelector();
				break;
			
			case 'font-size-bigger':
				increaseFontSize('fontSize', FONT_SIZES);
				break;
			
			case 'font-size-smaller':
				decreaseFontSize('fontSize', FONT_SIZES);
				break;
			
			case 'font-size-reset':
				Trellis.Prefs.clear('fontSize');
				break;
			
			/*case 'note-font-size-bigger':
				increaseFontSize('note.fontSize', NOTE_FONT_SIZES);
				break;
			
			case 'note-font-size-smaller':
				decreaseFontSize('note.fontSize', NOTE_FONT_SIZES);
				break;
			*/
			
			case 'note-font-size-reset':
				Trellis.Prefs.clear('note.fontSize');
				break;
			
			case 'note-tab-font-size-reset':
				Trellis.Prefs.clear('note.tabFontSize');
				break;

			case 'recursive-collections':
				this.toggleBooleanPref('recursiveCollections');
				break;

			case 'hide-context-annotation-rows':
				this.toggleBooleanPref('hideContextAnnotationRows');
				break;
		}
	};
	
	
	this.updateMenuItemCheckmark = function (id, checked) {
		var menuitem = document.getElementById(id);
		if (checked) {
			menuitem.setAttribute('checked', true);
		}
		else {
			menuitem.removeAttribute('checked');
		}
	};
	
	
	this.updateMenuItemEnabled = function (id, enabled) {
		var menuitem = document.getElementById(id);
		if (enabled) {
			menuitem.removeAttribute('disabled');
		}
		else {
			menuitem.setAttribute('disabled', true);
		}
	};
	
	
	this.toggleBooleanPref = function (pref) {
		Trellis.Prefs.set(pref, !Trellis.Prefs.get(pref));
	};
	
	
	function decreaseFontSize(pref, sizes) {
		var fontSize = Trellis.Prefs.get(pref);
		var lastSize = fontSize;
		// Get the highest font size below the current one
		for (let i = sizes.length - 1; i >= 0; i--) {
			if (fontSize > sizes[i]) {
				lastSize = sizes[i];
				break;
			}
		}
		Trellis.Prefs.set(pref, lastSize);
	}
	
	function increaseFontSize(pref, sizes) {
		var fontSize = Trellis.Prefs.get(pref);
		var lastSize = fontSize;
		// Get the font size above the current one
		for (let i = 0; i < sizes.length; i++) {
			if (sizes[i] > fontSize) {
				lastSize = sizes[i];
				break;
			}
		}
		Trellis.Prefs.set(pref, lastSize);
	}
	
	
	this.updateNoteFontSize = function (event) {
		var size = event.originalTarget.getAttribute('label');
		Trellis.Prefs.set('note.fontSize', size);
	};

	this.updateNoteTabFontSize = function (event) {
		var size = event.originalTarget.getAttribute('label');
		Trellis.Prefs.set('note.tabFontSize', size);
	};
	
	this.promptForRestart = function () {
		// Prompt to restart
		var ps = Services.prompt;
		var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING;
		var index = ps.confirmEx(
			null,
			Trellis.getString('general.restartRequired'),
			Trellis.getString('general.restartRequiredForChange', [TRELLIS_CONFIG.CLIENT_NAME]),
			buttonFlags,
			Trellis.getString('general.restartNow'),
			Trellis.getString('general.restartLater'),
			null, null, {}
		);
		
		if (index == 0) {
			Trellis.Utilities.Internal.quitTrellis(true);
		}
	};
	
	
	this.promptForRestartInTroubleshootingMode = async function () {
		let ps = Services.prompt;
		let [title, description] = await document.l10n.formatValues([
			'restart-in-troubleshooting-mode-dialog-title',
			'restart-in-troubleshooting-mode-dialog-description'
		]);
		let buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL;
		let index = ps.confirmEx(
			null,
			title,
			description,
			buttonFlags,
			Trellis.getString('general.restartNow'),
			null, null, null, {}
		);
		
		if (index == 0) {
			Services.startup.restartInSafeMode(Ci.nsIAppStartup.eAttemptQuit);
		}
	};
	
	
	this.updateAddonsPane = function (doc) {
		//var rootWindow = doc.ownerGlobal.windowRoot.ownerGlobal;
		
		// Update message when no plugins installed
		setTimeout(() => {
			var emptyListMessage = doc.getElementById('empty-list-message');
			emptyListMessage.innerHTML = Trellis.Utilities.htmlSpecialChars(
					Trellis.getString("addons.emptyListMessage")
				).replace(
					/\[([^\]]+)]/,
					`<a href="${TRELLIS_CONFIG.PLUGINS_URL}">$1</a>`
				);
			emptyListMessage.addEventListener('click', (event) => {
				Trellis.launchURL(TRELLIS_CONFIG.PLUGINS_URL);
				event.preventDefault();
				event.stopPropagation();
			});
		});
		
		// Make our own removal prompt instead of using BrowserAddonUI.promptRemoveExtension() from
		// browser-addons.js
		doc.ownerGlobal.promptRemoveExtension = function (addon) {
			var { name } = addon;
			var ps = Services.prompt;
			var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
				+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL;
			var result = ps.confirmEx(
				doc.ownerGlobal,
				Trellis.getString('addons.remove.title', name),
				Trellis.getString('addons.remove.text', [name, Trellis.appName]),
				buttonFlags,
				Trellis.getString('general.remove'),
				null,
				null,
				"",
				{}
			);
			return { remove: result === 0, report: null };
		};
		// A11y: when a popup appears, mark which buttons are checked for screen readers
		doc.addEventListener("shown", (event) => {
			for (let item of [...event.target.querySelectorAll("panel-item")]) {
				item.button.setAttribute("role", "menuitemcheckbox");
				item.button.setAttribute("aria-checked", item.checked);
			}
		}, true);

		// A11y: after a click, check if the panel with plugin details appeared.
		// If so, delete a misleading role=tabpanel because default firefox tabs
		// ("Details" and "Permissions") are explicitly hidden in fetch_xulrunner
		doc.addEventListener("click", (_) => {
			setTimeout(() => {
				let details = doc.querySelector("#details-deck section[role='tabpanel']");
				if (!details) return;
				details.removeAttribute("role");
			});
		}, true);
	}
	
	/**
	 * Handles help menu requests
	 */
	this.openHelp = function (type) {
		switch (type) {
		case "troubleshooting":
			TrellisPane.loadURI(TRELLIS_CONFIG.TROUBLESHOOTING_URL);
			break;
		
		case "feedback":
			TrellisPane.loadURI(TRELLIS_CONFIG.FEEDBACK_URL);
			break;
		
		case "connectors":
			TrellisPane.loadURI(TRELLIS_CONFIG.CONNECTORS_URL);
			break;
		
		default:
			TrellisPane.loadURI(TRELLIS_CONFIG.SUPPORT_URL);
		}
	}

	/**
	 * Checks for updates
	 */
	this.checkForUpdates = function () {
		Trellis.debug('TrellisStandalone.checkForUpdates is deprecated -- use Trellis.openCheckForUpdatesWindow() instead');
		Trellis.openCheckForUpdatesWindow();
	}
	
	/**
	 * Called before standalone window is closed
	 */
	this.onUnload = function () {
		Trellis.Notifier.unregisterObserver(this._notifierID);
		TrellisPane.destroy();
	}
}


TrellisStandalone.DebugOutput = {
	_timer: null,
	
	init: function () {
		var storing = Trellis.Debug.storing;
		this._showMenu();
		this.update();
	},
	
	
	toggleStore: function () {
		Trellis.Debug.setStore(!Trellis.Debug.storing);
	},
	
	
	update: function () {
		var enabled = Trellis.Debug.storing;
		var lines = Trellis.Debug.count();
		var empty = lines == 0;
		
		// Show "Submit" when enabled, but leave disabled until there's output
		var menuitem = document.getElementById('debug-output-submit');
		menuitem.hidden = !enabled && empty;
		menuitem.disabled = empty;
		
		// Toggle between "Enable" and "Disable"
		menuitem = document.getElementById('debug-output-enable-disable');
		menuitem.label = Trellis.getString('general.' + (enabled ? 'disable' : 'enable'));
		
		// Update line count
		var str = Trellis.getString('trellis.debugOutputLogging.linesLogged', lines, lines);
		document.getElementById('debug-output-status').label = str;
		
		// Enable "Clear" when there's output
		document.getElementById('debug-output-clear').disabled = empty;
	},
	
	
	submit: async function () {
		Trellis.debug("Submitting debug output");
		
		var url = TRELLIS_CONFIG.REPOSITORY_URL + "report?debug=1";
		var output = await Trellis.Debug.get(
			Trellis.Prefs.get('debug.store.submitSize'),
			Trellis.Prefs.get('debug.store.submitLineLength')
		);
		Trellis.Debug.setStore(false);
		
		var ps = Services.prompt;
		try {
			var xmlhttp = await Trellis.HTTP.request(
				"POST",
				url,
				{
					compressBody: true,
					body: output,
					logBodyLength: 30,
					timeout: 15000,
					requestObserver: function (req) {
						// Don't fail during tests, with fake XHR
						if (!req.channel) {
							return;
						}
						req.channel.notificationCallbacks = {
							onProgress: function (request, progress, progressMax) {},
							
							// nsIInterfaceRequestor
							getInterface: function (iid) {
								try {
									return this.QueryInterface(iid);
								}
								catch (e) {
									throw Components.results.NS_NOINTERFACE;
								}
							},
							
							QueryInterface: function (iid) {
								if (iid.equals(Components.interfaces.nsISupports) ||
										iid.equals(Components.interfaces.nsIInterfaceRequestor) ||
										iid.equals(Components.interfaces.nsIProgressEventSink)) {
									return this;
								}
								throw Components.results.NS_NOINTERFACE;
							},
			
						}
					}
				}
			);
		}
		catch (e) {
			Trellis.logError(e);
			let title = Trellis.getString('general.error');
			let msg;
			if (e instanceof Trellis.HTTP.UnexpectedStatusException) {
				msg = Trellis.getString('general.invalidResponseServer');
			}
			else if (e instanceof Trellis.HTTP.BrowserOfflineException) {
				msg = Trellis.getString('general.browserIsOffline', Trellis.appName);
			}
			else {
				msg = Trellis.getString('trellis.debugOutputLogging.dialog.error');
			}
			ps.alert(null, title, msg);
			return false;
		}
		
		Trellis.debug(xmlhttp.responseText);
		
		var reported = xmlhttp.responseXML.getElementsByTagName('reported');
		if (reported.length != 1) {
			ps.alert(
				null,
				Trellis.getString('general.error'),
				Trellis.getString('general.serverError')
			);
			return false;
		}
		
		var reportID = reported[0].getAttribute('reportID');
		
		var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_CANCEL;
		var index = ps.confirmEx(
			null,
			Trellis.getString('trellis.debugOutputLogging.dialog.title'),
			Trellis.getString('trellis.debugOutputLogging.dialog.sent', [TRELLIS_CONFIG.DOMAIN_NAME, reportID]),
			buttonFlags,
			Trellis.getString('general.copyToClipboard'),
			null, null, null, {}
		);
		if (index == 0) {
			const helper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
				.getService(Components.interfaces.nsIClipboardHelper);
			helper.copyString("D" + reportID);
		}
		
		Trellis.Debug.clear();
		return true;
	},
	
	
	view: function () {
		Trellis.openInViewer("chrome://trellis/content/debugViewer.html", {
			onLoad(doc) {
				var submitted = false;
				doc.querySelector('#submit-button').addEventListener('click', function (event) {
					submitted = true;
				});
				doc.querySelector('#clear-button').addEventListener('click', function (event) {
					Trellis.Debug.clear();
				});
				// If output has been submitted, disable logging when window is closed
				doc.defaultView.addEventListener('unload', function (event) {
					if (submitted) {
						Trellis.Debug.setStore(false);
						Trellis.Debug.clear();
					}
				});
			}
		});
	},
	
	
	clear: function () {
		Trellis.Debug.clear();
	},
	
	
	restartEnabled: function () {
		var checkbox = { value: true };
		var index = Trellis.Prompt.confirm({
			title: Trellis.getString('trellis.debugOutputLogging'),
			text: Trellis.getString('trellis.debugOutputLogging.enabledAfterRestart', [Trellis.clientName]),
			button0: Trellis.getString('general-restartApp'),
			button1: Services.prompt.BUTTON_TITLE_CANCEL,
			checkLabel: Trellis.getString('debug-output-logging-restart-in-troubleshooting-mode-checkbox'),
			checkbox,
		});
		if (index == 0) {
			Trellis.Prefs.set('debug.store', true);
			
			// Restart in Troubleshooting Mode
			if (checkbox.value) {
				Services.startup.restartInSafeMode(Ci.nsIAppStartup.eAttemptQuit);
			}
			// Restart in normal mode
			else {
				Trellis.Utilities.Internal.quit(true);
			}
		}
	},
	
	
	_showMenu: function () {
		document.getElementById('debug-output-menu').hidden = false;
	}
};


async function toJavaScriptConsole() {
	// We need the DevTools' built-in require() for this
	const { require } = ChromeUtils.importESModule("resource://devtools/shared/loader/Loader.sys.mjs");
	const { BrowserConsoleManager } = require("resource://devtools/client/webconsole/browser-console-manager.js");
	await BrowserConsoleManager.openBrowserConsoleOrFocus();
	// Add missing aria labels for the the VPAT review
	let win = Services.wm.getMostRecentWindow("devtools:webconsole");
	// X button next to "Filter ouput"
	win.document.querySelector(".devtools-searchinput-clear").setAttribute("aria-label", "Clear filter");
	// The actual input line
	win.document.querySelector(".flexible-output-input textarea").setAttribute("aria-label", "Input line");
}

function openRunJSWindow() {
	openWindowByType(
		'chrome://trellis/content/runJS.html',
		'trellis:run-js',
		'chrome,width=900,height=700,resizable,centerscreen'
	);
}

function openStyleEditor() {
	openWindowByType(
		'chrome://trellis/content/tools/csledit.xhtml',
		'trellis:style-editor',
		'chrome,width=950,height=700,resizable'
	);
}

function openScaffold() {
	openWindowByType(
		'chrome://scaffold/content/scaffold.xhtml',
		'trellis:scaffold',
		'chrome,menubar,resizable'
	);
}

function openWindowByType(uri, type, features) {
	var win = Services.wm.getMostRecentWindow(type);
	
	if (win) {
		win.focus();
	}
	else if (features) {
		window.open(uri, "_blank", features);
	}
	else {
		window.open(uri, "_blank", "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar");
	}
}

const gXPInstallObserver = {
	observe: function (subject, topic, data) {
		const { installs } = subject.wrappedJSObject;
		switch (topic) {
			case "addon-install-disabled":
			case "addon-install-blocked":
			case "addon-install-failed":
				Trellis.alert(
					null,
					Trellis.getString("standalone.addonInstallationFailed.title"),
					Trellis.getString("standalone.addonInstallationFailed.body", [installs[0].name || installs[0].file.path]));
				break;
			/*case "addon-install-started":
			case "addon-install-complete":*/
		}
	}
};

// Used by update prompt
function openUILinkIn(url) {
	TrellisPane.loadURI(url);
}

window.addEventListener("load", function (e) { TrellisStandalone.onLoad(e); }, false);
window.addEventListener("unload", function (e) { TrellisStandalone.onUnload(e); }, false);
