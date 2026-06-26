/* global JSWindowActorParent:false */

ChromeUtils.defineESModuleGetters(globalThis, {
	Trellis: "chrome://trellis/content/trellis.mjs"
});  

export class MendeleyAuthParent extends JSWindowActorParent {  
	async receiveMessage({ name, data }) {
		switch (name) {
			case "debug": {
				if (data.kind === "log") {
					Trellis.debug(`MendeleyAuth actor: ${data.message}`);
				}
				else if (data.kind === "error") {
					Trellis.debug(`MendeleyAuth actor: ${data.message}. Error: ${data.error}`);
				}
			}
		}
	}
}
