describe("Trellis.DB", function () {
	var tmpTable = "tmpDBTest";
	
	before(function* () {
		this.timeout(5000);
		Trellis.debug("Waiting for DB activity to settle");
		yield Trellis.DB.waitForTransaction();
		yield Trellis.Promise.delay(1000);
	});
	beforeEach(function* () {
		yield Trellis.DB.queryAsync("DROP TABLE IF EXISTS " + tmpTable);
		yield Trellis.DB.queryAsync("CREATE TABLE " + tmpTable + " (foo INT)");
	});
	after(function* () {
		yield Trellis.DB.queryAsync("DROP TABLE IF EXISTS " + tmpTable);
	});
	
	
	describe("#queryAsync()", function () {
		var tmpTable;
		
		before(function* () {
			tmpTable = "tmp_queryAsync";
			yield Trellis.DB.queryAsync("CREATE TEMPORARY TABLE " + tmpTable + " (a, b)");
			yield Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (1, 2)");
			yield Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (3, 4)");
			yield Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (5, NULL)");
		})
		after(function* () {
			if (tmpTable) {
				yield Trellis.DB.queryAsync("DROP TABLE IF EXISTS " + tmpTable);
			}
		})
		
		it("should throw an error if no parameters are passed for a query with placeholders", async function () {
			var e = await getPromiseError(Trellis.DB.queryAsync("SELECT itemID FROM items WHERE itemID=?"));
			assert.ok(e);
			assert.include(e.message, "for query containing placeholders");
		})
		
		it("should throw an error if too few parameters are passed", async function () {
			var e = await getPromiseError(Trellis.DB.queryAsync("SELECT itemID FROM items WHERE itemID=? OR itemID=?", [1]));
			assert.ok(e);
			assert.include(e.message, "Incorrect number of parameters provided for query");
		})
		
		it("should throw an error if too many parameters are passed", async function () {
			var e = await getPromiseError(Trellis.DB.queryAsync("SELECT itemID FROM items WHERE itemID=?", [1, 2]));
			assert.ok(e);
			assert.include(e.message, "Incorrect number of parameters provided for query");
		})
		
		it("should throw an error if too many parameters are passed for numbered placeholders", async function () {
			var e = await getPromiseError(Trellis.DB.queryAsync("SELECT itemID FROM items WHERE itemID=?1 OR itemID=?1", [1, 2]));
			assert.ok(e);
			assert.include(e.message, "Incorrect number of parameters provided for query");
		})
		
		it("should accept a single placeholder given as a value", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b=?", 2);
			assert.lengthOf(rows, 1);
			assert.equal(rows[0].a, 1);
		})
		
		it("should accept a single placeholder given as an array", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b=?", [2]);
			assert.lengthOf(rows, 1);
			assert.equal(rows[0].a, 1);
		})
		
		it("should accept multiple placeholders", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b=? OR b=?", [2, 4]);
			assert.lengthOf(rows, 2);
			assert.equal(rows[0].a, 1);
			assert.equal(rows[1].a, 3);
		});
		
		it("should accept combination of numbered and unnumbered placeholders", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE (a=?1 OR b=?1) OR b=?", [2, 4]);
			assert.lengthOf(rows, 2);
			assert.equal(rows[0].a, 1);
			assert.equal(rows[1].a, 3);
		});
		
		it("should accept a single placeholder within parentheses", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b IN (?)", 2);
			assert.lengthOf(rows, 1);
			assert.equal(rows[0].a, 1);
		})
		
		it("should accept multiple placeholders within parentheses", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b IN (?, ?)", [2, 4]);
			assert.lengthOf(rows, 2);
			assert.equal(rows[0].a, 1);
			assert.equal(rows[1].a, 3);
		})
		
		it("should replace =? with IS NULL if NULL is passed as a value", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b=?", null);
			assert.lengthOf(rows, 1);
			assert.equal(rows[0].a, 5);
		})
		
		it("should replace =? with IS NULL if NULL is passed in an array", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b=?", [null]);
			assert.lengthOf(rows, 1);
			assert.equal(rows[0].a, 5);
		})
		
		it("should replace ? with NULL for placeholders within parentheses in INSERT statements", async function () {
			await Trellis.DB.queryAsync("CREATE TEMPORARY TABLE tmp_srqwnfpwpinss (a, b)");
			// Replace ", ?"
			await Trellis.DB.queryAsync("INSERT INTO tmp_srqwnfpwpinss (a, b) VALUES (?, ?)", [1, null]);
			assert.equal(
				((await Trellis.DB.valueQueryAsync("SELECT a FROM tmp_srqwnfpwpinss WHERE b IS NULL"))),
				1
			);
			// Replace "(?"
			await Trellis.DB.queryAsync("DELETE FROM tmp_srqwnfpwpinss");
			await Trellis.DB.queryAsync("INSERT INTO tmp_srqwnfpwpinss (a, b) VALUES (?, ?)", [null, 2]);
			assert.equal(
				((await Trellis.DB.valueQueryAsync("SELECT b FROM tmp_srqwnfpwpinss WHERE a IS NULL"))),
				2
			);
			await Trellis.DB.queryAsync("DROP TABLE tmp_srqwnfpwpinss");
		})
		
		it("should throw an error if NULL is passed for placeholder within parentheses in a SELECT statement", async function () {
			var e = await getPromiseError(Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b IN (?)", null));
			assert.ok(e);
			assert.include(e.message, "NULL cannot be used for parenthesized placeholders in SELECT queries");
		})
		
		it("should handle numbered parameters", async function () {
			var rows = await Trellis.DB.queryAsync("SELECT a FROM " + tmpTable + " WHERE b=?1 "
				+ "UNION SELECT b FROM " + tmpTable + " WHERE b=?1", 2);
			assert.lengthOf(rows, 2);
			assert.equal(rows[0].a, 1);
			assert.equal(rows[1].a, 2);
		})
		
		it("should throw an error if onRow throws an error", async function () {
			var i = 0;
			var e = Trellis.DB.queryAsync(
				"SELECT * FROM " + tmpTable,
				false,
				{
					onRow: function (row) {
						if (i > 0) {
							throw new Error("Failed");
						}
						i++;
					}
				}
			);
			e = await getPromiseError(e)
			assert.ok(e);
			assert.equal(e.message, "Failed");
		});
		
		it("should stop gracefully if onRow calls cancel()", async function () {
			var i = 0;
			var rows = [];
			await Trellis.DB.queryAsync(
				"SELECT * FROM " + tmpTable,
				false,
				{
					onRow: function (row, cancel) {
						if (i > 0) {
							cancel();
							return;
						}
						rows.push(row.getResultByIndex(0));
						i++;
					}
				}
			);
			assert.lengthOf(rows, 1);
		});
	})
	
	
	describe("#executeTransaction()", function () {
		it("should serialize concurrent transactions", async function () {
			var resolve1, resolve2, reject1, reject2;
			var promise1 = new Promise(function (resolve, reject) {
				resolve1 = resolve;
				reject1 = reject;
			});
			var promise2 = new Promise(function (resolve, reject) {
				resolve2 = resolve;
				reject2 = reject;
			});
			
			Trellis.DB.executeTransaction(async function () {
				await Trellis.Promise.delay(250);
				var num = await Trellis.DB.valueQueryAsync("SELECT COUNT(*) FROM " + tmpTable);
				assert.equal(num, 0);
				await Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (1)");
				assert.ok(Trellis.DB.inTransaction());
			})
			.then(resolve1)
			.catch(reject1);
			
			Trellis.DB.executeTransaction(async function () {
				var num = await Trellis.DB.valueQueryAsync("SELECT COUNT(*) FROM " + tmpTable);
				assert.equal(num, 1);
				await Trellis.Promise.delay(500);
				await Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (2)");
				assert.ok(Trellis.DB.inTransaction());
			})
			.then(resolve2)
			.catch(reject2);
			
			await Promise.all([promise1, promise2]);
		});
		
		it("should serialize queued transactions", async function () {
			var resolve1, resolve2, reject1, reject2, resolve3, reject3;
			var promise1 = new Promise(function (resolve, reject) {
				resolve1 = resolve;
				reject1 = reject;
			});
			var promise2 = new Promise(function (resolve, reject) {
				resolve2 = resolve;
				reject2 = reject;
			});
			var promise3 = new Promise(function (resolve, reject) {
				resolve3 = resolve;
				reject3 = reject;
			});
			
			// Start a transaction and have it delay
			Trellis.DB.executeTransaction(async function () {
				await Trellis.Promise.delay(100);
				var num = await Trellis.DB.valueQueryAsync("SELECT COUNT(*) FROM " + tmpTable);
				assert.equal(num, 0);
				await Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (1)");
				assert.ok(Trellis.DB.inTransaction());
			})
			.then(resolve1)
			.catch(reject1);
			
			// Start two more transactions, which should wait on the first
			Trellis.DB.executeTransaction(async function () {
				var num = await Trellis.DB.valueQueryAsync("SELECT COUNT(*) FROM " + tmpTable);
				assert.equal(num, 1);
				await Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (2)");
				assert.ok(Trellis.DB.inTransaction());
			})
			.then(resolve2)
			.catch(reject2);
			
			Trellis.DB.executeTransaction(async function () {
				var num = await Trellis.DB.valueQueryAsync("SELECT COUNT(*) FROM " + tmpTable);
				assert.equal(num, 2);
				await Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (3)");
				// But make sure the second queued transaction doesn't start at the same time,
				// such that the first queued transaction gets closed while the second is still
				// running
				assert.ok(Trellis.DB.inTransaction());
			})
			.then(resolve3)
			.catch(reject3);
			
			await Promise.all([promise1, promise2, promise3]);
		})
		
		it("should roll back on error", async function () {
			await Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (1)");
			try {
				await Trellis.DB.executeTransaction(async function () {
					await Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (2)");
					throw 'Aborting transaction -- ignore';
				});
			}
			catch (e) {
				if (typeof e != 'string' || !e.startsWith('Aborting transaction')) throw e;
			}
			var count = await Trellis.DB.valueQueryAsync("SELECT COUNT(*) FROM " + tmpTable + "");
			assert.equal(count, 1);
			
			var conn = await Trellis.DB._getConnectionAsync();
			assert.isFalse(conn.transactionInProgress);
			
			await Trellis.DB.queryAsync("DROP TABLE " + tmpTable);
		});
		
		it("should run onRollback callbacks", async function () {
			var callbackRan = false;
			try {
				await Trellis.DB.executeTransaction(
					async function () {
						await Trellis.DB.queryAsync("INSERT INTO " + tmpTable + " VALUES (1)");
						throw 'Aborting transaction -- ignore';
					},
					{
						onRollback: function () {
							callbackRan = true;
						}
					}
				);
			}
			catch (e) {
				if (typeof e != 'string' || !e.startsWith('Aborting transaction')) throw e;
			}
			assert.ok(callbackRan);
			
			await Trellis.DB.queryAsync("DROP TABLE " + tmpTable);
		});
		
		it("should time out on nested transactions", async function () {
			var e;
			await Trellis.DB.executeTransaction(async function () {
				e = await getPromiseError(
					Promise.race([
						Trellis.Promise.delay(250).then(() => {
							var e = new Error;
							e.name = "TimeoutError";
							throw e;
						}),
						Trellis.DB.executeTransaction(async function () {})
					])
				);
			});
			assert.ok(e);
			assert.equal(e.name, "TimeoutError");
		});
		
		it("should run onRollback callbacks for timed-out nested transactions", async function () {
			var callback1Ran = false;
			var callback2Ran = false;
			try {
				await Trellis.DB.executeTransaction(async function () {
					await Trellis.DB.executeTransaction(
						async function () {},
						{
							waitTimeout: 100,
							onRollback: function () {
								callback1Ran = true;
							}
						}
					)
				},
				{
					onRollback: function () {
						callback2Ran = true;
					}
				});
			}
			catch (e) {
				if (e.name != "TimeoutError") throw e;
			}
			assert.ok(callback1Ran);
			assert.ok(callback2Ran);
		});
	})
	
	
	describe("#columnExists()", function () {
		it("should return true if a column exists", async function () {
			assert.isTrue(await Trellis.DB.columnExists('items', 'itemID'));
		});
		
		it("should return false if a column doesn't exists", async function () {
			assert.isFalse(await Trellis.DB.columnExists('items', 'foo'));
		});
		
		it("should return false if a table doesn't exists", async function () {
			assert.isFalse(await Trellis.DB.columnExists('foo', 'itemID'));
		});
	});
	
	
	describe("#indexExists()", function () {
		it("should return true if an index exists", async function () {
			assert.isTrue(await Trellis.DB.indexExists('items_synced'));
		});
		
		it("should return false if an index doesn't exists", async function () {
			assert.isFalse(await Trellis.DB.indexExists('foo'));
		});
	});
	
	
	describe("#parseSQLFile", function () {
		it("should extract tables and indexes from userdata SQL file", async function () {
			var sql = Trellis.File.getResource(`resource://trellis/schema/userdata.sql`);
			var statements = await Trellis.DB.parseSQLFile(sql);
			assert.isTrue(statements.some(x => x.startsWith('CREATE TABLE items')));
		});
	});
	
	describe("#backUpDatabase()", function () {
		var bakFile;
		var bakFile2;
		
		beforeEach(async function () {
			bakFile = Trellis.DB.path + '.test.bak';
			bakFile2 = Trellis.DB.path + '.test2.bak';
			await IOUtils.remove(bakFile);
			await IOUtils.remove(bakFile2);
		});
		
		afterEach(async function () {
			await IOUtils.remove(bakFile);
			await IOUtils.remove(bakFile2);
		});
		
		it("should perform an offline backup", async function () {
			await Trellis.DB.backUpDatabase({ suffix: 'test' });
			assert.isTrue(await IOUtils.exists(bakFile));
			assert.equal(await Trellis.DB.valueQueryAsync("PRAGMA main.locking_mode"), "exclusive");
		});
		
		it("should perform an online backup", async function () {
			await Trellis.DB.backUpDatabase({ suffix: 'test', online: true });
			assert.isTrue(await IOUtils.exists(bakFile));
			assert.equal(await Trellis.DB.valueQueryAsync("PRAGMA main.locking_mode"), "exclusive");
		});
		
		it("shouldn't perform an offline backup if one is already in progress", async function () {
			var promise = Trellis.DB.backUpDatabase({ suffix: 'test' });
			var result2 = await Trellis.DB.backUpDatabase({ suffix: 'test2' });
			var result1 = await promise;
			assert.isTrue(result1);
			assert.isTrue(await IOUtils.exists(bakFile));
			// Return value is true, but file won't exist
			assert.isTrue(result2);
			assert.isFalse(await IOUtils.exists(bakFile2));
		});
		
	});


	describe("#vacuum()", function () {
		it("should vacuum the database with force option", async function () {
			let result = await Trellis.DB.vacuum({ force: true });
			assert.isTrue(result);

			// DB should still be functional
			let count = await Trellis.DB.valueQueryAsync("SELECT COUNT(*) FROM items");
			assert.isNumber(count);

			// Vacuum timestamp should be updated
			assert.isAbove(Trellis.Prefs.get('vacuum.lastTime'), 0);

			// Temp file should be cleaned up
			assert.isFalse(await IOUtils.exists(Trellis.DB.path + '.vacuum.tmp'));
		});

		it("should skip vacuum when recently vacuumed", async function () {
			Trellis.Prefs.set('vacuum.lastTime', Math.floor(Date.now() / 1000));
			let result = await Trellis.DB.vacuum();
			assert.isFalse(result);
			Trellis.Prefs.clear('vacuum.lastTime');
		});

		it("should skip vacuum when freelist is below threshold", async function () {
			Trellis.Prefs.clear('vacuum.lastTime');
			Trellis.Prefs.set('vacuum.freelistThreshold', 99);
			let result = await Trellis.DB.vacuum();
			assert.isFalse(result);
			Trellis.Prefs.clear('vacuum.freelistThreshold');
		});
	});

	describe("#onConnect()", function () {
		it("should run registered callbacks after the connection is reopened", async function () {
			let count = 0;
			Trellis.DB.onConnect(async () => {
				count++;
			});
			await Trellis.DB.closeDatabase();
			await Trellis.DB.valueQueryAsync("SELECT 1");
			assert.equal(count, 1);
		});
	});
});
