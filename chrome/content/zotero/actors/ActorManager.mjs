// Register Mozilla actors
import "resource://gre/modules/ActorManagerParent.sys.mjs";

ChromeUtils.registerWindowActor("PageData", {
	child: {
		esModuleURI: "chrome://trellis/content/actors/PageDataChild.mjs"
	}
});

ChromeUtils.registerWindowActor("SingleFile", {
	child: {
		esModuleURI: "chrome://trellis/content/actors/SingleFileChild.mjs"
	}
});

ChromeUtils.registerWindowActor("Translation", {
	parent: {
		esModuleURI: "chrome://trellis/content/actors/TranslationParent.mjs"
	},
	child: {
		esModuleURI: "chrome://trellis/content/actors/TranslationChild.mjs"
	}
});

ChromeUtils.registerWindowActor("FeedAbstract", {
	parent: {
		esModuleURI: "chrome://trellis/content/actors/FeedAbstractParent.mjs",
	},
	child: {
		esModuleURI: "chrome://trellis/content/actors/FeedAbstractChild.mjs",
		events: {
			DOMDocElementInserted: {},
		}
	},
	messageManagerGroups: ["feedAbstract"]
});

ChromeUtils.registerWindowActor("TrellisPrint", {
	parent: {
		esModuleURI: "chrome://trellis/content/actors/TrellisPrintParent.mjs"
	},
	child: {
		esModuleURI: "chrome://trellis/content/actors/TrellisPrintChild.mjs",
		events: {
			pageshow: {}
		}
	},
	allFrames: true
});

ChromeUtils.registerWindowActor("ExternalLinkHandler", {
	parent: {
		esModuleURI: "chrome://trellis/content/actors/ExternalLinkHandlerParent.mjs",
	},
	child: {
		esModuleURI: "chrome://trellis/content/actors/ExternalLinkHandlerChild.mjs",
		events: {
			click: {},
		}
	},
	messageManagerGroups: ["feedAbstract", "basicViewer"]
});

// On macOS only, register the Ctrl-Enter handler actor
// (No access to Trellis object here)
if (AppConstants.platform === "macosx") {
	ChromeUtils.registerWindowActor("SequoiaContextMenu", {
		parent: {
			esModuleURI: "chrome://trellis/content/actors/SequoiaContextMenuParent.mjs",
		},
		child: {
			esModuleURI: "chrome://trellis/content/actors/SequoiaContextMenuChild.mjs",
		},
		allFrames: true,
		includeChrome: true
	});
}

ChromeUtils.registerWindowActor("MendeleyAuth", {
	parent: {
		esModuleURI: "chrome://trellis/content/actors/MendeleyAuthParent.mjs"
	},
	child: {
		esModuleURI: "chrome://trellis/content/actors/MendeleyAuthChild.mjs"
	}
});

ChromeUtils.registerWindowActor("DocumentIsReady", {
	child: {
		esModuleURI: "chrome://trellis/content/actors/DocumentIsReadyChild.mjs"
	}
});
