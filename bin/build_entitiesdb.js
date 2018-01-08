const Store = require('../lib/store.js');
const status = require('node-status');

const console = status.console();

const config = require('../config.js');

let store = new Store(config);
let status_suppliers = status.addItem('suppliers', {type: ['count']});
let status_buyers = status.addItem('buyers', {type: ['count']});
let status_tenders = status.addItem('tenders', {type: ['bar']});

let streamItems = (onItems, onEnd) => {
	let query = {match_all: {}};
	let pos = 0;
	store.Tender.stream(1000, query,
		(items, total, next) => {
			pos += items.length;
			onItems(items, pos, total, next);
		},
		(err) => {
			onEnd(err);
		});
};

function importBuyers(items, cb) {
	if (items.length === 0) {
		return cb();
	}
	let buyers = [];
	items.forEach(hit => {
		if (!hit._source) {
			console.log('transmission failed, hit without a _source', hit);
			return;
		}
		(hit._source.buyers || []).forEach(body => {
			body.id = body.id || 'no-id';
			let buyer = buyers.find(b => {
				return b.body.id === body.id;
			});
			if (!buyer) {
				buyer = {
					id: body.id,
					body: body,
					countries: [],
					count: 0
				};
				buyers.push(buyer);
			}
			if (buyer.countries.indexOf(hit._source.country) < 0) {
				buyer.countries.push(hit._source.country);
			}
			buyer.count++;
			// TODO: add other useful information
			// buyer.sources.push({tender: hit._source.id, country: hit._source.country});
		});
	});
	let ids = buyers.map(buyer => {
		return buyer.body.id;
	});
	store.Buyer.getByIds(ids, (err, result) => {
		if (err) return cb(err);
		let new_list = [];
		let update_hits = [];
		buyers.forEach(buyer => {
			let hit = result.hits.hits.find(h => {
				return buyer.body.id === h._source.body.id;
			});
			if (hit) {
				// hit._source.sources = hit._source.sources.concat(buyer.sources);
				update_hits.push(hit);
			} else {
				new_list.push(buyer);
				status_buyers.inc();
			}
		});
		store.Buyer.bulk_update(update_hits, (err) => {
			if (err) return cb(err);
			store.Buyer.bulk_add(new_list, (err) => {
				if (err) return cb(err);
				cb();
			});
		});
	});

}

function importSuppliers(items, cb) {
	if (items.length === 0) {
		return cb();
	}
	let suppliers = [];
	items.forEach(hit => {
		if (!hit._source) {
			return;
		}
		(hit._source.lots || []).forEach(lot => {
			(lot.bids || []).forEach(bid => {
				(bid.bidders || []).forEach(body => {
					body.id = body.id || 'no-id';
					let supplier = suppliers.find(b => {
						return b.body.id === body.id;
					});
					if (!supplier) {
						supplier = {
							id: body.id,
							body: body,
							count: 0,
							countries: []
						};
						suppliers.push(supplier);
					}
					supplier.count++;
					if (supplier.countries.indexOf(hit._source.country)<0) {
						supplier.countries.push(hit._source.country);
					}
					// supplier.sources.push({tender: hit._source.id, country: hit._source.country});
				});
			});
		});
	});
	let ids = suppliers.map(supplier => {
		return supplier.body.id;
	});
	store.Supplier.getByIds(ids, (err, result) => {
		if (err) return cb(err);
		let new_list = [];
		let update_hits = [];
		suppliers.forEach(supplier => {
			let hit = result.hits.hits.find(h => {
				return supplier.body.id === h._source.body.id;
			});
			if (hit) {
				// hit._source.sources = hit._source.sources.concat(supplier.sources);
				update_hits.push(hit);
			} else {
				new_list.push(supplier);
				status_suppliers.inc();
			}
		});
		store.Supplier.bulk_update(update_hits, (err) => {
			if (err) return cb(err);
			store.Supplier.bulk_add(new_list, (err) => {
				if (err) return cb(err);
				cb();
			});
		});
	});
}

let importEntities = (cb) => {
	streamItems((items, pos, total, next) => {
		status_tenders.max = total;
		status_tenders.count = pos;
		importBuyers(items, (err) => {
			if (err) {
				return cb(err);
			}
			importSuppliers(items, (err) => {
				if (err) {
					return cb(err);
				}
				next();
			});
		});
	}, (err) => {
		cb(err);
	});
};


store.init((err) => {
	if (err) {
		return console.log(err);
	}
	store.Buyer.removeIndex((err) => {
		if (err) {
			return console.log(err);
		}
		store.Buyer.checkIndex(err => {
			if (err) {
				return console.log(err);
			}
			store.Supplier.removeIndex((err) => {
				if (err) {
					return console.log(err);
				}
				store.Supplier.checkIndex(err => {
					if (err) {
						return console.log(err);
					}
					status.start();
					importEntities(err => {
						if (err) {
							return console.log(err);
						}
						store.close(() => {
							status.stop();
							console.log('done');
						});
					});
				});
			});
		});
	});
});
