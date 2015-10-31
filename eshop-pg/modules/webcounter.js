/**
 * @module WebCounter
 * @author Peter Širka
 */

var COOKIE = '__webcounter';
var REG_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows.?Phone/i;
var REG_ROBOT = /bot|crawler/i;

function WebCounter() {
	this.stats = { pages: 0, day: 0, month: 0, year: 0, hits: 0, unique: 0, uniquemonth: 0, count: 0, search: 0, direct: 0, social: 0, unknown: 0, advert: 0, mobile: 0, desktop: 0, visitors: 0, orders: 0, newsletter: 0, contactforms: 0, users: 0 };
	this.history = U.copy(this.stats);
	this.online = 0;
	this.arr = [0, 0];
	this.interval = 0;
	this.current = 0;
	this.last = 0;
	this.lastvisit = null;
	this.social = ['plus.url.google', 'plus.google', 'twitter', 'facebook', 'linkedin', 'tumblr', 'flickr', 'instagram'];
	this.search = ['google', 'bing', 'yahoo', 'duckduckgo'];
	this.ip = [];
	this.url = [];
	this.allowXHR = true;
	this.allowIP = false;
	this.onValid = null;

	this._onValid = function(req) {
		var self = this;
		var agent = req.headers['user-agent'] || '';
		if (agent.length === 0)
			return false;
		if (req.headers['x-moz'] === 'prefetch')
			return false;
		if (self.onValid !== null && !self.onValid(req))
			return false;
		return agent.match(REG_ROBOT) === null;
	};

	this.isAdvert = function(req) {
		return (req.query['utm_medium'] || '').length > 0 || (req.query['utm_source'] || '').length > 0;
	};

	// every 30 seconds
	setInterval(this.clean.bind(this), 1000 * 30);
}

WebCounter.prototype = {

	get online() {
		var arr = this.arr;
		return arr[0] + arr[1];
	},

	get today() {
		var stats = this.history;
		stats.last = this.lastvisit;
		stats.pages = stats.hits > 0 && stats.count > 0 ? (stats.hits / stats.count).floor(2) : 0;
		return stats;
	}
};

/**
 * Clean up
 * @return {Module]
 */
WebCounter.prototype.clean = function() {

	var self = this;

	self.interval++;

	var now = new Date();
	var stats = self.stats;

	self.current = now.getTime();

	var day = now.getDate();
	var month = now.getMonth() + 1;
	var year = now.getFullYear();
	var length = 0;

	if (stats.day !== day || stats.month !== month || stats.year !== year) {
		stats.day = day;
		stats.month = month;
		stats.year = year;
		self.save();
	} else if (self.interval % 20 === 0)
		self.save();

	var arr = self.arr;

	var tmp1 = arr[1];
	var tmp0 = arr[0];

	arr[1] = 0;
	arr[0] = tmp1;

	if (tmp0 !== arr[0] || tmp1 !== arr[1]) {
		var online = arr[0] + arr[1];
		if (online != self.last) {
			if (self.allowIP)
				self.ip = self.ip.slice(tmp0);
			self.last = online;
		}
	}

	return self;
};

/**
 * Custom counter
 * @return {Module]
 */
WebCounter.prototype.increment = function(type) {

	var self = this;

	if (typeof(self.stats[type]) === 'undefined')
		self.stats[type] = 1;
	else
		self.stats[type]++;

	return self;
};

/**
 * Request counter
 * @return {Module]
 */
WebCounter.prototype.counter = function(req, res) {

	var self = this;

	if (!self._onValid(req))
		return false;

	if (req.xhr && !self.allowXHR)
		return false;

	if (req.method !== 'GET')
		return false;

	if ((req.headers['accept'] || '').length === 0 || (req.headers['accept-language'] || '').length === 0)
		return false;

	var arr = self.arr;
	var user = req.cookie(COOKIE).parseInt();
	var now = new Date();
	var ticks = now.getTime();
	var sum = user === 0 ? 1000 : (ticks - user) / 1000;
	var exists = sum < 31;
	var stats = self.stats;
	var history = self.history;
	var referer = req.headers['x-referer'] || req.headers['referer'] || '';

	stats.hits++;
	history.hits++;

	self.track(referer, req);

	if (exists)
		return true;

	var isUnique = false;
	if (user > 0) {
		sum = Math.abs(self.current - user) / 1000;
		if (sum < 41)
			return true;

		var date = new Date(user);
		if (date.getDate() !== now.getDate() || date.getMonth() !== now.getMonth() || date.getFullYear() !== now.getFullYear()) {
			isUnique = true;
			reset(history);
		}

		if (date.diff('months') < 0) {
			history.uniquemonth++;
			stats.uniquemonth++;
		}

	} else {
		isUnique = true;
		history.uniquemonth++;
		stats.uniquemonth++;
	}

	if (isUnique) {
		stats.unique++;
		history.unique++;
		var agent = req.headers['user-agent'] || '';
		if (agent.match(REG_MOBILE) === null) {
			stats.desktop++;
			history.desktop++;
		} else {
			stats.mobile++;
			history.mobile++;
		}
	}

	arr[1]++;
	self.lastvisit = new Date();

	res.cookie(COOKIE, ticks, now.add('d', 5));

	if (self.allowIP)
		self.ip.push({ ip: req.ip, url: req.uri.href });

	var online = self.online;

	if (self.last !== online)
		self.last = online;

	stats.visitors++;
	history.visitors++;
	stats.count++;
	history.count++;

	if (self.isAdvert(req)) {
		stats.advert++;
		history.advert++;
		return true;
	}

	referer = getReferer(referer);

	if (referer === null) {
		stats.direct++;
		history.direct++;
		return true;
	}

	var length = self.social.length;

	for (var i = 0; i < length; i++) {
		if (referer.indexOf(self.social[i]) !== -1) {
			stats.social++;
			history.social++;
			return true;
		}
	}

	var length = self.search.length;

	for (var i = 0; i < length; i++) {
		if (referer.indexOf(self.search[i]) !== -1) {
			stats.search++;
			history.search++;
			return true;
		}
	}

	stats.unknown++;
	history.unknown++;
	return true;
};

/**
 * Saves the current stats into the cache
 * @return {Module]
 */
WebCounter.prototype.save = function() {
	var self = this;
	var stats = U.copy(self.stats);
	var sql = DB();
	var dt = new Date();
	var id = dt.format('yyyyMMdd');

	stats.pages = stats.hits > 0 && stats.count > 0 ? (stats.hits / stats.count).floor(2) : 0;

	delete stats.pages;
	delete stats.day;
	delete stats.month;
	delete stats.year;

	sql.exists('today', 'tbl_visitor').where('id', id);
	sql.prepare(function(error, response, resume) {

		var builder = sql.$;

		if (response.today) {
			builder.inc(stats);
			builder.set('dateupdated', new Date());
			sql.update('tbl_visitor').replace(builder).where('id', id);
		} else {
			stats.day = dt.getDate() + 1;
			stats.month = dt.getMonth();
			stats.year = dt.getFullYear();
			builder.set(stats);
			builder.set('id', id);
			sql.insert('tbl_visitor').replace(builder);
		}

		reset(self.stats);
		resume();
	});

	sql.exec(F.error());
	return self;
};

/**
 * Dail stats
 * @param {Function(stats)} callback
 * @return {Module]
 */
WebCounter.prototype.daily = function(callback) {

	var self = this;
	var sql = DB();

	sql.query('stats', self.query()).group(['day', 'month', 'year']);
	sql.exec(function(err, response) {
		callback(response.stats);
	});

	return self;
};

/**
 * Monthly stats
 * @param {Function(stats)} callback
 * @return {Module]
 */
WebCounter.prototype.monthly = function(callback) {

	var self = this;
	var sql = DB();

	sql.query('stats', self.query()).group(['day', 'month', 'year']);
	sql.exec(function(err, response) {
		var arr = response.stats;
		var stats = {};
		for (var i = 0, length = arr.length; i < length; i++) {
			var key = arr[i].month + '-' + arr[i].year;
			if (!stats[key])
				stats[key] = arr[i];
			else
				sum(stats[key], arr[i]);
		}

		callback(stats);
	});

	return self;
};

/**
 * Yearly stats
 * @param {Function(stats)} callback
 * @return {Module]
 */
WebCounter.prototype.yearly = function(callback) {

	var self = this;
	var sql = DB();

	sql.query('stats', self.query()).group(['day', 'month', 'year']);
	sql.exec(function(err, response) {

		var arr = response.stats;
		var stats = {};

		for (var i = 0, length = arr.length; i < length; i++) {
			var key = arr[i].year;
			if (stats[key])
				sum(stats[key], arr[i]);
			else
				stats[key] = arr[i];
		}

		callback(stats);
	});

	return self;
};

// Creates SQL query string
WebCounter.prototype.query = function() {
	var self = this;
	var query = '';
	var keys = Object.keys(self.stats);

	for (var i = 0, length = keys.length ; i < length; i++) {
		var key = keys[i];
		if (key === 'day' || key === 'month' || key == 'year')
			continue;
		query += (query ? ',' : '') + 'SUM(' + SqlBuilder.column(keys[i]) + ')::int as ' + SqlBuilder.column(keys[i]);
	}

	return 'SELECT day,month,year,' + query + ' FROM tbl_visitor';
};

/**
 * Refresh visitors URL
 * @internal
 * @param {String} referer
 * @param {Request} req
 */
WebCounter.prototype.track = function(referer, req) {

	if (referer.length === 0)
		return;

	var self = this;
	if (!self.allowIP)
		return;

	for (var i = 0, length = self.ip.length; i < length; i++) {
		var item = self.ip[i];
		if (item.ip === req.ip && item.url === referer) {
			item.url = req.uri.href;
			return;
		}
	}
};

function sum(a, b) {
	Object.keys(b).forEach(function(o) {
		if (o === 'day' || o === 'year' || o === 'month')
			return;
		if (typeof(a[o]) === 'undefined')
			a[o] = 0;
		if (typeof(b[o]) !== 'undefined')
			a[o] += b[o];
	});
}

function reset(stats) {

	delete stats.last;

	var keys = Object.keys(stats);
	for (var i = 0, length = keys.length; i < length; i++)
		stats[keys[i]] = 0;
}

function getReferer(host) {
	if (host.length === 0)
		return null;
	var index = host.indexOf('/') + 2;
	host = host.substring(index, host.indexOf('/', index));
	return host;
}

// Instance
var webcounter = new WebCounter();

var delegate_request = function(controller, name) {
	webcounter.counter(controller.req, controller.res);
};

module.exports.name = 'webcounter';
module.exports.version = 'v3.00';
module.exports.instance = webcounter;

framework.on('controller', delegate_request);

module.exports.usage = function() {
	var stats = utils.extend({}, webcounter.stats);
	stats.online = webcounter.online;
	return stats;
};

module.exports.install = function() {
	setTimeout(function() {
		var sql = DB();
		sql.select('stats', 'tbl_visitor').where('id', (new Date()).format('yyyyMMdd')).first();
		sql.exec(function(err, response) {
			if (response.stats)
				webcounter.history = response.stats;
		});
	}, 1000);
};

module.exports.online = function() {
	return webcounter.online;
};

module.exports.today = function() {
	return webcounter.today;
};

module.exports.increment = function(type) {
	webcounter.increment(type);
	return this;
};

module.exports.monthly = function(callback) {
	return webcounter.monthly(callback);
};

module.exports.yearly = function(callback) {
	return webcounter.yearly(callback);
};

module.exports.daily = function(callback) {
	return webcounter.daily(callback);
};