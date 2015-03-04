/*global require,module,process*/

var fs = require("fs");
var dblite = require("dblite");
var winston = require('winston');

// CREATE TABLE `entries` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `entry_key` VARCHAR(255) NOT NULL UNIQUE, `title` VARCHAR(255) NOT NULL UNIQUE, `tags` VARCHAR(255), value TEXT NOT NULL, expiration INT);

// A sqlite document store
var SqliteDocumentStore = function (options) {
  this.expireJS = options.expire;
  this.file = process.env.DATABASE_URL || options.file;
};

SqliteDocumentStore.prototype = {

  // Return JSON with a list of titles and document key
  search: function (term, callback) {
    var now = Math.floor(new Date().getTime() / 1000);
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query("SELECT entry_key, title FROM entries WHERE title LIKE ? OR tags LIKE ? AND (expiration IS NULL OR expiration > ?)",
      ['%'+term+'%', '%'+term+'%', now],
      function (err, result) {
        if (err) {
          winston.error('error searching value on sqlite', { error: err });
          return callback(false);
        }
        if (result.length) {
          rows = []
          for (var i in result) {
            key = result[i][0];
            title = result[i][1];
            rows.push({'entry_key': key, 'title': title})
          }
        }
        callback(result.length ? rows : false);
      });
    });
  },

  // Delete a given key
  del: function (key, callback) {
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query("DELETE FROM entries WHERE entry_key = ?", [
        key 
      ], function (err, result) {
        if (err) {
          winston.error('error deleting document on sqlite', { error: err });
          return callback(false);
        }
        callback(true);
      });
    });
  },

  // Set a given key
  set: function (key, data, title, tags, callback, skipExpire) {
    var now = Math.floor(new Date().getTime() / 1000);
    var that = this;
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query('INSERT INTO entries (entry_key, title, tags, value, expiration) VALUES (?,?,?,?,?)', [
        key,
        title,
        tags,
        data,
        that.expireJS && !skipExpire ? that.expireJS + now : null
      ], function (err, result) {
        if (err) {
          winston.error('error persisting value to sqlite', { error: err });
          return callback(false);
        }
        callback(true);
      });
    });
  },

  // Get a given key's data
  get: function (key, callback, skipExpire) {
    var now = Math.floor(new Date().getTime() / 1000);
    var that = this;
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query("SELECT id,value,expiration FROM entries WHERE entry_key = ? and (expiration IS NULL OR expiration > ?)", [key, now], function (err, result) {
        if (err) {
          winston.error('error retrieving value from sqlite', { error: err });
          return callback(false);
        }
        callback(result.length ? result[0][1] : false);
        if (result.length && that.expireJS && !skipExpire) {
          client.query('UPDATE entries SET expiration = ? WHERE id = ?', [
            that.expireJS + now,
            result[0][0]
          ], function (err, result) {
            if (!err) {
              //nothing
            }
          });
        } else {
          //nothing
        }
      });
    });
  },

  // A connection wrapper
  safeConnect: function (callback) {
    var exists = fs.existsSync(this.file);
    if (!exists) {
      fs.openSync(this.file, "w");
    }
    var connection = new dblite(this.file);
    connection.query("CREATE TABLE if not exists `entries` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `entry_key` VARCHAR(255) NOT NULL UNIQUE, `title` VARCHAR(255) NOT NULL UNIQUE, `tags` VARCHAR(255), value TEXT NOT NULL, expiration INT)");
    callback(undefined, connection);
  }

};

module.exports = SqliteDocumentStore;
