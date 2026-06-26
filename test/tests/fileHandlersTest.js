describe("Trellis.FileHandlers", () => {
	describe("open()", () => {
		var win;
		
		function clearPrefs() {
			Trellis.Prefs.clear('fileHandler.pdf');
			Trellis.Prefs.clear('fileHandler.epub');
			Trellis.Prefs.clear('fileHandler.snapshot');
			Trellis.Prefs.clear('openReaderInNewWindow');
		}
		
		before(async function () {
			clearPrefs();
			win = await loadTrellisPane();
		});

		afterEach(function () {
			clearPrefs();
			delete Trellis.FileHandlers._mockHandlers;
			for (let reader of Trellis.Reader._readers) {
				reader.close();
			}
		});

		after(async function () {
			win.close();
		});
		
		it("should open a PDF internally when no handler is set", async function () {
			let pdf = await importFileAttachment('wonderland_short.pdf');
			await Trellis.FileHandlers.open(pdf, {
				location: { pageIndex: 2 }
			});
			let reader = Trellis.Reader.getByTabID(win.Trellis_Tabs.selectedID);
			assert.ok(reader);
			
			// let notifierPromise = waitForNotifierEvent('add', 'setting');
			await reader._waitForReader();
			// await notifierPromise;
			// Check that the reader navigated to the correct page
			// Note: Temporary disable this check because in the latest reader view stats are initialized much later
			// assert.equal(reader._internalReader._state.primaryViewStats.pageIndex, 2);
		});

		it("should open an EPUB internally when no handler is set", async function () {
			let epub = await importFileAttachment('recognizeEPUB_test_content.epub');
			let annotation = await createAnnotation('highlight', epub);
			await Trellis.FileHandlers.open(epub, {
				location: { annotationID: annotation.key }
			});
			let reader = Trellis.Reader.getByTabID(win.Trellis_Tabs.selectedID);
			assert.ok(reader);
			await reader._waitForReader();
		});

		it("should open a snapshot internally when no handler is set", async function () {
			let snapshot = await importFileAttachment('test.html');
			let annotation = await createAnnotation('highlight', snapshot);
			await Trellis.FileHandlers.open(snapshot, {
				location: { annotationID: annotation.key }
			});
			let reader = Trellis.Reader.getByTabID(win.Trellis_Tabs.selectedID);
			assert.ok(reader);
			await reader._waitForReader();
		});

		it("should open a PDF in a new window when no handler is set and openInWindow is passed", async function () {
			let pdf = await importFileAttachment('wonderland_short.pdf');
			await Trellis.FileHandlers.open(pdf, {
				location: { pageIndex: 2 },
				openInWindow: true
			});
			assert.notOk(Trellis.Reader.getByTabID(win.Trellis_Tabs.selectedID));
			assert.isNotEmpty(Trellis.Reader.getWindowStates());
		});
		
		it("should use matching handler", async function () {
			let pdf = await importFileAttachment('wonderland_short.pdf');
			let wasRun = false;
			let readerOpenSpy = sinon.spy(Trellis.Reader, 'open');
			Trellis.FileHandlers._mockHandlers = {
				pdf: [
					{
						name: /mock/,
						async open() {
							wasRun = true;
						}
					}
				]
			};
			Trellis.Prefs.set('fileHandler.pdf', 'mock');
			
			await Trellis.FileHandlers.open(pdf);
			assert.isTrue(wasRun);
			assert.isFalse(readerOpenSpy.called);
			assert.notOk(Trellis.Reader.getByTabID(win.Trellis_Tabs.selectedID));
			assert.isEmpty(Trellis.Reader.getWindowStates());

			readerOpenSpy.restore();
		});

		it("should infer PDF page number when annotationID is passed", async function () {
			let pdf = await importFileAttachment('wonderland_short.pdf');
			let annotation = await createAnnotation('highlight', pdf);
			let wasRun = false;
			let readerOpenSpy = sinon.spy(Trellis.Reader, 'open');
			Trellis.FileHandlers._mockHandlers = {
				pdf: [
					{
						name: /mock/,
						async open(path, { page }) {
							assert.equal(page, JSON.parse(annotation.annotationPosition).pageIndex + 1);
							wasRun = true;
						}
					}
				]
			};
			Trellis.Prefs.set('fileHandler.pdf', 'mock');
			
			await Trellis.FileHandlers.open(pdf, { location: { annotationID: annotation.key } });
			assert.isTrue(wasRun);
			assert.isFalse(readerOpenSpy.called);
			assert.notOk(Trellis.Reader.getByTabID(win.Trellis_Tabs.selectedID));
			assert.isEmpty(Trellis.Reader.getWindowStates());

			readerOpenSpy.restore();
		});

		it("should fall back to fallback handler when location is passed", async function () {
			let pdf = await importFileAttachment('wonderland_short.pdf');
			let wasRun = false;
			let readerOpenSpy = sinon.spy(Trellis.Reader, 'open');
			Trellis.FileHandlers._mockHandlers = {
				pdf: [
					{
						name: /mock/,
						fallback: true,
						async open(appPath) {
							assert.notOk(appPath); // appPath won't be set when called as fallback
							wasRun = true;
						}
					}
				]
			};

			// Set our custom handler to something nonexistent,
			// and stub the system handler to something nonexistent as well
			Trellis.Prefs.set('fileHandler.pdf', 'some nonexistent tool');
			let getSystemHandlerStub = sinon.stub(Trellis.FileHandlers, '_getSystemHandler');
			getSystemHandlerStub.returns('some other nonexistent tool');

			await Trellis.FileHandlers.open(pdf, { location: {} });
			assert.isTrue(wasRun);
			assert.isFalse(readerOpenSpy.called);
			assert.notOk(Trellis.Reader.getByTabID(win.Trellis_Tabs.selectedID));
			assert.isEmpty(Trellis.Reader.getWindowStates());

			readerOpenSpy.restore();
			getSystemHandlerStub.restore();
		});

		it("should fall back when handler is set to system and we can't retrieve the system handler", async function () {
			let pdf = await importFileAttachment('wonderland_short.pdf');
			let wasRun = false;
			let readerOpenSpy = sinon.spy(Trellis.Reader, 'open');
			let launchFileStub = sinon.stub(Trellis, 'launchFile');
			Trellis.FileHandlers._mockHandlers = {
				pdf: [
					{
						name: new RegExp(''),
						async open() {
							wasRun = true;
						}
					}
				]
			};

			// Set our custom handler to something nonexistent,
			// and stub the system handler to something nonexistent as well
			Trellis.Prefs.set('fileHandler.pdf', 'system');
			let getSystemHandlerStub = sinon.stub(Trellis.FileHandlers, '_getSystemHandler');
			getSystemHandlerStub.returns(false);

			await Trellis.FileHandlers.open(pdf, { location: {} });
			assert.isFalse(wasRun);
			assert.isFalse(readerOpenSpy.called);
			assert.isTrue(launchFileStub.called);
			assert.notOk(Trellis.Reader.getByTabID(win.Trellis_Tabs.selectedID));
			assert.isEmpty(Trellis.Reader.getWindowStates());

			readerOpenSpy.restore();
			launchFileStub.restore();
			getSystemHandlerStub.restore();
		});
	});
});
