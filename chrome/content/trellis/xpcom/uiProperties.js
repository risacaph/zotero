/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2023 Corporation for Digital Scholarship
					 Vienna, Virginia, USA
					 https://www.trellis.org
	
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

Trellis.UIProperties = new (class {
	_roots = new Set();
	
	registerRoot(root) {
		if (root.nodeType !== Node.ELEMENT_NODE) {
			throw new Error('Root must be an element');
		}
		
		this._roots.add(new WeakRef(root));
		this.set(root);
	}
	
	setAll() {
		for (let rootRef of this._roots) {
			let root = rootRef.deref();
			if (!root) {
				this._roots.delete(rootRef);
				continue;
			}
			this.set(root);
		}
	}
	
	set(root) {
		this._setFontSize(root);
		this._setUIDensity(root);
		root.dispatchEvent(new Event('UIPropertiesChanged', { bubbles: false }));
	}
	
	_setFontSize(root) {
		let size = Trellis.Prefs.get('fontSize');
		let sizeCSS = size + 'rem';
		root.style.fontSize = sizeCSS;
		root.style.setProperty('--trellis-font-size', sizeCSS);
		if (size <= 1) {
			size = 'small';
		}
		else if (size <= 1.15) {
			size = 'medium';
		}
		else if (size <= 1.3) {
			size = 'large';
		}
		else {
			size = 'x-large';
		}
		// Custom attribute -- allows for additional customizations in trellis.css
		root.setAttribute('trellisFontSize', size);
		if (Trellis.rtl) {
			root.setAttribute('dir', 'rtl');
		}
		else {
			root.removeAttribute('dir');
		}
	}
	
	_setUIDensity(root) {
		let density = Trellis.Prefs.get('uiDensity');
		root.style.setProperty('--trellis-ui-density', density);
		root.setAttribute('trellisUIDensity', density);
	}
});
