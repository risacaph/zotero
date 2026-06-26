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
 * @namespace Singleton to interface with the browser when ingesting data
 */
var Trellis_Ingester_Interface_SelectItems = function () {};

//////////////////////////////////////////////////////////////////////////////
//
// Public Trellis_Ingester_Interface_SelectItems methods
//
//////////////////////////////////////////////////////////////////////////////

/**
 * Presents items to select in the select box. Assumes window.arguments[0].dataIn is an object with
 * URLs as keys and descriptions as values
 */
Trellis_Ingester_Interface_SelectItems.init = function () {
	document.addEventListener('dialogaccept',
		() => Trellis_Ingester_Interface_SelectItems.acceptSelection());

	// Set font size from pref
	var dialog = document.querySelector('dialog');
	Trellis.UIProperties.registerRoot(dialog);
	
	this.io = window.arguments[0];
	var listbox = document.getElementById("trellis-selectitems-links");
	
	for (var i in this.io.dataIn) {	// we could use a tree for this if we wanted to
		var item = this.io.dataIn[i];

		var title, checked = false;
		if (item && typeof item == "object" && item.title !== undefined) {
			title = item.title;
			checked = !!item.checked;
		}
		else {
			title = item;
		}

		let checkbox = document.createXULElement("checkbox");
		checkbox.checked = checked;
		checkbox.label = title;
		checkbox.setAttribute('native', 'true');

		let itemNode = document.createXULElement("richlistitem");
		itemNode.value = i;
		itemNode.append(checkbox);
		itemNode.addEventListener('click', (event) => {
			if (event.target == itemNode) {
				checkbox.checked = !checkbox.checked;
			}
		});
		listbox.append(itemNode);
	}
	
	// Check item if there is only one
	if (listbox.itemCount === 1) {
		listbox.getItemAtIndex(0).firstElementChild.checked = true;
	}
};

/**
 * Selects or deselects all items
 * @param {Boolean} deselect If true, deselect all items instead of selecting all items
 */
Trellis_Ingester_Interface_SelectItems.selectAll = function (deselect) {
	var listbox = document.getElementById("trellis-selectitems-links");
	for (var i = 0; i < listbox.childNodes.length; i++) {
		listbox.childNodes[i].firstElementChild.checked = !deselect;
	}
};

/**
 * Called when "OK" button is pressed to populate window.arguments[0].dataOut with selected items
 */
Trellis_Ingester_Interface_SelectItems.acceptSelection = function () {
	var listbox = document.getElementById("trellis-selectitems-links");
	
	var returnObject = false;
	this.io.dataOut = {};
	
	// collect scrapeURLList from listbox
	for (var i = 0; i < listbox.childNodes.length; i++) {
		var itemNode = listbox.childNodes[i];
		if (itemNode.firstElementChild.checked) {
			this.io.dataOut[itemNode.getAttribute("value")] = itemNode.firstElementChild.getAttribute("label");
			returnObject = true;
		}
	}
	
	if (!returnObject) this.io.dataOut = null;
};
