This folder is where the Godot web export goes.

The export is a build artifact, so it is not committed: this folder holds only
the .htaccess that serves the .wasm correctly. Produce it from the editor.

To fill it:

  1. Open the godot/ folder in Godot 4.4 (or newer).
  2. Let the first import finish.
  3. Editor > Manage Export Templates > Download and Install.
  4. Project > Export. The "Web" preset is already configured and its export
     path already points here.
  5. Press "Export Project".

You will get index.html, index.js, index.wasm, index.pck,
index.audio.worklet.js and index.icon.png beside this file.

Then upload the whole site. The Godot client ends up at

    https://your-site/play/

and the existing Three.js client stays at

    https://your-site/

Both talk to the same /api, so one account and one world serve both.

If the page loads to a blank canvas, open the browser console. The two usual
causes are the .wasm being served with the wrong MIME type - which the
.htaccess here fixes, unless your host ignores .htaccess - and a parent
.htaccess from a CMS rewriting these requests.
