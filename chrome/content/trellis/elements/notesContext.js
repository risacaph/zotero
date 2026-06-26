/*
	***** BEGIN LICENSE BLOCK *****
	
	Copyright © 2024 Corporation for Digital Scholarship
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


{
	class NotesContext extends XULElementBase {
		content = MozXULElement.parseXULToFragment(`
			<deck class="context-node" flex="1" selectedIndex="0">
				<vbox class="trellis-context-notes-list" flex="1">
					<hbox style="display: flex;">
						<vbox style="flex: 1;">
							<search-textbox data-l10n-id="context-notes-search" data-l10n-attrs="placeholder"
								style="margin: 6px 8px 7px 8px;"
								type="search" timeout="250">
							</search-textbox>
						</vbox>
					</hbox>
					<vbox style="display: flex; min-width: 0; flex-direction: row;" flex="1">
						<html:div class="notes-list-container" tabindex="-1">
							<context-notes-list></context-notes-list>
						</html:div>
					</vbox>
				</vbox>
				<vbox class="trellis-context-note-container context-note-standalone">
					<vbox class="trellis-context-pane-editor-parent-line">
						<html:div class="parent-title-container">
							<toolbarbutton class="trellis-tb-note-return" tabindex="0" data-l10n-id="context-notes-return-button"></toolbarbutton>
							<html:div class="parent-title"></html:div>
						</html:div>
					</vbox>
					<html:div class="divider"></html:div>
				</vbox>
				<vbox class="trellis-context-note-container context-note-child">
					<vbox class="trellis-context-pane-editor-parent-line">
						<html:div class="parent-title-container">
							<toolbarbutton class="trellis-tb-note-return" tabindex="0" data-l10n-id="context-notes-return-button"></toolbarbutton>
							<html:div class="parent-title"></html:div>
						</html:div>
					</vbox>
					<html:div class="divider"></html:div>
					<deck class="trellis-context-pane-tab-notes-deck" flex="1"></deck>
				</vbox>
			</deck>
			
			<popupset>
				<menupopup class="context-pane-add-child-note-button-popup">
					<menuitem class="context-pane-add-child-note" label="&trellis.context.addChildNote;"/>
					<menuitem class="context-pane-add-child-note-from-annotations" label="&trellis.context.addChildNoteFromAnnotations;"/>
				</menupopup>
		
				<menupopup class="context-pane-add-standalone-note-button-popup">
					<menuitem class="context-pane-add-standalone-note" label="&trellis.context.addStandaloneNote;"/>
					<menuitem class="context-pane-add-standalone-note-from-annotations" label="&trellis.context.addStandaloneNoteFromAnnotations;"/>
				</menupopup>
				
				<menupopup class="context-pane-list-popup">
					<menuitem class="context-pane-list-show-in-library" label="&trellis.items.menu.showInLibrary;"/>
					<menuitem class="context-pane-list-edit-in-window" label="&trellis.context.editInWindow;"/>
					<menuseparator/>
					<menuitem class="context-pane-list-move-to-trash" label="&trellis.general.moveToTrash;"/>
				</menupopup>
			</popupset>
		`, ['chrome://trellis/locale/trellis.dtd']);

		get editable() {
			return this._editable;
		}

		set editable(editable) {
			this._editable = editable;
			this.toggleAttribute('readonly', !editable);
		}

		get libraryID() {
			return Number(this.node.dataset.libraryId);
		}
		
		set libraryID(libraryID) {
			this.node.dataset.libraryId = libraryID;
			this.editable = Trellis.Libraries.get(libraryID).editable;
		}

		get selectedIndex() {
			return this.node.selectedIndex;
		}

		set selectedIndex(selectedIndex) {
			this.setAttribute("selectedIndex", selectedIndex);
			this.node.selectedIndex = selectedIndex;
		}

		get selectedPanel() {
			return this.node.selectedPanel;
		}

		set selectedPanel(selectedPanel) {
			this.node.selectedPanel = selectedPanel;
		}

		get mode() {
			return ["notesList", "standaloneNote", "childNote"][this.node.selectedIndex];
		}

		set mode(mode) {
			let modeMap = {
				notesList: "0",
				standaloneNote: "1",
				childNote: "2",
			};
			if (!(mode in modeMap)) {
				throw new Error(`NotesContext.mode must be one of ["notesList", "standaloneNote", "childNote"], but got ${mode}`);
			}
			// fx115: setting attribute doesn't work
			this.node.selectedIndex = modeMap[mode];
		}

		static get observedAttributes() {
			return ['selectedIndex'];
		}

		attributeChangedCallback(name, oldValue, newValue) {
			switch (name) {
				case 'selectedIndex':
					this.node.selectedIndex = newValue;
					break;
			}
		}

		update = Trellis.Utilities.throttle(this._updateNotesList, 1000, { leading: false });

		cachedNotes = [];

		affectedIDs = new Set();

		init() {
			this.node = this.querySelector(".context-node");
			this.notesList = this.querySelector("context-notes-list");
			this.standaloneNoteContainer = this.querySelector('.context-note-standalone');
			this.tabNotesDeck = this.querySelector('.trellis-context-pane-tab-notes-deck');
			this.input = this.querySelector("search-textbox");
			this.input.addEventListener('command', () => {
				this.notesList.expanded = false;
				this._updateNotesList();
			});

			this._initNotesList();
			this._initNoteEditor();
		}

		focus() {
			if (this.mode == "notesList") {
				this.input.focus();
				return true;
			}
			else {
				this._getCurrentEditor()?.focusFirst();
				return true;
			}
		}

		_initNotesList() {
			this.notesList.addEventListener('note-click', (event) => {
				let { id } = event.detail;
				let item = Trellis.Items.get(id);
				if (item) {
					this._setPinnedNote(item);
				}
			});
			this.notesList.addEventListener('note-contextmenu', (event) => {
				let { id, screenX, screenY } = event.detail;
				let item = Trellis.Items.get(id);
				if (item) {
					this.querySelector('.context-pane-list-move-to-trash').setAttribute('disabled', !this.editable);
					let popup = this.querySelector('.context-pane-list-popup');
					popup.dataset.itemId = id;
					popup.openPopupAtScreen(screenX, screenY, true);
				}
			});
			let addChildNotePopup = this.querySelector('.context-pane-add-child-note-button-popup');
			addChildNotePopup.addEventListener("command", (event) => {
				this._handleAddChildNotePopupClick(event);
			});
			this.notesList.addEventListener('add-child', (event) => {
				this.querySelector('.context-pane-add-child-note').setAttribute('disabled', !this.editable);
				this.querySelector('.context-pane-add-child-note-from-annotations').setAttribute('disabled', !this.editable);
				Trellis.MenuManager.updateMenuPopup(addChildNotePopup, "notesPane/addItemNote", {
					event: undefined,
					getContext: () => {
						let ret = {
							items: [this._getCurrentAttachment()],
						};
						if (typeof Trellis_Tabs !== 'undefined') {
							let { id, type, subType } = Trellis_Tabs.getTabInfo();
							ret.tabID = id;
							ret.tabType = type;
							ret.tabSubType = subType;
						}
						return ret;
					}
				});
				addChildNotePopup.openPopup(event.detail.button, 'after_end');
			});
			let addStandaloneNotePopup = this.querySelector('.context-pane-add-standalone-note-button-popup');
			addStandaloneNotePopup.addEventListener("command", (event) => {
				this._handleAddStandaloneNotePopupClick(event);
			});
			this.notesList.addEventListener('add-standalone', (event) => {
				this.querySelector('.context-pane-add-standalone-note').setAttribute('disabled', !this.editable);
				this.querySelector('.context-pane-add-standalone-note-from-annotations').setAttribute('disabled', !this.editable);
				Trellis.MenuManager.updateMenuPopup(addStandaloneNotePopup, "notesPane/addStandaloneNote", {
					event: undefined,
					getContext: () => {
						let ret = {
							items: [this._getCurrentAttachment()],
						};
						if (typeof Trellis_Tabs !== 'undefined') {
							let { id, type, subType } = Trellis_Tabs.getTabInfo();
							ret.tabID = id;
							ret.tabType = type;
							ret.tabSubType = subType;
						}
						return ret;
					}
				});
				addStandaloneNotePopup.openPopup(event.detail.button, 'after_end');
			});
			let listPopup = this.querySelector('.context-pane-list-popup');
			listPopup.addEventListener('command', (event) => {
				let id = parseInt(event.currentTarget.dataset.itemId);
				this._handleListPopupCommand(id, event);
			});
		}

		_initNoteEditor() {
			this.querySelectorAll(".trellis-tb-note-return").forEach(
				btn => btn.addEventListener("command", this._handleNoteEditorReturn));
		}

		async _createNoteFromAnnotations(child) {
			let attachment = this._getCurrentAttachment();
			if (!attachment) {
				return;
			}
			let annotations = attachment.getAnnotations().filter(x => x.annotationType != 'ink');
			if (!annotations.length) {
				return;
			}
			let note = await Trellis.EditorInstance.createNoteFromAnnotations(
				annotations,
				{
					parentID: child && attachment.parentID
				}
			);

			TrellisContextPane.updateAddToNote();

			this.input.value = '';
			this._updateNotesList();

			this._setPinnedNote(note);
		}

		_createNote(child) {
			this.mode = "standaloneNote";
			let item = new Trellis.Item('note');
			item.libraryID = this.libraryID;
			if (child) {
				let attachment = this._getCurrentAttachment();
				if (!attachment) {
					return;
				}
				item.parentID = attachment.parentID;
			}
			this._setPinnedNote(item);
			TrellisContextPane.updateAddToNote();
			
			this.input.value = '';
			this._updateNotesList();
		}

		_isNotesListVisible() {
			let splitter = TrellisContextPane.splitter;
			
			return Trellis_Tabs.selectedID != 'trellis-pane'
				&& TrellisContextPane.context.mode == "notes"
				&& this.mode == "notesList"
				&& splitter.getAttribute('state') != 'collapsed';
		}

		_getCurrentEditor() {
			let splitter = TrellisContextPane.splitter;
			if (splitter.getAttribute('state') == 'collapsed' || TrellisContextPane.context.mode != "notes") return null;
			switch (this.mode) {
				case "childNote": {
					return this.tabNotesDeck.selectedPanel?.querySelector("note-editor");
				}
				case "standaloneNote": {
					return this.standaloneEditor;
				}
				case "notesList":
				default: {
					return null;
				}
			}
		}

		_getCurrentAttachment() {
			let reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
			if (reader) {
				return Trellis.Items.get(reader.itemID);
			}
			return null;
		}

		_setPinnedNote(item) {
			let isChild = false;
			let reader = Trellis.Reader.getByTabID(Trellis_Tabs.selectedID);
			if (reader) {
				let attachment = Trellis.Items.get(reader.itemID);
				if (attachment.parentItemID == item.parentItemID) {
					isChild = true;
				}
			}

			let editor;

			if (isChild) {
				let vbox = document.createXULElement('vbox');
				vbox.setAttribute('data-tab-id', Trellis_Tabs.selectedID);
				vbox.style.display = 'flex';

				editor = document.createXULElement('note-editor');
				editor.style.flex = "1";

				vbox.append(editor);

				this.tabNotesDeck.append(vbox);

				this.mode = "childNote";
				this.tabNotesDeck.selectedIndex = this.tabNotesDeck.children.length - 1;
			}
			else {
				// Try to reuse existing editor
				if (this.standaloneEditor) {
					editor = this.standaloneEditor;
				}
				else {
					editor = document.createXULElement('note-editor');
					editor.classList.add("trellis-context-pane-pinned-note");
					editor.style.flex = "1";

					this.standaloneNoteContainer.append(editor);
					this.standaloneEditor = editor;
				}
				this.mode = "standaloneNote";
			}

			editor.mode = this.editable ? 'edit' : 'view';
			editor.item = item;
			editor.parentItem = null;
			editor.focus();

			this.updatePinnedNoteTitle();
			TrellisContextPane.updateAddToNote();
		}

		updatePinnedNoteTitle() {
			let item = this._getCurrentEditor()?.item;
			let title = this.selectedPanel?.querySelector('.parent-title');
			let parentItem = item.parentItem;
			title.textContent = parentItem?.getDisplayTitle() || '';
		}

		updateNotesListFromCache() {
			this._updateNotesList(true);
		}


		switchToTab(tabID) {
			if (TrellisContextPane.context.mode !== "notes") {
				return;
			}
			// Use childNote if find one
			let childNoteContainer = this.tabNotesDeck.querySelector(`:scope > [data-tab-id=${tabID}]`);
			if (childNoteContainer) {
				this.tabNotesDeck.selectedPanel = childNoteContainer;
				this.mode = "childNote";
				this.updatePinnedNoteTitle();
			}
			// Use standalone note if find one
			else if (this.standaloneEditor) {
				this.mode = "standaloneNote";
			}
			// Otherwise, show notes list
			else {
				this.mode = "notesList";
			}
			TrellisContextPane.updateAddToNote();
		}

		async _updateNotesList(useCached) {
			let query = this.input.value;
			let notes;
			
			// Calls itself and debounces until notes list becomes
			// visible, and then updates
			if (!useCached && !this._isNotesListVisible()) {
				this.update();
				return;
			}
			
			if (useCached && this.cachedNotes.length) {
				notes = this.cachedNotes;
			}
			else {
				await Trellis.Schema.schemaUpdatePromise;
				let s = new Trellis.Search();
				s.addCondition('libraryID', 'is', this.libraryID);
				s.addCondition('itemType', 'is', 'note');
				if (query) {
					let parts = Trellis.SearchConditions.parseSearchString(query);
					for (let part of parts) {
						s.addCondition('note', 'contains', part.text);
					}
				}
				notes = await s.search();
				notes = Trellis.Items.get(notes);
				if (Trellis.Prefs.get('sortNotesChronologically.reader')) {
					notes.sort((a, b) => {
						a = a.dateModified;
						b = b.dateModified;
						return (a > b ? -1 : (a < b ? 1 : 0));
					});
				}
				else {
					let collation = Trellis.getLocaleCollation();
					notes.sort((a, b) => {
						let aTitle = Trellis.Items.getSortTitle(a.getNoteTitle());
						let bTitle = Trellis.Items.getSortTitle(b.getNoteTitle());
						return collation.compareString(1, aTitle, bTitle);
					});
				}
				
				let cachedNotesIndex = new Map();
				for (let cachedNote of this.cachedNotes) {
					cachedNotesIndex.set(cachedNote.id, cachedNote);
				}
				notes = notes.map((note) => {
					let parentItem = note.parentItem;
					// If neither note nor parent item is affected try to return the cached note
					if (!this.affectedIDs.has(note.id)
						&& (!parentItem || !this.affectedIDs.has(parentItem.id))) {
						let cachedNote = cachedNotesIndex.get(note.id);
						if (cachedNote) {
							return cachedNote;
						}
					}
					let text = note.note;
					text = Trellis.Utilities.unescapeHTML(text);
					text = text.trim();
					text = text.slice(0, 500);
					let parts = text.split('\n').map(x => x.trim()).filter(x => x.length);
					let title = parts[0] && parts[0].slice(0, Trellis.Notes.MAX_TITLE_LENGTH);
					let date = Trellis.Date.sqlToDate(note.dateModified, true);
					date = Trellis.Date.toFriendlyDate(date);
					
					return {
						id: note.id,
						title: title || Trellis.getString('pane.item.notes.untitled'),
						body: parts[1] || '',
						date,
						parentID: note.parentID,
						parentItemType: parentItem && parentItem.itemType,
						parentTitle: parentItem && parentItem.getDisplayTitle()
					};
				});
				this.cachedNotes = notes;
				this.affectedIDs = new Set();
			}

			let attachment = this._getCurrentAttachment();
			let parentID = attachment && attachment.parentID;
			this.notesList.hasParent = !!parentID;
			this.notesList.notes = notes.map(note => ({
				...note,
				isCurrentChild: parentID && note.parentID == parentID
			}));
		}

		_handleListPopupCommand(id, event) {
			switch (event.originalTarget.classList[0]) {
				case 'context-pane-list-show-in-library':
					TrellisPane_Local.selectItem(id);
					Trellis_Tabs.select('trellis-pane');
					break;

				case 'context-pane-list-edit-in-window':
					TrellisPane.openNote(id, { openInWindow: true });
					break;

				case 'context-pane-list-move-to-trash':
					if (this.editable) {
						Trellis.Items.trashTx(id);
						this.cachedNotes = this.cachedNotes.filter(x => x.id != id);
						this._updateNotesList(true);
					}
					break;

				default:
			}
		}
		
		_handleAddChildNotePopupClick = (event) => {
			if (!this.editable) {
				return;
			}
			switch (event.originalTarget.classList[0]) {
				case 'context-pane-add-child-note':
					this._createNote(true);
					break;

				case 'context-pane-add-child-note-from-annotations':
					this._createNoteFromAnnotations(true);
					break;

				default:
			}
		};

		_handleAddStandaloneNotePopupClick = (event) => {
			if (!this.editable) {
				return;
			}
			switch (event.originalTarget.classList[0]) {
				case 'context-pane-add-standalone-note':
					this._createNote();
					break;

				case 'context-pane-add-standalone-note-from-annotations':
					this._createNoteFromAnnotations();
					break;

				default:
			}
		};

		_handleNoteEditorReturn = () => {
			let editor = this._getCurrentEditor();
			if (!editor) {
				return;
			}
			// Immediately save note content before vbox with note-editor iframe is destroyed below
			editor.saveSync();
			TrellisContextPane.context.mode = "notes";

			switch (this.mode) {
				case "childNote": {
					this.tabNotesDeck.selectedPanel?.remove();
					break;
				}
				case "standaloneNote": {
					this.standaloneEditor?.remove();
					this.standaloneEditor = undefined;
					break;
				}
				default: {
					break;
				}
			}

			this.mode = "notesList";
			TrellisContextPane.updateAddToNote();
		};
	}
	customElements.define("notes-context", NotesContext);
}
