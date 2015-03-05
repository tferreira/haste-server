var winston = require('winston');
var Busboy = require('busboy');

// For handling serving stored documents

var DocumentHandler = function(options) {
  if (!options) {
    options = {};
  }
  this.keyLength = options.keyLength || DocumentHandler.defaultKeyLength;
  this.maxLength = options.maxLength; // none by default
  this.store = options.store;
  this.keyGenerator = options.keyGenerator;
};

DocumentHandler.defaultKeyLength = 10;

// Handle search by document title
DocumentHandler.prototype.handleSearch = function(term, response) {
  this.store.search(term, function(ret) {
    if (ret) {
      winston.warn('found matching document(s)', { term: term });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: ret }));
    }
    else
    {
      winston.warn('no document title is matching', { term: term });
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'No title matching.' }));
    }
  });
};

// Handle tags statistics
/*DocumentHandler.prototype.handleTagsStats = function(request, response) {
  this.store.tagsstats(function(ret) {
    if (ret) {
      winston.warn('succesfuly found tags stats', {});
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: ret }));
    }
    else
    {
      winston.warn('tags stats not found', {});
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Cannot find tags statistics.' }));
    }
  });
};*/

// Handle delete by document id (key)
DocumentHandler.prototype.handleDelete = function(key, response) {
  this.store.del(key, function(ret) {
    if (ret) {
      winston.warn('succesfuly deleted document', { key: key });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: ret }));
    }
    else
    {
      winston.warn('document not found', { key: key });
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Document not found.' }));
    }
  });
};


// Handle retrieving a document
DocumentHandler.prototype.handleGet = function(key, response, skipExpire) {
  this.store.get(key, function(ret) {
    if (ret) {
      winston.verbose('retrieved document', { key: key });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: ret, key: key }));
    }
    else {
      winston.warn('document not found', { key: key });
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Document not found.' }));
    }
  }, skipExpire);
};

// Handle retrieving the raw version of a document
DocumentHandler.prototype.handleRawGet = function(key, response, skipExpire) {
  this.store.get(key, function(ret) {
    if (ret) {
      winston.verbose('retrieved raw document', { key: key });
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(ret);
    }
    else {
      winston.warn('raw document not found', { key: key });
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Document not found.' }));
    }
  }, skipExpire);
};

// Handle adding a new Document
DocumentHandler.prototype.handlePost = function (request, response) {
  var _this = this;
  var buffer = '';
  var title = '';
  var tags = '';
  var cancelled = false;

  // What to do when done
  var onSuccess = function () {
    // Check length
    if (_this.maxLength && buffer.length > _this.maxLength) {
      cancelled = true;
      winston.warn('document >maxLength', { maxLength: _this.maxLength });
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ message: 'Document exceeds maximum length.' })
      );
      return;
    }
    // And then save if we should
    _this.chooseKey(function (key) {
      _this.store.set(key, buffer, title, tags, function (res) {
        if (res) {
          winston.verbose('added document', { key: key });
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ key: key }));
        }
        else {
          winston.verbose('error adding document');
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ message: 'Error adding document.' }));
        }
      });
    });
  };

  // If we should, parse a form to grab the data
  var ct = request.headers['content-type'];
  if (ct && ct.split(';')[0] === 'multipart/form-data') {
    var busboy = new Busboy({ headers: request.headers });
    busboy.on('field', function (fieldname, val) {
      if (fieldname === 'data') {
        buffer = val['body'];
        title = val['title'];
        tags = val['tags'];
      }
    });
    busboy.on('finish', function () {
      onSuccess();
    });
    request.pipe(busboy);
  // Otherwise, use our own and just grab flat data from POST body
  } else {
    request.on('data', function (data) {
      var vars = data.toString('utf8').split('&');
      for (var i = 0; i < vars.length; i++) {
        var pair = vars[i].split('=');
        if (decodeURIComponent(pair[0]) == "body") {
          buffer += decodeURIComponent(pair[1].replace(/\+/g, '%20'));
        }
        if (decodeURIComponent(pair[0]) == "title") {
          title += decodeURIComponent(pair[1].replace(/\+/g, '%20'));
        }
        if (decodeURIComponent(pair[0]) == "tags") {
          tags += decodeURIComponent(pair[1].replace(/\+/g, '%20'));
        }
      }
    });
    request.on('end', function () {
      if (cancelled) { return; }
      onSuccess();
    });
    request.on('error', function (error) {
      winston.error('connection error: ' + error.message);
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Connection error.' }));
      cancelled = true;
    });
  }
};

// Keep choosing keys until one isn't taken
DocumentHandler.prototype.chooseKey = function(callback) {
  var key = this.acceptableKey();
  var _this = this;
  this.store.get(key, function(ret) {
    if (ret) {
      _this.chooseKey(callback);
    } else {
      callback(key);
    }
  });
};

DocumentHandler.prototype.acceptableKey = function() {
  return this.keyGenerator.createKey(this.keyLength);
};

module.exports = DocumentHandler;
