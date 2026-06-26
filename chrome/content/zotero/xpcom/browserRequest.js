/*
	***** BEGIN LICENSE BLOCK *****

	Copyright © 2026 Corporation for Digital Scholarship
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

const { HiddenBrowser } = ChromeUtils.importESModule("chrome://trellis/content/HiddenBrowser.mjs");

Trellis.BrowserRequest = {
	// Registry of URL patterns that need browser-mediated handling
	CHALLENGE_URLS: [
		{
			match: 'https://trellis-static.s3.amazonaws.com/test-pdf-redirect.html',
			captchaLocator: 'html'
		},
		{
			match: '://www.sciencedirect.com',
			captchaLocator: '#captcha-box'
		},
		{
			match: '://search.worldcat.org',
			// When /api/search returns 403 with turnstile_required, the user-
			// facing /search?q= page runs the matching invisible Turnstile
			// widget, POSTs the token to /api/turnstile-verify, and gets back
			// Set-Cookie: turnstile_passed. Loading that page in a hidden
			// browser reproduces the flow end-to-end with no user interaction.
			getChallengeURL: url => url.replace(/\/api\/search\b/, '/search'),
			// Invisible (managed) Turnstile; no user captcha interaction needed
			captchaLocator: null,
			// Wait for WorldCat's own Turnstile cookie to land
			successCookie: { host: 'search.worldcat.org', name: 'turnstile_passed' },
			detectBlock: (status, body) => status === 403 && /turnstile_required/.test(body)
		},
	],
	
	PLAIN_UA_HOSTS: [
		'challenges.cloudflare.com',
		'www.sciencedirect.com',
		'pdf.sciencedirectassets.com',
		'search.worldcat.org',
	],

	/**
	 * Look up a challenge entry for a URL, applying proxy unwrapping.
	 * @param {string} url
	 * @returns {object|null}
	 */
	getEntryForURL(url) {
		const unproxiedUrls = Object.keys(Trellis.Proxies.getPotentialProxies(url));
		for (let unproxiedUrl of unproxiedUrls) {
			for (let entry of this.CHALLENGE_URLS) {
				if (unproxiedUrl.includes(entry.match)) {
					return entry;
				}
			}
		}
		return null;
	},

	/**
	 * Navigate to a URL in a hidden browser, running its JS long enough for any
	 * client-side redirects or cookie-setting challenges to settle.
	 *
	 * Cookies acquired by the browser remain in the shared jar keyed on
	 * userContextId; a subsequent Trellis.HTTP.request using the same ID will
	 * see them.
	 *
	 * On timeout, if the page contains the entry's captchaLocator and
	 * allowViewer is set, escalates to clearChallengeInViewer().
	 *
	 * @param {string} url
	 * @param {object} [options]
	 * @param {number} [options.userContextId]
	 * @param {object} [options.entry] - registry entry controlling escalation
	 * @param {boolean} [options.allowViewer=false]
	 * @returns {Promise<void>}
	 */
	async clearChallenge(url, options = {}) {
		Trellis.debug(`BrowserRequest: Clearing challenge at ${url}`);

		let { userContextId, entry, allowViewer = false } = options;
		let successCookie = entry?.successCookie;
		// Capture the cookie's current value (if any) before the attempt so
		// we can tell a freshly-issued cookie from a stale one left over from
		// a previous session.
		let initialCookieValue = successCookie
			? this._readCookieValue({ ...successCookie, userContextId })
			: null;
		// Cloudflare Turnstile rejects the "Trellis/[version]" suffix.
		// A plain Firefox UA on just this browsing context lets the widget run.
		let customUserAgent = Trellis.VersionHeader.getPlainFirefoxUA();

		// Try the hidden browser first. _loadAndSettle() polls the cookie jar
		// and resolves as soon as successCookie appears, which may be well
		// before the page fully settles (or redirects somewhere else).
		let hiddenBrowser;
		try {
			hiddenBrowser = new HiddenBrowser({ userContextId, customUserAgent });
			await hiddenBrowser._createdPromise;
			await this._loadAndSettle(hiddenBrowser, url, {
				successCookie,
				userContextId
			});
		}
		catch (e) {
			Trellis.debug('BrowserRequest: Hidden browser attempt failed');
			Trellis.logError(e);
		}
		finally {
			if (hiddenBrowser) {
				hiddenBrowser.destroy();
			}
		}

		if (successCookie) {
			let currentValue = this._readCookieValue({ ...successCookie, userContextId });
			if (currentValue && currentValue !== initialCookieValue) {
				return;
			}
		}

		if (!allowViewer) {
			throw new Error(`BrowserRequest: Challenge not cleared at ${url} and viewer escalation is disabled`);
		}

		// Fall back to the viewer: user may need to click a visible Turnstile
		// widget, after which the cookie lands and we can continue.
		Trellis.debug(`BrowserRequest: Escalating to viewer for ${url}`);
		if (successCookie) {
			await this._loadAndWaitForCookieInViewer(url, {
				userContextId,
				customUserAgent,
				successCookie
			});
			return;
		}
		await this.clearChallengeInViewer(url, {
			userContextId,
			customUserAgent,
			captchaLocator: entry.captchaLocator
		});
	},

	/**
	 * Open a visible viewer at the URL and wait until successCookie appears
	 * in the jar. Necessary for sites where the success signal is a specific
	 * cookie being set (e.g., WorldCat's turnstile_passed) rather than a
	 * navigation or change in the DOM.
	 */
	async _loadAndWaitForCookieInViewer(url, options) {
		Trellis.debug(`BrowserRequest: Awaiting user challenge clearance (cookie ${options.successCookie.name}) at ${url}`);
		const timeout = Trellis.Prefs.get('browserRequest.timeout');
		const { successCookie, userContextId, customUserAgent } = options;

		let win, wmListener, pollInterval;
		let done = false;
		let cookieDeferred = Trellis.Promise.defer();
		let closedDeferred = Trellis.Promise.defer();

		try {
			wmListener = this._makeViewerCloseListener(() => {
				if (!done) closedDeferred.reject(new Error('BrowserRequest: User closed the viewer'));
			});
			Services.wm.addListener(wmListener);
			await new Promise((resolve) => {
				win = Trellis.openInViewer(url, { userContextId, customUserAgent });
				win.addEventListener('load', resolve);
			});
			Trellis.Utilities.Internal.activate(win);

			pollInterval = this._pollForCookie({
				successCookie,
				userContextId,
				onFound: () => {
					done = true;
					cookieDeferred.resolve();
				}
			});

			await Promise.race([
				cookieDeferred.promise,
				closedDeferred.promise,
				Trellis.Promise.delay(timeout).then(() => {
					if (!done) {
						throw new Error(`BrowserRequest: Viewer cookie wait timed out after ${timeout}ms`);
					}
				})
			]);
		}
		finally {
			if (pollInterval) clearInterval(pollInterval);
			Services.wm.removeListener(wmListener);
			if (win) win.close();
		}
	},

	/**
	 * Read the value of a named cookie on a given host under an optional
	 * userContextId. Returns null if the cookie is absent.
	 */
	_readCookieValue({ host, name, userContextId }) {
		try {
			let cookies = Services.cookies.getCookiesFromHost(
				host,
				userContextId ? { userContextId } : {}
			);
			for (let cookie of cookies) {
				if (cookie.name === name) {
					return cookie.value;
				}
			}
		}
		catch (e) {
			Trellis.debug('BrowserRequest: _readCookieValue() failed');
			Trellis.logError(e);
		}
		return null;
	},

	/**
	 * Build a Services.wm listener that tracks the first window opened after
	 * addListener() and invokes onClose when that window closes. Used to
	 * detect user-closed viewer windows.
	 *
	 * @param {Function} onClose
	 */
	_makeViewerCloseListener(onClose) {
		let xulWin;
		return {
			onOpenWindow(xulWindow) {
				xulWin ||= xulWindow;
			},
			onCloseWindow(xulWindow) {
				if (xulWin === xulWindow) {
					onClose();
				}
			}
		};
	},

	/**
	 * Invoke onFound as soon as successCookie appears with a value different
	 * from the one observed at poll start. Captures the initial value to
	 * avoid declaring success on a stale cookie left over from a previous
	 * session (the server-signed HMAC would no longer validate).
	 * Caller is responsible for clearing the returned interval handle.
	 *
	 * @param {object} opts
	 * @param {{host: string, name: string}} opts.successCookie
	 * @param {number} [opts.userContextId]
	 * @param {Function} opts.onFound
	 * @param {number} [opts.intervalMs=250]
	 * @returns {number} interval handle
	 */
	_pollForCookie({ successCookie, userContextId, onFound, intervalMs = 250 }) {
		let { host, name } = successCookie;
		let initialValue = this._readCookieValue({ host, name, userContextId });
		return setInterval(() => {
			let currentValue = this._readCookieValue({ host, name, userContextId });
			if (currentValue && currentValue !== initialValue) {
				onFound();
			}
		}, intervalMs);
	},

	/**
	 * Open a visible browser window at the URL and wait for the user to clear a
	 * challenge. Resolves once the captchaLocator element disappears and the
	 * page has been stable for `browserRequest.onLoadTimeout` ms.
	 *
	 * @param {string} url
	 * @param {object} options
	 * @param {number} [options.userContextId]
	 * @param {string} options.captchaLocator
	 * @param {string} [options.customUserAgent]
	 * @returns {Promise<void>}
	 */
	async clearChallengeInViewer(url, options) {
		Trellis.debug(`BrowserRequest: Awaiting user challenge clearance for ${url}`);
		const onLoadTimeout = Trellis.Prefs.get('browserRequest.onLoadTimeout');
		const timeout = Trellis.Prefs.get('browserRequest.timeout');

		let win, browser, wmListener;
		let cleared = false;
		let cancelled = false;
		let clearedDeferred = Trellis.Promise.defer();

		try {
			wmListener = this._makeViewerCloseListener(() => {
				if (!cleared) clearedDeferred.reject(new Error('BrowserRequest: User closed the viewer'));
			});
			Services.wm.addListener(wmListener);
			await new Promise((resolve) => {
				win = Trellis.openInViewer(url, {
					userContextId: options.userContextId,
					customUserAgent: options.customUserAgent,
				});
				win.addEventListener('load', resolve);
			});
			browser = win.document.querySelector('browser');
			Trellis.Utilities.Internal.activate(win);

			// Poll for the captcha element disappearing, then require the page
			// to stay stable for onLoadTimeout before we consider it cleared
			let lastLocation = browser.currentURI.spec;
			let stableSince = null;
			let pollInterval = 500;
			// Don't allow clearance until we've positively observed the challenge
			// at least once; otherwise a transient empty/about:blank document
			// during the challenge page's own loading would declare success
			// before the user sees anything.
			let sawChallenge = false;
			await Promise.race([
				clearedDeferred.promise,
				Trellis.Promise.delay(timeout).then(() => {
					if (!cleared) {
						cancelled = true;
						throw new Error(`BrowserRequest: Viewer challenge clearance timed out after ${timeout}ms`);
					}
				}),
				(async () => {
					// Set above:
					// eslint-disable-next-line no-unmodified-loop-condition
					while (!cleared && !cancelled) {
						await Trellis.Promise.delay(pollInterval);
						let currentLocation = browser.currentURI.spec;
						if (currentLocation !== lastLocation) {
							lastLocation = currentLocation;
							stableSince = null;
							continue;
						}
						let stillChallenged = await this._browserMatchesSelector(browser, options.captchaLocator);
						if (stillChallenged) {
							sawChallenge = true;
							stableSince = null;
							continue;
						}
						if (!sawChallenge) {
							// Challenge page hasn't rendered yet, or we can't read
							// the DOM. Keep waiting without advancing the timer.
							stableSince = null;
							continue;
						}
						if (stableSince === null) {
							stableSince = Date.now();
						}
						else if (Date.now() - stableSince >= onLoadTimeout) {
							cleared = true;
							clearedDeferred.resolve();
						}
					}
				})()
			]);
		}
		finally {
			Services.wm.removeListener(wmListener);
			if (win) {
				win.close();
			}
		}
	},

	/**
	 * Ask the browser's current document whether it has a match for a CSS selector.
	 * False if the document can't be queried or nothing matches.
	 */
	async _browserMatchesSelector(browser, selector) {
		try {
			let actor = browser.browsingContext?.currentWindowGlobal?.getActor('PageData');
			if (!actor) return false;
			return await actor.sendQuery('querySelectorMatches', { selector });
		}
		catch (e) {
			Trellis.logError(e);
			return false;
		}
	},

	/**
	 * Load the URL in the given HiddenBrowser and wait for the page to settle.
	 * Each location change restarts a `browserRequest.onLoadTimeout` window;
	 * if the location stays stable for that window, we consider the page
	 * settled. Throws if `browserRequest.timeout` elapses first.
	 *
	 * If `onPDF` is provided, also sets up a PDF MIME type handler on the
	 * browser and resolves early once a PDF is captured; the callback receives
	 * the blob.
	 *
	 * If `successCookie` is provided, polls the cookie jar and resolves as
	 * soon as a cookie with that name exists on the given host.
	 *
	 * @param {HiddenBrowser} hiddenBrowser
	 * @param {string} url
	 * @param {object} [opts]
	 * @param {(blob: Blob) => void} [opts.onPDF]
	 * @param {{ host: string, name: string }} [opts.successCookie]
	 * @param {number} [opts.userContextId]
	 * @returns {Promise<void>}
	 */
	async _loadAndSettle(hiddenBrowser, url, opts = {}) {
		const onLoadTimeout = Trellis.Prefs.get('browserRequest.onLoadTimeout');
		const timeout = Trellis.Prefs.get('browserRequest.timeout');

		let settled = false;
		let settleDeferred = Trellis.Promise.defer();
		let pdfDeferred = Trellis.Promise.defer();
		let cookieDeferred = Trellis.Promise.defer();
		let pdfFound = false;
		let pdfHandler;

		if (opts.onPDF) {
			pdfHandler = this._makePDFMIMETypeHandler(hiddenBrowser._browser, (blob) => {
				pdfFound = true;
				opts.onPDF(blob);
				pdfDeferred.resolve();
			});
			Trellis.MIMETypeHandler.addHandlers('application/pdf', pdfHandler, true);
		}

		try {
			let currentUrl = '';
			hiddenBrowser.webProgress.addProgressListener({
				QueryInterface: ChromeUtils.generateQI([Ci.nsIWebProgressListener, Ci.nsISupportsWeakReference]),
				async onLocationChange() {
					let loc = hiddenBrowser.currentURI.spec;
					if (currentUrl) {
						Trellis.debug(`BrowserRequest: A JS redirect occurred to ${loc}`);
					}
					currentUrl = loc;
					Trellis.debug(`BrowserRequest: Page loaded at ${loc}; waiting ${onLoadTimeout}ms for further JS activity`);
					await Trellis.Promise.delay(onLoadTimeout);
					if (currentUrl === loc && !settled && !pdfFound) {
						settled = true;
						settleDeferred.resolve();
					}
				}
			}, Ci.nsIWebProgress.NOTIFY_LOCATION);

			hiddenBrowser.load(url);

			let cookiePollInterval;
			if (opts.successCookie) {
				cookiePollInterval = this._pollForCookie({
					successCookie: opts.successCookie,
					userContextId: opts.userContextId,
					onFound: () => {
						Trellis.debug(`BrowserRequest: successCookie ${opts.successCookie.name} appeared`);
						cookieDeferred.resolve();
					}
				});
			}

			let races = [
				settleDeferred.promise,
				Trellis.Promise.delay(timeout).then(() => {
					if (!settled && !pdfFound) {
						throw new Error(`BrowserRequest: Browser request timed out after ${timeout}ms`);
					}
				})
			];
			if (opts.onPDF) {
				races.push(pdfDeferred.promise);
			}
			if (opts.successCookie) {
				races.push(cookieDeferred.promise);
			}
			try {
				await Promise.race(races);
			}
			finally {
				if (cookiePollInterval) clearInterval(cookiePollInterval);
			}
		}
		finally {
			if (pdfHandler) {
				Trellis.MIMETypeHandler.removeHandlers('application/pdf', pdfHandler);
			}
		}
	},

	_makePDFMIMETypeHandler(browser, onPDFFound = () => 0) {
		let isOurPDF, channelBrowser;
		let trackedBrowser = browser;
		return {
			onStartRequest: function (name, _, channel) {
				Trellis.debug(`BrowserRequest: Sniffing a PDF loaded at ${name}`);
				try {
					channelBrowser = channel.notificationCallbacks.getInterface(Ci.nsILoadContext).topFrameElement;
				}
				catch {}
				if (channelBrowser) {
					isOurPDF = trackedBrowser === channelBrowser;
				}
				else {
					try {
						channelBrowser = channel.loadGroup.notificationCallbacks.getInterface(Ci.nsILoadContext)
							.topFrameElement;
					}
					catch {}
					if (channelBrowser) {
						isOurPDF = trackedBrowser === channelBrowser;
					}
				}
			},
			onContent: async (blob, name) => {
				if (isOurPDF) {
					Trellis.debug(`BrowserRequest: Found our PDF at ${name}`);
					onPDFFound(blob);
					return true;
				}
				Trellis.debug(`BrowserRequest: Not our PDF at ${name}`);
				return false;
			}
		};
	},

	/**
	 * @param {String} url
	 * @param {String} path
	 * @param {Object} [options]
	 * @param {Boolean} [options.shouldDisplayCaptcha=false]
	 */
	async downloadPDF(url, path, options = {}) {
		Trellis.debug(`BrowserRequest: Downloading PDF via hidden browser from ${url}`);

		let hiddenBrowser;
		let blob;
		try {
			hiddenBrowser = new HiddenBrowser();
			await hiddenBrowser._createdPromise;
			await this._loadAndSettle(hiddenBrowser, url, {
				onPDF: (foundBlob) => {
					blob = foundBlob;
				}
			});
			if (!blob) {
				throw new Error('BrowserRequest: Settled without receiving a PDF');
			}
			await Trellis.File.putContentsAsync(path, blob);
		}
		catch (e) {
			try {
				await OS.File.remove(path, { ignoreAbsent: true });
			}
			catch (err) {
				Trellis.logError(err);
			}
			if (options?.shouldDisplayCaptcha) {
				Trellis.debug(`BrowserRequest: Hidden browser PDF download failed: ${e.message}`);
				const entry = this.getEntryForURL(url);
				if (entry?.captchaLocator && hiddenBrowser) {
					let doc;
					try {
						doc = await hiddenBrowser.getDocument();
					}
					catch {}
					if (doc && doc.querySelector(entry.captchaLocator)) {
						return this.downloadPDFViaViewer(url, path, options);
					}
				}
			}
			throw e;
		}
		finally {
			if (hiddenBrowser) {
				hiddenBrowser.destroy();
			}
		}
		return undefined;
	},

	async downloadPDFViaViewer(url, path, _options) {
		Trellis.debug(`BrowserRequest: Downloading PDF via viewer for captcha clearing from ${url}`);

		let win, browser, wmListener;
		let pdfMIMETypeHandler;
		let pdfFound;
		let pdfFoundDeferred = Trellis.Promise.defer();
		const timeout = Trellis.Prefs.get('browserRequest.timeout');

		// As above: Cloudflare Turnstile rejects the "Trellis/[version]" suffix, so strip
		let customUserAgent = Trellis.VersionHeader.getPlainFirefoxUA();

		try {
			wmListener = this._makeViewerCloseListener(() => {
				if (!pdfFound) pdfFoundDeferred.reject(new Error('BrowserRequest: User closed the viewer'));
			});
			Services.wm.addListener(wmListener);
			await new Promise((resolve) => {
				win = Trellis.openInViewer(url, { customUserAgent });
				win.addEventListener('load', resolve);
			});
			browser = win.document.querySelector('browser');
			Trellis.Utilities.Internal.activate(win);

			pdfMIMETypeHandler = this._makePDFMIMETypeHandler(browser, pdfFoundDeferred.resolve);
			Trellis.MIMETypeHandler.addHandlers('application/pdf', pdfMIMETypeHandler, true);

			Trellis.debug(`BrowserRequest: Awaiting user captcha clearance or timeout after ${timeout}ms`);
			let pdfBlob = await Promise.race([
				Trellis.Promise.delay(timeout).then(() => {
					if (!pdfFound) {
						throw new Error(`BrowserRequest: Viewer PDF download timed out after ${timeout}ms`);
					}
				}),
				pdfFoundDeferred.promise
			]);
			pdfFound = true;
			await Trellis.File.putContentsAsync(path, pdfBlob);
		}
		catch (e) {
			try {
				await OS.File.remove(path, { ignoreAbsent: true });
			}
			catch (err) {
				Trellis.logError(err);
			}
			throw e;
		}
		finally {
			Trellis.MIMETypeHandler.removeHandlers('application/pdf', pdfMIMETypeHandler);
			Services.wm.removeListener(wmListener);
			if (win) {
				win.close();
			}
		}
	},
};

// Register hosts that we intercept Cloudflare Turnstile challenges on,
// so they receive a plain UA everywhere. See comment on
// Trellis.VersionHeader.registerPlainUAHost().
for (let host of Trellis.BrowserRequest.PLAIN_UA_HOSTS) {
	Trellis.VersionHeader.registerPlainUAHost(host);
}
