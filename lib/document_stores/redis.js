var redis = require('redis');
var winston = require('winston');

// For storing in redis
// options[type] = redis
// options[host] - The host to connect to (default localhost)
// options[port] - The port to connect to (default 5379)
// options[db] - The db to use (default 0)
// options[expire] - The time to live for each key set (default never)

var RedisDocumentStore = function(options, client) {
  this.expire = options.expire;
  if (client) {
    winston.info('using predefined redis client');
    RedisDocumentStore.client = client;
  } else if (!RedisDocumentStore.client) {
    winston.info('configuring redis');
    RedisDocumentStore.connect(options);
  }
};

// Create a connection according to config
RedisDocumentStore.connect = function(options) {
  var host = options.host || '127.0.0.1';
  var port = options.port || 6379;
  var index = options.db || 0;
  RedisDocumentStore.client = redis.createClient(port, host);
  RedisDocumentStore.client.select(index, function(err, reply) {
    if (err) {
      winston.error(
        'error connecting to redis index ' + index,
        { error: err }
      );
      process.exit(1);
    }
    else {
      winston.info('connected to redis on ' + host + ':' + port + '/' + index);
    }
  });
};

// Save file in a key
RedisDocumentStore.prototype.set = function(key, data, title, tags, callback, skipExpire) {
  var _this = this;
  multi = RedisDocumentStore.client.multi();
  multi.hmset(key, {"value": data, "title": title});
  var tags_arr = tags.split(",");
  tags_arr = tags_arr.filter(function(n){ return (n != " ") && (n != "") && (n != undefined)});
  if (tags_arr.length > 0) {
    for (var i = 0, len = tags_arr.length; i < len; i++) {
      multi.sadd(key + ":tags", tags_arr[i].replace(/\s+/g, ''));
      multi.zincrby('tags:stats', 1, tags_arr[i].replace(/\s+/g, ''))
    }
  }
  multi.exec(function (err, replies) {
    if (err) {
      callback(false);
    }
    else {
      if (!skipExpire) {
        _this.setExpiration(key);
        _this.setExpiration(key + ":tags");
      }
      callback(true);
    }
  });
};

// Expire a key in expire time if set
RedisDocumentStore.prototype.setExpiration = function(key) {
  if (this.expire) {
    RedisDocumentStore.client.expire(key, this.expire, function(err, reply) {
      if (err) {
        winston.error('failed to set expiry on key: ' + key);
      }
    });
  }
};

// Get a file from a key
RedisDocumentStore.prototype.get = function(key, callback, skipExpire) {
  var _this = this;
  RedisDocumentStore.client.hget(key, "value", function(err, reply) {
    if (!err && !skipExpire) {
      _this.setExpiration(key);
    }
    callback(err ? false : reply);
  });
};

// Delete a given key and his tags (decrement tags count too)
RedisDocumentStore.prototype.del = function(key, callback) {
  RedisDocumentStore.client.smembers(key + ":tags", function (err, replies) {
    replies.forEach(function (reply, i) {
      RedisDocumentStore.client.zincrby("tags:stats", -1, reply);
    });
  });
  multi = RedisDocumentStore.client.multi();
  multi.del(key);
  multi.del(key + ":tags");
  multi.exec(function (err, replies) {
    if (err) {
      callback(false);
    }
    else {
      callback(true);
    }
  });
}

module.exports = RedisDocumentStore;
