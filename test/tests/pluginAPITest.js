describe("Plugin API", function () {
	var win, doc, TrellisPane, Trellis_Tabs, TrellisContextPane, _itemsView, infoSection, caches;

	function resetCaches() {
		caches = {};
	}

	function initCache(key) {
		if (!caches[key]) {
			caches[key] = {};
		}
		caches[key].deferred = Trellis.Promise.defer();
		caches[key].result = "";
	}

	async function getCache(key) {
		let cache = caches[key];
		await cache.deferred.promise;
		return cache.result;
	}

	function updateCache(key, value) {
		let cache = caches[key];
		if (!cache) return;
		cache.result = value;
		cache.deferred?.resolve();
	}

	before(async function () {
		win = await loadTrellisPane();
		doc = win.document;
		TrellisPane = win.TrellisPane;
		Trellis_Tabs = win.Trellis_Tabs;
		TrellisContextPane = win.TrellisContextPane;
		_itemsView = win.TrellisPane.itemsView;
		infoSection = win.TrellisPane.itemPane._itemDetails.getPane('info');
	});

	after(function () {
		win.close();
	});
	
	describe("Item pane info box custom section", function () {
		let defaultOption = {
			rowID: "default-test",
			pluginID: "trellis@trellis.org",
			label: {
				l10nID: "general-print",
			},
			onGetData: ({ item }) => {
				let data = `${item.id}`;
				updateCache("onGetData", data);
				return data;
			},
		};

		let waitForRegister = async (option) => {
			initCache("onGetData");
			let getDataPromise = getCache("onGetData");
			let rowID = Trellis.ItemPaneManager.registerInfoRow(option);
			await getDataPromise;
			return rowID;
		};

		let waitForUnregister = async (rowID) => {
			let unregisterPromise = waitForNotifierEvent("refresh", "infobox");
			let success = Trellis.ItemPaneManager.unregisterInfoRow(rowID);
			await unregisterPromise;
			return success;
		};

		beforeEach(async function () {
			resetCaches();
		});

		afterEach(function () {
			Trellis_Tabs.select("trellis-pane");
			Trellis_Tabs.closeAll();
		});

		it("should render custom row and call onGetData hook", async function () {
			initCache("onGetData");
			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);
			
			let getDataPromise = getCache("onGetData");
			let rowID = Trellis.ItemPaneManager.registerInfoRow(defaultOption);
			let result = await getDataPromise;

			// Should render custom row
			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			assert.exists(rowElem);

			// Should call onGetData and render
			let valueElem = rowElem.querySelector(".value");
			assert.equal(result, valueElem.value);

			await waitForUnregister(rowID);
		});
		
		it("should call onSetData hook", async function () {
			let option = Object.assign({}, defaultOption, {
				onSetData: ({ value }) => {
					let data = `${value}`;
					updateCache("onSetData", data);
				},
			});

			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);
			
			let rowID = await waitForRegister(option);

			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			let valueElem = rowElem.querySelector(".value");

			// Should call onSetData on value change
			initCache("onSetData");
			let setDataPromise = getCache("onSetData");
			let newValue = `TEST CUSTOM ROW`;
			valueElem.focus();
			valueElem.value = newValue;
			let blurEvent = new Event("blur");
			valueElem.dispatchEvent(blurEvent);
			let result = await setDataPromise;
			assert.equal(newValue, result);

			await waitForUnregister(rowID);
		});

		it("should call onItemChange hook", async function () {
			let option = Object.assign({}, defaultOption, {
				onItemChange: ({ item, tabType, setEnabled, setEditable }) => {
					let editable = item.itemType === "book";
					let enabled = tabType === "library";
					setEnabled(enabled);
					setEditable(editable);
					let data = { editable, enabled };
					updateCache("onItemChange", data);
				}
			});

			initCache("onItemChange");

			let bookItem = new Trellis.Item('book');
			await bookItem.saveTx();
			await TrellisPane.selectItem(bookItem.id);
			
			let itemChangePromise = getCache("onItemChange");
			let rowID = await waitForRegister(option);
			let result = await itemChangePromise;

			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			let valueElem = rowElem.querySelector(".value");

			// Should be enabled and editable
			assert.isTrue(result.editable);
			assert.isFalse(valueElem.readOnly);
			assert.isTrue(result.enabled);
			assert.isFalse(rowElem.hidden);

			initCache("onItemChange");
			itemChangePromise = getCache("onItemChange");
			let docItem = new Trellis.Item('document');
			await docItem.saveTx();
			await TrellisPane.selectItem(docItem.id);
			result = await itemChangePromise;

			// Should be enabled and not editable
			assert.isFalse(result.editable);
			assert.isTrue(valueElem.readOnly);
			assert.isTrue(result.enabled);
			assert.isFalse(rowElem.hidden);

			let file = getTestDataDirectory();
			file.append('test.pdf');
			let attachment = await Trellis.Attachments.importFromFile({
				file,
				parentItemID: docItem.id
			});

			initCache("onItemChange");
			itemChangePromise = getCache("onItemChange");

			await TrellisPane.viewItems([attachment]);
			let tabID = Trellis_Tabs.selectedID;
			let reader = Trellis.Reader.getByTabID(tabID);
			await reader._initPromise;
			// Ensure context pane is open
			TrellisContextPane.collapsed = false;
			result = await itemChangePromise;

			let itemDetails = TrellisContextPane.context._getItemContext(tabID);
			rowElem = itemDetails.getPane("info").querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			valueElem = rowElem.querySelector(".value");

			// Should not be enabled in non-library tab
			assert.isFalse(result.enabled);
			assert.isTrue(rowElem.hidden);

			await waitForUnregister(rowID);
		});

		it("should render row at position", async function () {
			let startOption = Object.assign({}, defaultOption, {
				position: "start",
			});
			let afterCreatorsOption = Object.assign({}, defaultOption, {
				position: "afterCreators",
			});
			let endOption = Object.assign({}, defaultOption, {
				position: "end",
			});

			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);

			// Row at start
			let rowID = await waitForRegister(startOption);
			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);

			assert.notExists(rowElem.previousElementSibling);
			await waitForUnregister(rowID);

			// Row after creator rows
			rowID = await waitForRegister(afterCreatorsOption);
			rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);

			assert.exists(rowElem.previousElementSibling.querySelector(".creator-type-value"));
			assert.notExists(rowElem.nextElementSibling.querySelector(".creator-type-value"));
			await waitForUnregister(rowID);

			// Row at end
			rowID = rowID = await waitForRegister(endOption);
			rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);

			assert.exists(rowElem.nextElementSibling.querySelector("*[fieldname=dateAdded]"));
			await waitForUnregister(rowID);
		});

		it("should set input editable", async function () {
			let editableOption = Object.assign({}, defaultOption, {
				editable: true,
			});
			let notEditableOption = Object.assign({}, defaultOption, {
				editable: false,
			});

			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);

			let rowID = await waitForRegister(defaultOption);

			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			let valueElem = rowElem.querySelector(".value");

			assert.isFalse(valueElem.readOnly);

			await waitForUnregister(rowID);

			rowID = await waitForRegister(editableOption);

			rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			valueElem = rowElem.querySelector(".value");

			assert.isFalse(valueElem.readOnly);

			await waitForUnregister(rowID);

			rowID = await waitForRegister(notEditableOption);

			rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			valueElem = rowElem.querySelector(".value");

			assert.isTrue(valueElem.readOnly);

			await waitForUnregister(rowID);
		});

		it("should set input multiline", async function () {
			let multilineOption = Object.assign({}, defaultOption, {
				multiline: true,
			});
			let notMultilineOption = Object.assign({}, defaultOption, {
				multiline: false,
			});

			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);
			
			let rowID = await waitForRegister(defaultOption);

			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			let valueElem = rowElem.querySelector(".value");

			assert.isFalse(valueElem.multiline);

			await waitForUnregister(rowID);

			rowID = await waitForRegister(multilineOption);

			rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			valueElem = rowElem.querySelector(".value");

			assert.isTrue(valueElem.multiline);

			await waitForUnregister(rowID);

			rowID = await waitForRegister(notMultilineOption);

			rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			valueElem = rowElem.querySelector(".value");

			assert.isFalse(valueElem.multiline);

			await waitForUnregister(rowID);
		});

		it("should set input nowrap", async function () {
			let noWrapOption = Object.assign({}, defaultOption, {
				nowrap: true,
			});
			let wrapOption = Object.assign({}, defaultOption, {
				nowrap: false,
			});

			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);
			
			let rowID = await waitForRegister(defaultOption);

			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			let valueElem = rowElem.querySelector(".value");

			assert.isFalse(valueElem.noWrap);

			await waitForUnregister(rowID);

			rowID = await waitForRegister(noWrapOption);

			rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			valueElem = rowElem.querySelector(".value");

			assert.isTrue(valueElem.noWrap);

			await waitForUnregister(rowID);

			rowID = await waitForRegister(wrapOption);

			rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			valueElem = rowElem.querySelector(".value");

			assert.isFalse(valueElem.noWrap);

			await waitForUnregister(rowID);
		});

		it("should refresh custom row value", async function () {
			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);
			
			let rowID = await waitForRegister(defaultOption);

			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			let valueElem = rowElem.querySelector(".value");

			let oldValue = valueElem.value;

			// Since this row does not have `onSetData`, changing value does not do anything
			// We just want to test if the value can be refreshed by calling `updateInfoRow`
			let newValue = "TEST CUSTOM ROW EDITED";
			valueElem.value = newValue;

			let notifyPromise = waitForNotifierEvent("refresh", "infobox");

			// Manually refresh the row
			Trellis.ItemPaneManager.refreshInfoRow(rowID);
			await notifyPromise;

			assert.equal(oldValue, valueElem.value);

			await waitForUnregister(rowID);
		});

		it("should render custom row value after item change", async function () {
			// https://github.com/trellis/trellis/issues/4874

			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);
			
			let rowID = await waitForRegister(defaultOption);

			let rowElem = infoSection.querySelector(`[data-custom-row-id="${CSS.escape(rowID)}"]`);
			let valueElem = rowElem.querySelector(".value");

			let value = valueElem.value;
			assert.equal(`${item.id}`, value);

			initCache("onGetData");
			let getDataPromise = getCache("onGetData");

			let docItem = new Trellis.Item('document');
			await docItem.saveTx();
			await TrellisPane.selectItem(docItem.id);
			await getDataPromise;

			value = valueElem.value;
			assert.equal(`${docItem.id}`, value);

			await waitForUnregister(rowID);
		});
	});

	describe("Item tree custom column", function () {
		// Only test hooks, as other column options are covered in item tree tests
		let defaultOption = {
			columnID: "default-test",
			pluginID: "trellis@trellis.org",
			dataKey: "api-test",
			label: "APITest",
			dataProvider: (item) => {
				let data = `${item.id}`;
				updateCache("dataProvider", data);
				return data;
			},
		};

		let waitForRegister = async (option) => {
			initCache("dataProvider");
			let getDataPromise = getCache("dataProvider");
			let columnKey = Trellis.ItemTreeManager.registerColumn(option);
			await getDataPromise;
			return columnKey;
		};

		let waitForColumnEnable = async (dataKey) => {
			_itemsView._columnPrefs[dataKey] = {
				dataKey,
				hidden: false,
			};
			let columns = _itemsView._getColumns();
			let columnID = columns.findIndex(column => column.dataKey === dataKey);
			if (columnID === -1) {
				return;
			}
			let column = columns[columnID];
			if (!column.hidden) {
				return;
			}
			_itemsView.tree._columns.toggleHidden(columnID);

			// Wait for column header to render
			await waitForCallback(
				() => !!doc.querySelector(`#trellis-items-tree .virtualized-table-header .cell.${CSS.escape(dataKey)}`),
				100, 3);
		};

		let waitForUnregister = async (columnID) => {
			let unregisterPromise = waitForNotifierEvent("refresh", "itemtree");
			let success = Trellis.ItemTreeManager.unregisterColumn(columnID);
			await unregisterPromise;
			return success;
		};

		let getSelectedRowCell = (dataKey) => {
			let cell = doc.querySelector(`#trellis-items-tree .row.selected .${CSS.escape(dataKey)}`);
			return cell;
		};

		beforeEach(async function () {
			resetCaches();
		});

		afterEach(function () {
			Trellis_Tabs.select("trellis-pane");
			Trellis_Tabs.closeAll();
		});

		it("should render custom column and call dataProvider hook", async function () {
			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);
			
			let columnKey = await waitForRegister(defaultOption);

			await waitForColumnEnable(columnKey);

			// Should render custom column cell
			let cellElem = getSelectedRowCell(columnKey);

			assert.exists(cellElem);

			// Should call dataProvider and render the value
			assert.equal(`${item.id}`, cellElem.textContent);

			await waitForUnregister(columnKey);
		});

		it("should use custom renderCell hook", async function () {
			let customCellContent = "Custom renderCell";

			let option = Object.assign({}, defaultOption, {
				renderCell: (index, data, column, isFirstColumn, doc) => {
					// index: the index of the row
					// data: the data to display in the column, return of `dataProvider`
					// column: the column options
					// isFirstColumn: true if this is the first column
					// doc: the document of the item tree
					// return: the HTML to display in the cell
					const cell = doc.createElement('span');
					cell.className = `cell ${column.className}`;
					cell.textContent = customCellContent;
					cell.style.color = 'red';
					updateCache("renderCell", cell.textContent);
					return cell;
				},
			});

			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);

			let columnKey = await waitForRegister(option);

			await waitForColumnEnable(columnKey);

			// Should render custom column cell
			let cellElem = getSelectedRowCell(columnKey);

			assert.exists(cellElem);

			// Should call renderCell and render the value
			assert.equal('rgb(255, 0, 0)', win.getComputedStyle(cellElem).color);

			await waitForUnregister(columnKey);
		});

		it("should not break ui when hooks throw error", async function () {
			let option = Object.assign({}, defaultOption, {
				dataProvider: () => {
					updateCache("dataProvider", "Test error");
					throw new Error("Test error");
				},
				renderCell: () => {
					updateCache("renderCell", "Test error");
					throw new Error("Test error");
				}
			});

			let item = new Trellis.Item('book');
			await item.saveTx();
			await TrellisPane.selectItem(item.id);
			
			let columnKey = await waitForRegister(option);

			await waitForColumnEnable(columnKey);

			// Should not break ui
			let columnElem = getSelectedRowCell(columnKey);
			assert.exists(columnElem);

			await waitForUnregister(columnKey);
		});
	});

	describe("Custom menu", function () {
		let defaultOption = {
			menuID: "default-test",
			pluginID: "trellis@trellis.org",
			menus: [{
				menuType: "menuitem",
				l10nID: "menu-print",
				onShowing: (event, context) => {
					updateCache("onShowing", context);
				},
				onCommand: (event, context) => {
					updateCache("onCommand", context);
				}
			}]
		};

		let defaultContextKeys = [
			"menuElem",
			"setEnabled",
			"setIcon",
			"setL10nArgs",
			"setVisible",
			"tabID",
			"tabType",
			"tabSubType",
		];

		// From https://searchfox.org/mozilla-esr128/source/browser/base/content/test/menubar/browser_file_close_tabs.js
		async function simulateMenuOpen(menu) {
			return new Promise((resolve) => {
				menu.addEventListener("popupshown", resolve, { once: true });
				menu.dispatchEvent(new MouseEvent("popupshowing"));
				menu.dispatchEvent(new MouseEvent("popupshown"));
			});
		}

		async function simulateMenuClosed(menu) {
			return new Promise((resolve) => {
				menu.addEventListener("popuphidden", resolve, { once: true });
				menu.dispatchEvent(new MouseEvent("popuphiding"));
				menu.dispatchEvent(new MouseEvent("popuphidden"));
			});
		}

		async function simulateMenuItemClick(menuitem) {
			return new Promise((resolve) => {
				menuitem.addEventListener("command", resolve, { once: true });
				menuitem.dispatchEvent(new MouseEvent("click"));
				menuitem.dispatchEvent(new MouseEvent("command"));
			});
		}

		async function checkMenuContext(option, popupSelector, contextKeys, targetDoc) {
			if (!targetDoc) {
				targetDoc = doc;
			}

			option = Object.assign({}, defaultOption, option);
			let target = option.target;

			initCache("onShowing");
			let menuID = Trellis.MenuManager.registerMenu(option);
			assert.isString(menuID);

			let popup;
			if (typeof popupSelector === "function") {
				popup = await popupSelector();
			}
			else {
				popup = targetDoc.querySelector(popupSelector);
				await simulateMenuOpen(popup);
			}
			assert.exists(popup, `Popup for target ${target} should exist`);

			let context = await getCache("onShowing");

			if (contextKeys) {
				for (let key of contextKeys) {
					assert.property(context, key, `Context of ${target} should have key: ${key}`);
				}
			}

			if (typeof popupSelector === "function") {
				popup.hidePopup();
			}
			else {
				await simulateMenuClosed(popup);
			}

			assert.isTrue(Trellis.MenuManager.unregisterMenu(menuID));
		}

		beforeEach(async function () {
			resetCaches();
		});

		afterEach(function () {
			Trellis_Tabs.select("trellis-pane");
			Trellis_Tabs.closeAll();
		});

		it("should register custom menu and call hooks", async function () {
			let option = Object.assign({}, defaultOption, {
				target: "main/menubar/file",
				menus: [{
					menuType: "menuitem",
					l10nID: "menu-print",
					onShowing: (event, context) => {
						updateCache("onShowing", context);
					},
					onShown: (event, context) => {
						updateCache("onShown", context);
					},
					onHiding: (event, context) => {
						updateCache("onHiding", context);
					},
					onHidden: (event, context) => {
						updateCache("onHidden", context);
					},
					onCommand: (event, context) => {
						updateCache("onCommand", context);
					}
				}]
			});
			initCache("onShowing");
			initCache("onShown");
			initCache("onHiding");
			initCache("onHidden");
			initCache("onCommand");
			let menuID = Trellis.MenuManager.registerMenu(option);
			assert.isString(menuID);

			let popup = doc.querySelector("#menu_FilePopup");
			await simulateMenuOpen(popup);
			let context = await getCache("onShowing");
			await getCache("onShown");

			assert.exists(context.menuElem);
			assert.equal(context.menuElem.parentNode, popup);

			await simulateMenuItemClick(context.menuElem);
			context = await getCache("onCommand");
			assert.exists(context);

			await simulateMenuClosed(popup);
			await Promise.all([
				getCache("onHiding"),
				getCache("onHidden")
			]);

			// Unregister the menu
			assert.isTrue(Trellis.MenuManager.unregisterMenu(menuID));

			// After unregistering and re-opening the popup, the menu should not exist
			popup.addEventListener("popupshown", () => {
				assert.notExists(popup.querySelector('.trellis-custom-menu-item'));
			}, { once: true });

			// Since the event is manually dispatched, the above listener will be triggered before the promise resolves
			await simulateMenuOpen(popup);
		});

		it("should hide custom menu when not enabled for tab type", async function () {
			let option = Object.assign({}, defaultOption, {
				target: "main/menubar/file",
				menus: [
					{
						menuType: "menuitem",
						l10nID: "menu-print",
						onShowing: (event, context) => {
							context.menuElem?.classList.add("test-menu-library");
						},
						enableForTabTypes: ["library"]
					},
					{
						menuType: "menuitem",
						l10nID: "menu-print",
						onShowing: (event, context) => {
							context.menuElem?.classList.add("test-menu-pdf");
						},
						enableForTabTypes: ["reader/pdf"]
					},
					{
						menuType: "menuitem",
						l10nID: "menu-print",
						onShowing: (event, context) => {
							context.menuElem?.classList.add("test-menu-epub");
						},
						enableForTabTypes: ["reader/epub"]
					},
					{
						menuType: "menuitem",
						l10nID: "menu-print",
						onShowing: (event, context) => {
							context.menuElem?.classList.add("test-menu-snapshot");
						},
						enableForTabTypes: ["reader/snapshot"]
					},
					{
						menuType: "menuitem",
						l10nID: "menu-print",
						onShowing: (event, context) => {
							context.menuElem?.classList.add("test-menu-anyReader");
						},
						enableForTabTypes: ["reader/*"]
					}
				]
			});

			// Create items for different tab types
			let pdfItem = await importFileAttachment('test.pdf');
			let epubItem = await importFileAttachment('stub.epub');
			let snapshotItem = await importFileAttachment('test.html');

			let menuID = Trellis.MenuManager.registerMenu(option);
			assert.isString(menuID);
			let popup = doc.querySelector("#menu_FilePopup");

			function assertMenuVisibility(popup, visibilities) {
				for (let [className, visible] of Object.entries(visibilities)) {
					let menuItem = popup.querySelector(`.test-menu-${className}`);
					if (visible) {
						assert.isFalse(menuItem.hidden, `Menu item ${className} should be visible`);
					}
					else {
						assert.isTrue(menuItem.hidden, `Menu item ${className} should be hidden`);
					}
				}
			}

			// Open the menu in library tab
			await simulateMenuOpen(popup);
			// Should show library menu item
			assertMenuVisibility(popup, {
				library: true,
				pdf: false,
				epub: false,
				snapshot: false,
				anyReader: false
			});
			await simulateMenuClosed(popup);

			// Switch to PDF tab
			await TrellisPane.viewItems([pdfItem]);
			let pdfTabID = Trellis_Tabs.selectedID;
			await Trellis.Reader.getByTabID(pdfTabID)._initPromise;
			await simulateMenuOpen(popup);
			// Should show PDF and anyReader menu items
			assertMenuVisibility(popup, {
				library: false,
				pdf: true,
				epub: false,
				snapshot: false,
				anyReader: true
			});
			await simulateMenuClosed(popup);

			// Switch to EPUB tab
			await TrellisPane.viewItems([epubItem]);
			let epubTabID = Trellis_Tabs.selectedID;
			await Trellis.Reader.getByTabID(epubTabID)._initPromise;
			await simulateMenuOpen(popup);
			// Should show EPUB and anyReader menu items
			assertMenuVisibility(popup, {
				library: false,
				pdf: false,
				epub: true,
				snapshot: false,
				anyReader: true
			});
			await simulateMenuClosed(popup);

			// Switch to Snapshot tab
			await TrellisPane.viewItems([snapshotItem]);
			let snapshotTabID = Trellis_Tabs.selectedID;
			await Trellis.Reader.getByTabID(snapshotTabID)._initPromise;
			await simulateMenuOpen(popup);
			// Should show Snapshot and anyReader menu items
			assertMenuVisibility(popup, {
				library: false,
				pdf: false,
				epub: false,
				snapshot: true,
				anyReader: true
			});
			await simulateMenuClosed(popup);

			// Unregister the menu
			assert.isTrue(Trellis.MenuManager.unregisterMenu(menuID));
		});

		it("should register recursive submenu", async function () {
			let testMenuClass = "test-recursive-submenu";
			let option = Object.assign({}, defaultOption, {
				target: "main/menubar/file",
				menus: [{
					menuType: "submenu",
					l10nID: "menu-print",
					onShowing: (event, context) => {
						context.menuElem?.classList.add(testMenuClass);
					},
					menus: [{
						menuType: "menuitem",
						l10nID: "menu-print",
						onShowing: (event, context) => {
							updateCache("onShowing", context);
						},
						onCommand: (event, context) => {
							updateCache("onCommand", context);
						}
					}]
				}]
			});

			initCache("onCommand");
			initCache("onShowing");

			let menuID = Trellis.MenuManager.registerMenu(option);
			assert.isString(menuID);

			let popup = doc.querySelector("#menu_FilePopup");

			await simulateMenuOpen(popup);

			// The onShowing hook of child menu should not be called yet
			assert.isEmpty(caches.onShowing.result, "Child menu onShowing should not be called yet");

			let submenu = popup.querySelector(`.${testMenuClass}`);
			assert.exists(submenu, "Submenu should be created");

			let submenuPopup = submenu.querySelector("menupopup");
			await simulateMenuOpen(submenuPopup);
			let context = await getCache("onShowing");
			assert.exists(context.menuElem, "Submenu onShowing context should have menuElem");

			await simulateMenuItemClick(context.menuElem);
			context = await getCache("onCommand");
			assert.exists(context, "Submenu command context should exist");

			assert.isTrue(Trellis.MenuManager.unregisterMenu(menuID));
		});

		it("should register main window menu", async function () {
			let menuTargetMap = {
				"main/menubar/file": "#menu_FilePopup",
				"main/menubar/edit": "#menu_EditPopup",
				"main/menubar/view": "#menu_viewPopup",
				"main/menubar/go": "#menu_goPopup",
				"main/menubar/tools": "#menu_ToolsPopup",
				"main/menubar/help": "#menu_HelpPopup",
			};
			
			let contextKeys = [
				...defaultContextKeys,
				"items",
			];

			for (let [target, popupSelector] of Object.entries(menuTargetMap)) {
				await checkMenuContext({ target }, popupSelector, contextKeys);
			}
		});

		it("should register library menu", async function () {
			let menuTargetMap = {
				"main/library/item": {
					popupSelector: () => {
						TrellisPane.onItemsContextMenuOpen(new MouseEvent("contextmenu"), 0, 0);
						return doc.querySelector("#trellis-itemmenu");
					},
					contextKeys: [
						...defaultContextKeys,
						"items",
						"collectionTreeRow",
						"collectionTreeRows",
					]
				},
				"main/library/collection": {
					popupSelector: () => {
						TrellisPane.onCollectionsContextMenuOpen(new MouseEvent("contextmenu"), 0, 0);
						return doc.querySelector("#trellis-collectionmenu");
					},
					contextKeys: [
						...defaultContextKeys,
						"collectionTreeRow",
						"collectionTreeRows",
					]
				},
				"main/library/addAttachment": {
					popupSelector: "#menu_attachmentAdd > menupopup",
					contextKeys: [
						...defaultContextKeys,
						"items",
					]
				},
				"main/library/addNote": {
					popupSelector: "#menu_noteAdd > menupopup",
					contextKeys: [
						...defaultContextKeys,
						"items",
					]
				}
			};

			for (let [target, { popupSelector, contextKeys }] of Object.entries(menuTargetMap)) {
				await checkMenuContext({ target }, popupSelector, contextKeys);
			}
		});

		it("should register other main window menus", async function () {
			let menuTargetMap = {
				"main/tab": {
					popupSelector: async () => {
						let tabID = Trellis_Tabs.selectedID;
						return Trellis_Tabs._openMenu(0, 0, tabID);
					},
					contextKeys: [
						...defaultContextKeys,
						"items"
					]
				},
				"itemPane/info/row": {
					popupSelector: async () => {
						let item = new Trellis.Item('book');
						await item.saveTx();
						await TrellisPane.selectItem(item.id);
						let itemDetails = TrellisPane.itemPane._itemDetails;
						let infoBox = itemDetails.getPane("info");
						let row = infoBox.querySelector("#itembox-field-value-title");
						row.focus();
						let event = new MouseEvent("contextmenu", {
							bubbles: true,
							cancelable: true,
						});
						row.dispatchEvent(event);
						let popup = infoBox.querySelector("#trellis-field-menu");
						return popup;
					},
					contextKeys: [
						...defaultContextKeys,
						"items",
						"editable",
						"fieldName",
						"targetElem"
					]
				},
				"sidenav/locate": {
					popupSelector: async () => {
						let item = new Trellis.Item('book');
						await item.saveTx();
						await TrellisPane.selectItem(item.id);
						let sidenav = TrellisPane.itemPane._sidenav;
						let button = sidenav.querySelector("toolbarbutton[data-action='locate']");
						let event = new MouseEvent("mousedown", {
							bubbles: true,
							cancelable: true,
						});
						button.dispatchEvent(event);
						let popup = button.querySelector("menupopup");
						return popup;
					},

					contextKeys: [
						...defaultContextKeys,
						"items",
					]
				}
			};

			for (let [target, { popupSelector, contextKeys }] of Object.entries(menuTargetMap)) {
				await checkMenuContext({ target }, popupSelector, contextKeys);
			}
		});

		it("should register note context menu", async function () {
			let menuTargetMap = {
				"notesPane/addItemNote": async () => {
					let button = notesList.querySelector(".item-notes .section-custom-button.add");
					let event = new MouseEvent("command", {
						bubbles: true,
						cancelable: true,
					});
					button.dispatchEvent(event);
					let popup = notesContext.querySelector(".context-pane-add-child-note-button-popup");
					return popup;
				},
				"notesPane/addStandaloneNote": async () => {
					let button = notesList.querySelector(".all-notes .section-custom-button.add");
					let event = new MouseEvent("command", {
						bubbles: true,
						cancelable: true,
					});
					button.dispatchEvent(event);
					let popup = notesContext.querySelector(".context-pane-add-standalone-note-button-popup");
					return popup;
				}
			};
			
			let item = new Trellis.Item('book');
			await item.saveTx();
			let pdfItem = await importFileAttachment('test.pdf', {
				parentItemID: item.id
			});
			await TrellisPane.viewItems([pdfItem]);
			await Trellis.Reader.getByTabID(Trellis_Tabs.selectedID)._initPromise;
			TrellisContextPane.collapsed = false;
			TrellisContextPane.sidenav._contextNotesPaneVisible = true;
			let contextPane = TrellisContextPane.context;
			let notesContext = contextPane._getCurrentNotesContext();
			let notesList = notesContext.notesList;

			for (let [target, popupSelector] of Object.entries(menuTargetMap)) {
				await checkMenuContext({ target }, popupSelector);
			}
		});

		it("should register reader window menu", async function () {
			let mainMenubarTargetMap = {
				"reader/menubar/file": "#menu_FilePopup",
				"reader/menubar/edit": "#menu_EditPopup",
				"reader/menubar/view": "#menu_viewPopup",
				"reader/menubar/go": "#menu_goPopup",
				"reader/menubar/window": "#windowPopup",
			};

			let pdfAttachment = await importFileAttachment('test.pdf');
			let reader = await Trellis.Reader.open(pdfAttachment.id, undefined, {
				openInWindow: true,
			});
			await reader._initPromise;
			
			let readerWin = reader._window;
			let readerDoc = readerWin.document;

			for (let [target, popupSelector] of Object.entries(mainMenubarTargetMap)) {
				await checkMenuContext({ target }, popupSelector, undefined, readerDoc);
			}

			reader.close();
		});

		it("should remove menu DOM elements on plugin shutdown", async function () {
			let pluginID = "test-plugin@trellis.org";
			let option = Object.assign({}, defaultOption, {
				pluginID,
				target: "main/menubar/file",
			});

			initCache("onShowing");
			let menuID = Trellis.MenuManager.registerMenu(option);
			assert.isString(menuID);

			let popup = doc.querySelector("#menu_FilePopup");
			await simulateMenuOpen(popup);
			await getCache("onShowing");

			let menuSelector = `.trellis-custom-menu-item.${CSS.escape(menuID)}`;
			assert.exists(popup.querySelector(menuSelector),
				"Menu element should exist after registration");

			await simulateMenuClosed(popup);

			await Trellis.MenuManager._menuManager._unregisterByPluginID(pluginID);

			assert.notExists(popup.querySelector(menuSelector),
				"Menu element should be removed after plugin shutdown");
		});

		it("should group custom menus", async function () {
			let option = Object.assign({}, defaultOption, {
				target: "main/library/item",
				menus: Array.from({length: 100}, () => ({
					menuType: "menuitem",
					l10nID: "menu-print",
				})),
			});

			initCache("onShowing");
			initCache("onCommand");

			let menuID = Trellis.MenuManager.registerMenu(option);
			assert.isString(menuID);

			let popup = doc.querySelector("#trellis-itemmenu");

			let promise = new Promise((resolve) => {
				popup.addEventListener("popupshown", resolve, { once: true });
			});

			TrellisPane.onItemsContextMenuOpen(new MouseEvent("contextmenu"), 0, 0);
			await promise;

			let groupedMenus = popup.querySelector(".trellis-custom-menu-group-submenu");
			assert.exists(groupedMenus, "Grouped menus should be created");

			assert.isTrue(Trellis.MenuManager.unregisterMenu(menuID));
		});
	});
});
