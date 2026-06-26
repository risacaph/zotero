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

var { FilePicker } = ChromeUtils.importESModule('chrome://trellis/content/modules/filePicker.mjs');

var Trellis_CSL_Editor = new function () {
	let monaco, editor;

	this.init = async function () {
		await Trellis.Schema.schemaUpdatePromise;

		const isDarkMQL = window.matchMedia('(prefers-color-scheme: dark)');
		
		Trellis.Styles.populateLocaleList(document.getElementById("locale-menu"));
		
		var cslList = document.getElementById('trellis-csl-list');
		cslList.removeAllItems();
		
		var lastStyle = Trellis.Prefs.get('export.lastStyle');
		
		var styles = Trellis.Styles.getVisible();
		var currentStyle = null;
		for (let style of styles) {
			if (style.source) {
				continue;
			}
			var item = cslList.appendItem(style.title, style.styleID);
			if (!currentStyle && lastStyle == style.styleID) {
				currentStyle = style;
				cslList.selectedItem = item;
			}
		}
		
		var pageList = document.getElementById('trellis-csl-page-type');
		var locators = Trellis.Cite.labels;
		for (let locator of locators) {
			pageList.appendItem(Trellis.Cite.getLocatorString(locator), locator);
		}
		
		pageList.selectedIndex = 0;

		let editorWin = document.getElementById("trellis-csl-editor-iframe").contentWindow;
		let { monaco: _monaco, editor: _editor } = await editorWin.loadMonaco({
			language: 'xml',
			theme: isDarkMQL.matches ? 'vs-dark' : 'vs-light',
			insertSpaces: true,
			tabSize: 2,
		});
		monaco = _monaco;
		editor = _editor;

		editor.getModel().onDidChangeContent(this.onStyleModifiedDebounced);

		if (currentStyle) {
			// Call asynchronously, see note in Trellis.Styles
			window.setTimeout(this.onStyleSelected.bind(this, currentStyle.styleID), 1);
		}

		isDarkMQL.addEventListener("change", (ev) => {
			monaco.editor.setTheme(ev.matches ? 'vs-dark' : 'vs-light');
			this.refresh();
		});
	};
	
	this.onStyleSelected = function (styleID) {
		Trellis.Prefs.set('export.lastStyle', styleID);
		let style = Trellis.Styles.get(styleID);
		Trellis.Styles.updateLocaleList(
			document.getElementById("locale-menu"),
			style,
			Trellis.Prefs.get('export.lastLocale')
		);
		
		this.loadCSL(style.styleID);
		this.refresh();
	};
	
	this.save = async function () {
		var style = editor.getValue();
		var fp = new FilePicker();
		fp.init(window, Trellis.getString('styles.editor.save'), fp.modeSave);
		fp.appendFilter("Citation Style Language", "*.csl");
		//get the filename from the id; we could consider doing even more here like creating the id from filename.
		var parser = new DOMParser();
		var doc = parser.parseFromString(style, 'text/xml');
		var filename = doc.getElementsByTagName("id");
		if (filename) {
			filename = filename[0].textContent;
			fp.defaultString = filename.replace(/.+\//, "") + ".csl";
		}
		else {
			fp.defaultString = "untitled.csl";
		}
		var rv = await fp.show();
		if (rv == fp.returnOK || rv == fp.returnReplace) {
			let outputFile = fp.file;
			Trellis.File.putContentsAsync(outputFile, style);
		}
	};
	
	this.loadCSL = function (cslID) {
		var style = Trellis.Styles.get(cslID);
		editor.setValue(style.getXML());
		document.getElementById('trellis-csl-list').value = cslID;
	};
	
	this.loadStyleFromEditor = function () {
		var styleObject;
		try {
			styleObject = new Trellis.Style(
				editor.getValue()
			);
		}
		catch (e) {
			this.updateIframe(Trellis.getString('styles.editor.warning.parseError') + '<div>' + e + '</div>', 'error');
			throw e;
		}
		
		return styleObject;
	};
	
	this.onStyleModified = function () {
		let xml = editor.getValue();
		Trellis.Styles.validate(xml).then(
			() => this.updateMarkers(''),
			rawErrors => this.updateMarkers(rawErrors)
		);
		let cslList = document.getElementById('trellis-csl-list');
		let savedStyle = Trellis.Styles.get(cslList.value);
		if (!savedStyle || xml !== savedStyle?.getXML()) {
			cslList.selectedIndex = -1;
		}
		
		let styleObject = this.loadStyleFromEditor();
		
		Trellis.Styles.updateLocaleList(
			document.getElementById("locale-menu"),
			styleObject,
			Trellis.Prefs.get('export.lastLocale')
		);
		Trellis_CSL_Editor.generateBibliography(styleObject);
	};
	
	this.onStyleModifiedDebounced = Trellis.Utilities.debounce(this.onStyleModified.bind(this), 250);
	
	this.generateBibliography = function (style = this.loadStyleFromEditor()) {
		var items = Trellis.getActiveTrellisPane().getSelectedItems();
		if (items.length == 0) {
			this.updateIframe(Trellis.getString('styles.editor.warning.noItems'), 'warning');
			return;
		}
		
		var selectedLocale = document.getElementById("locale-menu").value;
		var styleEngine;
		try {
			styleEngine = style.getCiteProc(style.locale || selectedLocale, 'html');
		}
		catch (e) {
			this.updateIframe(Trellis.getString('styles.editor.warning.parseError') + '<div>' + e + '</div>');
			throw e;
		}
		
		var itemIds = items.map(item => item.id);

		styleEngine.updateItems(itemIds);

		// Generate multiple citations
		var citation = {};
		citation.citationItems = [];
		citation.properties = {};
		citation.properties.noteIndex = 1;
		for (let i = 0, ilen = items.length; i < ilen; i += 1) {
			citation.citationItems.push({ id: itemIds[i] });
		}

		// Generate single citations
		var author = document.getElementById("preview-suppress-author").checked;
		var search = document.getElementById('preview-pages');
		var loc = document.getElementById('trellis-csl-page-type');
		var pos = document.getElementById('trellis-ref-position').selectedItem.value;
		var citations = '<h3>' + Trellis.getString('styles.editor.output.individualCitations') + '</h3>';
		for (let i = 0; i < citation.citationItems.length; i++) {
			citation.citationItems[i]['suppress-author'] = author;
			if (search.value !== '') {
				citation.citationItems[i].locator = search.value;
				citation.citationItems[i].label = loc.selectedItem.value;
			}
			if (pos == 4) {
				//near note is a subsequent citation with near note set to true;
				citation.citationItems[i].position = 1;
				citation.citationItems[i]["near-note"] = true;
			}
			else {
				citation.citationItems[i].position = parseInt(pos);
			}
			var subcitation = [citation.citationItems[i]];
			citations += styleEngine.makeCitationCluster(subcitation) + '<br />';
		}
		
		try {
			var multCitations = '<hr><h3>' + Trellis.getString('styles.editor.output.singleCitation') + '</h3>'
				+ styleEngine.previewCitationCluster(citation, [], [], "html");

			// Generate bibliography
			styleEngine.updateItems(itemIds);
			var bibliography = '<hr/><h3>' + Trellis.getString('styles.bibliography') + '</h3>'
				+ Trellis.Cite.makeFormattedBibliography(styleEngine, "html");
			
			this.updateIframe(citations + multCitations + bibliography);
		}
		catch (e) {
			this.updateIframe(Trellis.getString('styles.editor.warning.renderError') + '<div>' + e + '</div>', 'error');
			throw e;
		}
		styleEngine.free();
	};

	this.generateBibliographyDebounced = Trellis.Utilities.debounce(this.generateBibliography, 250);

	this.updateMarkers = function (rawErrors) {
		let model = editor.getModel();
		let errors = rawErrors ? rawErrors.split('\n') : [];
		let markers = errors.map((error) => {
			let matches = error.match(/^[^:]*:(?<line>[^:]*):(?<column>[^:]*): error: (?<message>.+)/);
			if (!matches) return null;
			let { line, message } = matches.groups;
			line = parseInt(line);
			return {
				startLineNumber: line,
				endLineNumber: line,
				// The error message doesn't give us an end column, so using its
				// start column looks weird. Just highlight the whole line.
				startColumn: model.getLineFirstNonWhitespaceColumn(line),
				endColumn: model.getLineMaxColumn(line),
				message,
				severity: 8
			};
		}).filter(Boolean);
		monaco.editor.setModelMarkers(model, 'csl-validator', markers);
	};

	this.updateIframe = function (content, containerClass = 'preview') {
		const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
		let iframe = document.getElementById('trellis-csl-preview-box');
		iframe.contentDocument.documentElement.innerHTML = `<html>
		<head>
			<title></title>
			<link rel="stylesheet" href="chrome://trellis-platform/content/trellis.css">
			<style>
				html {
					color-scheme: ${isDarkMode ? "dark" : "light"};
				}
			</style>
		</head>
		<body id="csl-edit-preview"><div class="${containerClass} trellis-dialog">${content}</div></body>
		</html>`;
	};
}();
