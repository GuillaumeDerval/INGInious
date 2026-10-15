/**
 * Port of the legacy "demo" plugin (SITE-16): it only proves that plugins load.
 * Its page (`/plugindemo`, see routes/plugindemo) is served when it is enabled.
 */
import type { PluginRegistry } from '../index.js';

/** Nothing to register: the page checks `plugins().isEnabled(...)`. */
export function init(registry: PluginRegistry): void {
	void registry;
}
