Trellis.Sync.Storage.Utilities = {
	getClassForMode: function (mode) {
		switch (mode) {
		case 'zfs':
			return Trellis.Sync.Storage.Mode.ZFS;
		
		case 'webdav':
			return Trellis.Sync.Storage.Mode.WebDAV;
		
		default:
			throw new Error("Invalid storage mode '" + mode + "'");
		}
	},
	
	getItemFromRequest: function (request) {
		var [libraryID, key] = request.name.split('/');
		return Trellis.Items.getByLibraryAndKey(libraryID, key);
	},
	
	
	/**
	 * Create zip file of attachment directory in the temp directory
	 *
	 * @param	{Trellis.Sync.Storage.Request}		request
	 * @return {Promise<Boolean>} - True if the zip file was created, false otherwise
	 */
	createUploadFile: async function (request) {
		var item = this.getItemFromRequest(request);
		Trellis.debug("Creating ZIP file for item " + item.libraryKey);
		
		switch (item.attachmentLinkMode) {
			case Trellis.Attachments.LINK_MODE_LINKED_FILE:
			case Trellis.Attachments.LINK_MODE_LINKED_URL:
				throw new Error("Upload file must be an imported snapshot or file");
		}
		
		var zipFile = OS.Path.join(Trellis.getTempDirectory().path, item.key + '.zip');
		
		return Trellis.File.zipDirectory(
			Trellis.Attachments.getStorageDirectory(item).path,
			zipFile,
			{
				onStopRequest: function (req, context, status) {
					var zipFileName = PathUtils.filename(zipFile);
					
					var originalSize = 0;
					for (let entry of context.entries) {
						let zipEntry = context.zipWriter.getEntry(entry.name);
						if (!zipEntry) {
							Trellis.logError("ZIP entry '" + entry.name + "' not found for "
								+ "request '" + request.name + "'")
							continue;
						}
						originalSize += zipEntry.realSize;
					}
					
					Trellis.debug("Zip of " + zipFileName + " finished with status " + status
						+ " (original " + Math.round(originalSize / 1024) + "KB, "
						+ "compressed " + Math.round(context.zipWriter.file.fileSize / 1024) + "KB, "
						+ Math.round(
							((originalSize - context.zipWriter.file.fileSize) / originalSize) * 100
						) + "% reduction)");
				}
			}
		);
	},
	
	
	/**
	 * Prompt whether to reset unsynced local files in a library
	 *
	 * Keep in sync with Sync.Data.Utilities.showWriteAccessLostPrompt()
	 *
	 * @param {Window|null} win
	 * @param {Trellis.Library} library
	 * @return {Integer} - 0 to reset, 1 to skip
	 */
	showFileWriteAccessLostPrompt: function (win, library) {
		var libraryType = library.libraryType;
		switch (libraryType) {
		case 'group':
			var msg = Trellis.getString('sync.error.groupFileWriteAccessLost',
					[library.name, TRELLIS_CONFIG.DOMAIN_NAME])
				+ "\n\n"
				+ Trellis.getString('sync.error.groupCopyChangedFiles')
			var button0Text = Trellis.getString('sync.resetGroupFilesAndSync');
			var button1Text = Trellis.getString('sync.skipGroup');
			break;
		
		default:
			throw new Error("Unsupported library type " + libraryType);
		}
		
		return Trellis.Prompt.confirm({
			window: win,
			title: Trellis.getString('general.permissionDenied'),
			text: msg,
			button0: button0Text,
			button1: button1Text,
			buttonDelay: true,
		});
	}
}
