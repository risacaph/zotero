const { PathParser } = ChromeUtils.importESModule("resource://trellis/pathparser.mjs");
Trellis.Router = PathParser;

Trellis.Router.Utilities = {
	convertControllerToObjectType: function (params) {
		if (params.controller !== undefined) {
			params.objectType = Trellis.DataObjectUtilities.getObjectTypeSingular(params.controller);
			delete params.controller;
		}
	}
};


Trellis.Router.InvalidPathException = function (path) {
	this.path = path;
}


Trellis.Router.InvalidPathException.prototype = {
	name: "InvalidPathException",
	toString: function () {
		return "Path '" + this.path + "' could not be parsed";
	}
};
