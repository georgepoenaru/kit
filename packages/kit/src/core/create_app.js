import * as fs from 'fs';
import { mkdirp } from '@sveltejs/app-utils/files';
import { stringify, walk, write_if_changed } from '../utils';

export function create_app({
	manifest_data,
	output
}) {
	if (!fs.existsSync(output)) mkdirp(output);

	const client_manifest = generate_client_manifest(manifest_data);

	const app = generate_app(manifest_data);

	write_if_changed(`${output}/generated/manifest.js`, client_manifest);
	write_if_changed(`${output}/generated/root.svelte`, app);
}

export function create_serviceworker_manifest({
	manifest_data,
	output,
	client_files,
	static_files
}) {
	let files = ['service-worker-index.html'];

	if (fs.existsSync(static_files)) {
		files = files.concat(walk(static_files));
	}

	const code = `
		// This file is generated by @sveltejs/kit — do not edit it!
		export const timestamp = ${Date.now()};

		export const files = [\n\t${files.map((x) => stringify('/' + x)).join(',\n\t')}\n];
		export { files as assets }; // legacy

		export const shell = [\n\t${client_files.map((x) => stringify('/' + x)).join(',\n\t')}\n];

		export const routes = [\n\t${manifest_data.pages
			.map((r) => `{ pattern: ${r.pattern} }`)
			.join(',\n\t')}\n];
	`
		.replace(/^\t\t/gm, '')
		.trim();

	write_if_changed(`${output}/service-worker.js`, code);
}

function create_param_match(param, i) {
	return /^\.{3}.+$/.test(param)
		? `${param.replace(/.{3}/, '')}: d(match[${i + 1}]).split('/')`
		: `${param}: d(match[${i + 1}])`;
}

function generate_client_manifest(manifest_data) {
	const page_ids = new Set(manifest_data.pages.map(page =>
		page.pattern.toString()));

	const endpoints_to_ignore = manifest_data.endpoints.filter(route =>
		!page_ids.has(route.pattern.toString()));

	const component_indexes = {};

	const components = `[
		${manifest_data.components
			.map((component, i) => {
				component_indexes[component.name] = i;

				return `() => import(${JSON.stringify(component.url)})`;
			})
			.join(',\n\t\t\t\t')}
	]`.replace(/^\t/gm, '');

	let needs_decode = false;

	let routes = `[
				${manifest_data.pages
					.map(
						(page) => `{
					// ${page.parts[page.parts.length - 1].component.file}
					pattern: ${page.pattern},
					parts: [
						${page.parts
							.map((part) => {
								const missing_layout = !part;
								if (missing_layout) return 'null';

								if (part.params.length > 0) {
									needs_decode = true;
									const props = part.params.map(create_param_match);
									return `{ i: ${
										component_indexes[part.component.name]
									}, params: match => ({ ${props.join(', ')} }) }`;
								}

								return `{ i: ${component_indexes[part.component.name]} }`;
							})
							.join(',\n\t\t\t\t\t\t')}
					]
				}`
					)
					.join(',\n\n\t\t\t\t')}
	]`.replace(/^\t/gm, '');

	if (needs_decode) {
		routes = `(d => ${routes})(decodeURIComponent)`;
	}

	return `
		import * as layout from ${JSON.stringify(manifest_data.layout.url)};
		export { layout };
		export { default as ErrorComponent } from ${JSON.stringify(manifest_data.error.url)};

		export const ignore = [${endpoints_to_ignore.map(route => route.pattern).join(', ')}];

		export const components = ${components};

		export const routes = ${routes};
	`
		.replace(/^\t{2}/gm, '')
		.trim();
}

function generate_app(manifest_data) {
	// TODO remove default layout altogether

	const max_depth = Math.max(
		...manifest_data.pages.map((page) => page.parts.filter(Boolean).length)
	);

	const levels = [];
	for (let i = 0; i < max_depth; i += 1) {
		levels.push(i + 1);
	}

	let l = max_depth;

	let pyramid = `<svelte:component this={level${l}.component} {...level${l}.props}/>`;

	while (l-- > 1) {
		pyramid = `
			<svelte:component this={level${l}.component} segment={segments[${l}]} {...level${l}.props}>
				{#if level${l + 1}}
					${pyramid.replace(/\n/g, '\n\t\t\t\t\t')}
				{/if}
			</svelte:component>
		`
			.replace(/^\t\t\t/gm, '')
			.trim();
	}

	return `
		<!-- This file is generated by @sveltejs/kit — do not edit it! -->
		<script>
			import { setContext, afterUpdate } from 'svelte';
			import { layout, ErrorComponent } from './manifest.js';

			const Layout = layout.default;

			// error handling
			export let status = undefined;
			export let error = undefined;

			export let stores;
			export let segments;
			export let level0;
			${levels.map((l) => `export let level${l} = null;`).join('\n\t\t\t')}
			export let notify;

			afterUpdate(notify);
			setContext('__svelte__', stores);
		</script>

		<Layout segment={segments[0]} {...level0.props}>
			{#if error}
				<ErrorComponent {status} {error}/>
			{:else}
				${pyramid.replace(/\n/g, '\n\t\t\t\t')}
			{/if}
		</Layout>
	`
		.replace(/^\t\t/gm, '')
		.trim();
}