// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://errand.philotheephilix.in',
	integrations: [
		starlight({
			title: 'Errand',
			description:
				'Errand is a Streamable-HTTP MCP server that lets an AI agent buy real products through Bitrefill, pay in crypto, and never spend past a cap enforced in code.',
			logo: {
				src: './src/assets/errand-mark.svg',
				replacesTitle: false,
			},
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/Philotheephilix/freesociety',
				},
			],
			customCss: ['./src/styles/theme.css'],
			expressiveCode: {
				themes: ['github-light'],
				styleOverrides: {
					borderColor: '#e7e9ee',
					borderRadius: '10px',
					codeFontFamily:
						"ui-monospace, 'SF Mono', 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
					frames: {
						shadowColor: 'transparent',
					},
				},
			},
			components: {
				Hero: './src/components/Hero.astro',
			},
			pagination: true,
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
			sidebar: [
				{
					label: 'Overview',
					items: [
						{ label: 'Introduction', slug: 'overview/introduction' },
						{ label: 'Architecture', slug: 'overview/architecture' },
						{ label: 'The permission layer', slug: 'overview/permissions' },
						{ label: 'Safety guardrails', slug: 'overview/safety' },
					],
				},
				{
					label: 'Install',
					items: [
						{ label: 'Quickstart', slug: 'install/quickstart' },
						{ label: 'Claude Code', slug: 'install/claude-code' },
						{ label: 'Cursor', slug: 'install/cursor' },
						{ label: 'Generic MCP client', slug: 'install/generic' },
					],
				},
				{
					label: 'Hub tools',
					items: [
						{ label: 'Overview', slug: 'tools/overview' },
						{ label: 'connect_jaw', slug: 'tools/connect-jaw' },
						{ label: 'connect_bitrefill', slug: 'tools/connect-bitrefill' },
						{ label: 'connect_swiggy', slug: 'tools/connect-swiggy' },
						{ label: 'configure_permissions', slug: 'tools/configure-permissions' },
						{ label: 'buy', slug: 'tools/buy' },
					],
				},
				{
					label: 'Internal tools',
					items: [
						{ label: 'Passthrough model', slug: 'internal/passthrough' },
						{ label: 'jaw__* (wallet)', slug: 'internal/jaw' },
						{ label: 'swiggy__* (Instamart)', slug: 'internal/swiggy' },
						{ label: 'bitrefill__* (fulfillment)', slug: 'internal/bitrefill' },
					],
				},
				{
					label: 'Gift-card CLI',
					items: [
						{ label: 'Prepare, pay, settle', slug: 'giftcard/overview' },
					],
				},
				{
					label: 'Marketplace',
					items: [
						{ label: 'Integration marketplace', slug: 'marketplace/overview' },
						{ label: 'Business model', slug: 'marketplace/business-model' },
						{ label: 'Request an integration', slug: 'marketplace/request' },
						{ label: 'Join the waitlist', slug: 'marketplace/waitlist' },
					],
				},
			],
		}),
	],
});
