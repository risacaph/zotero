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

import CollectionTree from 'trellis/collectionTree';
import CollectionViewItemTree from 'trellis/collectionViewItemTree';

var itemsView;
var collectionsView;
var loaded;
var io;
const isSelectItemsDialog = !!document.querySelector('#trellis-select-items-dialog');
const isEditBibliographyDialog = !!document.querySelector('#trellis-edit-bibliography-dialog');
const isAddEditItemsDialog = !!document.querySelector('#trellis-add-citation-dialog');

/*
 * window takes two arguments:
 * io - used for input/output (dataOut is list of item IDs)
 */
var doLoad = async function () {
	// Move the dialog button box into the items pane
	let itemsContainer = document.getElementById('trellis-items-tree-container');
	// TEMP: Only if we're in the redesigned Select Items dialog, not the
	// classic Add Citation dialog, or the Edit Bibliography dialog
	// (until we redesign that too)
	if (isSelectItemsDialog) {
		let buttonBox = document.querySelector('dialog')
			.shadowRoot
			.querySelector('.dialog-button-box');
		itemsContainer.append(buttonBox);
	}
	
	let searchBar = document.getElementById('trellis-tb-search');
	searchBar.searchTextbox.select();

	// Set font size from pref
	var sbc = document.getElementById('trellis-select-items-container');
	Trellis.UIProperties.registerRoot(sbc);
	
	io = window.arguments[0];
	if(io.wrappedJSObject) io = io.wrappedJSObject;
	if(io.addBorder) document.getElementsByTagName("dialog")[0].style.border = "1px solid black";
	if(io.singleSelection) document.getElementById("trellis-items-tree").setAttribute("seltype", "single");
	
	itemsView = await CollectionViewItemTree.init(document.getElementById('trellis-items-tree'), {
		onSelectionChange: () => {
			if (isEditBibliographyDialog) {
				Trellis_Bibliography_Dialog.treeItemSelected();
			}
			else if (isAddEditItemsDialog) {
				Trellis_Citation_Dialog.treeItemSelected();
			}
		},
		onActivate: () => {
			document.querySelector('dialog').acceptDialog();
		},
		id: io.itemTreeID || "select-items-dialog",
		dragAndDrop: false,
		regularOnly: io.onlyRegularItems,
		columnPicker: true,
		multiSelect: io.multiSelect,
		emptyMessage: Trellis.getString('pane.items.loading')
	});
	itemsView.setItemsPaneMessage(Trellis.getString('pane.items.loading'));

	const filterLibraryIDs = false || io.filterLibraryIDs;
	const hideSources = io.hideCollections || ['duplicates', 'trash', 'feeds'];
	collectionsView = await CollectionTree.init(document.getElementById('trellis-collections-tree'), {
		onSelectionChange: () => onCollectionSelected(),
		filterLibraryIDs,
		hideSources
	});

	await collectionsView.makeVisible();

	if (io.select) {
		await collectionsView.selectItem(io.select);
	}
	
	Trellis.updateQuickSearchBox(document);

	document.addEventListener('dialogaccept', doAccept);
	
	if (isSelectItemsDialog) {
		// Set proper tab order. It is only needed in selectItemsDialog -- other dialogs' focus order is correct
		document.querySelector("#trellis-tb-search").searchModePopup.parentNode.setAttribute("tabindex", 1);
		document.querySelector("#trellis-tb-search").searchTextbox.inputField.setAttribute("tabindex", 2);
		document.querySelector("#collection-tree").setAttribute("tabindex", 3);
		document.querySelector("#trellis-items-tree .virtualized-table").setAttribute("tabindex", 4);
		// On Windows, buttons are in a different order than on macOS, so set tabindex accordingly
		let nextButtonTabindex = 5;
		for (let button of [...document.querySelectorAll("button[dlgtype]:not([hidden])")]) {
			button.setAttribute("tabindex", nextButtonTabindex++);
		}
	}
	// Handle any custom button config that can be passed
	for (let buttonConfig of io.extraButtons || []) {
		let button = document.querySelector(`dialog button[dlgtype='${buttonConfig.type}']`);
		button.hidden = buttonConfig.isHidden(document);
		document.l10n.setAttributes(button, buttonConfig.l10nLabel, buttonConfig.l10nArgs || {});
		button.addEventListener("click", event => buttonConfig.onclick(event));
	}
	
	// Used in tests
	loaded = true;
};

function doUnload()
{
	collectionsView.unregister();
	if(itemsView)
		itemsView.unregister();
	
	io.deferred && io.deferred.resolve();
}

var onCollectionSelected = async function () {
	var collectionTreeRow = collectionsView.getRow(collectionsView.selection.focused);
	if (!collectionsView.selection.count) return;
	// Collection not changed
	if (itemsView && itemsView.collectionTreeRow && itemsView.collectionTreeRow.id == collectionTreeRow.id) {
		return;
	}
	collectionTreeRow.setSearch('');
	Trellis.Prefs.set('lastViewedFolder', collectionTreeRow.id);
	
	itemsView.setItemsPaneMessage(Trellis.getString('pane.items.loading'));
	
	// Load library data if necessary
	var library = Trellis.Libraries.get(collectionTreeRow.ref.libraryID);
	if (!library.getDataLoaded('item')) {
		Trellis.debug("Waiting for items to load for library " + library.libraryID);
		await library.waitForDataLoad('item');
	}
	
	await itemsView.changeCollectionTreeRows([collectionTreeRow]);
	
	itemsView.clearItemsPaneMessage();
};

function onSearch()
{
	if (itemsView)
	{
		var searchVal = document.getElementById('trellis-tb-search-textbox').value;
		itemsView.setFilter('search', searchVal);
	}
}

function doAccept() {
	io.dataOut = itemsView.getSelectedItems(true);
}
