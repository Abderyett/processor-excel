import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		outDir: '../backend/public', // Build output to the 'public' directory in backend
	},
	base: '/',
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
});
