export class TrellisPrintChild extends JSWindowActorChild {
	actorCreated() {
		Cu.exportFunction(
			options => new this.contentWindow.Promise(
				(resolve, reject) => this._sendTrellisPrint(options).then(resolve, reject)
			),
			this.contentWindow,
			{ defineAs: "trellisPrint" }
		);
	}

	async handleEvent(event) {
		switch (event.type) {
			case "pageshow": {
				// We just need this to trigger actor creation
			}
		}
	}

	async _sendTrellisPrint(options) {
		await this.sendQuery("trellisPrint", options);
	}
}
