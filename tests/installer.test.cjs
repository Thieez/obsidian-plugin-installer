const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const { strToU8, zipSync } = require("fflate");

const notices = [];
class Plugin {
	constructor(app) {
		this.app = app;
	}
	addSettingTab() {}
}
class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = {};
	}
}
class Setting {}
class Notice {
	constructor(message) {
		notices.push(message);
	}
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "obsidian") return { Notice, Plugin, PluginSettingTab, Setting };
	return originalLoad.call(this, request, parent, isMain);
};
let PluginZipInstaller;
try {
	PluginZipInstaller = require("../main.js").default;
} finally {
	Module._load = originalLoad;
}

function zipFile(entries) {
	const bytes = zipSync(Object.fromEntries(
		Object.entries(entries).map(([path, value]) => [path, strToU8(value)]),
	));
	return {
		name: "plugin.zip",
		arrayBuffer: async () => bytes.buffer.slice(
			bytes.byteOffset,
			bytes.byteOffset + bytes.byteLength,
		),
	};
}

function createApp() {
	const files = new Map();
	const directories = new Set([".obsidian"]);
	const enabledPlugins = [];
	return {
		files,
		directories,
		enabledPlugins,
		plugins: {
			async enablePluginAndSave(pluginId) {
				enabledPlugins.push(pluginId);
			},
		},
		vault: {
			configDir: ".obsidian",
			adapter: {
				async exists(path) {
					return directories.has(path);
				},
				async mkdir(path) {
					directories.add(path);
				},
				async writeBinary(path, contents) {
					files.set(path, new Uint8Array(contents));
				},
			},
		},
	};
}

test("installs a single plugin from an enclosing ZIP folder", async () => {
	const app = createApp();
	const plugin = new PluginZipInstaller(app);
	const archive = zipFile({
		"release/manifest.json": JSON.stringify({
			id: "example-vault-addon",
			name: "Example",
			main: "main.js",
		}),
		"release/main.js": "plugin build",
		"release/assets/data.json": "{}",
		"../outside.txt": "must not be written",
	});

	await plugin.installArchive(archive);

	assert.deepEqual([...app.files.keys()].sort(), [
		".obsidian/plugins/example-vault-addon/assets/data.json",
		".obsidian/plugins/example-vault-addon/main.js",
		".obsidian/plugins/example-vault-addon/manifest.json",
	]);
	assert.equal(
		new TextDecoder().decode(app.files.get(".obsidian/plugins/example-vault-addon/main.js")),
		"plugin build",
	);
	assert.deepEqual(app.enabledPlugins, ["example-vault-addon"]);
	assert.match(notices.at(-1), /Installed and enabled Example/);
});

test("defaults to main.js when the plugin manifest omits main", async () => {
	const app = createApp();
	const plugin = new PluginZipInstaller(app);
	const archive = zipFile({
		"note/manifest.json": JSON.stringify({
			id: "note-thieez",
			name: "Note.thieez",
		}),
		"note/main.js": "note build",
	});

	await plugin.installArchive(archive);

	assert.equal(
		new TextDecoder().decode(app.files.get(".obsidian/plugins/note-thieez/main.js")),
		"note build",
	);
	assert.deepEqual(app.enabledPlugins, ["note-thieez"]);
	assert.match(notices.at(-1), /Installed and enabled Note\.thieez/);
});

test("reports when the plugin manager cannot enable the installed plugin", async () => {
	const app = createApp();
	app.plugins.enablePluginAndSave = async () => {
		throw new Error("plugin failed to load");
	};
	const plugin = new PluginZipInstaller(app);
	const archive = zipFile({
		"manifest.json": JSON.stringify({ id: "example-vault-addon" }),
		"main.js": "plugin build",
	});

	await plugin.installArchive(archive);

	assert.ok(app.files.has(".obsidian/plugins/example-vault-addon/main.js"));
	assert.match(notices.at(-1), /Installed example-vault-addon, but could not enable it/);
	assert.match(notices.at(-1), /plugin failed to load/);
});

test("rejects ZIPs that do not contain a built plugin", async () => {
	const app = createApp();
	const plugin = new PluginZipInstaller(app);

	await assert.rejects(
		plugin.installArchive(zipFile({ "manifest.json": JSON.stringify({ id: "example-vault-addon" }) })),
		/valid manifest\.json and main\.js/,
	);
	assert.equal(app.files.size, 0);
});
