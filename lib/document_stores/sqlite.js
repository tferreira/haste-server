/*global require,module,process*/

var fs = require("fs");
var dblite = require("dblite");
var winston = require('winston');

// CREATE TABLE `entries` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `entry_key` VARCHAR(255) NOT NULL UNIQUE, `title` VARCHAR(255) NOT NULL UNIQUE, value TEXT NOT NULL, expiration INT);
// CREATE TABLE `tags` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `entry_key` VARCHAR(255) NOT NULL, `tag` VARCHAR(50));

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
      client.query("SELECT DISTINCT entries.entry_key, entries.title FROM entries INNER JOIN tags ON entries.entry_key = tags.entry_key AND tags.tag LIKE ? OR entries.title LIKE ? AND (entries.expiration IS NULL OR entries.expiration > ?)",
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
            rows.push({'entry_key': key, 'title': title});
          }
        }
        callback(result.length ? rows : false);
      });
    });
  },

  // Retrieve number of documents per tag

  tagsstats: function (callback) {
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query("SELECT tag, count(tag) FROM tags GROUP BY tag", function (err, result) {
        if (result.length) {
          rows = []
          for (var i in result) {
            tag = result[i][0];
            count = result[i][1];
            rows.push({'tag': tag, 'count': count});
          }
        }
        callback(result.length ? rows : false);
      });
      client.close();
    });
  },

  // Delete a given key
  del: function (key, callback) {
    this.safeConnect(function (err, client) {
      if (err) { client.close(); return callback(false); }
      client.query("DELETE FROM entries WHERE entry_key = ?; DELETE FROM tags WHERE entry_key = ?;", [
        key, key
      ], function (err, result) {
        if (err) {
          winston.error('error deleting document on sqlite', { error: err });
          return callback(false);
        }
        callback(true);
      });
      client.close();
    });
  },

  // Set a given key
  set: function (key, data, title, tags, callback, skipExpire) {
    var now = Math.floor(new Date().getTime() / 1000);
    var that = this;
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query('BEGIN TRANSACTION');
      client.query('INSERT INTO entries (entry_key, title, value, expiration) VALUES (?,?,?,?)', [
        key,
        title,
        data,
        that.expireJS && !skipExpire ? that.expireJS + now : null
      ]);
      // Tags
      var tags_array = tags.split(",");
      tags_array = tags_array.filter(function(n){ return (n != " ") && (n != "") && (n != undefined)});
      if (tags_array.length > 0) {
        var query = 'INSERT INTO tags (entry_key, tag) VALUES';
        var values = [];
        for (var i = 0, len = tags_array.length; i < len; i++) {
          query += i == 0 ? '(?,?)' : ',(?,?)';
          values.push(key);
          values.push(tags_array[i].replace(/\s+/g, ""));
        }
        client.query(query, values);
      }
      client.query('COMMIT');
      client.close();
    });
    callback(true);
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
    callback(undefined, connection);
  }

};

module.exports = SqliteDocumentStore;
