describe("Account Preferences", function () {
	var win, doc;
	before(function* () {
		// Load prefs with sync pane
		win = yield loadWindow("chrome://trellis/content/preferences/preferences.xhtml", {
			pane: 'trellis-prefpane-account'
		});
		doc = win.document;
		yield win.Trellis_Preferences.waitForFirstPaneLoad();
	});

	after(function () {
		win.close();
	});

	describe("Settings", function () {
		describe("Data Syncing", function () {
			var createLoginSessionStub, checkLoginSessionStub, deleteAPIKey, launchURLStub,
				streamerSubscribeStub, streamerUnsubscribeStub, indicatorElem, apiKey;

			var performLogin = async function (username) {
				apiKey = Trellis.Utilities.randomString(24);

				createLoginSessionStub.resolves({
					sessionToken: 'test-session-token',
					loginURL: 'https://www.trellis.org/authorize?token=test-session-token'
				});
				checkLoginSessionStub.resolves({
					status: 'completed',
					apiKey,
					userID: 1,
					username
				});

				await win.Trellis_Preferences.Sync.linkAccount();
			};

			before(function* () {
				createLoginSessionStub = sinon.stub(
					Trellis.Sync.APIClient.prototype, 'createLoginSession');
				checkLoginSessionStub = sinon.stub(
					Trellis.Sync.APIClient.prototype, 'checkLoginSession');
				deleteAPIKey = sinon.stub(Trellis.Sync.APIClient.prototype, 'deleteAPIKey').resolves();
				launchURLStub = sinon.stub(Trellis, 'launchURL');
				streamerSubscribeStub = sinon.stub(Trellis.Streamer, 'subscribe').returns(false);
				streamerUnsubscribeStub = sinon.stub(Trellis.Streamer, 'unsubscribe');
				indicatorElem = doc.querySelector('.account-login-status-indicator');
				sinon.stub(Trellis, 'alert');
				// Speed up polling for tests
				win.Trellis_Preferences.Sync._pollInterval = 10;
			});

			beforeEach(function* () {
				yield win.Trellis_Preferences.Sync.unlinkAccount(false);
				deleteAPIKey.resetHistory();
				createLoginSessionStub.resetHistory();
				checkLoginSessionStub.resetHistory();
				launchURLStub.resetHistory();
				streamerSubscribeStub.resetHistory();
				streamerUnsubscribeStub.resetHistory();
				Trellis.alert.reset();
			});

			after(function () {
				Trellis.HTTP.mock = null;
				Trellis.alert.restore();
				createLoginSessionStub.restore();
				checkLoginSessionStub.restore();
				deleteAPIKey.restore();
				launchURLStub.restore();
				streamerSubscribeStub.restore();
				streamerUnsubscribeStub.restore();
				win.Trellis_Preferences.Sync._pollInterval = 3000;
			});

			it("should set API key and display full controls after successful login", async function () {
				await performLogin("Username");

				assert.equal(await Trellis.Sync.Data.Local.getAPIKey(), apiKey);
				assert.equal(doc.getElementById('sync-unauthorized').getAttribute('hidden'), 'true');
				assert.isTrue(launchURLStub.calledOnce);
			});


			it("should show error when login session expires", async function () {
				createLoginSessionStub.resolves({
					sessionToken: 'test-session-token',
					loginURL: 'https://www.trellis.org/authorize?token=test-session-token'
				});
				let expiredError = new Error("Login session expired");
				expiredError.expired = true;
				checkLoginSessionStub.rejects(expiredError);

				await win.Trellis_Preferences.Sync.linkAccount();

				assert.isTrue(Trellis.alert.called);
				assert.equal(await Trellis.Sync.Data.Local.getAPIKey(), "");
				assert.equal(doc.getElementById('sync-settings-section').hidden, true);
			});


			it("should reset UI when login session is cancelled on server", async function () {
				createLoginSessionStub.resolves({
					sessionToken: 'test-session-token',
					loginURL: 'https://www.trellis.org/authorize?token=test-session-token'
				});
				checkLoginSessionStub.resolves({
					status: 'cancelled'
				});

				await win.Trellis_Preferences.Sync.linkAccount();

				assert.equal(await Trellis.Sync.Data.Local.getAPIKey(), "");
				assert.equal(doc.querySelector('.account-login-default').hidden, false);
				assert.equal(doc.querySelector('.account-login-pending').hidden, true);
			});


			it("should delete API key and display auth form when 'Unlink Account' clicked", async function () {
				await performLogin("Username");
				assert.equal(await Trellis.Sync.Data.Local.getAPIKey(), apiKey);

				await win.Trellis_Preferences.Sync.unlinkAccount(false);

				assert.isTrue(deleteAPIKey.called);
				assert.equal(await Trellis.Sync.Data.Local.getAPIKey(), "");
				assert.equal(doc.getElementById('sync-settings-section').hidden, true);
			});

			it("should reset the storage controller when unlinking", async function () {
				await performLogin("Username");
				assert.equal(await Trellis.Sync.Data.Local.getAPIKey(), apiKey);

				let options = {
					apiClient: Trellis.Sync.Runner.getAPIClient({ apiKey })
				};
				let controller = Trellis.Sync.Runner.getStorageController('zfs', options);
				let apiKey1 = controller.apiClient.apiKey;

				await win.Trellis_Preferences.Sync.unlinkAccount(false);
				await performLogin("Username");

				options = {
					apiClient: Trellis.Sync.Runner.getAPIClient({ apiKey })
				};
				controller = Trellis.Sync.Runner.getStorageController('zfs', options);
				assert.notEqual(controller.apiClient.apiKey, apiKey1);
			});

			it("should not unlink on pressing cancel", async function () {
				await performLogin("Username");

				waitForDialog(null, 'cancel');

				await win.Trellis_Preferences.Sync.unlinkAccount();
				assert.equal(await Trellis.Sync.Data.Local.getAPIKey(), apiKey);
				assert.equal(doc.getElementById('sync-unauthorized').getAttribute('hidden'), 'true');
			});

			it("should clear sync errors from the toolbar after logging in", async function () {
				let win = await loadTrellisPane();

				let syncError = win.document.getElementById('trellis-tb-sync-error');

				Trellis.Sync.Runner.updateIcons(new Error("a sync error"));
				assert.isFalse(syncError.hidden);

				await performLogin("Username");
				assert.isTrue(syncError.hidden);

				win.close();
			});

			it("should cancel login and reset UI when cancelLogin is called", async function () {
				let cancelLoginSessionStub = sinon.stub(
					Trellis.Sync.APIClient.prototype, 'cancelLoginSession').resolves();

				createLoginSessionStub.resolves({
					sessionToken: 'test-session-token',
					loginURL: 'https://www.trellis.org/authorize?token=test-session-token'
				});
				// Return "pending" so the poll loop keeps iterating
				checkLoginSessionStub.resolves({ status: 'pending' });

				// Start login but don't await -- it will keep polling
				let loginPromise = win.Trellis_Preferences.Sync.linkAccount();

				// Wait for the poll loop to start
				await Trellis.Promise.delay(50);

				win.Trellis_Preferences.Sync.cancelLogin();

				// Wait for the login promise to resolve after cancellation
				await loginPromise;

				assert.equal(doc.querySelector('.account-login-default').hidden, false);
				assert.equal(doc.querySelector('.account-login-pending').hidden, true);
				assert.isTrue(cancelLoginSessionStub.calledWith('test-session-token'));

				cancelLoginSessionStub.restore();
			});
		});
	});
});
