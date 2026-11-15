/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-5ccb27be'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "e62cafe0d1a12661a353b603f3660583"
  }, {
    "url": "pwa-512x512.png",
    "revision": "34474f5a356f8a15c85a5710640aa02c"
  }, {
    "url": "pwa-192x192.png",
    "revision": "b840c01f93dbf2324dbb98d3cc34d767"
  }, {
    "url": "index.html",
    "revision": "3cd461c61d5388e2ff4435bc69a26dde"
  }, {
    "url": "icon.svg",
    "revision": "933847e704665297d1e48d83d0cabc92"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "5385cb1d3c33ad2fe0b913553f4b1ff9"
  }, {
    "url": "assets/workbox-window.prod.es5-Bd17z0YL.js",
    "revision": null
  }, {
    "url": "assets/index-CHnqk3x-.css",
    "revision": null
  }, {
    "url": "assets/index-Bmbl6Q7_.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "5385cb1d3c33ad2fe0b913553f4b1ff9"
  }, {
    "url": "icon.svg",
    "revision": "933847e704665297d1e48d83d0cabc92"
  }, {
    "url": "pwa-192x192.png",
    "revision": "b840c01f93dbf2324dbb98d3cc34d767"
  }, {
    "url": "pwa-512x512.png",
    "revision": "34474f5a356f8a15c85a5710640aa02c"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "e62cafe0d1a12661a353b603f3660583"
  }, {
    "url": "manifest.webmanifest",
    "revision": "b0f16b00d44c89552d06641c9dc97fa2"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/i, new workbox.StaleWhileRevalidate({
    "cacheName": "osm-tiles-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 250,
      maxAgeSeconds: 604800
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
