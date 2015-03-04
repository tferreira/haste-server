/*global require,module,process*/

var mysql = require('mysql');
var winston = require('winston');

// CREATE TABLE `entries` (`id` BIGINT NOT NULL AUTO_INCREMENT , `entry_key` VARCHAR(255) NOT NULL UNIQUE, `title` VARCHAR(255) NOT NULL UNIQUE, `tags` VARCHAR(255), value TEXT NOT NULL, expiration INT, PRIMARY KEY (`id`)) ENGINE=InnoDB;

// A mysql document store
var MysqlDocumentStore = function (options) {
  this.expireJS = options.expire;
  this.connectionUrl = process.env.DATABASE_URL || options.connectionUrl;
};

MysqlDocumentStore.prototype = {

  // Return JSON with a list of titles and document key
  search: function (term, callback) {
    var now = Math.floor(new Date().getTime() / 1000);
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query("SELECT entry_key, title FROM entries WHERE title LIKE ? OR tags LIKE ? AND (expiration IS NULL OR expiration > ?)", [
        '%'+term+'%', '%'+term+'%', now
      ], function (err, result) {
        if (err) {
          winston.error('error searching value on mysql', { error: err.stack });
          return callback(false);
        }
        callback(result.length ? result : false);
      });
    });
  },

  // Delete a given key
  del: function (key, callback) {
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query("DELETE FROM entries WHERE ?", {
        entry_key: key
      }, function (err, result) {
        if (err) {
          winston.error('error deleting document on mysql', { error: err.stack });
          return callback(false);
        }
        callback(result.affectedRows ? true : false);
      });
    });
  },

  // Set a given key
  set: function (key, data, title, tags, callback, skipExpire) {
    var now = Math.floor(new Date().getTime() / 1000);
    var that = this;
    this.safeConnect(function (err, client) {
      if (err) { return callback(false); }
      client.query('INSERT INTO entries SET ?', {
        entry_key: key,
        title: title,
        tags: tags,
        value: data,
        expiration: that.expireJS && !skipExpire ? that.expireJS + now : null
      }, function (err, result) {
        if (err) {
          winston.error('error persisting value to mysql', { error: err.stack });
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
          winston.error('error retrieving value from mysql', { error: err.stack });
          return callback(false);
        }
        callback(result.length ? result[0].value : false);
        if (result.length && that.expireJS && !skipExpire) {
          client.query('UPDATE entries SET expiration = ? WHERE id = ?', [
            that.expireJS + now,
            result[0].id
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
    var connection = mysql.createConnection(this.connectionUrl);
    connection.connect(function (err) {
      if (err) {
        winston.error('error connecting to mysql', { error: err.stack });
        callback(err.stack);
      } else {
        callback(undefined, connection);
      }
    });
  }

};

module.exports = MysqlDocumentStore;
