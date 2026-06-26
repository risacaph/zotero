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

Trellis_Preferences.General = {
	_openURLResolvers: null,

	init: function () {
		// JS-based strings
		var checkbox = document.getElementById('launchNonNativeFiles-checkbox');
		if (checkbox) {
			checkbox.label = Trellis.getString(
				'trellis.preferences.launchNonNativeFiles', Trellis.appName
			);
		}
		var menuitems = document.querySelectorAll('.fileHandler-internal');
		for (let menuitem of menuitems) {
			menuitem.setAttribute('label', Trellis.appName);
		}

		// Set OpenURL resolver drop-down to last-known name or "custom" placeholder
		let resolverName = Trellis.getString("general.custom");
		if (Trellis.Prefs.get('openURL.resolver')) {
			let name = Trellis.Prefs.get('openURL.name');
			if (name) {
				resolverName = name;
			}
		}
		document.getElementById('openurl-primary-popup').firstChild.setAttribute('label', resolverName);
		
		this.refreshLocale();
		this._initItemPaneHeaderUI();
		this._updateFileHandlerUI();
		this._initEbookFontFamilyMenu();
		this._initAutoDisableToolCheckbox();
	},

	uninit: function () {
	},

	_getAutomaticLocaleMenuLabel: function () {
		return Trellis.getString(
			'trellis.preferences.locale.automaticWithLocale',
			Trellis.Locale.availableLocales[Trellis.locale] || Trellis.locale
		);
	},
	
	
	refreshLocale: function () {
		var autoLocaleName, currentValue;
		
		// If matching OS, get the name of the current locale
		if (Trellis.Prefs.get('intl.locale.requested', true) === '') {
			autoLocaleName = this._getAutomaticLocaleMenuLabel();
			currentValue = 'automatic';
		}
		// Otherwise get the name of the locale specified in the pref
		else {
			autoLocaleName = Trellis.getString('trellis.preferences.locale.automatic');
			currentValue = Trellis.locale;
		}
		
		// Populate menu
		var menu = document.getElementById('locale-menu');
		var menupopup = menu.firstChild;
		menupopup.textContent = '';
		// Show "Automatic (English)", "Automatic (Français)", etc.
		menu.appendItem(autoLocaleName, 'automatic');
		menu.menupopup.appendChild(document.createXULElement('menuseparator'));
		// Add all available locales
		for (let locale in Trellis.Locale.availableLocales) {
			menu.appendItem(Trellis.Locale.availableLocales[locale], locale);
		}
		menu.value = currentValue;
	},
	
	onLocaleChange: function () {
		var requestedLocale = Services.locale.requestedLocale;
		var menu = document.getElementById('locale-menu');
		
		if (menu.value == 'automatic') {
			// Changed if not already set to automatic (unless we have the automatic locale name,
			// meaning we just switched away to the same manual locale and back to automatic)
			var changed = requestedLocale
				&& requestedLocale == Trellis.locale
				&& menu.label != this._getAutomaticLocaleMenuLabel();
			Services.locale.requestedLocales = [];
		}
		else {
			// Changed if moving to a locale other than the current one
			var changed = requestedLocale != menu.value
			Services.locale.requestedLocales = [menu.value];
		}
		
		// https://searchfox.org/mozilla-central/rev/961a9e56a0b5fa96ceef22c61c5e75fb6ba53395/browser/base/content/utilityOverlay.js#383-387
		if (Services.locale.isAppLocaleRTL) {
			Trellis.Prefs.set("bidi.browser.ui", true, true);
		}
		
		if (!changed) {
			return;
		}
		
		var ps = Services.prompt;
		var buttonFlags = ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING
			+ ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING;
		var index = ps.confirmEx(null,
			Trellis.getString('general.restartRequired'),
			Trellis.getString('general.restartRequiredForChange', Trellis.appName),
			buttonFlags,
			Trellis.getString('general.restartNow'),
			Trellis.getString('general.restartLater'),
			null, null, {});
		
		if (index == 0) {
			Trellis.Utilities.Internal.quitTrellis(true);
		}
	},

	_initItemPaneHeaderUI() {
		let pane = document.querySelector('#trellis-prefpane-general');
		let headerMenu = document.querySelector('#item-pane-header-menulist');
		let styleMenu = document.querySelector('#item-pane-header-style-menu');

		this._updateItemPaneHeaderStyleUI();
		pane.addEventListener('showing', () => this._updateItemPaneHeaderStyleUI());
		
		// menulists stop responding to clicks if we replace their items while
		// they're closing. Yield back to the event loop before updating to
		// avoid this.
		let updateUI = () => {
			setTimeout(() => {
				this._updateItemPaneHeaderStyleUI();
			});
		};
		headerMenu.addEventListener('command', updateUI);
		styleMenu.addEventListener('command', updateUI);
	},
	
	_updateItemPaneHeaderStyleUI: Trellis.Utilities.Internal.serial(async function () {
		let optionsContainer = document.querySelector('#item-pane-header-bib-entry-options');
		let styleMenu = document.querySelector('#item-pane-header-style-menu');
		let localeMenu = document.querySelector('#item-pane-header-locale-menu');

		optionsContainer.hidden = Trellis.Prefs.get('itemPaneHeader') !== 'bibEntry';
		if (optionsContainer.hidden) {
			return;
		}
		
		if (!Trellis.Styles.initialized()) {
			let menus = [styleMenu, localeMenu];
			for (let menu of menus) {
				menu.selectedItem = null;
				menu.setAttribute('label', Trellis.getString('general.loading'));
				menu.disabled = true;
			}
			await Trellis.Styles.init();
			for (let menu of menus) {
				menu.disabled = false;
			}
		}

		let currentStyle = Trellis.Styles.get(styleMenu.value);
		let currentLocale = Trellis.Prefs.get('itemPaneHeader.bibEntry.locale');

		styleMenu.menupopup.replaceChildren();
		for (let style of Trellis.Styles.getVisible()) {
			let menuitem = document.createXULElement('menuitem');
			menuitem.label = style.title;
			menuitem.value = style.styleID;
			styleMenu.menupopup.append(menuitem);
		}
		
		if (currentStyle) {
			if (currentStyle.styleID !== styleMenu.value) {
				// Style has been renamed
				styleMenu.value = currentStyle.styleID;
			}

			if (!localeMenu.menupopup.childElementCount) {
				Trellis.Styles.populateLocaleList(localeMenu);
			}
			Trellis.Styles.updateLocaleList(localeMenu, currentStyle, currentLocale);
		}
		else {
			// Style is unknown/removed - show placeholder
			let shortName = styleMenu.value.replace('http://www.trellis.org/styles/', '');
			let missingLabel = await document.l10n.formatValue(
				'preferences-item-pane-header-missing-style',
				{ shortName }
			);
			styleMenu.selectedItem = null;
			styleMenu.setAttribute('label', missingLabel);
		}
	}),
	
	openFileRenamingDialog: function () {
		Services.ww.openWindow(null, 'chrome://trellis/content/fileRenamingDialog.xhtml',
			'trellis-file-renaming-dialog', 'chrome,dialog=no,titlebar,centerscreen,resizable=yes', null
		);
	},

	//
	// File handlers
	//
	chooseFileHandler: async function (type) {
		var pref = this._getFileHandlerPref(type);
		var currentPath = Trellis.Prefs.get(pref);
		
		var fp = new FilePicker();
		if (currentPath && currentPath != 'system') {
			fp.displayDirectory = PathUtils.parent(currentPath);
		}
		fp.init(
			window,
			Trellis.getString('trellis.preferences.chooseApplication'),
			fp.modeOpen
		);
		fp.appendFilters(fp.filterApps);
		if (await fp.show() != fp.returnOK) {
			this._updateFileHandlerUI();
			return false;
		}
		this.setFileHandler(type, fp.file);
	},
	
	setFileHandler: function (type, handler) {
		var pref = this._getFileHandlerPref(type);
		
		var isTrellis = false;
		if (Trellis.isMac) {
			isTrellis = /Trellis.*\.app/.test(handler);
		}
		else if (Trellis.isWindows) {
			isTrellis = handler.endsWith('\\trellis.exe');
		}
		else if (Trellis.isLinux) {
			isTrellis = handler.endsWith('/trellis');
		}
		// Reset to the internal reader if pointing to Trellis
		if (isTrellis) {
			handler = '';
		}
		
		Trellis.Prefs.set(pref, handler);
		this._updateFileHandlerUI();
	},
	
	_updateFileHandlerUI: function () {
		function update(type) {
			let handler = Trellis.Prefs.get('fileHandler.' + type);
			let menulist = document.getElementById('fileHandler-' + type);
			var customMenuItem = menulist.querySelector('.fileHandler-custom');
			
			// System default
			if (handler == 'system') {
				customMenuItem.hidden = true;
				menulist.selectedIndex = 1;
			}
			// Custom handler
			else if (handler) {
				let icon;
				try {
					let urlspec = Trellis.File.pathToFileURI(handler);
					icon = "moz-icon://" + urlspec + "?size=16";
				}
				catch (e) {
					Trellis.logError(e);
				}

				let handlerFilename = PathUtils.filename(handler);
				if (Trellis.isMac) {
					handlerFilename = handlerFilename.replace(/\.app$/, '');
				}
				customMenuItem.setAttribute('label', handlerFilename);
				if (icon) {
					customMenuItem.classList.add('menuitem-iconic');
					customMenuItem.setAttribute('image', icon);
				}
				else {
					customMenuItem.classList.remove('menuitem-iconic');
				}
				customMenuItem.hidden = false;
				menulist.selectedIndex = 2;

				// There's almost certainly a better way to do this...
				// but why doesn't the icon just behave by default?
				menulist.shadowRoot.querySelector('[part="icon"]').style.height = '16px';
			}
			// Trellis
			else {
				menulist.selectedIndex = 0;
				customMenuItem.hidden = true;
			}
		}
		
		update('pdf');
		update('epub');
		update('snapshot');
		var inNewWindowCheckbox = document.getElementById('open-reader-in-new-window');
		inNewWindowCheckbox.disabled = ['pdf', 'epub', 'snapshot'].every(type => Trellis.Prefs.get('fileHandler.' + type));
	},
	
	_getFileHandlerPref: function (type) {
		if (type != 'pdf' && type != 'epub' && type != 'snapshot') {
			throw new Error(`Unknown file type ${type}`);
		}
		return 'fileHandler.' + type;
	},

	handleOpenURLPopupShowing: async function (event) {
		if (event.target.id != 'openurl-primary-popup') {
			return;
		}
		var openURLMenu = document.getElementById('openurl-menu');
		let openURLMenuFirstItem = openURLMenu.menupopup.firstChild;
		if (!this._openURLResolvers) {
			openURLMenuFirstItem.setAttribute('label', Trellis.getString('general.loading'));
			try {
				this._openURLResolvers = await Trellis.Utilities.Internal.OpenURL.getResolvers();
			}
			catch (e) {
				Trellis.logError(e);
				openURLMenu.menupopup.firstChild.setAttribute('label', "Error loading resolvers");
				return;
			}
		}
		// Set top-most item to "Custom" once the menu appears
		openURLMenuFirstItem.setAttribute('label', Trellis.getString('general.custom'));
		openURLMenuFirstItem.setAttribute('value', 'custom');
		this.updateOpenURLResolversMenu();
	},
	
	handleOpenURLPopupHidden(event) {
		if (event.target.id != 'openurl-primary-popup') {
			return;
		}
		// Clear the menu so that on Windows arrowUp/Down does not select an invalid
		// top-level entry (e.g. North America)
		this.emptyOpenURLMenu();
		// Set the proper values on the first item to be displayed when dropdown closes
		let firstItem = document.getElementById('openurl-menu').menupopup.firstChild;
		if (Trellis.Prefs.get('openURL.resolver')) {
			firstItem.setAttribute("value", Trellis.Prefs.get('openURL.resolver'));
		}
		if (Trellis.Prefs.get('openURL.name')) {
			firstItem.setAttribute("label", Trellis.Prefs.get('openURL.name'));
		}
		// Ensures that arrow keys will navigate the menu in case of subsequent opening on windows
		document.getElementById('openurl-menu').selectedItem = firstItem;
	},

	// Clear all menus, except for the top-most "Custom" menuitem. That item is selected
	// when menu opens and, if removed while still selected, keyboard navigation may break.
	emptyOpenURLMenu() {
		var openURLMenu = document.getElementById('openurl-menu');
		var menupopup = openURLMenu.firstChild;
		while (menupopup.childNodes.length > 1) menupopup.removeChild(menupopup.lastChild);
	},
	
	
	updateOpenURLResolversMenu: function () {
		if (!this._openURLResolvers) {
			Trellis.debug("Resolvers not loaded -- not updating menu");
			return;
		}
		
		var currentResolver = Trellis.Prefs.get('openURL.resolver');
		
		var openURLMenu = document.getElementById('openurl-menu');
		var menupopup = openURLMenu.firstChild;
		let firstItem = menupopup.firstChild;
		this.emptyOpenURLMenu();
		
		menupopup.appendChild(document.createXULElement('menuseparator'));
		
		var selectedName;
		var lastContinent;
		var lastCountry;
		var currentContinentPopup;
		var currentMenuPopup;
		for (let r of this._openURLResolvers) {
			// Create submenus for continents
			if (r.continent != lastContinent) {
				let menu = document.createXULElement('menu');
				menu.setAttribute('label', r.continent);
				openURLMenu.firstChild.appendChild(menu);
				
				currentContinentPopup = currentMenuPopup = document.createXULElement('menupopup');
				menu.appendChild(currentContinentPopup);
				lastContinent = r.continent;
			}
			if (r.country != lastCountry) {
				// If there's a country, create a submenu for it
				if (r.country) {
					let menu = document.createXULElement('menu');
					menu.setAttribute('label', r.country);
					currentContinentPopup.appendChild(menu);
					
					let menupopup = document.createXULElement('menupopup');
					menu.appendChild(menupopup);
					currentMenuPopup = menupopup;
				}
				// Otherwise use the continent popup
				else {
					currentMenuPopup = currentContinentPopup;
				}
				lastCountry = r.country;
			}
			let menuitem = document.createXULElement('menuitem');
			menuitem.setAttribute('label', r.name);
			menuitem.setAttribute('value', r.url);
			menuitem.setAttribute('type', 'checkbox');
			currentMenuPopup.appendChild(menuitem);
			var checked = r.url == Trellis.Prefs.get('openURL.resolver');
			menuitem.setAttribute('checked', checked);
			if (checked) {
				selectedName = r.name;
			}
		}
		
		// From directory
		if (selectedName) {
			openURLMenu.setAttribute('label', selectedName);
			// If we found a match, update stored name
			Trellis.Prefs.set('openURL.name', selectedName);
			firstItem.setAttribute('checked', false);
		}
		// Custom
		else {
			openURLMenu.setAttribute('label', Trellis.getString('general.custom'));
			firstItem.setAttribute('checked', true);
			Trellis.Prefs.clear('openURL.name');
		}
	},
	
	
	handleOpenURLSelected: function (event) {
		event.stopPropagation();
		event.preventDefault();
		
		if (event.target.localName != 'menuitem') {
			Trellis.debug("Ignoring click on " + event.target.localName);
			return;
		}
		
		var openURLMenu = document.getElementById('openurl-menu');
		
		var openURLServerField = document.getElementById('openURLServerField');
		
		// If "Custom" selected, clear URL field
		if (event.target.value == "custom") {
			Trellis.Prefs.clear('openURL.name');
			Trellis.Prefs.set('openURL.resolver', '');
			openURLServerField.value = '';
			openURLServerField.focus();
		}
		else {
			Trellis.Prefs.set('openURL.name', openURLServerField.value = event.target.label);
			Trellis.Prefs.set('openURL.resolver', openURLServerField.value = event.target.value);
		}
	},
	
	onOpenURLCustomized: function () {
		// Change resolver preference to "custom"
		let firstItem = document.getElementById('openurl-menu').menupopup.firstChild;
		firstItem.setAttribute('label', Trellis.getString('general.custom'));
		firstItem.setAttribute('value', 'custom');
		Trellis.Prefs.clear('openURL.name');
	},

	EBOOK_FONT_STACKS: {
		Baskerville: 'Baskerville, serif',
		Charter: 'Charter, serif',
		Futura: 'Futura, sans-serif',
		Georgia: 'Georgia, serif',
		// Helvetica and equivalent-ish
		Helvetica: 'Helvetica, Arial, Open Sans, Liberation Sans, sans-serif',
		Iowan: 'Iowan, serif',
		'New York': 'New York, serif',
		OpenDyslexic: 'OpenDyslexic, eulexia, serif',
		// Windows has called Palatino by many names
		Palatino: 'Palatino, Palatino Linotype, Adobe Palatino, Book Antiqua, URW Palladio L, FPL Neu, Domitian, serif',
		// Times New Roman and equivalent-ish
		'Times New Roman': 'Times New Roman, Linux Libertine, Liberation Serif, serif',
	},

	async _initEbookFontFamilyMenu() {
		let enumerator = Cc["@mozilla.org/gfx/fontenumerator;1"].createInstance(Ci.nsIFontEnumerator);
		let fonts = new Set(await enumerator.EnumerateAllFontsAsync());

		let menulist = document.getElementById('reader-ebook-font-family');
		let popup = menulist.menupopup;
		for (let [label, stack] of Object.entries(this.EBOOK_FONT_STACKS)) {
			// If no font in the stack exists on the user's system, don't add it to the list
			// Exclude the generic family name at the end, which is only there in case no font specified by name in the
			// stack supports a specific character (e.g. non-Latin)
			if (!stack.split(', ').slice(0, -1).some(font => fonts.has(font))) {
				continue;
			}
			
			let menuitem = document.createXULElement('menuitem');
			menuitem.label = label;
			menuitem.value = stack;
			menuitem.style.fontFamily = stack;
			popup.append(menuitem);
		}

		if (popup.childElementCount && fonts.size) {
			popup.append(document.createXULElement('menuseparator'));
		}
		for (let font of fonts) {
			let menuitem = document.createXULElement('menuitem');
			menuitem.label = font;
			menuitem.value = font;
			menuitem.style.fontFamily = `'${font.replace(/'/g, "\\'")}'`;
			popup.append(menuitem);
		}
	},

	_initAutoDisableToolCheckbox() {
		let checkbox = document.getElementById('auto-disable-tool');
		checkbox.addEventListener('command', () => {
			let value = checkbox.checked;
			Trellis.Prefs.set('reader.autoDisableTool.note', value);
			Trellis.Prefs.set('reader.autoDisableTool.text', value);
			Trellis.Prefs.set('reader.autoDisableTool.image', value);
			checkbox.querySelector('.checkbox-check').style.opacity = 'unset';
		});

		let values = [
			Trellis.Prefs.get('reader.autoDisableTool.note'),
			Trellis.Prefs.get('reader.autoDisableTool.text'),
			Trellis.Prefs.get('reader.autoDisableTool.image')
		];
		if (values.every(x => x)) {
			checkbox.checked = true;
		}
		else if (values.every(x => !x)) {
			checkbox.checked = false;
		}
		else {
			checkbox.checked = true;
			// XUL checkbox doesn't support 'indeterminate' property, therefore making it grayish instead
			checkbox.querySelector('.checkbox-check').style.opacity = '0.5';
		}
	}
}
