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

Trellis.Styles = new function () {
	var _initialized = false;
	var _initializationDeferred = false;
	var _styles, _visibleStyles;
	
	var _renamedStyles = null;
	
	this.xsltProcessor = null;
	this.ns = {
		"csl":"http://purl.org/net/xbiblio/csl"
	};

	this.CSL_VALIDATOR_URL = "resource://trellis/csl-validator-wasm/worker.mjs";

	this._memoryPressureObserver = {
		observe: (subject, topic) => {
			if (topic !== 'memory-pressure') {
				return;
			}
			for (let style of Object.values(this.getAll())) {
				style.clearEngineCache();
			}
		},
		QueryInterface: ChromeUtils.generateQI(['nsISupportsWeakReference']),
	};
	Services.obs.addObserver(this._memoryPressureObserver, 'memory-pressure', /* ownsWeak */ true);
	
	
	/**
	 * Initializes styles cache, loading metadata for styles into memory
	 */
	this.init = async function (options = {}) {
		if (Trellis.Prefs.get('cite.useCiteprocRs')) {
			await Trellis.CiteprocRs.init();
		}
		
		// Wait until bundled files have been updated, except when this is called by the schema update
		// code itself
		if (!options.fromSchemaUpdate) {
			await Trellis.Schema.schemaUpdatePromise;
		}
		
		// If an initialization has already started, a regular init() call should return the promise
		// for that (which may already be resolved). A reinit should yield on that but then continue
		// with reinitialization.
		if (_initializationDeferred) {
			let promise = _initializationDeferred.promise;
			if (options.reinit) {
				await promise;
			}
			else {
				return promise;
			}
		}
		
		_initializationDeferred = Trellis.Promise.defer();
		
		Trellis.debug("Initializing styles");
		var start = new Date;
		
		// Upgrade style locale prefs for 4.0.27
		var bibliographyLocale = Trellis.Prefs.get("export.bibliographyLocale");
		if (bibliographyLocale) {
			Trellis.Prefs.set("export.lastLocale", bibliographyLocale);
			Trellis.Prefs.set("export.quickCopy.locale", bibliographyLocale);
			Trellis.Prefs.clear("export.bibliographyLocale");
		}
		
		_styles = {};
		_visibleStyles = [];
		
		// main dir
		var dir = Trellis.getStylesDirectory().path;
		var num = await _readStylesFromDirectory(dir, false);
		
		// hidden dir
		var hiddenDir = OS.Path.join(dir, 'hidden');
		if (await OS.File.exists(hiddenDir)) {
			num += await _readStylesFromDirectory(hiddenDir, true);
		}

		// Load renamed styles
		_renamedStyles = JSON.parse(
			await Trellis.File.getResourceAsync("resource://trellis/schema/renamed-styles.json")
		);

		// Delete installed styles that have been renamed if the new style is also installed
		var prefix = "http://www.trellis.org/styles/";
		for (let oldName in _renamedStyles) {
			let oldID = prefix + oldName;
			let newID = prefix + _renamedStyles[oldName];
			if (_styles[oldID] && _styles[newID]) {
				Trellis.debug("Deleting renamed style '" + oldID + "'");
				try {
					await OS.File.remove(_styles[oldID].path);
					delete _styles[oldID];
				}
				catch (e) {
					Trellis.logError(e);
				}
			}
		}
		_visibleStyles = _visibleStyles.filter(s => _styles[s.styleID]);

		// Sort visible styles by title
		_visibleStyles.sort(function (a, b) {
			return a.title.localeCompare(b.title);
		})
		// .. and freeze, so they can be returned directly
		_visibleStyles = Object.freeze(_visibleStyles);
		
		Trellis.debug("Cached " + num + " styles in " + (new Date - start) + " ms");
		
		// load available CSL locales
		var localeFile = {};
		var locales = {};
		var primaryDialects = {};
		localeFile = JSON.parse(
			await Trellis.File.getResourceAsync("chrome://trellis/content/locale/csl/locales.json")
		);
		
		primaryDialects = localeFile["primary-dialects"];
		
		// only keep localized language name
		for (let locale in localeFile["language-names"]) {
			locales[locale] = localeFile["language-names"][locale][0];
		}
		
		this.locales = locales;
		this.primaryDialects = primaryDialects;

		_initializationDeferred.resolve();
		_initialized = true;
		
		// Styles are fully loaded, but we still need to trigger citeproc reloads in Integration
		// so that style updates are reflected in open documents
		Trellis.Integration.resetSessionStyles();
	};
	
	this.reinit = function (options = {}) {
		return this.init(Object.assign({}, options, { reinit: true }));
	};
	
	// This is used by bibliography.js to work around a weird interaction between Bluebird and modal
	// dialogs in tests. Calling `yield Trellis.Styles.init()` from `Trellis_File_Interface_Bibliography.init()`
	// in the modal Create Bibliography dialog results in a hang, so instead use a synchronous check for
	// initialization. The hang doesn't seem to happen (at least in the same way) outside of tests.
	this.initialized = function () {
		return _initialized;
	};
	
	/**
	 * Reads all styles from a given directory and caches their metadata
	 * @private
	 */
	var _readStylesFromDirectory = async function (dir, hidden) {
		var numCached = 0;
		
		var iterator = new OS.File.DirectoryIterator(dir);
		try {
			while (true) {
				let entries = await iterator.nextBatch(10); // TODO: adjust as necessary
				if (!entries.length) break;
				
				for (let i = 0; i < entries.length; i++) {
					let entry = entries[i];
					let path = entry.path;
					let fileName = entry.name;
					if (!fileName || fileName[0] === "."
							|| fileName.substr(-4).toLowerCase() !== ".csl"
							|| entry.isDir) continue;
					
					try {
						let code = await Trellis.File.getContentsAsync(path);
						var style = new Trellis.Style(code, path);
					}
					catch (e) {
						Components.utils.reportError(e);
						Trellis.debug(e, 1);
						continue;
					}
					if(style.styleID) {
						// same style is already cached
						if (_styles[style.styleID]) {
							Components.utils.reportError('Style with ID ' + style.styleID
								+ ' already loaded from ' + _styles[style.styleID].fileName);
						} else {
							// add to cache
							_styles[style.styleID] = style;
							_styles[style.styleID].hidden = hidden;
							if(!hidden) _visibleStyles.push(style);
						}
					}
					numCached++;
				}
			}
		}
		finally {
			iterator.close();
		}
		return numCached;
	};
	
	/**
	 * Gets a style with a given ID
	 * @param {String} id
	 * @param {Boolean} [skipMappings] Don't automatically return renamed style
	 */
	this.get = function (id, skipMappings) {
		if (!_initialized) {
			throw new Trellis.Exception.UnloadedDataException("Styles not yet loaded", 'styles');
		}
		
		if(!skipMappings) {
			var prefix = "http://www.trellis.org/styles/";
			var shortName = id.replace(prefix, "");
			if(_renamedStyles.hasOwnProperty(shortName) && _styles[prefix + _renamedStyles[shortName]]) {
				let newID = prefix + _renamedStyles[shortName];
				Trellis.debug("Mapping " + id + " to " + newID);
				return _styles[newID];
			}
		}
		
		return _styles[id] || false;
	};
	
	/**
	 * Gets all visible styles
	 * @return {Trellis.Style[]} - An immutable array of Trellis.Style objects
	 */
	this.getVisible = function () {
		if (!_initialized) {
			throw new Trellis.Exception.UnloadedDataException("Styles not yet loaded", 'styles');
		}
		return _visibleStyles; // Immutable
	}
	
	/**
	 * Gets all styles
	 *
	 * @return {Object} - An object with style IDs for keys and Trellis.Style objects for values
	 */
	this.getAll = function () {
		if (!_initialized) {
			throw new Trellis.Exception.UnloadedDataException("Styles not yet loaded", 'styles');
		}
		return _styles;
	}
	
	/**
	 * Validates a style
	 * @param {String} style The style, as a string
	 * @return {Promise} A promise representing the style file. This promise is rejected
	 *    with the validation error if validation fails, or resolved if it is not.
	 */
	this.validate = function (style) {
		return new Promise((resolve, reject) => {
			let worker = new Worker(this.CSL_VALIDATOR_URL, { type: 'module' });
			worker.onmessage = function (event) {
				if (event.data) {
					reject(event.data);
				}
				else {
					resolve();
				}
				worker.terminate();
			};
			worker.postMessage(style);
		});
	};
	
	/**
	 * Installs a style file, getting the contents of an nsIFile and showing appropriate
	 * error messages
	 * @param {Object} style - An object with one of the following properties
	 *      - file: An nsIFile or string path representing a style on disk
	 *      - path: A string path
	 *      - url: A url of the location of the style (local or remote)
	 *      - string: A string containing the style data
	 * @param {String} origin The origin of the style, either a filename or URL, to be
	 *     displayed in dialogs referencing the style
	 * @param {Boolean} [silent=false] Skip prompts
	 */
	this.install = async function (style, origin, silent=false) {
		var warnDeprecated;
		if (style instanceof Components.interfaces.nsIFile) {
			warnDeprecated = true;
			style = {file: style};
		} else if (typeof style == 'string') {
			warnDeprecated = true;
			style = {string: style};
		}
		if (warnDeprecated) {
			Trellis.debug("Trellis.Styles.install() now takes a style object as first argument -- update your code", 2);
		}
		
		try {
			if (style.file) {
				style.string = await Trellis.File.getContentsAsync(style.file);
			}
			else if (style.url) {
				style.string = await Trellis.File.getContentsFromURLAsync(style.url);
			}
			var { styleTitle, styleID } = await _install(style.string, origin, false, silent);
		}
		catch (error) {
			// Unless user cancelled, show an alert with the error
			if(typeof error === "object" && error instanceof Trellis.Exception.UserCancelled) return {};
			if(typeof error === "object" && error instanceof Trellis.Exception.Alert) {
				Trellis.logError(error);
				if (silent) {
					throw error;
				} else {
					error.present();
				}
			} else {
				Trellis.logError(error);
				if (silent) {
					throw error
				} else {
					(new Trellis.Exception.Alert("styles.install.unexpectedError",
						origin, "styles.install.title", error)).present();
				}
			}
		}
		return { styleTitle, styleID };
	};
	
	/**
	 * Installs a style
	 * @param {String} style The style as a string
	 * @param {String} origin The origin of the style, either a filename or URL, to be
	 *     displayed in dialogs referencing the style
	 * @param {Boolean} [hidden] Whether style is to be hidden.
	 * @param {Boolean} [silent=false] Skip prompts
	 * @return {Promise}
	 */
	var _install = async function (style, origin, hidden, silent=false) {
		if (!_initialized) await Trellis.Styles.init();
		
		var existingFile, destFile, source;
		
		// First, parse style and make sure it's valid XML
		var parser = new DOMParser(),
			doc = parser.parseFromString(style, "application/xml");
		
		var styleID = Trellis.Utilities.xpathText(doc, '/csl:style/csl:info[1]/csl:id[1]',
				Trellis.Styles.ns),
			// Get file name from URL
			m = /[^\/]+$/.exec(styleID),
			fileName = Trellis.File.getValidFileName(m ? m[0] : styleID),
			title = Trellis.Utilities.xpathText(doc, '/csl:style/csl:info[1]/csl:title[1]',
				Trellis.Styles.ns);
		
		if(!styleID || !title) {
			// If it's not valid XML, we'll return a promise that immediately resolves
			// to an error
			throw new Trellis.Exception.Alert("styles.installError", origin,
				"styles.install.title", "Style is not valid XML, or the styleID or title is missing");
		}
			
		// look for a parent
		source = Trellis.Utilities.xpathText(doc,
			'/csl:style/csl:info[1]/csl:link[@rel="source" or @rel="independent-parent"][1]/@href',
			Trellis.Styles.ns);
		if(source == styleID) {
			throw new Trellis.Exception.Alert("styles.installError", origin,
				"styles.install.title", "Style references itself as source");
		}
		
		// ensure csl extension
		if(fileName.substr(-4).toLowerCase() != ".csl") fileName += ".csl";
		
		destFile = Trellis.getStylesDirectory();
		var destFileHidden = destFile.clone();
		destFile.append(fileName);
		destFileHidden.append("hidden");
		if(hidden) Trellis.File.createDirectoryIfMissing(destFileHidden);
		destFileHidden.append(fileName);
		
		// look for an existing style with the same styleID or filename
		var existingTitle;
		if(_styles[styleID]) {
			existingFile = _styles[styleID].file;
			existingTitle = _styles[styleID].title;
		} else {
			if(destFile.exists()) {
				existingFile = destFile;
			} else if(destFileHidden.exists()) {
				existingFile = destFileHidden;
			}
			
			if(existingFile) {
				// find associated style
				for (let existingStyle of _styles) {
					if(destFile.equals(existingStyle.file)) {
						existingTitle = existingStyle.title;
						break;
					}
				}
			}
		}
		
		// also look for an existing style with the same title
		if(!existingFile) {
			let styles = Trellis.Styles.getAll();
			for (let i in styles) {
				let existingStyle = styles[i];
				if(title === existingStyle.title) {
					existingFile = existingStyle.file;
					existingTitle = existingStyle.title;
					break;
				}
			}
		}
		
		// display a dialog to tell the user we're about to install the style
		if(hidden) {
			destFile = destFileHidden;
		} else if (!silent) {
			if(existingTitle) {
				var text = Trellis.getString('styles.updateStyle', [existingTitle, title, origin]);
			} else {
				var text = Trellis.getString('styles.installStyle', [title, origin]);
			}
			
			var index = Services.prompt.confirmEx(null, Trellis.getString('styles.install.title'),
				text,
				((Services.prompt.BUTTON_POS_0) * (Services.prompt.BUTTON_TITLE_IS_STRING)
				+ (Services.prompt.BUTTON_POS_1) * (Services.prompt.BUTTON_TITLE_CANCEL)),
				Trellis.getString('general.install'), null, null, null, {}
			);
			
			if(index !== 0) {
				throw new Trellis.Exception.UserCancelled("style installation");
			}
		}
		
		await Trellis.Styles.validate(style)
		.catch(function (validationErrors) {
			Trellis.logError("Style from " + origin + " failed to validate:\n\n" + validationErrors);
			
			// If this is the parent of a dependent style, or if we're in
			// silent mode, suppress the prompt
			if (hidden || silent) return;
			
			// Otherwise, ask the user whether to continue installing
			var shouldInstall = Services.prompt.confirmEx(null,
				Trellis.getString('styles.install.title'),
				Trellis.getString('styles.validationWarning', [origin, Trellis.appName]),
				(Services.prompt.BUTTON_POS_0) * (Services.prompt.BUTTON_TITLE_OK)
				+ (Services.prompt.BUTTON_POS_1) * (Services.prompt.BUTTON_TITLE_CANCEL)
				+ Services.prompt.BUTTON_POS_1_DEFAULT + Services.prompt.BUTTON_DELAY_ENABLE,
				null, null, null, null, {}
			);
			if(shouldInstall !== 0) {
				throw new Trellis.Exception.UserCancelled("style installation");
			}
		});
		
		// User wants to install/update
		if(source && !_styles[source]) {
			// Need to fetch source
			if(source.substr(0, 7) === "http://" || source.substr(0, 8) === "https://") {
				try {
					let xmlhttp = await Trellis.HTTP.request("GET", source);
					await _install(xmlhttp.responseText, origin, true);
				}
				catch (e) {
					if (typeof e === "object" && e instanceof Trellis.Exception.Alert) {
						throw new Trellis.Exception.Alert(
							"styles.installSourceError",
							[origin, source],
							"styles.install.title",
							e
						);
					}
					throw e;
				}
			} else {
				throw new Trellis.Exception.Alert("styles.installSourceError", [origin, source],
					"styles.install.title", "Source CSL URI is invalid");
			}
		}
		
		// Dependent style has been retrieved if there was one, so we're ready to
		// continue
		
		// Remove any existing file with a different name
		if(existingFile) existingFile.remove(false);
		
		await Trellis.File.putContentsAsync(destFile, style);
		
		await Trellis.Styles.reinit();
		
		// Refresh preferences windows
		var enumerator = Services.wm.getEnumerator("trellis:pref");
		while(enumerator.hasMoreElements()) {
			var win = enumerator.getNext();
			if(win.Trellis_Preferences.Cite) {
				await win.Trellis_Preferences.Cite.refreshStylesList(styleID);
			}
		}
		return {
			styleTitle: existingTitle || title,
			styleID: styleID
		};
	};
	
	/**
	 * Populate menulist with locales
	 * 
	 * @param {xul:menulist} menulist
	 */
	this.populateLocaleList = function (menulist) {
		if (!_initialized) {
			throw new Trellis.Exception.UnloadedDataException("Styles not yet loaded", 'styles');
		}
		
		// Reset menulist
		menulist.selectedItem = null;
		menulist.removeAllItems();
		
		let fallbackLocale = Trellis.Styles.primaryDialects[Trellis.locale]
			|| Trellis.locale;
		
		let menuLocales = Trellis.Utilities.deepCopy(Trellis.Styles.locales);
		let menuLocalesKeys = Object.keys(menuLocales).sort();
		
		// Make sure that client locale is always available as a choice
		if (fallbackLocale && !(fallbackLocale in menuLocales)) {
			menuLocales[fallbackLocale] = fallbackLocale;
			menuLocalesKeys.unshift(fallbackLocale);
		}
		
		for (let i=0; i<menuLocalesKeys.length; i++) {
			menulist.appendItem(menuLocales[menuLocalesKeys[i]], menuLocalesKeys[i]);
		}
	}
	
	/**
	 * Update locale list state based on style selection.
	 *   For styles that do not define a locale, enable the list and select a
	 *     preferred locale.
	 *   For styles that define a locale, disable the list and select the
	 *     specified locale. If the locale does not exist, it is added to the list.
	 *   If null is passed instead of style, the list and its label are disabled,
	 *    and set to blank value.
	 * 
	 * Note: Do not call this function synchronously immediately after
	 *   populateLocaleList. The menulist items are added, but the values are not
	 *   yet set.
	 * 
	 * @param {xul:menulist} menulist Menulist object that will be manipulated
	 * @param {Trellis.Style} style Currently selected style
	 * @param {String} prefLocale Preferred locale if not overridden by the style
	 * 
	 * @return {String} The locale that was selected
	 */
	this.updateLocaleList = function (menulist, style, prefLocale) {
		if (!_initialized) {
			throw new Trellis.Exception.UnloadedDataException("Styles not yet loaded", 'styles');
		}
		
		// Remove any nodes that were manually added to menulist
		let availableLocales = [];
		for (let i=0; i<menulist.itemCount; i++) {
			let item = menulist.getItemAtIndex(i);
			if (item.getAttributeNS('trellis:', 'customLocale')) {
				item.remove();
				i--;
				continue;
			}
			
			availableLocales.push(item.value);
		}
		
		if (!style) {
			// disable menulist and label
			menulist.disabled = true;
			if (menulist.labelElement) menulist.labelElement.disabled = true;
			
			// set node to blank node
			// If we just set value to "", the internal label is collapsed and the dropdown list becomes shorter
			let blankListNode = menulist.appendItem('', '');
			blankListNode.setAttributeNS('trellis:', 'customLocale', true);
			
			menulist.selectedItem = blankListNode;
			return menulist.value;
		}
		
		menulist.disabled = !!style.effectiveLocale;
		if (menulist.labelElement) menulist.labelElement.disabled = false;
		
		let selectLocale = style.effectiveLocale || prefLocale || Trellis.locale;
		selectLocale = Trellis.Styles.primaryDialects[selectLocale] || selectLocale;
		
		// Make sure the locale we want to select is in the menulist
		if (availableLocales.indexOf(selectLocale) == -1) {
			var menuitem = menulist.ownerDocument.createXULElement('menuitem');
			menuitem.setAttribute('label', selectLocale);
			menuitem.setAttribute('value', selectLocale);
			menuitem.setAttributeNS('trellis:', 'customLocale', true);
			menulist.menupopup.append(menuitem);
		}
		
		return menulist.value = selectLocale;
	}
}

/**
 * @class Represents a style file and its metadata
 * @property {String} path The path to the style file
 * @property {String} fileName The name of the style file
 * @property {String} styleID
 * @property {String} url The URL where the style can be found (rel="self")
 * @property {String} type "csl" for CSL styles
 * @property {String} title
 * @property {String} updated SQL-style date updated
 * @property {String} class "in-text" or "note"
 * @property {String} source The CSL that contains the formatting information for this one, or null
 *	if this CSL contains formatting information
 * @property {Trellis.CSL} csl The Trellis.CSL object used to format using this style
 * @property {Boolean} hidden True if this style is hidden in style selection dialogs, false if it
 *	is not
 */
Trellis.Style = function (style, path) {
	if (typeof style != "string") {
		throw new Error("Style code must be a string");
	}
	
	this.type = "csl";
	
	var parser = new DOMParser(),
		doc = parser.parseFromString(style, "application/xml");
	if(doc.documentElement.localName === "parsererror") {
		throw new Error("File is not valid XML");
	}
	
	if (path) {
		this.path = path;
		this.fileName = PathUtils.filename(path);
	}
	else {
		this.string = style;
	}
	
	this.styleID = Trellis.Utilities.xpathText(doc, '/csl:style/csl:info[1]/csl:id[1]',
		Trellis.Styles.ns);
	this.url = Trellis.Utilities.xpathText(doc,
		'/csl:style/csl:info[1]/csl:link[@rel="self"][1]/@href',
		Trellis.Styles.ns);
	this.title = Trellis.Utilities.xpathText(doc, '/csl:style/csl:info[1]/csl:title[1]',
		Trellis.Styles.ns);
	this.updated = Trellis.Utilities.xpathText(doc, '/csl:style/csl:info[1]/csl:updated[1]',
		Trellis.Styles.ns).replace(/(.+)T([^\+]+)\+?.*/, "$1 $2");
	this.locale = Trellis.Utilities.xpathText(doc, '/csl:style/@default-locale',
		Trellis.Styles.ns) || null;
	
	this._class = doc.documentElement.getAttribute("class");
	this._usesAbbreviation = !!Trellis.Utilities.xpath(doc,
		'//csl:text[(@variable="container-title" and @form="short") or (@variable="container-title-short")][1]',
		Trellis.Styles.ns).length;
	this._hasBibliography = !!doc.getElementsByTagName("bibliography").length;
	this._version = doc.documentElement.getAttribute("version");
	if(!this._version) {
		this._version = "0.8";
		
		//In CSL 0.8.1, the "term" attribute on cs:category stored both
		//citation formats and fields.
		this.categories = Trellis.Utilities.xpath(
			doc, '/csl:style/csl:info[1]/csl:category', Trellis.Styles.ns)
		.filter(category => category.hasAttribute("term"))
		.map(category => category.getAttribute("term"));
	} else {
		//CSL 1.0 introduced a dedicated "citation-format" attribute on cs:category 
		this.categories = Trellis.Utilities.xpathText(doc,
			'/csl:style/csl:info[1]/csl:category[@citation-format][1]/@citation-format',
			Trellis.Styles.ns);
	}
	
	this.source = Trellis.Utilities.xpathText(doc,
		'/csl:style/csl:info[1]/csl:link[@rel="source" or @rel="independent-parent"][1]/@href',
		Trellis.Styles.ns);
	if(this.source === this.styleID) {
		throw new Error("Style with ID "+this.styleID+" references itself as source");
	}
	
	this._cachedEngines = new Map();
}

/**
 * The style's own default-locale, falling back to the parent's for dependent
 * styles that don't specify their own. citeproc-js parses the parent's XML and
 * will honor the parent's default-locale over any user-selected locale unless
 * forced, so this reflects the locale that will actually be used.
 */
Object.defineProperty(Trellis.Style.prototype, 'effectiveLocale', {
	get: function () {
		if (this.locale) return this.locale;
		if (this.source) {
			let parent = Trellis.Styles.get(this.source);
			if (parent) return parent.locale;
		}
		return null;
	}
});

/**
 * Get a citeproc-js CSL.Engine instance
 * @param {String} locale Locale code
 * @param {String} [format] Output format one of [rtf, html, text]
 * @param {GetCiteProcOptions | boolean} [options] If passed as a boolean, sets automaticJournalAbbreviations
 * @param {boolean} [options.automaticJournalAbbreviations] Abbreviate publication titles automatically
 * @param {boolean} [options.cache] Use the global CSL.Engine cache. CSL.Engine is highly stateful,
 * 		so this should only be used if you're aware of the pitfalls of reusing CSL.Engine instances.
 *
 * @typedef {{
 *     automaticJournalAbbreviations?: boolean;
 *     cache?: boolean;
 * }} GetCiteProcOptions
 */
Trellis.Style.prototype.getCiteProc = function (locale, format, options = {}) {
	if (typeof options === 'boolean') {
		options = { automaticJournalAbbreviations: options };
	}
	let { automaticJournalAbbreviations, cache } = options;
	
	locale = locale || Trellis.locale || 'en-US';
	format = format || 'text';
	automaticJournalAbbreviations = !!automaticJournalAbbreviations;

	let useCiteprocRs = Trellis.Prefs.get('cite.useCiteprocRs');
	
	// We can cache the Engine instance if we aren't using citeproc-rs
	// and this is an installed style. The output format is excluded from
	// the cache key because setOutputFormat() can switch it cheaply.
	let cacheKey = cache && !useCiteprocRs && this.path
		? JSON.stringify({ locale, automaticJournalAbbreviations })
		: null;
	if (cacheKey && this._cachedEngines.has(cacheKey)) {
		let engine = this._cachedEngines.get(cacheKey);
		// rebuildProcessorState() won't cause disambiguation issues here
		// because we're passing an empty citation list. See comment in
		// integration.js.
		engine.setOutputFormat(format);
		engine.rebuildProcessorState([], format, []);
		return engine;
	}
	
	// APA and some similar styles capitalize the first word of subtitles
	var uppercaseSubtitlesRE = /^apa($|-)|^academy-of-management($|-)|^(freshwater-science)/;
	var shortIDMatches = this.styleID.match(/\/?([^/]+)$/);
	var uppercaseSubtitles = !!shortIDMatches && uppercaseSubtitlesRE.test(shortIDMatches[1]);
	
	// determine version of parent style
	var overrideLocale = false; // to force dependent style locale
	if(this.source) {
		var parentStyle = Trellis.Styles.get(this.source);
		if(!parentStyle) {
			throw new Error(
				'Style references ' + this.source + ', but this style is not installed',
				Trellis.File.pathToFileURI(this.path)
			);
		}
		var version = parentStyle._version;
		
		// citeproc-js will not know anything about the dependent style, including
		// the default-locale, so we need to force locale if a dependent style
		// contains one
		if(this.locale) {
			overrideLocale = true;
			locale = this.locale;
		}
		
		// Turn on uppercase subtitles if parent style matches
		if (!uppercaseSubtitles) {
			let shortIDMatches = parentStyle.styleID.match(/\/?([^/]+)$/);
			uppercaseSubtitles = !!shortIDMatches && uppercaseSubtitlesRE.test(shortIDMatches[1]);
		}
	}
	else {
		var version = this._version;
	}
	
	if(version === "0.8") {
		// get XSLT processor from updateCSL.xsl file
		if(!Trellis.Styles.xsltProcessor) {
			let xsl = Trellis.File.getContentsFromURL("chrome://trellis/content/updateCSL.xsl");
			let updateXSLT = new DOMParser()
				.parseFromString(xsl, "application/xml");
			
			// load XSLT file into XSLTProcessor
			Trellis.Styles.xsltProcessor = new XSLTProcessor();
			Trellis.Styles.xsltProcessor.importStylesheet(updateXSLT);
		}
		
		// read style file as DOM XML
		let styleDOMXML = new DOMParser()
			.parseFromString(this.getXML(), "text/xml");
		
		// apply XSLT and serialize output
		let newDOMXML = Trellis.Styles.xsltProcessor.transformToDocument(styleDOMXML);
		var xml = new XMLSerializer().serializeToString(newDOMXML);
	} else {
		var xml = this.getXML();
	}
	
	xml = this._eventToEventTitle(xml);
	
	try {
		var citeproc;
		var engineDesc;
		if (useCiteprocRs) {
			citeproc = new Trellis.CiteprocRs.Engine(
				new Trellis.Cite.System({
					automaticJournalAbbreviations,
					uppercaseSubtitles: uppercaseSubtitles
				}),
				this,
				xml,
				locale,
				format == 'text' ? 'plain' : format,
				overrideLocale
			);
			engineDesc = 'CiteprocRs';
		}
		else {
			citeproc = new Trellis.CiteProc.CSL.Engine(
				new Trellis.Cite.System({
					automaticJournalAbbreviations,
					uppercaseSubtitles
				}),
				xml,
				locale,
				overrideLocale
			);
			citeproc.setOutputFormat(format);
			citeproc.free = () => 0;
			citeproc.opt.development_extensions.wrap_url_and_doi = true;
			// Don't try to parse author names. We parse them in itemToCSLJSON
			citeproc.opt.development_extensions.parse_names = false;
			engineDesc = 'CSL';
		}
		
		// Cache the Engine instance if allowed
		if (cacheKey) {
			this._cachedEngines.set(cacheKey, citeproc);
			Trellis.debug(`Cached ${engineDesc}.Engine instance with ${cacheKey} for ${this.styleID}`);
		}

		return citeproc;
	}
	catch (e) {
		Trellis.logError(e);
		throw e;
	}
};

Trellis.Style.prototype.clearEngineCache = function () {
	this._cachedEngines.clear();
};

/**
 * Temporarily substitute `event-title` for `event`
 *
 * Until https://github.com/citation-style-language/styles/issues/6151
 */
Trellis.Style.prototype._eventToEventTitle = function (xml) {
	var parser = new DOMParser();
	var doc = parser.parseFromString(xml, "text/xml");
	// Ignore styles that already include `event-title`
	if (doc.querySelector('[variable*="event-title"]')) {
		return xml;
	}
	var elems = doc.querySelectorAll('[variable*="event"]');
	if (!elems.length) {
		return xml;
	}
	var changed = false;
	for (let elem of elems) {
		let variable = elem.getAttribute('variable');
		// Must be "event" or "event foo", not, say, "event-place"
		if (!/event( |$)/.test(variable)) {
			continue;
		}
		elem.setAttribute('variable', variable.replace(/event(?= |$)/, 'event-title'));
		changed = true;
	}
	if (changed) {
		xml = doc.documentElement.outerHTML;
	}
	return xml;
};

Trellis.Style.prototype.__defineGetter__("class",
/**
 * Retrieves the style class, either from the metadata that's already loaded or by loading the file
 * @type String
 */
function () {
	if(this.source) {
		// use class from source style
		var parentStyle = Trellis.Styles.get(this.source);
		if(!parentStyle) {
			throw new Error('Style references missing parent ' + this.source);
		}
		return parentStyle.class;
	}
	return this._class;
});

Trellis.Style.prototype.__defineGetter__("hasBibliography",
/**
 * Determines whether or not this style has a bibliography, either from the metadata that's already\
 * loaded or by loading the file
 * @type String
 */
function () {
	if(this.source) {
		// use hasBibliography from source style
		var parentStyle = Trellis.Styles.get(this.source);
		if(!parentStyle) {
			throw new Error('Style references missing parent ' + this.source);
		}
		return parentStyle.hasBibliography;
	}
	return this._hasBibliography;
});

Trellis.Style.prototype.__defineGetter__("usesAbbreviation",
/**
 * Retrieves the style class, either from the metadata that's already loaded or by loading the file
 * @type String
 */
function () {
	if(this.source) {
		var parentStyle = Trellis.Styles.get(this.source);
		if(!parentStyle) return false;
		return parentStyle.usesAbbreviation;
	}
	return this._usesAbbreviation;
});

Trellis.Style.prototype.__defineGetter__("independentFile",
/**
 * Retrieves the file corresponding to the independent CSL
 * (the parent if this style is dependent, or this style if it is not)
 */
function () {
	if(this.source) {
		// parent/child
		var formatCSL = Trellis.Styles.get(this.source);
		if(!formatCSL) {
			throw new Error('Style references missing parent ' + this.source);
		}
		return formatCSL.path;
	} else if (this.path) {
		return this.path;
	}
	return null;
});

/**
 * Retrieves the XML corresponding to this style
 * @type String
 */
Trellis.Style.prototype.getXML = function () {
	var indepFile = this.independentFile;
	if(indepFile) return Trellis.File.getContents(indepFile);
	return this.string;
};

/**
 * Deletes a style
 */
Trellis.Style.prototype.remove = async function () {
	if (!this.path) {
		throw new Error("Cannot delete a style with no associated file")
	}
	
	// make sure no styles depend on this one
	var dependentStyles = false;
	var styles = Trellis.Styles.getAll();
	for (let i in styles) {
		let style = styles[i];
		if(style.source == this.styleID) {
			dependentStyles = true;
			break;
		}
	}
	
	if(dependentStyles) {
		// copy dependent styles to hidden directory
		let hiddenDir = OS.Path.join(Trellis.getStylesDirectory().path, 'hidden');
		await Trellis.File.createDirectoryIfMissingAsync(hiddenDir);
		await OS.File.move(this.path, OS.Path.join(hiddenDir, PathUtils.filename(this.path)));
	} else {
		// remove defunct files
		await OS.File.remove(this.path);
	}
	
	// check to see if this style depended on a hidden one
	if(this.source) {
		var source = Trellis.Styles.get(this.source);
		if(source && source.hidden) {
			var deleteSource = true;
			
			// check to see if any other styles depend on the hidden one
			let styles = Trellis.Styles.getAll();
			for (let i in styles) {
				let style = styles[i];
				if(style.source == this.source && style.styleID != this.styleID) {
					deleteSource = false;
					break;
				}
			}
			
			// if it was only this style with the dependency, delete the source
			if(deleteSource) {
				await source.remove();
			}
		}
	}
	
	return Trellis.Styles.reinit();
};
