const ypearUserbase = async (router, options) => {
  return new Promise(async (resolve) => {

    const [
      Autobase,
      AutobaseManager, 
      Hyperbee
    ] = await require('@ypear/forks')();
    const Corestore = require('corestore');
    const Hypercore = require('hypercore');
    const DHT = require('hyperdht');
    const b4a = require('b4a');
    const crypto = require('hypercore-crypto');
    const RAM = require('random-access-memory');
    const forge = require('node-forge');
    const fs = (await require('fs')).promises;
    

    if (!options) {
      throw new Error('options object is missing');
    }
    else if (!options.networkName || typeof options.networkName !== 'string') {
      throw new Error('options.networkName should be a string');
    }
    if (!options.aes) {
      throw new Error('both options.aes key and iv are required');
    }
    if (!options.quit || typeof options.quit != 'function') {
      throw new Error('options.quit is expected to be a function that closes the app to stop multiple writers');
    }

    let store, input, base, secret, broadcast, ub, loaded = false; // everyone has random publicKeys
    let ix; // your personal index where you collect permanent and temporary public keys of cores
    let index = {}; // the memory of your ix
    let koKeyPair;
    

    

    /*
    global.PUBLICKEY_HEX_LENGTH = 64;
    global.SECRETKEY_HEX_LENGTH = 128;
    global.SEED_HEX_LENGTH = 32;
    */

    class CallerError extends Error {
      constructor(message) {
        super(message);
        if (Error.captureStackTrace) { // Capture stack trace starting from the caller
          Error.captureStackTrace(this, this.constructor);
        }
        this.stack = this.adjustStack(this.stack, message); // Adjust the stack trace to remove the frames related to this constructor
      }
      adjustStack(stack, message) {
        const stackLines = stack.split('\n');
        return 'USERBASE:' + message + '\n' + stackLines.slice(2).join('\n'); // Remove the first two lines (this constructor and the constructor call)
      }
    }

    const aes = {
      key: options.aes.key,
      iv: options.aes.iv,
      en: function(d, key, iv) {
        if (!key) {
          key = aes.key;
          iv = aes.iv;
        }
        let c = forge.rc2.createEncryptionCipher(forge.util.hexToBytes(key));
        c.start(forge.util.hexToBytes(iv));
        c.update(forge.util.createBuffer(d));
        c.finish();
        return c.output.toHex();
      },
      de: function(d, key, iv) {
        if (!key) {
          key = aes.key;
          iv = aes.iv;
        }
        let c = forge.rc2.createDecryptionCipher(forge.util.hexToBytes(key));
        c.start(forge.util.hexToBytes(iv));
        c.update(forge.util.createBuffer(forge.util.hexToBytes(d)));
        c.finish();
        return c.output.data;
      }
    };
    

    



    // main code
    
    try {
      let source = new Hypercore('./db/db', { valueEncoding: 'utf8', createIfMissing: false });
      await source.ready();
      secret = aes.de((await source.get(source.length - 1)).toString('hex')).slice(0, 32);
      console.log('secret:', secret);
      if (secret.length !== 32) secret = undefined;
      options.keyPair = crypto.keyPair(b4a.from(secret));
      await source.close();
      if (options.seeSecret && !await get(options.seeSecret.username)) { // has never logged in
        const pin = secret.substring(0, 3) + secret.substring(secret.length - 3);
        options.seeSecret.send({ secret, pin });
      }
    } catch (e) {
      console.log(e);
    }

    async function restartBase(task, options, reffereeUserName, referralUserName, profile, resolve) {
      if (!options.keyPair) {
        try {
          options.loadingLog('removing userbase ...');
          await fs.rm(`./db/${options.networkName}`, { recursive: true });
        } catch (e) {}
      }
      options.loadingLog(options.keyPair ? 'creating corestore ...' : 'creating ramstore ...');
      store = new Corestore(options.keyPair ? `./db/${options.networkName}` : RAM);
      options.loadingLog('store ready ...');
      await store.ready();
      if (options.keyPair) { // autojar
        options.loadingLog('secure channel setup ...');
        koKeyPair = nextKeyPair(options.keyPair.secretKey);
        options.loadingLog('getting index ...');
        ix = store.get({ keyPair: koKeyPair }); // todo: ko is used for what?
        options.loadingLog('index ready ...');
        await ix.ready();
        options.loadingLog('index updating ...');
        await ix.update();
        if (ix.length) index = JSON.parse(await ix.get(ix.length - 1));
      }
      if (options.loadingFunction) options.loadingFunction();
      options.loadingLog('store get input ...');
      if (options.keyPair) input = store.get({ keyPair: options.keyPair });
      options.loadingLog('store get output ...');
      let output = store.get({ name: 'output' });
      if (options.loadingFunction) options.loadingFunction();
      options.loadingLog('input ready ...');
      if (options.keyPair) await input.ready();
      if (options.loadingFunction) options.loadingFunction();
      options.loadingLog('output ready ...');
      await output.ready();
      options.loadingLog('creating autobase ...');
      base = new Autobase({
        inputs: (options.keyPair)? [input] : [],
        localInput: (options.keyPair) ? input : null,
        localOutput: output
      });
      options.loadingLog('autobase setup ...');
      base.start({
        unwrap: true,
        apply: async function(bee, batch) {
          const b = bee.batch({ update: false });
          for (const node of batch) {
            const op = JSON.parse(node.value.toString());
            if (op.type === 'del') await b.del(op.key);
            else if (!op.value) throw new Error('op has no value');
            else if (op.type === 'put') await b.put(op.key, op.value.toString());
          }
          await b.flush();
        },
        view: core => new Hyperbee(core.unwrap(), {
          extension: false
        })
      });
      options.loadingLog('autobase ready ...');
      if (options.loadingFunction) options.loadingFunction();
      await base.ready();
      options.loadingLog('create manager ...');
      const manager = new AutobaseManager(
        base,
        (key, coreType, channel) => true, // function to filter core keys
        store.get.bind(store), // get(key) function to get a hypercore given a key
        store.storage, // Storage for managing autobase keys
        { id: `./db/${options.networkName}` } // Options
      );
      options.loadingLog('manager ready ...');
      if (options.loadingFunction) options.loadingFunction();
      await manager.ready();
      options.loadingLog('create hyperswarm ...');
      if (typeof router !== 'function') router = require('@ypear/router');
      router = await router({}, { userbase: { store, manager } });
      if ( options.keyPair && router.isYpearRouter) {
        router.updateOptions({
          networkName: options.networkName,
          seed: secret,
          publicKey: options.keyPair.publicKey.toString('hex'),
          quit: options.quit
        });
      }
      if (options.loadingFunction) options.loadingFunction();
      options.loadingLog('joining swarm ...');
      await router.start();
      options.loadingLog('swarm flushing ...');
      let tooLong = setTimeout(function() { options.loadingLog('swarm flushing taking longer ...'); }, 20000);
      if (options.loadingFunction) options.loadingFunction();
      clearTimeout(tooLong);
      options.loadingLog(`performing task ${task} ...`);
      if (task == 'register') {
        options.loadingLog('doing register ...');
        await register(reffereeUserName, referralUserName, profile, resolve);
      }
      else options.loadingLog('');
    }


    
    async function recover(username, secret) {
      return new Promise((resolve) => {
        ;(async function () {
          const keyPair = crypto.keyPair(b4a.from(secret));
          let hasdbdb = false;
          try { 
            await fs.stat('./db/db');
            hasdbdb = true;
          } catch (e) {}
          if (hasdbdb) {
            await fs.rm('./db/db', { recursive: true });
            await base.close();
            router.destroy();
            await restartBase('wait', options); // had to restart it without the local input
          }
          const profile = await lookup(username);
          if (!profile) {
            resolve({ status: 'fail no profile' });
          }
          else {
            console.log(profile);
            const verified = crypto.verify(b4a.from(username), b4a.from(profile.sig, 'hex'), keyPair.publicKey);
            if (!verified) {
              resolve({ status: 'fail verifier' });
            }
            else {
              const source = new Hypercore('./db/db', { valueEncoding: 'utf8' });
              await source.ready();
              await source.append(b4a.from(aes.en(secret)));
              await source.close();
              await base.close();
              router.destroy();
              options.keyPair = keyPair;
              console.log('restartBase');
              await restartBase('wait', options);
              console.log('base restarted');
              // ub.login = login;
              // delete ub.register;
              resolve({ status: 'success', login });
            }
          }
        })();
      });
    }

    

    async function login(pin, username) {
      return new Promise((resolve) => {
        ;(async function (pin, username, resolve) {
          const source = new Hypercore('./db/db', { valueEncoding: 'utf8' });
          await source.ready();
          const secret = aes.de((await source.get(source.length - 1)).toString('hex')).slice(0, 32);
          options.loadingLog(`compairing pin to secret ...`);
          console.log('benz secret:', secret);
          await source.close();
          const keyPair = crypto.keyPair(b4a.from(secret));
          const _pin = secret.substring(0, 3) + secret.substring(secret.length - 3);
          console.log(`benz login secret ${secret} length ${secret.length}`);
          console.log(`benz login pin ${pin} !== ${_pin}`);
          if (pin !== _pin) {
            resolve([{ success: false }, router]);
          }
          else {
            options.loadingLog(`getting profile ...`);
            const profile = await ub.lookup(username);
            if (!profile) {
              console.log('no userbase profile');
              options.quit();
            }
            else {
              const verified = crypto.verify(b4a.from(username), b4a.from(profile.sig, 'hex'), keyPair.publicKey);
              if (!verified) {
                resolve([{ success: false }, router]);
                // when userbase can have detection of empty name hogs autobase will allow profile username over-rights and this protects against
                // an empty name hog from coming back later and taking over a users account
              }
              else {
                router.updateOptions({
                  _userbase: ub,
                  username
                });
                if (options.loadingFunction) options.loadingFunction();
                options.keyPair = keyPair;
                koKeyPair = nextKeyPair(options.keyPair.secretKey);
                await router.knockout(koKeyPair);
                [,broadcast,,] = await router.alow(options.networkName + '-ub', async function handler(d) {
                  if (d.change && d.share) {
                    for (let key in d.share) {
                      if (options.filters
                       && !Object.keys(options.filters).includes(key) 
                       && (options.filterWildCards?.(key))) delete d.share[key];
                    }
                    if (Object.keys(d.share).length) await options.onData(d.change, d.share);
                  }
                });
                loaded = true;
                options.role = username; // autojar
                const hyperdown = nextKeyPair(nextKeyPair(keyPair.secretKey).secretKey);
                options.role = username;
                refresh();
                options.loadingLog(``);
                delete router.start;
                ub = { 
                  username,
                  success: 'success',
                  self: profile,
                  peer: async function(peername) {
                    return await ub.lookup(peername);
                  },
                  showPub: function(publicKey) {
                    return aes.de(publicKey).slice(0, 64); // it is hex so it is x2 longer than buffer 32 byte length
                  },
                  keyPair,
                  secret,
                  index,
                  got: get,
                  put,
                  hyperdown,
                  options,
                  aes,
                  store, // for cacheDB
                  pub, // statuses
                  sub, // statuses watcher
                  unsub,
                  swapPublisher, // to change ownership of a published item
                  upgrade,
                  rename,
                  list,
                  indexOf,
                  sign,
                  lookup,
                  getImages,
                  nextKeyPair,
                  isYpearUserbase: true
                };
                resolve([
                  ub,
                  router
                ]);
              }
            }
          }
        })(pin, username, resolve);
      });
    }

    
  
    async function register(reffereeUserName, referralUserName, profile, resolve) {
      if (options.loadingFunction) options.loadingFunction();
      options.loadingLog(`registering ...`);
      if (!reffereeUserName || !referralUserName || !profile) throw new Error('malformed details');
      else if (!profile._id) throw new Error('profile needs a unique _id');
      else if (reffereeUserName != 'seed' && !await lookup('seed')) throw new Error('seed username needs to exist first');
      else if (reffereeUserName != 'seed' && reffereeUserName == referralUserName) {
        return new Promise((resolve) => resolve(['refferee username cannot be the same as referralUserName']));
      }
      else if (referralUserName != 'seed' && !await lookup(reffereeUserName)) {
        return new Promise((resolve) => resolve(['Ether the refferee username does not exist or the referralUserName exists'])); // ah so seed does exist because we got past register to login and there was a problem b4 shit got saved locally?
      }
      else {
        const already = await lookup(referralUserName);
        let bot = false;
        if (options.botPrevent) bot = await options.botPrevent(lookup, get, reffereeUserName); // check the sponsor and the sponsors sponsor or all of their refs
        if (bot) {
          return new Promise((resolve) => resolve(['Bot accounts are not supported']));
        }
        else if (already?._id == profile._id) { // you can't be your own sponsor!
          return new Promise((resolve) => resolve(['Ether the refferee username does not exist or the referral username exists']));
        }
        else if (!already) {
          options.loadingLog(`has options.keyPair ${!!options.keyPair} ...`);
          if (!options.keyPair) {
            return new Promise((resolve) => {
              ;(async function (reffereeUserName, referralUserName, profile, resolve) {
                await base.close();
                router.destroy();
                options.loadingLog(`has secret ${!!secret} ...`);
                if (!secret) {
                  if (options.entropy) {
                    secret = entropyHex(options.entropy); // for users 16, for coins trim the date console.log(new Date(Number((+new Date() + '').slice(0, 8) + '00000'))) (the date is just 8 long but accurate)
                  }
                  else {
                    secret = options.secret || crypto.randomBytes(16).toString('hex'); // length is 2 x 16 = 32 // todo: coins and seed use this method but users use entropyHex(16)
                  }
                  //                        281474976710656 (281 trillion combinations)
                  // each user could create 408008439348625 unique keyPairs out of 115000000000000000000000000000000000000000000000000000000000000000000
                  options.loadingLog('creating key pair ...');
                  options.keyPair = crypto.keyPair(b4a.from(secret));
                  try { await fs.rm('./db/db', { recursive: true }); } catch (e) {}
                  const source = new Hypercore('./db/db', { valueEncoding: 'utf8' });
                  options.loadingLog('hiding secret ...');
                  await source.ready();
                  await source.append(b4a.from(aes.en(secret)));
                  await source.close();
                  options.loadingLog('secret hidden ...');
                }
                options.loadingLog('restarting base after creating secret ...');
                await restartBase('register', options, reffereeUserName, referralUserName, profile, resolve);
              })(reffereeUserName, referralUserName, profile, resolve);
            });
          }
          else {
            if (options.loadingFunction) options.loadingFunction();
            options.loadingLog('creating userbase profile ...');
            delete ub.register; // function only can be done once!
            profile = {
              ...profile,
              sig:        crypto.sign(b4a.from(profile._id), options.keyPair.secretKey).toString('hex'), // used in userbase.recover
              userbase:   aes.en(options.keyPair.publicKey.toString('hex')),
              ix:         aes.en(nextKeyPair(options.keyPair.secretKey).publicKey.toString('hex')),
              hyperdown:  options.hyperdown ? aes.en(nextKeyPair(nextKeyPair(options.keyPair.secretKey).secretKey).publicKey.toString('hex')) : undefined,
              trunc1:     reffereeUserName == 'seed' ? aes.en(nextKeyPair(nextKeyPair(nextKeyPair(options.keyPair.secretKey).secretKey).secretKey).publicKey.toString('hex')) : undefined, // @new
              trunc2:     reffereeUserName == 'seed' ? aes.en(nextKeyPair(nextKeyPair(nextKeyPair(nextKeyPair(options.keyPair.secretKey).secretKey).secretKey).secretKey).publicKey.toString('hex')) : undefined // @new
            };
            options.loadingLog('adding userbase profile ...');
            await setup(referralUserName, profile);
            ub.login = login;
            const pin = secret.substring(0, 3) + secret.substring(secret.length - 3);
            options.loadingLog('');
            resolve(['success', secret, pin]);
          }
        }
      }
    }

    
    
    await restartBase('wait', options);
    
    console.log('userbase done?');
    
    
    






































    // Methods
    async function refresh(change, key) { // pushed to everyone
      let share = {};
      if (!key) {
        for (const k in index) {
          if (index[k].role == options.role) share[k] = { publicKey: index[k].publicKey, role: options.role };
        }
      }
      else share[key] = index[key];
      await broadcast({ change, share });
    }

    /*
    put function
    - More complex and feature-rich than pub
    - Supports read-only cores with encryption keys
    - Handles special cases for certain keys (like 'seed')
    - Updates the main index and optionally notifies peers
    - Supports upgrading from read-only to writable cores
    - Handles special cases for user profiles
    - Truncates both the index and the core if they grow too large
    */
    async function put(key, value, aesKey, aesIv, dataEvent) { // can only be done by you for you ... 
      let core, keyPair;
      if (index[key]) { // locate
        if (index[key].role != options.role) return null;
        if (index[key].readOnly) {
          keyPair = {
            publicKey: b4a.from(aes.de(index[key].publicKey).slice(0, 64), 'hex'),
            secretKey: b4a.from(aes.de(index[key].secretKey, aesKey, aesIv).slice(0, 128), 'hex')
          };
        }
        else {
          keyPair = {
            publicKey: b4a.from(aes.de(index[key].publicKey).slice(0, 64), 'hex'),
            secretKey: b4a.from(aes.de(index[key].secretKey).slice(0, 128), 'hex')
          };
          if (aesKey) { // upgrading because we now have the aes #moved
            index[key] = {
              publicKey: aes.en(keyPair.publicKey.toString('hex')),
              secretKey: aes.en(keyPair.secretKey.toString('hex'), aesKey, aesIv),
              role: options.role,
              readOnly: true
            };
          }
        }
        core = await store.get({ keyPair });
        await core.ready();
      }
      else {
        keyPair = crypto.keyPair(); // create a new location on the store
        core = await store.get({ keyPair });
        await core.ready();
        index[key] = {
          publicKey: aes.en(keyPair.publicKey.toString('hex')),
          secretKey: aes.en(keyPair.secretKey.toString('hex'), aesKey, aesIv), // (aes may be blank) users monitor empty users that may be created by a hacker ...
          role: options.role,
          readOnly: !!aesKey
        };
      }
      // upgrading #moved (originally here)
      if (key == options.role && !!aesKey && !index['keyPair']) { // is maybe a hacker/bot
        index['keyPair'] = {
          secretKey: aes.en(nextKeyPair(options.keyPair.secretKey).secretKey.toString('hex')), // empty user's index
          publicKey: aes.en(nextKeyPair(options.keyPair.secretKey).publicKey.toString('hex'))
        };
      }
      else if (aesKey) delete index['keyPair']; // not a hacker/bot
      //
      //
      //
      // lets see if the seed is still getable in a really weak net with almost no users ...
      if (key == 'seed') { // @new
        const trunc1 = nextKeyPair(nextKeyPair(nextKeyPair(options.keyPair.secretKey).secretKey).secretKey);
        const t1 = await store.get({ keyPair: trunc1 });
        await t1.ready();
        await t1.append(JSON.stringify(index));
        if (t1.length > 500) t1.truncate(50);
        await t1.close();
        if (value == key) {
          const trunc2 = nextKeyPair(nextKeyPair(nextKeyPair(nextKeyPair(options.keyPair.secretKey).secretKey).secretKey).secretKey);
          const t2 = await store.get({ keyPair: trunc2 });
          await t2.ready();
          await t2.append(JSON.stringify(value));
          if (t2.length > 500) core.truncate(50);
          await t2.close();
        }
      }
      //
      //
      //
      await ix.append(JSON.stringify(index)); // update your ix for others to find your index
      if (ix.length > 50) ix.truncate(1); // clears the core leaving the last item
      await core.append(JSON.stringify(value)); // put the new data into your new location
      if (core.length > 50) core.truncate(1); // clears the core leaving the last item
      await core.close();
      if (dataEvent) await refresh(change, key);
    };



    async function get(username, key) { // we dont need to index each others indexes because we know them!
      if (!key) key = username; // you can get your own index
      let res = null;
      if (username == options.role) { // your own data
        let publicKey = index[key]?.publicKey;
        if (!publicKey) return res;
        publicKey = aes.de(publicKey).slice(0, 64);
        let core = await store.get({ key: b4a.from(publicKey, 'hex') });
        await core.ready();
        await core.update();
        if (core.length) res = JSON.parse(await core.get(core.length -1));
        await core.close();
        return res;
      }
      else { // other users data
        const stack = new CallerError('@ get').stack;
        const er = setTimeout(function () {
          console.log('Autobase Error:', { stack, ball, args: [username, key] });
        }, 60000);
        let ball = 'bounces?';
        const peer = await indexOf(username, stack, ball);
        clearTimeout(er);
        if (key == 'keyPair') return res;
        let publicKey = peer?.[key]?.publicKey;
        if (!publicKey) return res;
        publicKey = aes.de(publicKey).slice(0, 64);
        res = await tryCore(publicKey, 0, stack, ball, username == 'seed' ? await lookup(username) : undefined, username == key ? 'profile' : 'other'); // loop n tries if core length == 0 n++ // @new
        return res;
      }
    }



    /*
    pub function
    - Creates a new core or uses an existing one for a specific key
    - Can only store one value/object per core (overwrites previous value/object)
    - Uses Hyperbee for storage, which allows for the on('update') event subscription
    - Returns the stored value when called without a value parameter
    - Truncates the core if it grows too large (> 50 entries)
    - Primarily designed for data that needs to be subscribed to via the sub function
    */
    async function pub(key, value) { // can only store one value per core
      let keyPair;
      if (!index[key]) {
        keyPair = crypto.keyPair(); // create a new location on the store
        index[key] = {
          publicKey: aes.en(keyPair.publicKey.toString('hex')),
          secretKey: aes.en(keyPair.secretKey.toString('hex')),
          role: options.role,
          readOnly: false
        };
        await ix.append(JSON.stringify(index)); // update your ix for others to find your index
      }
      else {
        keyPair = {
          publicKey: b4a.from(aes.de(index[key].publicKey).slice(0, 64), 'hex'),
          secretKey: b4a.from(aes.de(index[key].secretKey).slice(0, 128), 'hex')
        };
      }
      let core = await store.get({ keyPair });
      await core.ready();
      const db = new Hyperbee(core); // the only reason we use this is for the on('update)
      await db.ready();
      if (!value) { // returns the key instead
        value = await db.get(key);
        if (value) { // else null
          value = value.value.toString();
          if (['{', '['].includes(value[0])) value = JSON.parse(value); // json
        }
        return value;
      }
      else {
        if (typeof value == 'object') value = JSON.stringify(value);
        await db.put(key, value);
        if (core.length > 50) {
          core.truncate(1); // clears the core leaving the last item
        }
      }
    };

    const subs = {};

    async function unsub(username, key) {
      await subs[username + '/' + key].close();
      delete subs[username + '/' + key];
    }

    async function sub(username, key, onUpdate, n) {
      const stack = new CallerError('@ sub').stack;
      const er = setTimeout(function () {
        console.log('Autobase Error:', { stack, ball, args: [username, key, onUpdate, n] });
      }, 60000);
      let ball = 'bounces?';
      return new Promise((resolve) => {
        ;(async function () {
          if (!n) n = 1;
          const peer = await indexOf(username, stack, ball);
          clearTimeout(er);
          let publicKey = peer?.[key]?.publicKey;
          if (!publicKey) return null;
          publicKey = b4a.from(aes.de(publicKey).slice(0, 64), 'hex');
          let db;
          async function watching() {
            subs[username + '/' + key] = await db.watch();
            subs[username + '/' + key].on('update', async function () {
              onUpdate(await getUpdate());
            });
          }
          async function getUpdate() {
            let res;
            res = await db.get(key);
            if (res.value) { // else null
              res = res.value.toString();
              if (['{', '['].includes(res[0])) res = JSON.parse(res); // json
            }
            return res;
          }
          async function again() {
            let core = await store.get({ key: publicKey });
            await core.ready();
            await core.update();
            db = new Hyperbee(core); // the only reason we use this is for the on('update)
            await db.ready();
            await db.update();
            if (!core.length) {
              if (n > 20) {
                await watching();
                onUpdate({});
                resolve({});
              }
              else {
                await db.close(); // closes the core also
                await pause(1000);
                n++;
                await again();
              }
            }
            else {
              await watching();
              const res = await getUpdate();
              onUpdate(res);
              resolve(res);
            }
          }
          await again();
        })();
      });
    }


    const lookup = async function(key, stack, ball) {
      await base.latest(base.inputs);
      await base.view.update({ wait: true });
      if (!stack) {
        stack = new Error(`Error lookup(${key}):`).stack;
        const er = setTimeout(function () {
          console.log('Autobase Error:', { stack, ball: '!bounces', args: [key] });
        }, 60000);
        key = await base.view.get(key);
        clearTimeout(er);
      }
      else key = await base.view.get(key);
      if (key == 'del') return null; // b/c real del was leaving behind old profiles + the tombstone
      if (!key) return key;
      key.value = key.value.toString();
      if (['[', '{'].includes(key.value[0])) return JSON.parse(key.value);
      return key.value;
    };

    const setup = async function(key, value) {
      const op = b4a.from(JSON.stringify({ type: 'put', key, value: JSON.stringify(value) }));
      await base.append(op);
      await base.view.update({ wait: true });
      await base.latest(base.inputs);
    };

    const _del = async function(key) {
      const op = b4a.from(JSON.stringify({ type: 'put', key, value: 'del' }));
      // const op = b4a.from(JSON.stringify({ type: 'del', key })); // this keeps the last put intact but also adds an empty tombstone (can other users now use this key/value a register or is it fudged!?)
      await base.append(op);
      await base.view.update({ wait: true });
      await base.latest(base.inputs);
    };


    function entropyHex(m) {
      if (typeof m !== 'number' || m < 0) m = 0; // normalize
      let d = (+new Date()) + ''; // '1708891062610'.length == 13
      d = d.split('').reverse().join('');
      if (m) d = d.slice(0, m); // raise the m number to lower the minimum length of the timestamp giving more space to the bytes
      let h = (crypto.randomBytes(3).toString('hex')) + d + (crypto.randomBytes(29).toString('hex'));
      return h.slice(0, 32); // something like fde1708891062610ae43b6043ef1bcbd
    }

    function nextKeyPair(secretKey) { // if every user user has 3 keyPairs there would be 115000000000000000000000000000000000000000000000000000000000000000000 combinations (one hundred fifteen unvigintillion)
      let md = forge.md.sha256.create();
      md.update(secretKey.toString('hex')); // creates a new seed
      return crypto.keyPair(b4a.alloc(32, md.digest().toHex())); // a predetermined, unique and recoverable keyPair
    }

    
    
    async function pause(milliseconds) {
      return new Promise(async (resolve) => {
        setTimeout(resolve, milliseconds);
      });
    }

    async function getImages(username) { // autojar
      const peerIx = await indexOf(username);
      let images = {};
      for (const key in peerIx) {
        if (key.includes('.png')) {
          images[key] = await get(username, key);
        }
      }
      return images;
    }

    

    
    async function swapPublisher(username, key) { // this is for when someone else takes over the role of another (only used after the previous user no longer has this role)
      // needs protection
      const stack = new CallerError('@ swapPublisher').stack;
      const er = setTimeout(function () {
        console.log('Autobase Error:', { stack, ball, args: [username, key]});
      }, 60000);
      let ball = 'bounces?';
      const peer = await indexOf(username, stack, ball);
      clearTimeout(er);
      if (key == 'keyPair') return null;
      const publicKey = peer?.[key]?.publicKey;
      if (!publicKey) return false;
      const secretKey = peer[key].secretKey;
      let keyPair = {
        publicKey: b4a.from(aes.de(publicKey).slice(0, 64), 'hex'), // locate the old op's service
        secretKey: b4a.from(aes.de(secretKey).slice(0, 128), 'hex')
      };
      index[key] = {
        publicKey: aes.en(keyPair.publicKey.toString('hex')), // become the new op (pass-the-parcel) todo: needs auth and needs to be sent away to someone else
        secretKey: aes.en(keyPair.secretKey.toString('hex')),
        role: options.role,
        readOnly: false
      };
      await ix.append(JSON.stringify(index)); // update your ix for others to find your index
      refresh(key);
      return true;
      // this allows everyone to stay subscribed without moving the data to a new core
    }



    
    async function tryCore(publicKey, n, stack, ball, isSeed, coreType, done) { // @new
      // todo: done is allways false
      // is done even needed ?
      return new Promise((resolve) => {
        async function retry(publicKey, n, stack, ball, isSeed, coreType, done) {
          console.log('retry', n, coreType);
          let res = null;
          if (n > 20) {
            if (!done) {
              done = true;
              resolve(res);
            }
          }
          else {
            ball = new Error().stack;
            const er = setTimeout(async function (publicKey, n, stack, ball, isSeed, coreType, done) {
              console.log('Autobase Error:', { stack, ball });
              if (!isSeed) { // @new
                if (coreType == 'index') publicKey = aes.de(isSeed.trunc1).slice(0, 64);
                else if (coreType == 'profile') publicKey = aes.de(isSeed.trunc2).slice(0, 64);
                res = await retry(publicKey, n + 1, stack, ball, isSeed, coreType, done); // @new
                if (!done) {
                  done = true;
                  resolve(res);
                }
              }
            }, 60000, publicKey, n, stack, ball, isSeed, coreType, done);
            let core = await store.get({ key: b4a.from(publicKey, 'hex') });
            await core.ready();
            await core.update();
            ball = new Error().stack;
            if (core.length) res = JSON.parse(await core.get(core.length -1));
            clearTimeout(er);
            await core.close();
            if (!res) {
              await pause(1000);
              ball = new Error().stack;
              res = await retry(publicKey, n + 1, stack, ball, isSeed, coreType, done); // @new
            }
            if (!done) {
              done = true;
              resolve(res);
            }
          }
        };
        retry(publicKey, n, stack, ball, isSeed, coreType, done);
      });
    }

    async function indexOf(username, stack, ball) {
      let peer;
      if (!stack) {
        stack = new Error('@ indexOf').stack;
        const er = setTimeout(function () {
          console.log('Autobase Error:', { stack, ball, username });
        }, 60000);
        ball = 'bounces?';
        peer = await ub.lookup(username, stack, ball);
        clearTimeout(er);
      }
      else {
        ball = new Error().stack;
        peer = await ub.lookup(username, stack, ball);
      }
      if (!peer) return null;
      const publicKey = aes.de(peer.ix).slice(0, 64);
      ball = new Error().stack;
      return await tryCore(publicKey, 0, stack, ball, username == 'seed' ? peer : undefined, 'index'); // loop n tries if core length == 0 n++ // @new
    }



    async function rename(oldKey, newKey) {
      if (!index[oldKey]) return;
      else {
        oldKey = JSON.parse(JSON.stringify(index[oldKey]));
        index[newKey] = oldKey;
        delete index[oldKey];
        await ix.append(JSON.stringify(index));
      }
    }

    
    
    /**
     * Upgrades a user profile while preserving their data
     * 
     * This function handles the process of migrating from an old profile to a new one
     * by updating the stored profile, adjusting the index references, and cleaning up
     * the old profile data.
     * 
     * @param {Object} newProfile - The updated user profile to migrate to
     * @param {Object} oldProfile - The current user profile to migrate from
     * @param {Function} fixIndexFunction - A function that updates index references
     *        This function receives (oldProfile, newProfile, currentIndex) and should
     *        return the updated index with all necessary reference changes
     * @returns {Promise<void>} - Resolves when the upgrade is complete
     */
    async function upgrade(newProfile, oldProfile, fixIndexFunction) {
      await setup(newProfile._id, newProfile); // The setup function in the upgrade function stores the new profile in the database under the new profile ID, essentially establishing the new user identity in the system.
      index = fixIndexFunction(oldProfile, newProfile, index); // The fixIndexFunction within the upgrade function updates all references in the index from the old profile to the new profile, ensuring data continuity when a user's identity changes.
      await ix.append(JSON.stringify(index)); //  persists the updated index to the user's hypercore. It converts the modified index (which contains the updated references from old profile to new profile) to a JSON string and appends it as a new block in the append-only log, making the profile changes permanent and visible to other peers in the network.
      await _del(oldProfile._id); // removes the old profile data from the database after the migration is complete. This cleanup step prevents duplicate profiles and ensures that only the new profile remains in the system, while the updated index (which was already saved) maintains all the user's data references now pointing to the new profile ID.
    }

    async function sign(what) {
      return crypto.sign(b4a.from(what), options.keyPair.secretKey).toString('hex');
    }
    
    async function list() {
      const search = base.createReadStream();
      const list = {};
      for await (let entry of search) {
        entry = JSON.parse(entry.value.toString());
        list[entry.key] = entry.value; // used to be entry type (b/c we were deleting them but that leaves there old account intact [[[AND]]] a tombstone)
        if (list[entry.key] == 'del') delete list[entry.key];
      }
      return Object.keys(list);
    }

    async function botDelete(botName, my, is) {
      const stack = new CallerError('@ botDelete').stack;
      const er = setTimeout(function () {
        console.log('Autobase Error:', { stack, ball, args: [botName, my, is] });
      }, 60000);
      let ball = 'bounces?';
      let botIx = await indexOf(botName, stack, ball);
      clearTimeout(er);
      let refs = [];
      if (botIx.keyPair) {
        refs = (await get(botName)).refs; // value from key
        await _del(botName); // overwrite the userbase profile
        const botIxKeyPair = {
          publicKey: b4a.from(aes.de(botIx.keyPair.secretKey).slice(0, 64), 'hex'),
          secretKey: b4a.from(aes.de(botIx.keyPair.secretKey).slice(0, 128), 'hex')
        };
        delete botIx.keyPair;
        for (let core of botIx) { // loop and load each core in the index and purge it
          core = await store.get({ 
            keyPair: {
              publicKey: b4a.from(aes.de(core.publicKey).slice(0, 64), 'hex'),
              secretKey: b4a.from(aes.de(core.secretKey/*, aesKey, aesIv*/).slice(0, 128), 'hex') // if it is a bot it is not read only
            }
          });
          await core.ready();
          await core.purge();
        }
        botIx = await store.get({ keyPair: botIxKeyPair });
        await botIx.ready();
        await botIx.purge(); // purge the index
        for (const ref of refs) {
          let profile = await lookup(ref);
          profile.spon = my._id;
          await setup(ref, profile);
        }
        if (refs?.length) {
          my.cache.refs = my.cache.refs.concat(refs);
          await is.decached();
        }
      }
    }





    ub = { 
      isYpearUserbase: true,
      lookup,
      getImages,
      close: base.close,
      recover,
      nextKeyPair
    };



    if (!options.keyPair) {
      resolve({
        ...ub,
        register
      });
    }
    else {
      resolve({
        ...ub,
        login,
        list,
        botDelete
      });
    }

    
  });
};

module.exports = ypearUserbase;
