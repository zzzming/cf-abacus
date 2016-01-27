'use strict';

// Small utility that provides a subset of the MongoDB API over a set of DB
// partitions

const _ = require('underscore');
const sample = _.sample;
const each = _.each;

const partition = require('abacus-partition');
const batch = require('abacus-batch');
const dbclient = require('..');
const https = require('https');
const path = require('path');
const fs = require('fs');

/* eslint handle-callback-err: 0 */

const dbserver = () => process.env.COUCHDB;
const debug = require('abacus-debug')('abacus-mongoclient-test');

describe('abacus-mongoclient', () => {
  const helloKey = dbclient.kturi('Hello', Date.parse(
    'Thu Nov 06 2014 19:06:54 GMT-0800 (PST)'));
  const helloAgainKey = dbclient.kturi('Hello', Date.parse(
    'Thu Nov 06 2014 19:07:54 GMT-0800 (PST)'));
  const heyKey = dbclient.tkuri('Hey', Date.parse(
    'Mon Oct 06 2014 19:06:54 GMT-0800 (PST)'));
  const blahKey = dbclient.kturi('Blah', Date.parse(
    'Mon Oct 06 2014 19:06:54 GMT-0800 (PST)'));
  const awwwwKey = dbclient.kturi('Awwww', Date.parse(
    'Thu Nov 06 2014 19:06:54 GMT-0800 (PST)'));

  it('distributes db operations over several db partitions', (done) => {

    // Setup a partitioned db
    // Use a custom partition function causing some errors to help test
    // error handling. That complicates the setup a bit.
    //
    // Without that error test code, a normal setup would look like this:
    // const db = dbclient(partition, function(p) { return ['testdb',
    // p.join('-')].join('-'); }, function(uri, opt, cb) {
    //   cb(undefined, new mongoDB(uri, { db: memdown }));
    // });
    //
    const berr = new Error('Can\'t load balance DB partition 3');
    const perr = new Error('Can\'t open DB partition 2-201411');
    const db = dbclient(partition.partitioner(
      partition.bucket, partition.period, partition.forward, (p, o, cb) => {
        // Cause load balancing errors on DB partition 3
        return p[0][0] === 3 ? cb(berr) : cb(undefined, sample(p));
      }), dbclient.dburi(dbserver(), 'mongoclient-test'), (uri, opt, cb) => {
        // Cause DB handler errors on DB partition 2-201411
        return /mongoclient-test-2-201411/.test(uri) ? cb(perr) :
          dbclient.dbcons(uri, opt, cb);
      });

    // Remove any remaining docs from possibly failed test runs to make
    // sure we are starting clean
    const clean = (done) => {
      debug('several partitions: starting clean ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 3) {
          debug('several partitions: clean finished');
          done();
        }
      };

      db.get(helloKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(helloAgainKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(heyKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
    };

    // Put some docs into the partitioned db. The doc keys will be
    // distributed to specific partitions out of 4 default partitions
    const put = (done) => {
      debug('several partitions: starting put ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('several partitions: put finished');
          done();
        }
      };

      db.put({
        id: helloKey,
        value: 'Hello'
      }, (err, doc) => cb(expect(err).to.equal(null)));
      db.put({
        id: helloAgainKey,
        value: 'Hello again'
      }, (err, doc) => cb(expect(err).to.equal(null)));
      db.put({
        id: heyKey,
        value: 'Hey'
      }, (err, doc) => cb(expect(err).to.equal(null)));
      db.put({
        id: blahKey,
        value: 'Blah'
      }, (err, doc) => cb(expect(err).to.equal(berr)));
      db.put({
        id: awwwwKey,
        value: 'Awwww'
      }, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Put same docs to verify we are not doing upsert
    const putAgain = (done) => {
      debug('several partitions: starting put ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('several partitions: put finished');
          done();
        }
      };

      db.put({
        id: helloKey,
        value: 'Hello'
      }, (err, doc) => cb(expect(err).to.not.equal(null)));
      db.put({
        id:helloAgainKey,
        value: 'Hello again'
      }, (err, doc) => cb(expect(err).to.not.equal(null)));
      db.put({
        id: heyKey,
        value: 'Hey'
      }, (err, doc) => cb(expect(err).to.not.equal(null)));
      db.put({
        id: blahKey,
        value: 'Blah'
      }, (err, doc) => cb(expect(err).to.equal(berr)));
      db.put({
        id: awwwwKey,
        value: 'Awwww'
      }, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Get the docs back from the db
    let hellodoc;
    let hello2doc;
    let heydoc;
    const get = (done) => {
      debug('several partitions: starting get ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('several partitions: get finished');
          done();
        }
      };

      // Expect to get the documents previously put into the db in
      // partitions 0 and 1 and the reported errors on partitions 2 and 3
      db.get(helloKey, (err, doc) => {
        hellodoc = doc;
        cb(expect(doc.value).to.equal('Hello'));
      });
      db.get(helloAgainKey, (err, doc) => {
        hello2doc = doc;
        cb(expect(doc.value).to.equal('Hello again'));
      });
      db.get(heyKey, (err, doc) => {
        heydoc = doc;
        cb(expect(doc.value).to.equal('Hey'));
      });
      db.get(blahKey, (err, doc) => cb(expect(err).to.equal(berr)));
      db.get(awwwwKey, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Remove the docs from the db
    const remove = (done) => {
      debug('several partitions: starting remove ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('several partitions: remove finished');
          done();
        }
      };

      // Expect no errors on partitions 0 and 1 and the reported errors
      // on partitions 2 and 3
      db.remove(hellodoc, (err, doc) => cb(expect(err).to.equal(null)));
      db.remove(hello2doc, (err, doc) => cb(expect(err).to.equal(null)));
      db.remove(heydoc, (err, doc) => cb(expect(err).to.equal(null)));
      db.remove({
        id: blahKey
      }, (err, doc) => cb(expect(err).to.equal(berr)));
      db.remove({
        id: awwwwKey
      }, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Attempt to get the docs back from the db again
    const getagain = (done) => {
      debug('several partitions: starting getagain ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('several partitions: getagain finished');
          done();
        }
      };

      // Expect the docs to not be found, and the reported errors on
      // partitions 2 and 3
      db.get(helloKey, (err, doc) => cb(expect(doc).to.equal(undefined)));
      db.get(helloAgainKey, (err, doc) => cb(expect(doc).to.equal(undefined)));
      db.get(heyKey, (err, doc) => cb(expect(doc).to.equal(undefined)));
      db.get(blahKey, (err, doc) => cb(expect(err).to.equal(berr)));
      db.get(awwwwKey, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Run all the above steps
    clean(() => put(() => putAgain(() => get(() => remove(() =>
      getagain(done))))));
  });

  it('distributes batches of ops over several db partitions', (done) => {

    // Setup a partitioned db
    // Use a custom partition function causing some errors to help test
    // error handling. That complicates the setup a bit.
    //
    // Without that error test code, a normal setup would look like this:
    // const db = dbclient(partition, function(p) { return ['testdb',
    // p.join('-')].join('-'); }, function(uri, opt, cb) {
    //   cb(undefined, new mongoDB(uri, { db: memdown }));
    // });
    //
    const berr = new Error('Can\'t load balance DB partition 3');
    const perr = new Error('Can\'t open DB partition 2-201411');
    const db = batch(dbclient(partition.partitioner(
      partition.bucket, partition.period, partition.forward, (p, o, cb) => {
        // Cause load balancing errors on DB partition 3
        return p[0][0] === 3 ? cb(berr) : cb(undefined, sample(p));
      }), dbclient.dburi(dbserver(), 'dbclient-test'), (uri, opt, cb) => {
        // Cause DB handler errors on DB partition 2-201411
        return /dbclient-test-2-201411/.test(uri) ? cb(perr) :
          dbclient.dbcons(uri, opt, cb);
      }));

    // Remove any remaining docs from possibly failed test runs to make
    // sure we are starting clean
    const clean = (done) => {
      debug('batch: starting clean ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 3) {
          debug('batch: clean finished');
          done();
        }
      };

      db.get(helloKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(helloAgainKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(heyKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
    };

    // Put some docs into the partitioned db. The doc keys will be
    // distributed to specific partitions out of 4 default partitions
    const put = (done) => {
      debug('batch: starting put ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('batch: put finished');
          done();
        }
      };

      db.put({
        id: helloKey,
        value: 'Hello'
      }, (err, doc) => cb(expect(err).to.equal(null)));
      db.put({
        id: helloAgainKey,
        value: 'Hello again'
      }, (err, doc) => cb(expect(err).to.equal(null)));
      db.put({
        id: heyKey,
        value: 'Hey'
      }, (err, doc) => cb(expect(err).to.equal(null)));
      db.put({
        id: blahKey,
        value: 'Blah'
      }, (err, doc) => cb(expect(err).to.equal(berr)));
      db.put({
        id: awwwwKey,
        value: 'Awwww'
      }, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Put same docs to verify we are not doing upsert
    const putAgain = (done) => {
      debug('batch: starting put ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('batch: put finished');
          done();
        }
      };

      db.put({
        id: helloKey,
        value: 'Hello'
      }, (err, doc) => cb(expect(err).to.not.equal(null)));
      db.put({
        id: helloAgainKey,
        value: 'Hello again'
      }, (err, doc) => cb(expect(err).to.not.equal(null)));
      db.put({
        id: heyKey,
        value: 'Hey'
      }, (err, doc) => cb(expect(err).to.not.equal(null)));
      db.put({
        id: blahKey,
        value: 'Blah'
      }, (err, doc) => cb(expect(err).to.equal(berr)));
      db.put({
        id: awwwwKey,
        value: 'Awwww'
      }, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Get the docs back from the db
    let hellodoc;
    let hello2doc;
    let heydoc;
    const get = (done) => {
      debug('batch: starting get ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('batch: get finished');
          done();
        }
      };

      // Expect to get the documents previously put into the db in
      // partitions 0 and 1 and the reported errors on partitions 2 and 3
      db.get(helloKey, (err, doc) => {
        hellodoc = doc;
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello'));
      });
      db.get(helloAgainKey, (err, doc) => {
        hello2doc = doc;
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello again'));
      });
      db.get(heyKey, (err, doc) => {
        heydoc = doc;
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hey'));
      });
      db.get(blahKey, (err, doc) => cb(expect(err).to.equal(berr)));
      db.get(awwwwKey, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Get the same document several times in a batch
    const getDuplicate = (done) => {
      debug('batch: starting getDuplicate ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 6) {
          debug('batch: getDuplicate finished');
          done();
        }
      };

      // Expect to get the documents previously put into the db
      db.get(helloKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello'));
      });
      db.get(helloKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello'));
      });
      db.get(helloAgainKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello again'));
      });
      db.get(helloKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello'));
      });
      db.get(helloKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello'));
      });
      db.get(helloAgainKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello again'));
      });
    };

    // Remove the docs from the db
    const remove = (done) => {
      debug('batch: starting remove ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('batch: remove finished');
          done();
        }
      };

      // Expect no errors on partitions 0 and 1 and the reported errors
      // on partitions 2 and 3
      db.remove(hellodoc, (err, doc) => cb(expect(err).to.equal(null)));
      db.remove(hello2doc, (err, doc) => cb(expect(err).to.equal(null)));
      db.remove(heydoc, (err, doc) => cb(expect(err).to.equal(null)));
      db.remove({
        id: blahKey
      }, (err, doc) => cb(expect(err).to.equal(berr)));
      db.remove({
        id: awwwwKey
      }, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Attempt to get the docs back from the db again
    const getagain = (done) => {
      debug('batch: starting getagain ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 5) {
          debug('batch: gatagain finished');
          done();
        }
      };

      // Expect notfound errors and reported errors on partitions 2 and 3
      db.get(helloKey, (err, doc) => cb(expect(doc).to.equal(undefined)));
      db.get(helloAgainKey, (err, doc) => cb(expect(doc).to.equal(undefined)));
      db.get(heyKey, (err, doc) => cb(expect(doc).to.equal(undefined)));
      db.get(blahKey, (err, doc) => cb(expect(err).to.equal(berr)));
      db.get(awwwwKey, (err, doc) => cb(expect(err).to.equal(perr)));
    };

    // Run all the above steps
    clean(() => put(() => putAgain(() => get(() => getDuplicate(() =>
      remove(() => getagain(done)))))));
  });

  it('distributes bulk operations over 4 db partitions', (done) => {

    // Setup a partitioned db
    // Use a custom partition function causing some errors to help test
    // error handling. That complicates the setup a bit.
    //
    // Without that error test code, a normal setup would look like this:
    // const db = dbclient(partition, function(p) { return ['testdb',
    // p.join('-')].join('-'); }, function(uri, opt, cb) {
    //   cb(undefined, new mongoDB(uri, { db: memdown }));
    // });
    //
    const berr = new Error('Can\'t load balance DB partition 3');
    const perr = new Error('Can\'t open DB partition 2-201411');
    const db = dbclient(partition.partitioner(
      partition.bucket, partition.period, partition.forward, (p, o, cb) => {
        // Cause load balancing errors on DB partition 3
        return p[0][0] === 3 ? cb(berr) : cb(undefined, sample(p));
      }), dbclient.dburi(dbserver(), 'dbclient-testbulk'), (uri, opt, cb) => {
        // Cause DB handler errors on DB partition 2-201411
        return /dbclient-testbulk-2-201411/.test(uri) ? cb(perr) :
          dbclient.dbcons(uri, opt, cb);
      });

    // Remove any remaining docs from possibly failed test runs to make
    // sure we are starting clean
    const clean = (done) => {
      debug('bulk: starting clean ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 3) {
          debug('bulk: clean finished');
          done();
        }
      };

      db.get(helloKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(helloAgainKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(heyKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
    };

    // Put a list of docs into the partitioned db. The doc keys will be
    // distributed to specific partitions out of 4 default partitions
    const putlist = (done) => {
      debug('bulk: starting putlist ...');
      db.bulkDocs([{
        id: helloKey,
        value: 'Hello'
      },
        {
          id: helloAgainKey,
          value: 'Hello again'
        },
        {
          id: heyKey,
          value: 'Hey'
        }], {}, (err, doc) => {
          expect(err).to.equal(null);
          debug('bulk: putlist finished');
          done();
        });
    };

    // Put a list of docs into the partitioned db, use partitions
    // 2 and 3 to test error handling
    const puterr = (done) => {
      debug('bulk: starting puterr ...');
      db.bulkDocs([{
        id: blahKey,
        value: 'Blah'
      },
        {
          id: awwwwKey,
          value: 'Awwww'
        }], {}, (err, docs) => {
          expect(err).to.equal(berr);
          debug('bulk: puterr finished');
          done();
        });
    };

    // Get the docs back from the db
    const get = (done) => {
      debug('bulk: starting get ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 3) {
          debug('bulk: get finished');
          done();
        }
      };

      // Expect to get the documents previously put into the db in
      // partitions 0 and 1
      db.get(helloKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello'))
      });
      db.get(helloAgainKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hello again'))
      });
      db.get(heyKey, (err, doc) => {
        expect(err).to.equal(null);
        cb(expect(doc.value).to.equal('Hey'))
      });
    };

    // Get a list of docs back from the db
    const getlist = (done) => {
      debug('bulk: starting getlist ...');
      // Expect to get the requested docs from partitions 0 and 1
      db.allDocs({
        include_docs: true,
        keys: [
          helloKey,
          helloAgainKey,
          heyKey
        ]
      }, (err, docs) => {
        expect(err).to.equal(null);
        expect(docs.rows.length).to.equal(3);
        expect(docs.rows[0].doc.value).to.equal('Hello');
        expect(docs.rows[1].doc.value).to.equal('Hello again');
        expect(docs.rows[2].doc.value).to.equal('Hey');

        debug('bulk: getlist finished');
        done();
      });
    };

    // Get a list of docs from the partitioned db, use partitions
    // 2 and 3 to test error handling
    const geterr = (done) => {
      debug('bulk: starting geterr ...');
      db.allDocs({
        include_docs: true,
        keys: [
          blahKey,
          awwwwKey
        ]
      }, (err, doc) => {
        expect(err).to.equal(berr);

        debug('bulk: geterr finished');
        done();
      });
    };

    // Get a range of docs back from the db
    const getrange = (done) => {
      debug('bulk: starting getrange ...');
      // Expect to get the requested range of docs from partitions 0 and 1
      db.allDocs({
        include_docs: true,
        startkey: helloKey,
        endkey: helloAgainKey
      }, (err, docs) => {
        expect(err).to.equal(null);
        expect(docs.rows.length).to.equal(2);
        expect(docs.rows[0].doc.value).to.equal('Hello');
        expect(docs.rows[1].doc.value).to.equal('Hello again');

        debug('bulk: getrange finished');
        done();
      });
    };

    // Get a range of docs metadata back from the db without the values
    const getNoDocs = (done) => {
      debug('bulk: starting getNoDocs ...');
      // Expect to get the requested range of docs from partitions 0 and 1
      db.allDocs({
        include_docs: false,
        startkey: helloKey,
        endkey: helloAgainKey
      }, (err, docs) => {
        expect(err).to.equal(null);
        expect(docs.rows.length).to.equal(2);
        expect(docs.rows[0].doc.value).to.equal(undefined);
        expect(docs.rows[1].doc.value).to.equal(undefined);

        debug('bulk: getNoDocs finished');
        done();
      });
    };

    // Get a range of docs back from the db in descending order
    const getDocsAscending = (done) => {
      debug('bulk: starting getDocsAscending ...');
      // Expect to get the requested range of docs from partitions 0 and 1
      db.allDocs({
        include_docs: true,
        startkey: helloKey,
        endkey: helloAgainKey,
        descending: false
      }, (err, docs) => {
        expect(err).to.equal(null);
        expect(docs.rows.length).to.equal(2);
        expect(docs.rows[0].doc.value).to.equal('Hello');
        expect(docs.rows[1].doc.value).to.equal('Hello again');

        debug('bulk: getDocsAscending finished');
        done();
      });
    };

    // Get a range of docs back from the db in descending order
    const getDocsDescending = (done) => {
      debug('bulk: starting getDocsDescending ...');
      // Expect to get the requested range of docs from partitions 0 and 1
      db.allDocs({
        include_docs: true,
        startkey: helloAgainKey,
        endkey: helloKey,
        descending: true
      }, (err, docs) => {
        expect(err).to.equal(null);
        expect(docs.rows.length).to.equal(2);
        expect(docs.rows[0].doc.value).to.equal('Hello again');
        expect(docs.rows[1].doc.value).to.equal('Hello');

        debug('bulk: getDocsDescending finished');
        done();
      });
    };

    // Get a limited range of docs back from the db
    const getlimit = (done) => {
      debug('bulk: starting getlimit ...');
      // Expect to get the requested range of docs from partitions 0 and 1
      db.allDocs({
        include_docs: true,
        limit: 1,
        startkey: helloKey,
        endkey: helloAgainKey
      }, (err, docs) => {
        expect(err).to.equal(null);
        expect(docs.rows.length).to.equal(1);
        expect(docs.rows[0].doc.value).to.equal('Hello');

        debug('bulk: getlimit finished');
        done();
      });
    };

    // Get a range of docs from the partitioned db, use partitions
    // 2 and 3 to test error handling
    const getrangeerr = (done) => {
      debug('bulk: starting getrangeerr ...');
      db.allDocs({
        include_docs: true,
        startkey: dbclient.kturi('Blah', Date.parse(
          'Sun Oct 05 2014 19:06:54 GMT-0800 (PST)')),
        endkey: dbclient.kturi('Blah', Date.parse(
          'Sun Dec 07 2014 19:07:54 GMT-0800 (PST)'))
      }, (err, docs) => {
        expect(err).to.equal(berr);

        debug('bulk: getrangeerr finished');
        done();
      });
    };

    // Run the above steps
    clean(() => putlist(() => putlist(() => puterr(() => get(() => getlist(() =>
      geterr(() => getrange(() => getNoDocs(() => getDocsAscending(() =>
        getDocsDescending(() => getlimit(() => getrangeerr(done)))))))))))));
  });

  it('can construct a default partitioned db handle', (done) => {
    // Try to read docs to test db connection
    const read = (db, done) => {
      let cbs = 0;
      const cb = (err, doc) => {
        expect(err).to.not.equal(undefined);
        expect(doc).to.equal(undefined);
        if(++cbs === 3) done();
      };

      db.get(helloKey, (err, doc) => cb(err, doc));
      db.get(helloAgainKey, (err, doc) => cb(err, doc));
      db.get(heyKey, (err, doc) => cb(err, doc));
    };

    const noParams = (done) => {
      const db = dbclient();
      expect(db).to.not.equal(undefined);
      read(db, done);
    };

    const uriOnly = (done) => {
      const db = dbclient(undefined, () => {
        return dbserver() || 'mongodb://localhost:27017';
      });
      expect(db).to.not.equal(undefined);
      read(db, done);
    };

    noParams(() => uriOnly(done));
  });

  it('works with different collection', (done) => {
    let fullDB;
    let emptyDB;
    let defaultDB;

    // Remove any remaining docs from possibly failed test runs to make
    // sure we are starting clean
    const clean = (db, done) => {
      debug('collections: starting clean ...');
      let cbs = 0;
      const cb = () => {
        // Put some docs into the partitioned db. The doc keys will be
        // distributed to specific partitions out of 4 default partitions
        if(++cbs === 3) {
          debug('collections: clean finished');
          done();
        }
      };

      db.get(helloKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(helloAgainKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(heyKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
    };

    const put = (db, done) => {
      debug('collections: starting put ...');
      let cbs = 0;
      const cb = () => {
        // Verify no docs exist
        if(++cbs === 3) {
          debug('collections: put finished');
          done();
        }
      };

      db.put({
        id: helloKey,
        value: 'Hello'
      }, (err, doc) => cb(expect(err).to.equal(null)));
      db.put({
        id: helloAgainKey,
        value: 'Hello again'
      }, (err, doc) => cb(expect(err).to.equal(null)));
      db.put({
        id: heyKey,
        value: 'Hey'
      }, (err, doc) => cb(expect(err).to.equal(null)));
    };

    const verifyNoDocuments = (db, done) => {
      debug('collections: starting verifyNoDocuments ...');
      let cbs = 0;
      const cb = (err, doc) => {
        expect(err).to.not.equal(undefined);
        expect(doc).to.equal(undefined);
        if(++cbs === 3) {
          // Verify that the docs exist
          debug('collections: verifyNoDocuments finished ...');
          done();
        }
      };

      db.get(helloKey, (err, doc) => cb(err, doc));
      db.get(helloAgainKey, (err, doc) => cb(err, doc));
      db.get(heyKey, (err, doc) => cb(err, doc));
    };

    const verifyDocuments = (db, done) => {
      debug('collections: starting verifyDocuments ...');
      let cbs = 0;
      const cb = (err, doc) => {
        expect(err).to.not.equal(undefined);
        expect(doc).to.not.equal(undefined);
        if(++cbs === 3) {
          debug('collections: verifyDocuments finished ...');
          done();
        }
      };

      db.get(helloKey, (err, doc) => cb(err, doc));
      db.get(helloAgainKey, (err, doc) => cb(err, doc));
      db.get(heyKey, (err, doc) => cb(err, doc));
    };

    const fullCollection = (cb) => {
      debug('collections: starting fullCollection ...');
      const db = dbclient(undefined,
        dbclient.dburi(dbserver(), 'test-full-collection'));
      expect(db).to.not.equal(undefined);
      clean(db, () => put(db, () => {
        debug('collections: fullCollection finished ...');
        cb(db);
      }));
    };

    const defaultCollection = (cb) => {
      debug('collections: starting defaultCollection ...');
      const db = dbclient(undefined, dbclient.dburi(dbserver()));
      expect(db).to.not.equal(undefined);
      clean(db, () => put(db, () => {
        debug('collections: defaultCollection finished ...');
        cb(db);
      }))
    };

    const emptyCollection = (cb) => {
      debug('collections: starting emptyCollection ...');
      const db = dbclient(undefined,
        dbclient.dburi(dbserver(), 'test-empty-collection'));
      expect(db).to.not.equal(undefined);
      clean(db, () => {
        debug('collections: emptyCollection finished ...');
        cb(db);
      });
    };

    const createCollections = (cb) => {
      debug('collections: starting createCollections ...');
      emptyCollection((db) => {
        emptyDB = db;
        fullCollection((db) => {
          fullDB = db;
          defaultCollection((db) => {
            defaultDB = db;
            debug('collections: createCollections finished ...');
            cb();
          })
        })
      })
    };

    createCollections(() => verifyNoDocuments(emptyDB, () =>
      verifyDocuments(fullDB, () => verifyDocuments(defaultDB, done))));
  });

  it('does not retry on missing documents', (done) => {
    const db = dbclient(undefined,
      dbclient.dburi(dbserver(), 'test-missing-docs'));
    const batchDB = batch(dbclient(undefined,
      dbclient.dburi(dbserver(), 'test-missing-docs-batch')));

    // Remove any remaining docs from possibly failed test runs to make
    // sure we are starting clean
    const clean = (done) => {
      debug('missing docs: starting clean ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 3) {
          debug('missing docs: clean finished');
          done();
        }
      };

      db.get(helloKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(helloAgainKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(heyKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
    };

    // Verify that no error is generated
    const verifyGet = (db, done) => {
      debug('missing docs: starting verifyGet ...');
      let cbs = 0;
      const cb = (err, doc) => {
        expect(doc).to.equal(undefined);
        expect(err).to.equal(null);
        if (++cbs === 3) {
          debug('missing docs: verifyGet finished');
          done();
        }
      };

      db.get(dbclient.kturi('Hello', 0), (err, doc) => cb(err, doc));
      db.get(dbclient.kturi('Hello', 1), (err, doc) => cb(err, doc));
      db.get(dbclient.tkuri('Hey', 0), (err, doc) => cb(err, doc));
    };

    clean(() => verifyGet(db, () => verifyGet(batchDB, done)));
  });

  it('does not retry on conflicting documents', (done) => {
    const db = dbclient(undefined,
      dbclient.dburi(dbserver(), 'test-conflicting-docs'));
    const batchDB = batch(dbclient(undefined,
      dbclient.dburi(dbserver(), 'test-conflicting-docs-batch')));

    // Remove any remaining docs from possibly failed test runs to make
    // sure we are starting clean
    const clean = (db, done) => {
      debug('conflicting docs: starting clean ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 3) {
          debug('conflicting docs: clean finished');
          done();
        }
      };

      db.get(helloKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(helloAgainKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(heyKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
    };

    // Ensure DB contains documents
    const put = (db, done) => {
      debug('conflicting docs: starting put ...');
      let cbs = 0;
      const cb = (err, doc) => {
        expect(doc).to.not.equal(undefined);
        expect(err).to.equal(null);
        if (++cbs === 3) {
          debug('conflicting docs: put finished');
          done();
        }
      };

      db.put({
        id: helloKey,
        value: 'Hello'
      }, (err, doc) => cb(err, doc));
      db.put({
        id: helloAgainKey,
        value: 'Hello again'
      }, (err, doc) => cb(err, doc));
      db.put({
        id: heyKey,
        value: 'Hey'
      }, (err, doc) => cb(err, doc));
    };

    // Verify that generated errors are set with correct flags
    const verifyPut = (db, done) => {
      debug('conflicting docs: starting verifyPut ...');
      let cbs = 0;
      const cb = (err, doc) => {
        expect(doc).to.equal(undefined);
        expect(err).to.not.equal(undefined);
        expect(err.status).to.equal(409);
        expect(err.noretry).to.equal(true);
        expect(err.nobreaker).to.equal(true);
        if (++cbs === 3) {
          debug('conflicting docs: verifyPut finished');
          done();
        }
      };

      db.put({
        id: helloKey,
        value: 'Hello'
      }, (err, doc) => cb(err, doc));
      db.put({
        id: helloAgainKey,
        value: 'Hello again'
      }, (err, doc) => cb(err, doc));
      db.put({
        id: heyKey,
        value: 'Hey'
      }, (err, doc) => cb(err, doc));
    };

    clean(db, () => put(db, () => verifyPut(db, () =>
      clean(batchDB, () => put(batchDB, () =>verifyPut(batchDB, done))))));
  });

  it('calls back with the documents', (done) => {
    const document = {
      'metered-usage_id': 't/0001446256800000-0-0-0-0/k/' +
        'a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27/' +
        '0b39fa70-a65f-4183-bae8-385633ca5c87/' +
        'external:bbeae239-f3f8-483c-9dd0-de6781c38bab/basic',
      'accumulated_usage': [
        {
          'metric': 'memory',
          'windows': [
            [ null ],
            [ null ],
            [ null ],
            [
              {
                'quantity': {
                  'current': {
                    'consumed': 0,
                    'consuming': 2,
                    'since': 1446336000000
                  }
                },
                'cost': {
                  'burned': 0,
                  'burning': 0.00028,
                  'since': 1446336000000
                }
              },
              {
                'quantity': {
                  'current': {
                    'consumed': 0,
                    'consuming': 2,
                    'since': 1446249600000
                  }
                },
                'cost': {
                  'burned': 0,
                  'burning': 0.00028,
                  'since': 1446249600000
                }
              },
              null
            ],
            [
              {
                'quantity': {
                  'current': {
                    'consumed': 0,
                    'consuming': 2,
                    'since': 1446336000000
                  }
                },
                'cost': {
                  'burned': 0,
                  'burning': 0.00028,
                  'since': 1446336000000
                }
              },
              {
                'quantity': {
                  'current': {
                    'consumed': 0,
                    'consuming': 2,
                    'since': 1446249600000
                  }
                },
                'cost': {
                  'burned': 0,
                  'burning': 0.00028,
                  'since': 1446249600000
                }
              }
            ]
          ]
        }
      ],
      'normalized_usage_id': '351',
      'start': 1446249600000,
      'end': 1446336000000,
      'collected_usage_id': '555',
      'metered_usage_id': '443',
      'resource_id': 'test-resource',
      'resource_instance_id': '0b39fa70-a65f-4183-bae8-385633ca5c87',
      'organization_id': 'a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27',
      'space_id': 'aaeae239-f3f8-483c-9dd0-de5d41c38b6a',
      'consumer_id': 'external:bbeae239-f3f8-483c-9dd0-de6781c38bab',
      'plan_id': 'basic',
      'processed': 1446418800000,
      'id': 'k/a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27/' +
        '0b39fa70-a65f-4183-bae8-385633ca5c87/' +
        'external:bbeae239-f3f8-483c-9dd0-de6781c38bab/' +
        'basic/t/0001446336000000/0001446336000000',
      '_id': 'k/a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27/' +
        '0b39fa70-a65f-4183-bae8-385633ca5c87/' +
        'external:bbeae239-f3f8-483c-9dd0-de6781c38bab/' +
        'basic/t/0001446336000000/0001446336000000',
      '_rev': '1-817cb8dafb9c04d1fb26d3c6f75f5b84'
    };

    const db = dbclient(undefined,
      dbclient.dburi(dbserver(), 'test-correct-docs'));
    const batchDB = batch(dbclient(undefined,
      dbclient.dburi(dbserver(), 'test-correct-docs-batch')));

    // Remove any remaining docs from possibly failed test runs to make
    // sure we are starting clean
    const clean = (db, done) => {
      debug('correct docs: starting clean ...');
      let cbs = 0;
      const cb = () => {
        if(++cbs === 3) {
          debug('correct docs: clean finished');
          done();
        }
      };

      db.get(helloKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(helloAgainKey,
        (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
      db.get(heyKey, (err, doc) => doc ? db.remove(doc, cb) : cb(err, doc));
    };

    // Ensure DB contains documents
    const put = (db, done) => {
      debug('correct docs: starting put ...');
      let cbs = 0;
      const cb = (err, doc) => {
        expect(err).to.equal(null);
        expect(doc).to.not.equal(undefined);
        expect(doc.value).to.not.equal(undefined);
        expect(doc.doc).to.deep.equal(document);
        if (++cbs === 3) {
          debug('correct docs: put finished');
          done();
        }
      };

      db.put({
        id: helloKey,
        value: 'Hello',
        doc: document
      }, (err, doc) => cb(err, doc));
      db.put({
        id: helloAgainKey,
        value: 'Hello again',
        doc: document
      }, (err, doc) => cb(err, doc));
      db.put({
        id: heyKey,
        value: 'Hey',
        doc: document
      }, (err, doc) => cb(err, doc));
    };

    // Verify document content
    const get = (db, done) => {
      debug('correct docs: starting get ...');
      let cbs = 0;
      const cb = (err, doc) => {
        expect(err).to.equal(null);
        expect(doc).to.not.equal(undefined);
        expect(doc.value).to.not.equal(undefined);
        expect(doc.doc).to.deep.equal(document);
        if (++cbs === 3) {
          debug('correct docs: get finished');
          done();
        }
      };

      db.get(helloKey, (err, doc) => cb(err, doc));
      db.get(helloAgainKey, (err, doc) => cb(err, doc));
      db.get(heyKey, (err, doc) => cb(err, doc));
    };

    // Put a list of docs into the partitioned db. The doc keys will be
    // distributed to specific partitions out of 4 default partitions
    const putlist = (db, done) => {
      debug('correct docs: starting putlist ...');
      db.bulkDocs([{
        id: helloKey,
        value: 'Hello',
        doc: document
      },
        {
          id: helloAgainKey,
          value: 'Hello again',
          doc: document
        },
        {
          id: heyKey,
          value: 'Hey',
          doc: document
        }], {}, (err, docs) => {
          expect(err).to.equal(null);
          each(docs, (doc) => {
            expect(doc.doc).to.deep.equal(document);
          });

          debug('correct docs: putlist finished');
          done();
        });
    };

    // Get a range of docs back from the db
    const getrange = (db, done) => {
      debug('correct docs: starting getrange ...');
      // Expect to get the requested range of docs from partitions 0 and 1
      db.allDocs({
        include_docs: true,
        startkey: helloKey,
        endkey: helloAgainKey
      }, (err, docs) => {
        expect(err).to.equal(null);
        expect(docs.rows.length).to.equal(2);
        expect(docs.rows[0].doc.value).to.equal('Hello');
        expect(docs.rows[1].doc.value).to.equal('Hello again');

        debug('correct docs: getrange finished');
        done();
      });
    };

    clean(db, () => put(db, () => get(db, () =>
      clean(batchDB, () => put(batchDB, () => get(batchDB, () =>
        clean(db, () => putlist(db, () => getrange(db, done)))))))));
  });

  it('preserves options when constructing DB URIs', () => {
    const serverNameFunc = dbclient.dburi('mongodb://localhost:1234' +
      '?ssl=true', 'ssl-test');
    expect(serverNameFunc(['1'])).to.equal('mongodb://localhost:1234/' +
      'ssl-test-1?ssl=true');
    expect(serverNameFunc(['1', '23'])).to.equal('mongodb://localhost:1234/'
      + 'ssl-test-1-23?ssl=true');

    const serverFunc = dbclient.dburi('mongodb://localhost:1234?ssl=true');
    expect(serverFunc(['1'])).to.equal('mongodb://localhost:1234/' +
      '-1?ssl=true');
    expect(serverFunc(['1', '23'])).to.equal('mongodb://localhost:1234/' +
      '-1-23?ssl=true');

    const nameFunc = dbclient.dburi(undefined, 'dbname');
    expect(nameFunc(['1'])).to.equal('dbname-1');
    expect(nameFunc(['1', '23'])).to.equal('dbname-1-23');

    const noSchemaFunc = dbclient.dburi('localhost:2345?ssl=true', 'dbname');
    expect(noSchemaFunc(['1'])).to.equal('localhost:2345/dbname-1?ssl=true');
    expect(noSchemaFunc(['1', '23'])).to.equal('localhost:2345/dbname-1-23?' +
      'ssl=true');
  });

  it('supports self-signed certificates for SSL', (done) => {
    // keys, cert and configuration setup using the following commands:
    //
    // openssl genrsa -des3 -out ca.key 4096
    // openssl req -new -x509 -days 365 -key ca.key -out ca.crt
    //
    // openssl genrsa -des3 -out server.key 1024
    // openssl req -new -key server.key -out server.csr
    //
    // openssl x509 -req -days 365 -in server.csr -CA ca.crt -CAkey ca.key
    //   -set_serial 01 -out server.crt
    //
    // openssl genrsa -des3 -out client.key 1024
    // openssl req -new -key client.key -out client.csr
    //
    // openssl x509 -req -days 365 -in client.csr -CA ca.crt -CAkey ca.key
    //   -set_serial 01 -out client.crt
    const ca = [ fs.readFileSync(path.join(__dirname,
      '../../src/test/keys/ca.crt')) ];

    // Create HTTPS service
    const serverOptions = {
      agent: false,
      key:  fs.readFileSync(path.join(__dirname,
        '../../src/test/keys/server.key')),
      cert: fs.readFileSync(path.join(__dirname,
        '../../src/test/keys/server.crt')),
      ca:   ca,
      passphrase: 'pass'
    };
    const dummyServer = https.createServer(serverOptions).listen(() => {
      debug('self-signed: started HTTPS server on port %d',
        dummyServer.address().port);
    });

    dummyServer.on('clientError', (exception) => {
      debug('self-signed: got client error %o', exception);
      // Expect Mongo driver to verify the certificate and send non-standard
      // method for HTTPS protocol. This means that a handshake and connection
      // are established successfully.
      expect(exception.code).to.equal('HPE_INVALID_METHOD');
      debug('self-signed: test finished successfully', exception);
      done();
    });

    const verifySelfSignedCert = () => {
      debug('self-signed: starting verifySSL ...');
      const db = dbclient(undefined, dbclient.dburi('mongodb://localhost:' +
        dummyServer.address().port + '?ssl=true', 'ssl-test'), (uri, opt, cb) =>
        dbclient.dbcons(uri, {}, (err) => {
          expect(err.message).to.not.equal('self signed certificate');
          debug('self-signed: verifySSL finished');
        })
      );

      // Trigger db connection
      db.get(helloKey);
    };

    verifySelfSignedCert();
  });
});