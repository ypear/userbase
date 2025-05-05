# <img src="https://github.com/benzmuircroft/temp/blob/main/Yjs.png" height="32" style="vertical-align:40px;"/>🍐@ypear/userbase 😀


## 💾 Installation
```bash
npm install @ypear/userbase
```

## 👀 Description
An autobase converted into a invite only registration, login and recovery system. Each user has a profile and can publish informaton to the undelying Corestore. Users can also list each other and look to see what other users have published. Single user instance is enforced.



## 🤯 Gotchas
- The `userbase` takes a `router` that has not been `started`

- The `router` will automatically replicate the `userbase`'s `corestore`

- The first user added to a new network must register with `referrer: 'seed', username: 'seed'`, the second must have `referrer: 'seed'`, afterwhich users may start using existing users as thier referrer

- The first user can have a preset `options.seed` if you want

- `seed` and `secret` are both interchangable names (the users will know it as `seed`, but interally in holepunch it is referred to as a `seed` in thier code)

- A users `pin` in the first three and last three digets of the user's `secret`

- When testing, please remember to have at least the seed or another user online when creating a new user, otherwise the new user will not see the network

- `is.put`/`is.got` are for updating your profile and `is.pub`/`is.sub` is for data that is not in your profile but will be indexed by your profile so that other users can find it 

- `userbase` will update all subscribed users on any `userbase.put` if `dataEvent` is true. To subscribe to a prfile put; run `is.options.filters = ['username1', 'username2' ...];` after login and the `onData` event will fire for any of those profile changes 


## ✅ Usage
To test userbase and get used to the concept we are going to simulate multiple users on seperate devices

This test will be in this folder structure:

![image](https://github.com/user-attachments/assets/ae401844-9814-484f-9528-cea89f305159)

```javascript
const userbaseExample = module.exports = async function() {
  return new Promise(async (resolve) => {

    const loading = {
      steps: 10,
      stage: 0,
      outcome: true,
      more: function(done) {
         loading.stage ++;
         // send to client-side: { n: loading.stage * loading.steps, outcome: loading.outcome, done };
      }
   };
  
   loading.more();
  
  
  
  
   let router = require('@ypear/router'); // userbase will upgrade this later several times so it must be 'let'
  
   let seeSecret = false; // should be true but we have no ui here

   const options = {
      networkName: 'very-unique-4898n0aev7e7egigtr', // pick a unique name
      aes: { // choose your own aes key and iv for your app
         key: '581cecab27fc7724a871f9a5dc26030db03b6d9d850058c7b106497544415989', // keep same for all users!
         iv: '143cc663df5fb41611e0e4365b3c0e45', // keep same for all users!
      },
      entropy: 16,
      seeSecret: !seeSecret ? undefined : {
         username: seeSecret,
         send: function(data) { // user must never have logged in after join but never recieved their secret due to network/connection issue
         // your method to send the data to the client-side goes here ...
      }},
      // hyperdown: true, // forces the creation of hyperdown secrets like it does with userbase secrets
      quit: () => { throw 'quit'; }, // should be app.quit wrapper function passed from main.js
      loadingLog: function(log) {
         console.log('loading bar:', log); // send loading information to the client-side
      },
      loadingFunction: function() {
         loading.more();
      },
      onData: async function(change, data) { 
         if (loading.outcome == 'done'/* && is.options.filters.includes(change)*/) {
            // users could detect maintenance on/off for users that may have roles
            console.log('tester got some data:', data, 'on change:', change);
         }
      },
      botPrevent: async function(lookup, get, sponsor) { // prevent name hogging
         return false; // see: #botPreventExample
      }
   };

   const userbase = await require('@ypear/userbase')(router, options});
  
  loading.outcome = userbase.register ? 'join': undefined; // if they need to register still
  console.log('loading outcome?', loading.outcome);
  
  loading.more();
  
  
  
  
  
  
    async function recover(d) { // would be sent from the client-side
      const recovery = await userbase.recover(d.username, d.secret); // 'fail no profile' | 'fail verifier' | 'success'
      if(recovery.status == 'success') {
         delete userbase.register;
         userbase.login = recovery.login;
      }
      return recovery.status;
      // you need to send the succes result back to the client-side
    }
  
  
  
  
    let register;
    if (loading.outcome == 'join') {
      register = async function(d) {
        d = {
          referrer: d.referrer,
          username: d.username
        };
        loading.steps = 10;
        loading.stage = 0;
        loading.more = function(done) {
          loading.stage ++;
          // send this to the client-side { n: (loading.stage * 100) / loading.steps, done };
        };
        const profile = {
          _id: d.username,
          spon: d.referrer,
          fp: global.fingerprint // you can use a device fingerprint lib to detect bots
        }
        const [success, secret, pin] = await userbase.register(profile.spon, profile._id, profile);
        // send this to the client-side { fail: (success != 'success'), secret, pin, report: success };
        return { fail: (success != 'success'), secret, pin, report: success };
      };
    }
  
  
  
  
  
  
    async function login(d) {
      let login;
      d = {
         username: d.username,
         pin: d.pin
      };
      loading.steps = 4;
      loading.stage = 0;
      loading.outcome = true;
      loading.more = function(done) {
         loading.stage ++;
         // send to client-side { n: (loading.stage * 100) / loading.steps, outcome: loading.outcome, done };
      };
      [login, router] = await userbase.login(d.pin, d.username);
      if (login.success != 'success') {
         // reply to client-side { fail: true, report: login.success }
         console.trace({ fail: true, report: login.success });
      }
      else {
         const store = login.store;
         global.hide = login.aes.en;    // local encryption
         global.show = login.aes.de;    // local decryption
         // methods for the user's utilization
         is = {
            aPublicKey:   login.showPub,   // enforce the correct publicKey decrypted length so-as-to not make mistakes
            // hyperdown:    login.hyperdown, // keyPair for events
            options:      login.options,
            peer:         login.peer,      // is.peer(peerid), it finds users userbase imutable profile objects
            got:          login.got,       // await is.got(key) or await is.got(username, key)
            put:          login.put,       // await is.put(key, val)
            pub:          login.pub,       // await is.pub(key, val)
            sub:          login.sub,       // await is sub(username, key, (update) => {});
            unsub:        login.unsub      // await is.unsub(username, key);
            // botBounty
         };
         is.locked = async function(str, key, iv) {
            return global.hide(str, key || is.aPublicKey(my.self.userbase), iv || my.secret);
         };
         is.unlocked = async function(str, key, iv) {
            return global.show(str, key || is.aPublicKey(my.self.userbase), iv || my.secret);
         };
         // the user:
         my = {
            _id:        login.username,  // string connected to your userbase input
            self:       login.self,      // like my.peer ...
            index:      login.index,     // records of your extra objects
            secret:     login.secret,    // string 32 length
            list:       userbase.list
         };
         my.cache = await is.got(my._id); 
         is.decached = async function() { // save your cache but, personally encrypt it so only you can recover it
            await is.put(
               my._id,                                                                 // key: username
               my.cache,                                                               // value: object
               my.cache.bot ? undefined : is.aPublicKey(my.self.userbase),             // secretKey will be privatly encrypted by this user
               my.cache.bot ? undefined : my.secret                                    // secretKey will be privatly encrypted by this user
            );
         };
         // the user's current state
         const network = await is.got('seed'); // ment for users to see after the seed user is created
         if (!my.cache) {
         my.cache = { // set profile for the first time
            genesis: +new Date(),
            activeOn: +new Date(),
            bot: true, // todo: change this when the user has human activity so that their account becomes protected.
            refs: [], // team
            anything: {},
            vol: 0.5, // things like setting volume
            sex: 'm',
            bg: '', // background ?
            base: 'btc'
         };
         await is.decached();
         }
         else {
         my.cache.activeOn = +new Date(); // we don't save here, instead we wait to see if the user does something un bot like ... // todo: maybe move to close but they must do something
         }
         // ... the user is logged in now (load your app stuff) ...
         console.log({
          //, store,
          seed: network,
          my, 
          is
         }, '... the user is logged in now (load your app stuff) ...');
      }
    }
  
    resolve([
      register,
      recover,
      login
    ]);
  });
};

```
Using the example (./ub1/createSeed.js):
```javascript
(async () => {
  const [ register, recover, login ] = await require('../userbaseExample')();

  if (typeof register == 'function') {
    console.log('new user registering');
    console.log(await register({ referrer: 'seed', username: 'seed' }));
    /* prints something similar to:
    HypercoreError: STORAGE_EMPTY: No Hypercore is stored here
    at Core.resume (/home/benz/Desktop/vite/hypear/ypear/userbase/node_modules/hypercore/lib/core.js:91:15)
    at async Core.open (/home/benz/Desktop/vite/hypear/ypear/userbase/node_modules/hypercore/lib/core.js:56:14)
    at async Hypercore._openCapabilities (/home/benz/Desktop/vite/hypear/ypear/userbase/node_modules/hypercore/index.js:385:17)
    at async Hypercore._openSession (/home/benz/Desktop/vite/hypear/ypear/userbase/node_modules/hypercore/index.js:327:7) {
      code: 'STORAGE_EMPTY'
    }
    loading bar: removing userbase ...
    loading bar: creating ramstore ...
    loading bar: store ready ...
    loading bar: store get input ...
    loading bar: store get output ...
    loading bar: input ready ...
    loading bar: output ready ...
    loading bar: creating autobase ...
    loading bar: autobase setup ...
    loading bar: autobase ready ...
    loading bar: create manager ...
    loading bar: manager ready ...
    loading bar: create hyperswarm ...
    loading bar: joining swarm ...
    true is synced at start?
    loading bar: swarm flushing ...
    loading bar: performing task wait ...
    loading bar: 
    userbase done?
    loading outcome? join
    register: [AsyncFunction: exampleRegister]
    loading bar: registering ...
    loading bar: has options.keyPair false ...
    loading bar: has secret false ...
    loading bar: creating key pair ...
    loading bar: hiding secret ...
    loading bar: secret hidden ...
    loading bar: restarting base after creating secret ...
    loading bar: creating corestore ...
    loading bar: store ready ...
    loading bar: secure channel setup ...
    loading bar: getting index ...
    loading bar: index ready ...
    loading bar: index updating ...
    loading bar: store get input ...
    loading bar: store get output ...
    loading bar: input ready ...
    loading bar: output ready ...
    loading bar: creating autobase ...
    loading bar: autobase setup ...
    loading bar: autobase ready ...
    loading bar: create manager ...
    loading bar: manager ready ...
    loading bar: create hyperswarm ...
    loading bar: joining swarm ...
    true is synced at start?
    loading bar: swarm flushing ...
    loading bar: performing task register ...
    loading bar: doing register ...
    loading bar: registering ...
    loading bar: has options.keyPair true ...
    loading bar: creating userbase profile ...
    loading bar: adding userbase profile ...
    loading bar: 
    {
      fail: false,
      secret: '411de272146587654711068e015e2184', <<<< yours will be different (save it)
      pin: '411184',                              <<<< yours will be different (save it)
      report: 'success'
    }
    */
  }
  else { // on second run of this script we login
    const username = 'seed';
    const pin = '411184'; // your pin generated in step one
    console.log(await login({ username, pin }));
    /*
    secret: 411de272146587654711068e015e2184
    loading bar: creating corestore ...
    loading bar: store ready ...
    loading bar: secure channel setup ...
    loading bar: getting index ...
    loading bar: index ready ...
    loading bar: index updating ...
    loading bar: store get input ...
    loading bar: store get output ...
    loading bar: input ready ...
    loading bar: output ready ...
    loading bar: creating autobase ...
    loading bar: autobase setup ...
    loading bar: autobase ready ...
    loading bar: create manager ...
    loading bar: manager ready ...
    loading bar: create hyperswarm ...
    loading bar: joining swarm ...
    true is synced at start?
    loading bar: swarm flushing ...
    loading bar: performing task wait ...
    loading bar: 
    userbase done?
    loading outcome? undefined
    loading bar: compairing pin to secret ...
    loading bar: getting profile ...
    loading bar: knocking out other account instances ...
    Client errored: DHTError: PEER_NOT_FOUND: Peer not found
        at findAndConnect (/home/benz/Desktop/vite/hypear/ypear/userbase/node_modules/hyperdht/lib/connect.js:350:74)
        at async connectAndHolepunch (/home/benz/Desktop/vite/hypear/ypear/userbase/node_modules/hyperdht/lib/connect.js:181:3) {
      code: 'PEER_NOT_FOUND'
    }
    false
    server listen: cdf11ea847333a04e372387d391f0fd24a51aedbcbbc6d9157125a700e8c9d1d
    loading bar: creating dht server ...
    loading bar: dht server ready ...
    loading bar: dht server listening ...
    loading bar: 
    {
      my: {
        _id: 'seed',
        self: {
          _id: 'seed',
          spon: 'seed',
          sig: '48c61f7368ac7422125b4cf572df8e292de87d1dfc20e7d8b60c1cdbc45b0fdb11552d89d90a8ab035984924f15f8f49098dee0ae05a9fad43966790443eb007',
          userbase: 'eccacefcd4e8212ec00dcf157d6c01e85903aa19426fd490758052283cf970828414db82e4883ed9ab6fe261536450c5f8f54c2e795ad508c6db84b00305fb59d5ac409b302ede0f',
          ix: 'af42031f30d16baceb905605d46bb0d20ab1aca1e26b38c83a5e2a5c10f57dc96d099b120ad91dff0c68901ee6b26373ee105ad7c05075676f1912af965fdade7784b0f797941b16',
          trunc1: 'ee9c85f49f84047a0b2b04871445d8bb3cbab9cee16b3ec41b2195e28612c214af99132ae395798aa3342f9e85b3a5618c3c91a8a83e1391bef38329cd41933efcd3ce46b8a728cf',
          trunc2: '548e61a7a0bb288930b7b4b4e556193237206c439af27f1c6587c3dbedb5289b7db34a5c3143aee1e7f682e960412181a597b67be89158800d8cccdafdb00ab671f86ae260b7a508'
        },
        index: { seed: [Object] },
        secret: '411de272146587654711068e015e2184',
        list: [AsyncFunction: list],
        cache: {
          genesis: 1745678787544,
          activeOn: 1745678787544,
          bot: true,
          refs: [],
          anything: {},
          vol: 0.5,
          sex: 'm',
          bg: '',
          base: 'btc'
        }
      },
      is: {
        aPublicKey: [Function: showPub],
        options: {
          networkName: 'myApp-example-123',
          aes: [Object],
          entropy: 16,
          seeSecret: undefined,
          quit: [Function: quit],
          loadingLog: [Function: loadingLog],
          loadingFunction: [Function: loadingFunction],
          onData: [AsyncFunction: onData],
          botPrevent: [AsyncFunction: botPrevent],
          keyPair: [Object],
          role: 'seed'
        },
        peer: [AsyncFunction: peer],
        got: [AsyncFunction: get],
        put: [AsyncFunction: put],
        pub: [AsyncFunction: pub],
        sub: [AsyncFunction: sub],
        locked: [AsyncFunction (anonymous)],
        unlocked: [AsyncFunction (anonymous)],
        decached: [AsyncFunction (anonymous)]
      }
    } ... the user is logged in now (load your app stuff) ...
    */
  }

})();
```
Now keep the above code running and copy it as ./ub2/createUser.js:
```javascript
(async () => {
  const [ register, recover, login ] = await require('../userbaseExample')();
  const fs = require('fs').promises;
  const process = require('process');


  /**
   * Note: you need to load this script 4 times (the seed should still be running in another terminal)
   * 
   * 1. Run with recovery false and alice's seed and pins blank (as she's a new user) she will be registered!
   * 2. Run with recovery false and alice's seed and pins updated with the details provided in step 1 because
   *    she will login!
   * 3. Run with recovery true because she is going to loose her device (her ./db folder will be deleted)
   * 4. Run with recovery true because shes going to recover her account from the seed and then she will login!
   */

  let recovery = false;
  let exists;

  try {
    await fs.access('./db'); // before step 1 and after step 3 this will be missing but then recreated on step 4   
    exists = true;
  }
  catch (e) {
    exists = false;
  }

  if (typeof register == 'function' && !recovery) {                         // 1
    console.log('new user registering');
    console.log(await register({ referrer: 'seed', username: 'alice' }));
  }
  else if (typeof login == 'function' && !recovery()) {                     // 2
    const username = 'alice';
    const pin = 'f9d495'; // your pin generated in step one
    console.log(await login({ username, pin }));
  }
  else if (recovery && exists) {                                            // 3
    await fs.rm('./db', { recursive: true, force: true });
    console.log('On no! I threw my device in a lake!');
    process.exit(0);
  }
  else if (recovery) {                                                      // 4
    const username = 'alice';
    const secret = 'f9d24a98256168654715ab1c33674495';
    recovery = await recover({ username, secret });
    setTimeout(async () => {
      const username = 'alice';
      const pin = 'f9d495'; // your pin generated in step one
      console.log(await login({ username, pin }));
    }, 1000);
  }
  else {                                                                    // derp!
    throw new Error('you did something wrong in the setup script.');
  }

})();
```


## 🧰 Methods
Before registration or recovery:
```javascript
isYpearUserbase: true,
lookup,
getImages,
close: base.close,
recover,
nextKeyPair
register
```
Before login:
```javascript
isYpearUserbase: true,
lookup,
getImages,
close: base.close,
recover,
nextKeyPair
login,
list,
botDelete
```
After login:
```javascript
isYpearUserbase: true,
username,
success: 'success',
self: profile,
peer,
showPub,
keyPair,
secret,
index,
get,
put,
// hyperdown,
options,
aes,
store,
pub, // statuses
sub, // statuses watcher
unsub,
swapPublisher, // to change ownership of a published item
upgrade,
rename,
list,
indexOf,
sign
```

## 📜 Licence
MIT


# todo:

- let put use pub and take away onData

- reduce the api with a proxy

- get the loading bar to end at 100%
 
