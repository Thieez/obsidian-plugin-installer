import { unzipSync } from "fflate";
import { Notice, Plugin, PluginSettingTab, Setting, type App } from "obsidian";

interface PluginManifest {
	id: string;
	name?: string;
	main: string;
}

interface ArchivePlugin {
	manifest: PluginManifest;
	root: string;
	files: Map<string, Uint8Array>;
}

export default class PluginZipInstaller extends Plugin {
	async onload(): Promise<void> {
		this.addSettingTab(new InstallerSettingTab(this.app, this));
	}

	async installArchive(file: File): Promise<void> {
		if (!file.name.toLowerCase().endsWith(".zip")) {
			throw new Error("Choose a .zip file containing a built Obsidian plugin.");
		}

		const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
		const plugin = findPlugin(archive);
		const pluginPath = `${this.app.vault.configDir}/plugins/${plugin.manifest.id}`;

		for (const [relativePath, contents] of plugin.files) {
			const destination = `${pluginPath}/${relativePath}`;
			await ensureParentDirectories(this.app, destination);
			const binary = new ArrayBuffer(contents.byteLength);
			new Uint8Array(binary).set(contents);
			await this.app.vault.adapter.writeBinary(destination, binary);
		}

		new Notice(`Installed ${plugin.manifest.name ?? plugin.manifest.id}. Enable or reload it in Community plugins.`);
	}
}

class InstallerSettingTab extends PluginSettingTab {
	plugin: PluginZipInstaller;

	constructor(app: App, plugin: PluginZipInstaller) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Plugin ZIP Installer" });
		containerEl.createEl("p", {
			text: "Install unpublished plugin builds from a ZIP on this device. This is useful for testing development builds on phones and tablets.",
		});

		const fileInput = containerEl.createEl("input", {
			type: "file",
			attr: { accept: ".zip,application/zip" },
		});
		fileInput.style.display = "none";
		fileInput.addEventListener("change", () => {
			const file = fileInput.files?.[0];
			fileInput.value = "";
			if (!file) return;

			void this.plugin.installArchive(file).catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`Could not install plugin ZIP: ${message}`, 10000);
			});
		});

		new Setting(containerEl)
			.setName("Install a plugin ZIP")
			.setDesc("Choose a ZIP containing a built plugin with manifest.json and its main JavaScript file.")
			.addButton((button) => button
				.setButtonText("Choose ZIP")
				.setCta()
				.onClick(() => fileInput.click()));
	}
}

function findPlugin(archive: Record<string, Uint8Array>): ArchivePlugin {
	const files = new Map<string, Uint8Array>();
	for (const [archivePath, contents] of Object.entries(archive)) {
		const path = normalizeArchivePath(archivePath);
		if (!path || path.endsWith("/")) continue;
		files.set(path, contents);
	}

	const candidates: ArchivePlugin[] = [];
	for (const [path, contents] of files) {
		if (path !== "manifest.json" && !path.endsWith("/manifest.json")) continue;

		try {
			const manifest = JSON.parse(new TextDecoder().decode(contents)) as Partial<PluginManifest>;
			if (
				typeof manifest.id !== "string"
				|| !/^[a-z0-9-]+$/.test(manifest.id)
				|| typeof manifest.main !== "string"
			) continue;

			const root = path === "manifest.json" ? "" : path.slice(0, -"manifest.json".length);
			const main = normalizeArchivePath(`${root}${manifest.main}`);
			if (!main || !files.has(main)) continue;
			candidates.push({ manifest: manifest as PluginManifest, root, files });
		} catch {
			continue;
		}
	}

	if (candidates.length !== 1) {
		throw new Error(candidates.length === 0
			? "The ZIP must contain a built plugin with a valid manifest.json and main.js."
			: "The ZIP contains multiple plugins. Install one plugin at a time.");
	}

	const plugin = candidates[0];
	const pluginFiles = new Map<string, Uint8Array>();
	for (const [path, contents] of plugin.files) {
		if (!path.startsWith(plugin.root)) continue;
		const relativePath = path.slice(plugin.root.length);
		if (relativePath) pluginFiles.set(relativePath, contents);
	}

	return { ...plugin, files: pluginFiles };
}

function normalizeArchivePath(path: string): string | null {
	if (path.includes("\\") || path.includes("\0") || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
		return null;
	}

	const parts = path.split("/");
	if (parts.some((part) => part === ".." || part === ".")) return null;
	return parts.filter(Boolean).join("/") + (path.endsWith("/") ? "/" : "");
}

async function ensureParentDirectories(app: App, filePath: string): Promise<void> {
	const parts = filePath.split("/");
	parts.pop();
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!(await app.vault.adapter.exists(current))) {
			await app.vault.adapter.mkdir(current);
		}
	}
}
