import { documentIsReady } from "chrome://trellis/content/actors/actorUtils.mjs";

const TRANSLATE_SCRIPT_PATHS = [
	'src/trellis.js',
	'src/promise.js',
	'modules/utilities/openurl.js',
	'modules/utilities/date.js',
	'modules/utilities/xregexp-all.js',
	'modules/utilities/xregexp-unicode-trellis.js',
	'modules/utilities/utilities.js',
	'modules/utilities/utilities_item.js',
	'modules/utilities/schema.js',
	'modules/utilities/resource/trellisTypeSchemaData.js',
	'modules/utilities/cachedTypes.js',
	'src/utilities_translate.js',
	'src/debug.js',
	'src/http.js',
	'src/translator.js',
	'src/translators.js',
	'src/repo.js',
	'src/translation/translate.js',
	'src/translation/sandboxManager.js',
	'src/translation/translate_item.js',
	'src/tlds.js',
	'src/proxy.js',
	'src/rdf/init.js',
	'src/rdf/uri.js',
	'src/rdf/term.js',
	'src/rdf/identity.js',
	'src/rdf/n3parser.js',
	'src/rdf/rdfparser.js',
	'src/rdf/serialize.js',
];

const OTHER_SCRIPT_URIS = [
	'chrome://trellis/content/actors/translation/http.js',
	'chrome://trellis/content/actors/translation/translate_item.js',
];

export class TranslationChild extends JSWindowActorChild {
	_sandbox = null;
	
	async receiveMessage(message) {
		// Wait for 'complete', or 'interactive' after a 100ms delay
		await documentIsReady(this.document, { allowInteractiveAfter: 100 });
		
		let { name, data } = message;
		switch (name) {
			case 'initTranslation': {
				let { schemaJSON, dateFormatsJSON, prefs } = data;
				this._sandbox = this._loadTranslationFramework(schemaJSON, dateFormatsJSON, prefs);
				break;
			}
			case 'detect': {
				let { translator, id } = data;
				let { Trellis } = this._sandbox;
				try {
					let translate = new Trellis.Translate.Web();
					translate.setTranslatorProvider(this._makeTranslatorProvider(id));
					translate.setDocument(this.document);
					this._initHandlers(id, translate);
					if (translator) {
						translate.setTranslator(Cu.cloneInto(translator, this._sandbox));
					}
					return await translate.getTranslators(false, !!translator);
				}
				catch (e) {
					this._error(id, e);
					return null;
				}
			}
			case 'translate': {
				let { translator, id } = data;
				let { Trellis } = this._sandbox;
				try {
					let translate = new Trellis.Translate.Web();
					translate.setTranslatorProvider(this._makeTranslatorProvider(id));
					translate.setDocument(this.document);
					this._initHandlers(id, translate);
					if (translator) {
						translate.setTranslator(Cu.cloneInto(translator, this._sandbox));
					}
					return await translate.translate();
				}
				catch (e) {
					this._error(id, e);
					return null;
				}
			}
		}
	}
	
	_makeTranslatorProvider(id) {
		let { Trellis } = this._sandbox;
		let makeProxy = method => 
			(...args) => this._sandbox.Promise.resolve(
				this.sendQuery('Translators:call', { id, method, args })
			).then(result => Cu.cloneInto(result, this._sandbox))
		;
		return Cu.cloneInto({
			...Trellis.Translators,
			get: makeProxy('get'),
			getCodeForTranslator: makeProxy('getCodeForTranslator'),
			getAllForType: makeProxy('getAllForType'),
			getWebTranslatorsForLocation: makeProxy('getWebTranslatorsForLocation'),
		}, this._sandbox, { cloneFunctions: true });
	}

	/**
	 * Wraps a call to sendQuery() so that any returned value or error is safe to access from the content window,
	 * and the returned promise can be `then`ed from the content window.
	 *
	 * @param {String} message
	 * @param {Object} value
	 * @return {Promise<Object>}
	 */
	_sendQuerySafe(message, value) {
		return new this._sandbox.Promise((resolve, reject) => {
			this.sendQuery(message, value)
				.then(rv => Cu.cloneInto(rv, this._sandbox))
				.catch(e => this._sandbox.Promise.reject(new this._sandbox.Error(e.message)))
				.then(resolve, reject);
		});
	}

	/**
	 * Run the debug handler on the Trellis.Translate instance with the given ID
	 * @return {Promise<void>}
	 */
	_debug(id, arg) {
		let { Trellis } = this._sandbox;
		if (typeof arg !== 'string') {
			arg = Trellis.Utilities.varDump(arg);
		}
		// 8096K ought to be enough for anybody
		// (And Firefox will throw an error when serializing very large values in fx102.
		// Limit seems to have been removed in later versions.)
		if (arg.length > 1024 * 8096) {
			arg = arg.substring(0, 1024 * 1024);
		}
		return this._sendQuerySafe('Translate:runHandler', {
			id,
			name: 'debug',
			arg
		});
	}

	/**
	 * Run the error handler on the Trellis.Translate instance with the given ID
	 * @return {Promise<void>}
	 */
	_error(id, arg) {
		return this._sendQuerySafe('Translate:runHandler', {
			id,
			name: 'error',
			arg: String(arg)
		});
	}

	/**
	 * Initialize proxied handlers on the provided Trellis.Translate instance.
	 */
	_initHandlers(id, translate) {
		let names = [
			"select",
			"itemDone",
			"collectionDone",
			"done",
			"debug",
			"error",
			"translators",
			"pageModified",
		];
		for (let name of names) {
			let handler;
			if (name == 'debug') {
				handler = (_, arg) => this._debug(id, arg);
			}
			else if (name == 'error') {
				handler = (_, arg) => this._error(id, arg);
			}
			else if (name == 'select') {
				handler = (_, items, callback) => {
					this.sendQuery('Translate:runHandler', { id, name, arg: items }).then((items) => {
						callback(Cu.cloneInto(items, this._sandbox));
					});
				};
			}
			else {
				handler = (_, arg) => this._sendQuerySafe('Translate:runHandler', { id, name, arg });
			}
			translate.setHandler(name, Cu.exportFunction(handler, this._sandbox));
		}
	}

	/**
	 * Load the translation framework into the current page.
	 * @param {Object | String} schemaJSON
	 * @param {Object | String} dateFormatsJSON
	 * @param {Object} prefs
	 * @return {Sandbox}
	 */
	_loadTranslationFramework(schemaJSON, dateFormatsJSON, prefs) {
		// Modeled after:
		// https://searchfox.org/mozilla-esr102/source/toolkit/components/extensions/ExtensionContent.jsm#809-845
		let systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
		let sandbox = new Cu.Sandbox(systemPrincipal, {
			sandboxPrototype: this.contentWindow,
			sameZoneAs: this.contentWindow,
			wantXrays: true,
			wantGlobalProperties: ["XMLHttpRequest", "fetch", "WebSocket"],
		});
		
		let scriptURIs = [
			...TRANSLATE_SCRIPT_PATHS.map(path => 'chrome://trellis/content/xpcom/translate/' + path),
			...OTHER_SCRIPT_URIS,
		];
		for (let scriptURI of scriptURIs) {
			Services.scriptloader.loadSubScript(scriptURI, sandbox);
		}

		let { Trellis } = sandbox;

		Trellis.Debug.init(1);
		Trellis.Debug.setStore(true);
		
		Trellis.Translators._initialized = true;
		Trellis.Schema.init(schemaJSON);
		Trellis.Date.init(dateFormatsJSON);
		
		for (let [key, value] of Object.entries(prefs)) {
			Trellis.Prefs.set(key, value);
		}

		return sandbox;
	}

	didDestroy() {
		if (this._sandbox) {
			Cu.nukeSandbox(this._sandbox);
		}
	}
}
