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
    Contributed by Julian Onions
*/

// eslint-disable-next-line no-unused-vars
var Trellis_CSL_Preview = new function () {
	this.lastContent = null;
	
	this.init = function () {
		var menulist = document.getElementById("locale-menu");
		
		Trellis.Styles.populateLocaleList(menulist);
		menulist.value = Trellis.Prefs.get('export.lastLocale');
		
		this.updateIframe(Trellis.getString('styles.preview.instructions'));
		
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener("change", () => {
			this.updateIframe(this.lastContent.content, this.lastContent.containerClass);
		});
	};

	this.refresh = function () {
		var items = Trellis.getActiveTrellisPane().getSelectedItems();
		if (items.length === 0) {
			this.updateIframe(Trellis.getString('styles.editor.warning.noItems'), 'warning');
			return;
		}
		var progressWin = new Trellis.ProgressWindow();
		// XXX needs its own string really!
		progressWin.changeHeadline(Trellis.getString("pane.items.menu.createBib.multiple"));
		var icon = 'chrome://trellis/skin/treeitem-attachment-file.png';
		progressWin.addLines(document.title, icon);
		progressWin.show();
		progressWin.startCloseTimer();
		// Give progress window time to appear
		setTimeout(() => {
			var d = new Date();
			var styles = Trellis.Styles.getVisible();
			// XXX needs its own string really for the title!
			var str = '<div>';
			for (let style of styles) {
				Trellis.debug("Generate bibliography for " + style.title);
				let bib;
				let err = false;
				try {
					bib = this.generateBibliography(style);
				}
				catch (e) {
					err = e;
					Trellis.logError(e);
				}
				if (bib || err) {
					str += '<h3>' + style.title + '</h3>';
					str += bib || `<p style="color: red">${Trellis.Utilities.htmlSpecialChars(err)}</p>`;
					str += '<hr>';
				}
			}

			str += '</div>';
			this.updateIframe(str);

			Trellis.debug(`Generated previews in ${new Date() - d} ms`);
		}, 100);
	};
	
	this.generateBibliography = function (style) {
		var items = Trellis.getActiveTrellisPane().getSelectedItems();
		if (items.length === 0) {
			return '';
		}
		
		var citationFormat = document.getElementById("citation-format").selectedItem.value;
		if (citationFormat != "all" && citationFormat != style.categories) {
			Trellis.debug("CSL IGNORE: citation format is " + style.categories);
			return '';
		}
		
		var locale = document.getElementById("locale-menu").value;
		var styleEngine = style.getCiteProc(locale, 'html');
		
		// Generate multiple citations
		var citations = styleEngine.previewCitationCluster(
			{
				citationItems: items.map(item => ({ id: item.id })),
				properties: {}
			},
			[], [], "html"
		);
		
		// Generate bibliography
		var bibliography = '';
		if (style.hasBibliography) {
			styleEngine.updateItems(items.map(item => item.id));
			bibliography = Trellis.Cite.makeFormattedBibliography(styleEngine, "html");
		}
		
		styleEngine.free();
		
		return '<p>' + citations + '</p>' + bibliography;
	};

	this.updateIframe = function (content, containerClass = 'preview') {
		this.lastContent = { content, containerClass };
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
