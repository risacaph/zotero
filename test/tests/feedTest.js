describe("Trellis.Feed", function () {
	async function checkSaveFails(dataObject, message, options = undefined) {
		let e = await getPromiseError(dataObject.saveTx(options));
		assert.ok(e);
		if (typeof message === 'string') {
			assert.equal(e.message, message);
		}
		else {
			assert.match(e.message, message);
		}
	}
	
	// Clean up after after tests
	after(async function () {
		await clearFeeds();
	});
	
	it("should be an instance of Trellis.Library", function () {
		let feed = new Trellis.Feed();
		assert.instanceOf(feed, Trellis.Library);
	});
	
	describe("#constructor()", function () {
		it("should accept required fields as arguments", async function () {
			let feed = new Trellis.Feed();
			await checkSaveFails(feed, 'Feed name not set');
			
			feed = new Trellis.Feed({
				name: 'Test ' + Trellis.randomString(),
				url: 'http://www.' + Trellis.randomString() + '.com'
			});
			await feed.saveTx();
		});
	});
	
	describe("#isFeed", function () {
		it("should be true", function () {
			let feed = new Trellis.Feed();
			assert.isTrue(feed.isFeed);
		});
		it("should be falsy for regular Library", function () {
			let library = new Trellis.Library();
			assert.notOk(library.isFeed);
		});
	});
	
	describe("#editable", function () {
		it("should always be not editable", async function () {
			let feed = await createFeed();
			assert.isFalse(feed.editable);
			feed.editable = true;
			assert.isFalse(feed.editable);
			await feed.saveTx();
			assert.isFalse(feed.editable);
		});
		it("should allow adding items without editCheck override", async function () {
			let feed = await createFeed();
			let feedItem = new Trellis.FeedItem('book', { guid: Trellis.randomString() });
			feedItem.libraryID = feed.libraryID;
			await feedItem.saveTx();
		});
	});
	
	describe("#libraryTypeID", function () {
		it("should be undefind", async function () {
			let feed = await createFeed();
			assert.isUndefined(feed.libraryTypeID);
		});
	});
	
	describe("#url", function () {
		it("should throw if trying to set an invalid URL", async function () {
			let feed = new Trellis.Feed({ name: 'Test ' + Trellis.randomString() });
			
			assert.throws(function () {feed.url = 'foo'}, /^Invalid feed URL /);
			assert.throws(function () {feed.url = 'ftp://example.com'}, /^Invalid feed URL /);
		});
	});
	
	describe("#save()", function () {
		it("should save a new feed to the feed library", async function () {
			let props = {
				name: 'Test ' + Trellis.randomString(),
				url: 'http://' + Trellis.randomString() + '.com/'
			};
			let feed = await createFeed(props);
			
			assert.equal(feed.name, props.name, "name is correct");
			assert.equal(feed.url.toLowerCase(), props.url.toLowerCase(), "url is correct");
		});
		it("should save a feed with all fields set", async function () {
			let props = {
				name: 'Test ' + Trellis.randomString(),
				url: 'http://' + Trellis.randomString() + '.com/',
				refreshInterval: 30,
				cleanupReadAfter: 1,
				cleanupUnreadAfter: 30
			};
			
			let feed = await createFeed(props);
			
			assert.equal(feed.name, props.name, "name is correct");
			assert.equal(feed.url.toLowerCase(), props.url.toLowerCase(), "url is correct");
			assert.equal(feed.refreshInterval, props.refreshInterval, "refreshInterval is correct");
			assert.equal(feed.cleanupReadAfter, props.cleanupReadAfter, "cleanupReadAfter is correct");
			assert.equal(feed.cleanupUnreadAfter, props.cleanupUnreadAfter, "cleanupUnreadAfter is correct");
			
			assert.isNull(feed.lastCheck, "lastCheck is null");
			assert.isNull(feed.lastUpdate, "lastUpdate is null");
			assert.isNull(feed.lastCheckError, "lastCheckError is null");
		});
		it("should throw if name or url are missing", async function () {
			let feed = new Trellis.Feed();
			await checkSaveFails(feed, 'Feed name not set');
			
			feed.name = 'Test ' + Trellis.randomString();
			await checkSaveFails(feed, 'Feed URL not set');
			
			feed = new Trellis.Feed();
			feed.url = 'http://' + Trellis.randomString() + '.com';
			await checkSaveFails(feed, 'Feed name not set');
		});
		it("should not allow saving a feed with the same url", async function () {
			let url = 'http://' + Trellis.randomString() + '.com';
			let feed1 = await createFeed({ url });
			
			let feed2 = new Trellis.Feed({ name: 'Test ' + Trellis.randomString(), url });
			await checkSaveFails(feed2, /^Feed for URL already exists: /);
			
			// Perform check with normalized URL
			feed2.url = url + '/';
			await checkSaveFails(feed2, /^Feed for URL already exists: /);
			
			feed2.url = url.toUpperCase();
			await checkSaveFails(feed2, /^Feed for URL already exists: /);
		});
		it("should allow saving a feed with the same name", async function () {
			let name = 'Test ' + Trellis.randomString();
			let feed1 = await createFeed({ name });
			
			let feed2 = new Trellis.Feed({ name, url: 'http://' + Trellis.randomString() + '.com' });
			
			await feed2.saveTx();
			
			assert.equal(feed1.name, feed2.name, "feed names remain the same");
		});
		it("should save field to DB after editing", async function () {
			let feed = await createFeed();
			
			feed.name = 'bar';
			await feed.saveTx();
			
			let dbVal = await Trellis.DB.valueQueryAsync('SELECT name FROM feeds WHERE libraryID=?', feed.libraryID);
			assert.equal(feed.name, 'bar');
			assert.equal(dbVal, feed.name);
		});
		it("should add a new synced setting after creation", async function () {
			let url = 'http://' + Trellis.Utilities.randomString(10, 'abcde') + '.com/feed.rss';
			
			let syncedFeeds = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			assert.notOk(syncedFeeds[url]);
			
			await createFeed({url});
			
			syncedFeeds = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			assert.ok(syncedFeeds[url]);
		});
		it("should remove previous feed and add a new one if url changed", async function () {
			let feed = await createFeed();
			
			let syncedFeeds = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			assert.ok(syncedFeeds[feed.url]);

			let oldUrl = feed.url;
			feed.url = 'http://' + Trellis.Utilities.randomString(10, 'abcde') + '.com/feed.rss';
			await feed.saveTx();

			syncedFeeds = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			assert.notOk(syncedFeeds[oldUrl]);
			assert.ok(syncedFeeds[feed.url]);
		});
		it('should update syncedSettings if `name`, `url`, `refreshInterval` or `cleanupUnreadAfter` was modified', async function () {
			let feed = await createFeed();
			let syncedSetting = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			await Trellis.SyncedSettings.set(Trellis.Libraries.userLibraryID, 'feeds', syncedSetting, 0, true);
			
			feed.name = "New name";
			await feed.saveTx();
			assert.isFalse(Trellis.SyncedSettings.getMetadata(Trellis.Libraries.userLibraryID, 'feeds').synced)
		});
		it('should not update syncedSettings if `name`, `url`, `refreshInterval` or `cleanupUnreadAfter` were not modified', async function () {
			let feed = await createFeed();
			let syncedSetting = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			await Trellis.SyncedSettings.set(Trellis.Libraries.userLibraryID, 'feeds', syncedSetting, 0, true);

			feed._set('_feedLastCheck', Trellis.Date.dateToSQL(new Date(), true));
			await feed.saveTx();
			assert.isTrue(Trellis.SyncedSettings.getMetadata(Trellis.Libraries.userLibraryID, 'feeds').synced)
		});
	});
	describe("#erase()", function () {
		it("should erase a saved feed", async function () {
			let feed = await createFeed();
			let id = feed.libraryID;
			let url = feed.url;
			
			await feed.eraseTx();
			
			assert.isFalse(Trellis.Libraries.exists(id));
			assert.isFalse(Trellis.Feeds.existsByURL(url));
			
			let dbValue = await Trellis.DB.valueQueryAsync('SELECT COUNT(*) FROM feeds WHERE libraryID=?', id);
			assert.equal(dbValue, '0');
		});
		it("should clear feedItems from cache", async function () {
			let feed = await createFeed();
			
			let feedItem = await createDataObject('feedItem', { libraryID: feed.libraryID });
			assert.ok(await Trellis.FeedItems.getAsync(feedItem.id));
			
			await feed.eraseTx();
			
			assert.notOk(await Trellis.FeedItems.getAsync(feedItem.id));
		});
		it("should remove synced settings", async function () {
			let url = 'http://' + Trellis.Utilities.randomString(10, 'abcde') + '.com/feed.rss';
			let feed = await createFeed({url});
			
			let syncedFeeds = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			assert.ok(syncedFeeds[feed.url]);
			
			await feed.eraseTx();
			
			syncedFeeds = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			assert.notOk(syncedFeeds[url]);

		});
	});
	
	describe("#storeSyncedSettings", function () {
		it("should store settings for feed in compact format", async function () {
			let url = 'http://' + Trellis.Utilities.randomString().toLowerCase() + '.com/feed.rss';
			let settings = [Trellis.Utilities.randomString(), 1, 30, 1];
			let feed = await createFeed({
				url,
				name: settings[0],
				cleanupReadAfter: settings[1],
				cleanupUnreadAfter: settings[2],
				refreshInterval: settings[3]
			});
			
			let syncedFeeds = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'feeds');
			assert.deepEqual(syncedFeeds[url], settings);
		});
	});
	
	describe("#clearExpiredItems()", function () {
		var feed, readExpiredFI, unreadExpiredFI, readFeedItem, feedItem, readStillInFeed, feedItemIDs;
		
		before(async function () {
			feed = await createFeed({cleanupReadAfter: 1, cleanupUnreadAfter: 3});
			
			readExpiredFI = await createDataObject('feedItem', { libraryID: feed.libraryID });
			// Read 2 days ago
			readExpiredFI.isRead = true;
			readExpiredFI._feedItemReadTime = Trellis.Date.dateToSQL(
					new Date(Date.now() - 2 * 24*60*60*1000), true);
			await readExpiredFI.saveTx();

			// Added 5 days ago
			unreadExpiredFI = await createDataObject('feedItem', { 
				libraryID: feed.libraryID,
				dateAdded: Trellis.Date.dateToSQL(new Date(Date.now() - 5 * 24*60*60*1000), true),
				dateModified: Trellis.Date.dateToSQL(new Date(Date.now() - 5 * 24*60*60*1000), true)
			});
			await unreadExpiredFI.saveTx();
			
			readStillInFeed = await createDataObject('feedItem', { libraryID: feed.libraryID });
			// Read 2 days ago
			readStillInFeed.isRead = true;
			readStillInFeed._feedItemReadTime = Trellis.Date.dateToSQL(
					new Date(Date.now() - 2 * 24*60*60*1000), true);
			await readStillInFeed.saveTx();
			
			readFeedItem = await createDataObject('feedItem', { libraryID: feed.libraryID });
			readFeedItem.isRead = true;
			await readFeedItem.saveTx();
			
			feedItem = await createDataObject('feedItem', { libraryID: feed.libraryID });
			
			feedItemIDs = (await Trellis.FeedItems.getAll(feed.libraryID)).map((row) => row.id);
			
			assert.include(feedItemIDs, feedItem.id, "feed contains unread feed item");
			assert.include(feedItemIDs, readFeedItem.id, "feed contains read feed item");
			assert.include(feedItemIDs, readExpiredFI.id, "feed contains expired feed item");
			assert.include(feedItemIDs, readStillInFeed.id, "feed contains expired but still in rss feed item");
			
			await feed.clearExpiredItems(new Set([readStillInFeed.id]));
			
			feedItemIDs = (await Trellis.FeedItems.getAll(feed.libraryID)).map((row) => row.id);
		});
	
		it('should clear expired items', function () {
			assert.notInclude(feedItemIDs, readExpiredFI.id, "feed no longer contains expired read feed item");
			assert.notInclude(feedItemIDs, unreadExpiredFI.id, "feed no longer contains expired feed item");	
		});
		
		it('should not clear read items that have not expired yet', function () {
			assert.include(feedItemIDs, readFeedItem.id, "feed still contains new feed item");
		});
		
		it('should not clear read items that are still in rss', function () {
			assert.include(feedItemIDs, readStillInFeed.id, "feed still contains read still in rss feed item");
		});
		
		it('should not clear unread items', function () {
			assert.include(feedItemIDs, feedItem.id, "feed still contains new feed item");
		});
	});
	
	describe('#updateFeed()', function () {
		var feed, scheduleNextFeedCheck;
		var feedUrl = getTestDataUrl("feed.rss");
		var modifiedFeedUrl = getTestDataUrl("feedModified.rss");
		var win;
		
		before(async function () {
			// Browser window is needed as parent window to load the feed reader scripts.
			win = await loadTrellisWindow();
			scheduleNextFeedCheck = sinon.stub(Trellis.Feeds, 'scheduleNextFeedCheck').resolves();
		});
		
		beforeEach(async function () {
			scheduleNextFeedCheck.resetHistory();
			feed = await createFeed();
			feed._feedUrl = feedUrl;
			await feed.updateFeed();
		});
		
		afterEach(async function () {
			await clearFeeds();
		});
		
		after(function () {
			if (win) {
				win.close();
			}
			scheduleNextFeedCheck.restore();
		});
		
		it('should schedule next feed check', async function () {
			let feed = await createFeed();
			feed._feedUrl = feedUrl;
			await feed.updateFeed();
			assert.equal(scheduleNextFeedCheck.called, true);
		});
		
		it('should add new feed items', async function () {
			let feedItems = await Trellis.FeedItems.getAll(feed.id, true);
			assert.equal(feedItems.length, 3);
		});
		
		it('should set lastCheck and lastUpdated values', async function () {
			await clearFeeds();
			let feed = await createFeed();
			feed._feedUrl = feedUrl;
			
			assert.notOk(feed.lastCheck);
			assert.notOk(feed.lastUpdate);
			
			await feed.updateFeed();
			
			assert.isTrue(feed.lastCheck > Trellis.Date.dateToSQL(new Date(Date.now() - 1000*60), true), 'feed.lastCheck updated');
			assert.isTrue(feed.lastUpdate > Trellis.Date.dateToSQL(new Date(Date.now() - 1000*60), true), 'feed.lastUpdate updated');
		});
		it('should update modified items, preserving isRead', async function () {
			let feedItem = await Trellis.FeedItems.getAsyncByGUID("http://liftoff.msfc.nasa.gov/2003/06/03.html#item573");
			feedItem.isRead = true;
			await feedItem.saveTx();
			feedItem = await Trellis.FeedItems.getAsyncByGUID("http://liftoff.msfc.nasa.gov/2003/06/03.html#item573");
			assert.isTrue(feedItem.isRead);
			
			let oldDateModified = feedItem.getField('date');
			
			feed._feedUrl = modifiedFeedUrl;
			await feed.updateFeed();
			
			feedItem = await Trellis.FeedItems.getAsyncByGUID("http://liftoff.msfc.nasa.gov/2003/06/03.html#item573");
			
			assert.notEqual(oldDateModified, feedItem.getField('date'));
			assert.isTrue(feedItem.isRead);
		});
		it('should skip items that are not modified', async function () {
			let save = sinon.spy(Trellis.FeedItem.prototype, 'save');
			
			feed._feedUrl = modifiedFeedUrl;
			await feed.updateFeed();
			
			assert.equal(save.thisValues[0].guid, "http://liftoff.msfc.nasa.gov/2003/06/03.html#item573");
			save.restore();
		});
		it('should update unread count', async function () {
			assert.equal(feed.unreadCount, 3);

			let feedItems = await Trellis.FeedItems.getAll(feed.id);
			for (let feedItem of feedItems) {
				feedItem.isRead = true;
				await feedItem.saveTx();
			}
			
			feed._feedUrl = modifiedFeedUrl;
			await feed.updateFeed();
			
			assert.equal(feed.unreadCount, 1);
		});
		it('should add a link to enclosed pdfs from <enclosure/> elements', async function () {
			let feedItem = await Trellis.FeedItems.getAsyncByGUID("http://liftoff.msfc.nasa.gov/2003/06/03.html#item573");
			let pdf = await Trellis.Items.getAsync(feedItem.getAttachments()[0]);
			
			assert.equal(pdf.getField('url'), "http://www.example.com/example.pdf");
		});
	});
	
	describe("Adding items", function () {
		let feed;
		before(async function () {
			feed = await createFeed();
		})
		it("should not allow adding collections", async function () {
			let collection = new Trellis.Collection({ name: 'test', libraryID: feed.libraryID });
			await checkSaveFails(collection, /^Cannot add /, { skipEditCheck: true });
		});
		it("should not allow adding saved search", async function () {
			let search = new Trellis.Search({ name: 'test', libraryID: feed.libraryID });
			await checkSaveFails(search, /^Cannot add /, { skipEditCheck: true });
		});
		it("should allow adding feed item", async function () {
			let feedItem = new Trellis.FeedItem('book', { guid: Trellis.randomString() });
			feedItem.libraryID = feed.libraryID;
			await feedItem.saveTx();
		});
	});
})
