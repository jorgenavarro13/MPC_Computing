// local/testing-post.js
//
// Two ways to start the party, both supported from one build:
//
//  1. Legacy / testing: a `?arguments=...` query string on the page URL.
//     Auto-starts main() with that argv, same as before.
//
//  2. Programmatic: window.webSPDZStartParty(argsArray, inputFiles).
//     Used by a lobby/registration UI that assigns each browser its party
//     index and lets the player type their own private input, instead of
//     baking Player-Data into the build. inputFiles is a {path: contents}
//     map written into the in-browser filesystem right before main() starts
//     — e.g. {'Player-Data/Input-P0-0': '5\n5\n5\n5\n'}. Values only ever
//     touch this browser; nothing here sends them anywhere.
//
// Module.noInitialRun is set (in the page, before this module loads) so the
// generated runtime does NOT call main() on its own. We call it ourselves
// via Module.callMain(), but only once Module.onRuntimeInitialized has
// fired — that's the point the WASM module is actually linked and ready to
// be called into. Calling Module.callMain() any earlier (e.g. synchronously
// at script-parse time) crashes, because the wasm exports aren't bound yet.
arguments_ = [];
(function () {
  if (typeof window === 'undefined') return;

  var runtimeReady = false;
  var pending = null; // { args, inputFiles }

  function doStart(args, inputFiles) {
    (inputFiles ? Object.keys(inputFiles) : []).forEach(function (path) {
      var slash = path.lastIndexOf('/');
      if (slash > 0) {
        Module['FS'].mkdirTree(path.substring(0, slash));
      }
      // FS.writeFile appends instead of truncating on this build (WASMFS +
      // MEMORY64 size-tracking bug) when the path already has content from
      // --embed-file. Explicitly truncate first so a fresh write isn't
      // silently glued onto whatever was baked in at compile time.
      try { Module['FS'].truncate(path, 0); } catch (e) {}
      Module['FS'].writeFile(path, inputFiles[path]);
    });
    arguments_ = args;
    Module['callMain'](args);
  }

  var prevOnRuntimeInitialized = Module['onRuntimeInitialized'];
  Module['onRuntimeInitialized'] = function () {
    if (prevOnRuntimeInitialized) prevOnRuntimeInitialized();
    runtimeReady = true;
    if (pending) {
      var p = pending;
      pending = null;
      doStart(p.args, p.inputFiles);
    }
  };

  window.webSPDZStartParty = function (args, inputFiles) {
    if (runtimeReady) {
      doStart(args, inputFiles);
    } else {
      pending = { args: args, inputFiles: inputFiles };
    }
  };

  var searchParams = new URLSearchParams(window.location.search);
  if (searchParams.has('arguments')) {
    window.webSPDZStartParty(Array.from(searchParams.get('arguments').split(",")));
  }
})();
// END -- Path: local/testing-post.js
