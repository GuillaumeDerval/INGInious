/**
 * Unit tests of the plugin hook registry (SITE-12).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PluginRegistry, plugins, requirePlugin, resetPlugins } from './index.js';

afterEach(() => vi.restoreAllMocks());

describe('PluginRegistry', () => {
	it('calls hooks by decreasing priority, then registration order, and drops nulls', async () => {
		const r = new PluginRegistry();
		r.addHook('h', () => 'a');
		r.addHook('h', () => 'b', 5);
		r.addHook('h', () => null);
		r.addHook('h', async () => 'c', 5);
		r.addHook('h', () => undefined, 1);
		r.addHook('h', () => 'd', -1);
		expect(await r.callHook('h', {})).toEqual(['b', 'c', 'a', 'd']);
		expect(await r.callHook('unknown', {})).toEqual([]);
	});

	it('logs and ignores failing callbacks', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const r = new PluginRegistry();
		r.addHook('h', () => {
			throw new Error('boom');
		});
		r.addHook('h', () => 1);
		expect(await r.callHook('h', {})).toEqual([1]);
		r.addHook('rec', () => {
			throw new Error('boom');
		});
		expect(await r.callHookRecursive('rec', { x: 1 })).toEqual({ x: 1 });
		expect(log).toHaveBeenCalledTimes(2);
	});

	it('threads arguments through recursive hooks', async () => {
		const r = new PluginRegistry();
		r.addHook<{ text: string }, { text: string }>('feedback_text', ({ text }) => ({ text: text + '1' }));
		r.addHook<{ text: string }, null>('feedback_text', () => null);
		r.addHook<{ text: string }, { text: string }>('feedback_text', async ({ text }) => ({ text: text + '2' }));
		expect(await r.callHookRecursive('feedback_text', { text: 'x' })).toEqual({ text: 'x12' });
		expect(await r.callHookRecursive('none', { y: 2 })).toEqual({ y: 2 });
	});

	it('loads configured plugins in order and reports unsupported ones', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const r = new PluginRegistry();
		const order: string[] = [];
		await r.load([{ plugin_module: 'a', opt: 1 }, { plugin_module: 'python.only' }, { plugin_module: 'b' }], {
			a: async () => ({ init: (reg, options) => void order.push(`a${options.opt}`) }),
			b: async () => ({ init: async () => void order.push('b') })
		});
		expect(order).toEqual(['a1', 'b']);
		expect(r.isEnabled('a')).toBe(true);
		expect(r.isEnabled('python.only')).toBe(false);
		expect(r.loaded.get('a')).toEqual({ plugin_module: 'a', opt: 1 });
		expect(warn).toHaveBeenCalledOnce();
	});
});

describe('process registry', () => {
	it('can be reset', () => {
		const before = plugins();
		const after = resetPlugins();
		expect(after).not.toBe(before);
		expect(plugins()).toBe(after);
	});
});

describe('bundled plugins', () => {
	it('are discovered by legacy module name', async () => {
		const { BUNDLED } = await import('./index.js');
		expect(Object.keys(BUNDLED)).toContain('inginious.frontend.plugins.demo');
		const r = new PluginRegistry();
		await r.load([{ plugin_module: 'inginious.frontend.plugins.demo' }], BUNDLED);
		expect(r.isEnabled('inginious.frontend.plugins.demo')).toBe(true);
	});

	it('requirePlugin answers 404 for disabled plugins', async () => {
		resetPlugins();
		expect(() => requirePlugin('a')).toThrow(expect.objectContaining({ status: 404 }));
		await plugins().load([{ plugin_module: 'a' }], { a: async () => ({ init: () => {} }) });
		expect(() => requirePlugin('a')).not.toThrow();
		resetPlugins();
	});
});
