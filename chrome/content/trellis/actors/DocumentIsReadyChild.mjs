import { documentIsReady } from "chrome://trellis/content/actors/actorUtils.mjs";

export class DocumentIsReadyChild extends JSWindowActorChild {
	async receiveMessage({ name, data }) {
		if (name !== "waitForDocument") {
			return null;
		}

		let { allowInteractiveAfter } = data;
		await documentIsReady(this.document, { allowInteractiveAfter });
	}
}
