# CloakCord

Discord bot to track other servers

## First launch

```java
npm i
```

```java
node init
```

then fill src > configs > guild_whitelist.json with data

  also you need to fill .env (will be create automaticaly)

  ```java
node upload
```

To upload data from **guild_whitelist.json** into **Dataabe**

  Launch ```node index```

## Memory

Memory growth was caused by unbounded member and user caches in the library
(it forces all intents for user accounts). Fixed in v1.6.1 with cache limits.
Investigation, fix and verification procedure: [docs/MEMORY.md](docs/MEMORY.md).
The monitor logs a `[MEMSTAT]` line every 10 minutes.

## Get Token ?

Run code (Discord Console - [Ctrl + Shift + I])

IF it's first time console using type ```allow pasting``` and press ENTER

Next copypaste and press ENTER

```javascript
window.webpackChunkdiscord_app.push([
  [Math.random()],
  {},
  req => {
    if (!req.c) return;
    for (const m of Object.keys(req.c)
      .map(x => req.c[x].exports)
      .filter(x => x)) {
      if (m.default && m.default.getToken !== undefined) {
        return copy(m.default.getToken());
      }
      if (m.getToken !== undefined) {
        return copy(m.getToken());
      }
    }
  },
]);
console.log('%cWorked!', 'font-size: 50px');
console.log(`%cYou now have your token in the clipboard!`, 'font-size: 16px');
```

Token will be copied to clipboard
