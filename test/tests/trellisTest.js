"use strict";

describe("Trellis", function() {
	describe("VersionHeader", function () {
		describe("#update()", function () {
			var majorMinorVersion;
			
			before(function () {
				majorMinorVersion = Trellis.version.replace(/(\d+\.\d+).*/, '$1');
			});
			
			it("should replace app name with Firefox", function () {
				var platformVersion = Services.appinfo.platformVersion.match(/^\d+/)[0] + '.0';
				var ua1 = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:60.0) Gecko/20100101 ${Trellis.clientName}/${Trellis.version}`;
				var ua2 = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:60.0) Gecko/20100101 Firefox/${platformVersion} ${Trellis.clientName}/${Trellis.version}`;
				assert.equal(Trellis.VersionHeader.update(ua1), ua2);
			});
			
			it("should show Chrome user agent unchanged", function () {
				var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0.3359.139 Safari/537.36';
				assert.equal(Trellis.VersionHeader.update(ua), ua);
			});
				
			it("should show Firefox user agent unchanged", function () {
				var ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:60.0) Gecko/20100101 Firefox/60.0';
				assert.equal(Trellis.VersionHeader.update(ua), ua);
			});
		});
	});
});
