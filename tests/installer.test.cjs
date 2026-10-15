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
	return {
		files,
		directories,
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
	assert.match(notices.at(-1), /Installed Example/);
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
