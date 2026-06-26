/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2020 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
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

import VirtualizedTable from 'components/virtualized-table';
import React from 'react';
import ReactDOM from 'react-dom';


var tree;
var engines;
const columns = [
	{ dataKey: 'visible', type: 'checkbox', fixedWidth: true, width: 28 },
	{ dataKey: 'name', label: "trellis.preferences.locate.name" },
	{ dataKey: 'description', label: "trellis.preferences.locate.description" },
];

function init() {
	engines = Trellis.LocateManager.getEngines();
	const domEl = document.querySelector('#locateManager-tree');
	return new Promise((resolve) => {
		ReactDOM.createRoot(domEl).render(
			<VirtualizedTable
				getRowCount={() => engines.length}
				id="locateManager-table"
				ref={(ref) => {
					tree = ref;
					resolve();
				}}
				renderItem={VirtualizedTable.makeRowRenderer(getRowData)}
				showHeader={true}
				multiSelect={true}
				columns={columns}
				onColumnSort={null}
				disableFontSizeScaling={true}
				getRowString={index => getRowData(index).name}
				onSelectionChange={handleSelectionChange}
				onActivate={handleActivate}
			/>
		);
	});
}

function getRowData(index) {
	var data = {};
	columns.forEach((column) => {
		if (column.dataKey == 'visible') {
			var value = !engines[index].hidden;
		}
		else {
			value = engines[index][column.dataKey];
		}
		data[column.dataKey] = value;
	});
	return data;
}

/**
 * Refreshes the list of locate engines in the locate pane
 * @param {String} name of locate engine to select
 */
function updateTree() {
	if (!tree) return;
	tree.forceUpdate(tree.invalidate);
}

function handleSelectionChange(selection) {
	document.getElementById('locateManager-delete').disabled = selection.count == 0;
}

function handleActivate(event, indices) {
	// Ignore Enter, only run on dblclick
	if (event.key) return;
	indices.forEach(index => engines[index].hidden = !engines[index].hidden)
	updateTree();
}

/**
 * Adds a new Locate Engine to the locate pane
 **/
/*
function addLocateEngine() {
	// alert(Trellis.LocateManager.activeLocateEngines.join(" || "));
	var textbox = document.getElementById('locate-add-textbox');
	Trellis.LocateManager.addLocateEngine(textbox.value);

	refreshLocateEnginesList();
}
*/

function toggleLocateEngines() {
	if (!tree) return;
	const numSelected = tree.selection.count;
	const numVisible = engines.filter((_, index) => tree.selection.isSelected(index))
		.reduce((acc, engine) => acc + (engine.hidden ? 0 : 1), 0);

	// Make all visible, unless all selected are already visible
	var hideAll = numVisible == numSelected;
	
	engines.forEach((engine, index) => {
		if (tree.selection.isSelected(index)) {
			engine.hidden = hideAll;
		}
	});
	updateTree();
}

/**
 * Deletes selected Locate Engines from the locate pane
 *
 * TODO: Limit to custom engines?
 **/
function deleteLocateEngine() {
	engines.forEach((engine, index) => {
		if (tree.selection.isSelected(index)) {
			Trellis.LocateManager.removeEngine(engine);
		}
	});
	tree.selection.clearSelection();
	engines = Trellis.LocateManager.getEngines();
	updateTree();
}

/**
 * Restores Default Locate Engines
 **/
async function restoreDefaultLocateEngines() {
	await Trellis.LocateManager.restoreDefaultEngines();
	engines = Trellis.LocateManager.getEngines();
	updateTree();
}
