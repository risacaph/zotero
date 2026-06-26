"use strict";

describe("Connector HTTP Integration Server", function () {
	var serverURL;
	
	before(function* () {
		this.timeout(20000);
		yield resetDB({
			thisArg: this,
			skipBundledFiles: true
		});
		
		serverURL = `http://127.0.0.1:${Trellis.Server.port}/connector/document`;
	});
	
	describe('/connector/document/execCommand', function () {
		it('should set HTTPIntegrationClient.inProgress=true and respond with a plugin command', async function () {
			let stub = sinon.stub(Trellis.Integration, 'execCommand');
			try {
				stub.callsFake(() => {
					let app = new Trellis.HTTPIntegrationClient.Application();
					app.getActiveDocument();
				});
				assert.isNotTrue(Trellis.HTTPIntegrationClient.inProgress);
				
				let response = await Trellis.HTTP.request(
					'POST',
					`${serverURL}/execCommand`,
					{
						headers: {
							"Content-Type": "application/json",
							"X-Trellis-Connector-API-Version": "2"
						},
						body: JSON.stringify({
							command: "addEditCitation",
							docId: "trellisTestDoc",
						}),
					},
				);
				
				assert.isTrue(Trellis.HTTPIntegrationClient.inProgress);
				assert.equal(response.status, 200);
				assert.equal(JSON.parse(response.response).command, 'Application.getActiveDocument');
			}
			finally {
				stub.restore();
				Trellis.HTTPIntegrationClient.inProgress = false;
				Trellis.Integration.currentDoc = Trellis.Integration.currentSession = null;
			}
		});
	});
	
	describe('/connector/document/respond', function () {
		it('should pass along the request body via HTTPIntegrationClient', async function () {
			try {
				Trellis.HTTPIntegrationClient.deferredResponse = Trellis.Promise.defer();

				let postBody = { outputFormat: 'html' };
				Trellis.HTTP.request(
					'POST',
					`${serverURL}/respond`,
					{
						headers: {
							"Content-Type": "application/json",
							"X-Trellis-Connector-API-Version": "2"
						},
						body: JSON.stringify(postBody),
					},
				);
				
				let receivedBody = await Trellis.HTTPIntegrationClient.deferredResponse.promise;
				
				assert.deepEqual(postBody, receivedBody);
			}
			finally {
				Trellis.HTTPIntegrationClient.inProgress = false;
				Trellis.Integration.currentDoc = Trellis.Integration.currentSession = null;
			}
		});
	});
});
