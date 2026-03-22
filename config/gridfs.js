const mongoose = require('mongoose');
const Grid = require('gridfs-stream');

let gfs;
let gridfsBucket;

const initGridFS = () => {
  const conn = mongoose.connection;
  conn.once('open', () => {
    gridfsBucket = new mongoose.mongo.GridFSBucket(conn.db, { bucketName: 'audio' });
    gfs = Grid(conn.db, mongoose.mongo);
    gfs.collection('audio');
  });
};

const getGridFS = () => {
  if (!gfs) initGridFS();
  return { gfs, gridfsBucket };
};

module.exports = { initGridFS, getGridFS };
