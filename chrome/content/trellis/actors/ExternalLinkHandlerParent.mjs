ChromeUtils.defineESModuleGetters(globalThis, {
	Trellis: "chrome://trellis/content/trellis.mjs"
});

export class ExternalLinkHandlerParent extends JSWindowActorParent {
	async receiveMessage({ name, data }) {
		switch (name) {
			case "launchURL": {
				Trellis.launchURL(data);
				return;
			}
		}
	}
}
