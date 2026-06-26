// These are DEFAULT prefs for the install.
//
// Add new user-adjustable hidden preferences to
// http://www.trellis.org/documentation/hidden_prefs

pref("extensions.trellis.firstRun2", true);
pref("extensions.trellis.undoHistory.steps", 100);

pref("extensions.trellis.saveRelativeAttachmentPath", false);
pref("extensions.trellis.baseAttachmentPath", "");
pref("extensions.trellis.useDataDir", false);
pref("extensions.trellis.dataDir", "");
pref("extensions.trellis.warnOnUnsafeDataDir", true);
pref("extensions.trellis.debug.log",false);
pref("extensions.trellis.debug.log.slowTime", 250);
pref("extensions.trellis.debug.stackTrace", false);
pref("extensions.trellis.debug.store",false);
pref("extensions.trellis.debug.store.limit",500000);
pref("extensions.trellis.debug.store.submitSize",10000000);
pref("extensions.trellis.debug.store.submitLineLength",10000);
pref("extensions.trellis.debug.level",5);
pref("extensions.trellis.automaticScraperUpdates",true);
pref("extensions.trellis.triggerProxyAuthentication", true);
// Proxy auth URLs should respond successfully to HEAD requests over HTTP and HTTPS (in case of forced HTTPS requests)
pref("extensions.trellis.proxyAuthenticationURLs", "https://www.acm.org,https://www.ebscohost.com,https://www.sciencedirect.com,https://ieeexplore.ieee.org,https://www.jstor.org,http://www.ovid.com,https://link.springer.com,https://www.tandfonline.com");
pref("extensions.trellis.openURL.resolver","");
pref("extensions.trellis.automaticSnapshots",true);
pref("extensions.trellis.downloadAssociatedFiles",true);
pref("extensions.trellis.findPDFs.resolvers", '[]');
pref("extensions.trellis.reportTranslationFailure",true);
pref("extensions.trellis.automaticTags",true);
pref("extensions.trellis.hideContextAnnotationRows", true);
pref("extensions.trellis.fontSize", "1.00");
pref("extensions.trellis.layout", "standard");
pref("extensions.trellis.recursiveCollections", false);
pref("extensions.trellis.autoRecognizeFiles", true);
pref("extensions.trellis.autoRenameFiles", true);
pref("extensions.trellis.autoRenameFiles.linked", false);
pref("extensions.trellis.autoRenameFiles.fileTypes", "application/pdf,application/epub+zip");
pref("extensions.trellis.autoRenameFiles.onMetadataChange", true);
pref("extensions.trellis.autoRenameFiles.done", true);
pref("extensions.trellis.autoRenameFiles.bannerShown", true);
pref("extensions.trellis.showAttachmentFilenames", false);
pref("extensions.trellis.capitalizeTitles", false);
pref("extensions.trellis.launchNonNativeFiles", false);
pref("extensions.trellis.naturalSorting", true);
pref("extensions.trellis.sortNotesChronologically", false);
pref("extensions.trellis.sortNotesChronologically.reader", true);
pref("extensions.trellis.sortAttachmentsChronologically", false);
pref("extensions.trellis.showTrashWhenEmpty", true);
pref("extensions.trellis.trashAutoEmptyDays", 30);
pref("extensions.trellis.viewOnDoubleClick", true);
pref("extensions.trellis.firstRunGuidance", true);
pref("extensions.trellis.firstRunGuidanceShown.readAloud", true);
pref("extensions.trellis.showPostUpgradeBanner", true);
pref("extensions.trellis.showConnectorVersionWarning", true);

pref("extensions.trellis.groups.copyChildLinks", true);
pref("extensions.trellis.groups.copyChildFileAttachments", true);
pref("extensions.trellis.groups.copyAnnotations", true);
pref("extensions.trellis.groups.copyChildNotes", true);
pref("extensions.trellis.groups.copyTags", true);

pref("extensions.trellis.feeds.sortAscending", false);
pref("extensions.trellis.feeds.defaultTTL", 1);
pref("extensions.trellis.feeds.defaultCleanupReadAfter", 3);
pref("extensions.trellis.feeds.defaultCleanupUnreadAfter", 30);

pref("extensions.trellis.backup.numBackups", 2);
pref("extensions.trellis.backup.interval", 1440);

pref("extensions.trellis.vacuum.interval", 14);  // days
pref("extensions.trellis.vacuum.freelistThreshold", 10);  // percentage of free pages to trigger

pref("extensions.trellis.lastCreatorFieldMode",0);
pref("extensions.trellis.lastAbstractExpand", true);
pref("extensions.trellis.lastRenameAssociatedFile", false);
pref("extensions.trellis.lastLongTagMode", 0);
pref("extensions.trellis.lastLongTagDelimiter", ";");

pref("extensions.trellis.fallbackSort", "firstCreator,date,title,dateAdded");
pref("extensions.trellis.sortCreatorAsString", false);

pref("extensions.trellis.uiDensity", "comfortable");

pref("extensions.trellis.itemPaneHeader", "title");
pref("extensions.trellis.itemPaneHeader.bibEntry.style", "http://www.trellis.org/styles/apa");
pref("extensions.trellis.itemPaneHeader.bibEntry.locale", "");

//Tag Selector
pref("extensions.trellis.tagSelector.showAutomatic", true);
pref("extensions.trellis.tagSelector.displayAllTags", false);

pref("extensions.trellis.browserRequest.onLoadTimeout", 3000);
pref("extensions.trellis.browserRequest.timeout", 60000);

// Keyboard shortcuts
pref("extensions.trellis.keys.saveToTrellis", "S");
pref("extensions.trellis.keys.newItem", "N");
pref("extensions.trellis.keys.newNote", "O");
pref("extensions.trellis.keys.library", "L");
pref("extensions.trellis.keys.quicksearch", "K");
pref("extensions.trellis.keys.copySelectedItemCitationsToClipboard", "A");
pref("extensions.trellis.keys.copySelectedItemsToClipboard", "C");
pref("extensions.trellis.keys.sync", "Y");
pref("extensions.trellis.keys.toggleAllRead", "R");
pref("extensions.trellis.keys.toggleRead", "`");
pref("extensions.trellis.keys.showTabsMenu", ";");

pref("extensions.trellis.search.quicksearch-mode", "fields");

// Fulltext indexing
pref("extensions.trellis.fulltext.textMaxLength", 500000);
pref("extensions.trellis.fulltext.pdfMaxPages", 100);
pref("extensions.trellis.search.useLeftBound", true);

// Notes
pref("extensions.trellis.note.fontFamily", "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Helvetica Neue\", Helvetica, Arial, sans-serif");
pref("extensions.trellis.note.fontSize", "14");
pref("extensions.trellis.note.tabFontSize", "16");
pref("extensions.trellis.note.css", "");
pref("extensions.trellis.note.smartQuotes", true);

// Reports
pref("extensions.trellis.report.includeAllChildItems", true);
pref("extensions.trellis.report.combineChildItems", true);

// Export and citation settings
pref("extensions.trellis.export.lastTranslator", "14763d24-8ba0-45df-8f52-b8d1108e7ac9");
pref("extensions.trellis.export.translatorSettings", "true,false");
pref("extensions.trellis.export.lastNoteTranslator", "1412e9e2-51e1-42ec-aa35-e036a895534b");
pref("extensions.trellis.export.noteTranslatorSettings", "");
pref("extensions.trellis.export.lastStyle", "http://www.trellis.org/styles/chicago-shortened-notes-bibliography");
pref("extensions.trellis.export.bibliographySettings", "save-as-rtf");
pref("extensions.trellis.export.displayCharsetOption", true);
pref("extensions.trellis.export.citePaperJournalArticleURL", false);
pref("extensions.trellis.cite.automaticJournalAbbreviations", true);
pref("extensions.trellis.cite.useCiteprocRs", false);
pref("extensions.trellis.import.createNewCollection.fromFileOpenHandler", true);
pref("extensions.trellis.rtfScan.lastInputFile", "");
pref("extensions.trellis.rtfScan.lastOutputFile", "");

pref("extensions.trellis.export.quickCopy.setting", "bibliography=http://www.trellis.org/styles/chicago-shortened-notes-bibliography");
pref("extensions.trellis.export.quickCopy.dragLimit", 50);

pref("extensions.trellis.export.noteQuickCopy.setting", '{"mode":"export","id":"a45eca67-1ee8-45e5-b4c6-23fb8a852873","markdownOptions":{"includeAppLinks":true},"htmlOptions":{"includeAppLinks":false}}');

// Integration settings
pref("extensions.trellis.integration.port", 50001);
pref("extensions.trellis.integration.autoRegenerate", -1);	// -1 = ask; 0 = no; 1 = yes
pref("extensions.trellis.integration.useClassicAddCitationDialog", false);
pref("extensions.trellis.integration.keepAddCitationDialogRaised", false);
pref("extensions.trellis.integration.upgradeTemplateDelayedOn", 0);
pref("extensions.trellis.integration.dontPromptMendeleyImport", false);
pref("extensions.trellis.integration.citationDialogMode", "last-used");
pref("extensions.trellis.integration.citationDialogShowLocatorTip", true);
pref("extensions.trellis.integration.annotationDialogIncludeComments", true);
pref("extensions.trellis.integration.citationPreviewShown", true);

// Connector settings
pref("extensions.trellis.httpServer.enabled", true);
pref("extensions.trellis.httpServer.port", 23119);	// ascii "ZO"
pref("extensions.trellis.httpServer.localAPI.enabled", false);

// Zeroconf
pref("extensions.trellis.zeroconf.server.enabled", false);

// Streaming server
pref("extensions.trellis.streaming.enabled", true);

// Sync
pref("extensions.trellis.sync.autoSync", true);
pref("extensions.trellis.sync.server.username", "");
pref("extensions.trellis.sync.server.compressData", true);
pref("extensions.trellis.sync.storage.enabled", true);
pref("extensions.trellis.sync.storage.protocol", "trellis");
pref("extensions.trellis.sync.storage.verified", false);
pref("extensions.trellis.sync.storage.scheme", "https");
pref("extensions.trellis.sync.storage.url", "");
pref("extensions.trellis.sync.storage.username", "");
pref("extensions.trellis.sync.storage.maxDownloads", 4);
pref("extensions.trellis.sync.storage.maxUploads", 2);
pref("extensions.trellis.sync.storage.deleteDelayDays", 30);
pref("extensions.trellis.sync.storage.groups.enabled", true);
pref("extensions.trellis.sync.storage.downloadMode.personal", "on-sync");
pref("extensions.trellis.sync.storage.downloadMode.groups", "on-sync");
pref("extensions.trellis.sync.fulltext.enabled", true);
pref("extensions.trellis.sync.reminder.setUp.enabled", true);
pref("extensions.trellis.sync.reminder.setUp.lastDisplayed", 0);
pref("extensions.trellis.sync.reminder.autoSync.enabled", true);
pref("extensions.trellis.sync.reminder.autoSync.lastDisplayed", 0);

// Proxy
pref("extensions.trellis.proxies.autoRecognize", true);
pref("extensions.trellis.proxies.transparent", true);
pref("extensions.trellis.proxies.disableByDomain", false);
pref("extensions.trellis.proxies.disableByDomainString", ".edu");
pref("extensions.trellis.proxies.showRedirectNotification", true);

// Data layer purging
pref("extensions.trellis.purge.creators", false);
pref("extensions.trellis.purge.fulltext", false);
pref("extensions.trellis.purge.items", false);
pref("extensions.trellis.purge.tags", false);

// Trellis pane persistent data
pref("extensions.trellis.pane.persist", "");
pref("extensions.trellis.showAttachmentPreview", true);

pref("extensions.trellis.fileHandler.pdf", "");
pref("extensions.trellis.fileHandler.epub", "");
pref("extensions.trellis.fileHandler.snapshot", "");
pref("extensions.trellis.openReaderInNewWindow", false);

pref("extensions.trellis.openNoteInNewWindow", false);

// File/URL opening executable if launch() fails
pref("extensions.trellis.fallbackLauncher.unix", "/usr/bin/xdg-open");
pref("extensions.trellis.fallbackLauncher.windows", "");

//Translators
pref("extensions.trellis.translators.attachSupplementary", false);
pref("extensions.trellis.translators.supplementaryAsLink", false);
pref("extensions.trellis.translators.RIS.import.ignoreUnknown", true);
pref("extensions.trellis.translators.RIS.import.keepID", false);

// Retracted Items
pref("extensions.trellis.retractions.enabled", true);
pref("extensions.trellis.retractions.recentItems", "[]");

// Annotations
pref("extensions.trellis.annotations.noteTemplates.title", "<h1>{{title}}<br/>({{date}})</h1>");
pref("extensions.trellis.annotations.noteTemplates.highlight", "<p>{{highlight}} {{citation}} {{comment}}</p>");
pref("extensions.trellis.annotations.noteTemplates.note", "<p>{{citation}} {{comment}}</p>");

// Scaffold
pref("extensions.trellis.scaffold.eslint.enabled", true);

// Tabs
pref("extensions.trellis.tabs.title.reader", "titleCreatorYear");

// Reader
pref("extensions.trellis.reader.textSelectionAnnotationMode", "highlight");
pref("extensions.trellis.reader.lightTheme", "");
pref("extensions.trellis.reader.darkTheme", "dark");
pref("extensions.trellis.reader.ebookFontFamily", "Georgia, serif");
pref("extensions.trellis.reader.ebookHyphenate", true);
pref("extensions.trellis.reader.autoDisableTool.note", true);
pref("extensions.trellis.reader.autoDisableTool.text", true);
pref("extensions.trellis.reader.autoDisableTool.image", true);
pref("extensions.trellis.reader.lastSidebarTab", "annotations");

// Set color scheme to auto by default
pref("browser.theme.toolbar-theme", 2);

// Need to enable -moz-context-properties for SVG context properties to work
pref("svg.context-properties.content.enabled", true);
