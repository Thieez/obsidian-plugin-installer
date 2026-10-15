# Plugin ZIP Installer

Install a built Obsidian plugin from a ZIP stored on your device. The plugin is intended for testing unpublished development builds, especially on phones and tablets where manually copying files into `.obsidian/plugins` is inconvenient.

## Use

1. Build or obtain a ZIP containing one plugin's `manifest.json`, compiled main JavaScript file, and any other plugin assets. The files may be at the ZIP root or inside one enclosing folder.
2. In Obsidian, open **Settings → Community plugins → Plugin ZIP Installer** and choose the ZIP from your device.
3. The plugin is unpacked into `.obsidian/plugins/<plugin-id>`. The selected ZIP is read directly and is not saved in the vault.
4. Enable the installed plugin in **Community plugins**. If it was already enabled, reload Obsidian to load the new build.

The installer writes over files with matching names but leaves unrelated files in an existing plugin folder untouched. It does not enable plugins automatically. Only install ZIPs from sources you trust.

## Build

```sh
npm install
npm run build
```

`main.js` is the bundled plugin entry point. The root `manifest.json` and built `main.js` are the files required to install this plugin in Obsidian.

## Releases

From the koud workspace, run `koud release Thieez/obsidian-plugin-installer`.
This runs the build and tests, updates `manifest.json` and `versions.json`, and
publishes `main.js`, `manifest.json`, `styles.css`, and an installable ZIP to
GitHub Releases.
Use `-Version 1.2.3` to choose a version instead of the automatically selected
next patch version.
