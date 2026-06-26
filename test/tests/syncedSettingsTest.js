describe('Trellis.SyncedSettings', function () {
	it('should not affect cached value when modifying the setting after #set() call', async function () {
		let setting = {athing: 1};
		await Trellis.SyncedSettings.set(Trellis.Libraries.userLibraryID, 'setting', setting);
		
		setting.athing = 2;
		let storedSetting = Trellis.SyncedSettings.get(Trellis.Libraries.userLibraryID, 'setting');
		assert.notDeepEqual(setting, storedSetting);
	});
});
