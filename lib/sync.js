var glob = require('glob'),
  gracefulFs = require('graceful-fs'),
  fs = require('fs'),
  q = require('q'),
  path = require('path');

gracefulFs.gracefulify(fs);

var diff = require('./diff'),
  putFile = require('./putFile'),
  deleteMultiple = require('./deleteMultiple');

// Magic put which handles files, globs, and directories
module.exports = function sync(client, source, destination, options){
  options = options || {};

  var doDiff = false;
  var base = options.base || '';

  var fileListPromise;

  // Change non-files (usually directories) to match-all globs
  if(Array.isArray(source)){
    fileListPromise = q.when(
      source.map(function(file){
        return path.relative(base, file);
      })
    );
  } else if(!glob.hasMagic(source)){
    if(fs.lstatSync(source).isFile()){
      base = path.dirname(source);
      fileListPromise = q.when([path.basename(source)]);
    } else {
      base = source;
      source += '/**/*';

      // Diffing removes extraneous files when syncing directories
      fileListPromise = diff(client, base, source, destination).then(function(data){
        var toRemove = data.removed.map(function(filePath){
          return path.join(destination, filePath);
        });

        var upsertFiles = data.existing.concat(data.new);
        if(toRemove.length > 0){
          return deleteMultiple(client, toRemove).then(function(){
            return upsertFiles;
          });
        } else {
          return upsertFiles;
        }
      });
    }
  } else {
    fileListPromise = q.when(
      glob.sync(source).filter(function(filePath){
        return fs.lstatSync(filePath).isFile();
      }).map(function(file){
        return path.relative(base, file);
      })
    );
  }

  return fileListPromise.then(function(files){
    var promises = files.map(function(filePath){
      var sourcePath = path.join(base, filePath);
      var destinationPath = path.join(destination, filePath);
      return putFile(client, sourcePath, destinationPath, options);
    });

    return q.all(promises);
  });
};
