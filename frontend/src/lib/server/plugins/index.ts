/**
 * Plugin system (SITE-12, docs/reference/plugin-hooks.md).
 *
 * Plugins are enabled exactly like in the legacy frontend, through the
 * `plugins:` list of configuration.yaml (`plugin_module` + options). Since the
 * frontend is now TypeScript, each supported legacy module name maps to a
 * bundled TypeScript implementation (see `BUNDLED`); unknown modules (third
 * party Python plugins) are reported and ignored instead of crashing the app.
 *
 * Hooks keep the legacy semantics: callbacks run by decreasing priority (then
 * registration order), `callHook` returns the non-null results, and
 * `callHookRecursive` threads an argument object through every callback. A
 * failing callback is logged and ignored, like legacy.
 */
import { error } from '@sveltejs/kit';
import { t } from '#lib/i18n/index.js';
import type { PluginConfig } from '../config.js';

/** A hook callback: receives the hook arguments, may return a value (or null). */
export type HookCallback<A = Record<string, unknown>, R = unknown> = (
	args: A
) => R | null | undefined | Promise<R | null | undefined>;

/** What a bundled plugin module exports. */
export interface PluginModule {
	/** Registers the plugin hooks; `options` is the plugin entry of the configuration. */
	init(registry: PluginRegistry, options: PluginConfig): void | Promise<void>;
}

/** Lazy loaders of the bundled plugins, keyed by legacy `plugin_module` name. */
export type PluginLoaders = Record<string, () => Promise<PluginModule>>;

/** Hook registry and set of loaded plugins. */
export class PluginRegistry {
	private readonly hooks = new Map<string, { prio: number; cb: HookCallback<never, unknown> }[]>();
	/** Legacy module names of the plugins successfully loaded, with their options. */
	readonly loaded = new Map<string, PluginConfig>();

	/** Registers `cb` under `name`; higher `prio` runs first. */
	addHook<A, R>(name: string, cb: HookCallback<A, R>, prio = 0): void {
		const list = this.hooks.get(name) ?? [];
		// Insert after every callback of higher or equal priority (legacy bisect_right).
		const index = list.findIndex((h) => h.prio < prio);
		list.splice(index === -1 ? list.length : index, 0, { prio, cb: cb as HookCallback<never, unknown> });
		this.hooks.set(name, list);
	}

	/** Runs `call` on every callback of a hook in priority order; a failing callback is logged and skipped. */
	private async run<A, R>(name: string, call: (cb: HookCallback<A, R>) => Promise<unknown>): Promise<void> {
		for (const { cb } of this.hooks.get(name) ?? []) {
			try {
				await call(cb as HookCallback<A, R>);
			} catch (e) {
				console.error(`An exception occurred while calling hook ${name}:`, e);
			}
		}
	}

	/** Calls every callback of a hook and returns the non-null results in order. */
	async callHook<A, R>(name: string, args: A): Promise<R[]> {
		const results: R[] = [];
		await this.run<A, R>(name, async (cb) => {
			const value = await cb(args);
			if (value !== null && value !== undefined) results.push(value);
		});
		return results;
	}

	/** Chains callbacks: each one receives the output of the previous one (legacy `call_hook_recursive`). */
	async callHookRecursive<A extends object>(name: string, args: A): Promise<A> {
		let current = args;
		await this.run<A, A>(name, async (cb) => (current = (await cb(current)) ?? current));
		return current;
	}

	/** True when a plugin (legacy module name) is enabled. */
	isEnabled(module: string): boolean {
		return this.loaded.has(module);
	}

	/** Loads the plugins listed in the configuration, in order; unsupported modules are reported and ignored. */
	async load(entries: PluginConfig[], loaders: PluginLoaders): Promise<void> {
		for (const entry of entries) {
			const loader = loaders[entry.plugin_module];
			if (!loader) console.warn(`Plugin ${entry.plugin_module} is not supported by this frontend; ignored.`);
			else {
				await (await loader()).init(this, entry);
				this.loaded.set(entry.plugin_module, entry);
			}
		}
	}
}

/**
 * Bundled plugins, keyed by their legacy module name: every file
 * `bundled/<legacy.module.name>.ts` exporting `init` is a plugin, e.g.
 * `bundled/inginious.frontend.plugins.scoreboard.ts`.
 */
export const BUNDLED: PluginLoaders = Object.fromEntries(
	Object.entries(import.meta.glob<PluginModule>(['./bundled/*.ts', '!./bundled/*.test.ts'])).map(([path, load]) => [
		path.slice('./bundled/'.length, -'.ts'.length),
		load
	])
);

let registry = new PluginRegistry();

/** The process-wide plugin registry. */
export function plugins(): PluginRegistry {
	return registry;
}

/** Guard of the plugin pages: 404 "Not found" when the plugin (legacy module name) is not enabled. */
export function requirePlugin(module: string): void {
	if (!registry.isEnabled(module)) error(404, t('Not found'));
}

/** Replaces the registry (tests). */
export function resetPlugins(): PluginRegistry {
	registry = new PluginRegistry();
	return registry;
}
