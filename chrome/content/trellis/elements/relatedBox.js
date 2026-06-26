/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2021 Corporation for Digital Scholarship
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

"use strict";

import { getCSSItemTypeIcon } from 'components/icons';

{
	const { ItemPaneSectionElementBase } = ChromeUtils.importESModule(
		"chrome://trellis/content/elements/itemPaneSectionElementBase.mjs",
		{ global: "current" }
	);

	class RelatedBox extends ItemPaneSectionElementBase {
		content = MozXULElement.parseXULToFragment(`
			<collapsible-section data-l10n-id="section-related" data-pane="related" extra-buttons="add">
				<html:div class="body"/>
			</collapsible-section>
		`);
		
		init() {
			this._notifierID = Trellis.Notifier.registerObserver(this, ['item'], 'relatedbox');
			this.initCollapsibleSection();
			this._section.addEventListener('add', this.add);
		}
		
		destroy() {
			this._section?.removeEventListener('add', this.add);
			Trellis.Notifier.unregisterObserver(this._notifierID);
		}
		
		get item() {
			return this._item;
		}

		set item(val) {
			this.hidden = val?.isFeedItem;
			this._item = val;
		}

		notify(event, type, ids, _extraData) {
			if (!this._item || !this._item.id) return;

			// Refresh if this item has been modified
			if (event == 'modify' && ids.includes(this._item.id)) {
				this._forceRenderAll();
				return;
			}

			// Or if any listed items have been modified or deleted
			if (event == 'modify' || event == 'delete') {
				let libraryID = this._item.libraryID;
				let relatedItemIDs = new Set(this._item.relatedItems.map(key => Trellis.Items.getIDFromLibraryAndKey(libraryID, key)));
				for (let id of ids) {
					if (relatedItemIDs.has(id)) {
						this._forceRenderAll();
						return;
					}
				}
			}
		}

		render() {
			if (!this.item) return;
			if (this._isAlreadyRendered()) return;

			let body = this.querySelector('.body');
			body.replaceChildren();

			if (this._item) {
				let relatedItems = this._getRelatedItems();
				// Sort by display title
				var collation = Trellis.getLocaleCollation();
				var titles = new Map();
				function getTitle(item) {
					var title = titles.get(item.id);
					if (title === undefined) {
						title = Trellis.Items.getSortTitle(item.getDisplayTitle());
						titles.set(item.id, title);
					}
					return title;
				}
				relatedItems.sort((a, b) => {
					var titleA = getTitle(a);
					var titleB = getTitle(b);
					return collation.compareString(1, titleA, titleB);
				});
				
				for (let relatedItem of relatedItems) {
					let id = relatedItem.id;

					let row = document.createElement('div');
					row.className = 'row';

					let iconKey = relatedItem.isAnnotation() ? `annotation-${relatedItem.annotationType}-${relatedItem.annotationColor}` : undefined;
					let icon = getCSSItemTypeIcon(relatedItem.getItemTypeIconName(), iconKey);

					let label = document.createElement("span");
					label.className = 'label';
					label.append(relatedItem.getDisplayTitle());

					let box = document.createElement('div');
					box.addEventListener('click', () => this._handleShowItem(id));
					box.setAttribute("tabindex", "0");
					box.setAttribute("role", "button");
					box.setAttribute("aria-label", label.textContent);
					box.className = 'box keyboard-clickable';
					box.appendChild(icon);
					box.appendChild(label);
					row.append(box);

					if (this.editable) {
						let remove = document.createXULElement("toolbarbutton");
						remove.addEventListener('command', () => this._handleRemove(id));
						remove.className = 'trellis-clicky trellis-clicky-minus';
						remove.setAttribute("data-l10n-id", 'section-button-remove');
						remove.setAttribute("tabindex", "0");
						row.append(remove);
					}

					row.addEventListener('dragstart', (event) => {
						Trellis.Utilities.Internal.onDragItems(event, [id]);
					});

					body.append(row);
				}
				this._updateCount();
			}
		}

		add = async () => {
			this._section.empty = false;
			this._section.open = true;

			let io = {
				dataIn: null,
				dataOut: null,
				deferred: Trellis.Promise.defer(),
				itemTreeID: 'related-box-select-item-dialog',
				filterLibraryIDs: [this._item.libraryID]
			};
			window.openDialog('chrome://trellis/content/selectItemsDialog.xhtml', '',
				'chrome,dialog=no,centerscreen,resizable=yes', io);

			await io.deferred.promise;
			if (!io.dataOut || !io.dataOut.length) {
				return;
			}

			let relItems = await Trellis.Items.getAsync(io.dataOut);
			if (!relItems.length) {
				return;
			}
			if (relItems[0].libraryID != this._item.libraryID) {
				Trellis.alert(null, "", "You cannot relate items in different libraries.");
				return;
			}
			await Trellis.DB.executeTransaction(async () => {
				Trellis.UndoHistory.stageAction('undo-action-add-related');
				for (let relItem of relItems) {
					if (this._item.addRelatedItem(relItem)) {
						await this._item.save({
							skipDateModifiedUpdate: true
						});
					}
					if (relItem.addRelatedItem(this._item)) {
						await relItem.save({
							skipDateModifiedUpdate: true
						});
					}
				}
			});
		};

		async _handleRemove(id) {
			let item = await Trellis.Items.getAsync(id);
			if (item) {
				await Trellis.DB.executeTransaction(async () => {
					Trellis.UndoHistory.stageAction('undo-action-remove-related');
					if (this._item.removeRelatedItem(item)) {
						await this._item.save({
							skipDateModifiedUpdate: true
						});
					}
					if (item.removeRelatedItem(this._item)) {
						await item.save({
							skipDateModifiedUpdate: true
						});
					}
				});
			}
		}

		_handleShowItem(id) {
			let win = Trellis.getMainWindow();
			if (win) {
				win.TrellisPane.selectItem(id);
				win.Trellis_Tabs.select('trellis-pane');
				win.focus();
			}
		}

		_updateCount() {
			let count = this._getRelatedItems().length;
			this._section.setCount(count);
		}

		_id(id) {
			return this.querySelector(`[id=${id}]`);
		}

		_getRelatedItems() {
			let relatedKeys = this._item.relatedItems;
			
			let relatedItems = relatedKeys.map((key) => {
				let item = Trellis.Items.getByLibraryAndKey(this._item.libraryID, key);
				if (!item) {
					Trellis.debug(`Related item ${this._item.libraryID}/${key} not found `
						+ `for item ${this._item.libraryKey}`, 2);
				}
				return item;
			}).filter(Boolean);

			// Unless the item itself is trashed, filter out trashed related items
			if (!this._item.deleted) {
				relatedItems = relatedItems.filter(item => !item.deleted);
			}
			return relatedItems;
		}

		receiveKeyboardFocus(_direction) {
			this._id("addButton").focus();
			// TODO: the relatedbox is not currently keyboard accessible
			// so we are ignoring the direction
		}
	}
	customElements.define("related-box", RelatedBox);
}
