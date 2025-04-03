const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * Copy a directory recursively
 */
function copyDirectory(source, destination) {
	// Create destination directory if it doesn't exist
	if (!fs.existsSync(destination)) {
		fs.mkdirSync(destination, { recursive: true });
	}

	// Get all files and directories in the source directory
	const entries = fs.readdirSync(source, { withFileTypes: true });

	for (const entry of entries) {
		const sourcePath = path.join(source, entry.name);
		const destPath = path.join(destination, entry.name);

		if (entry.isDirectory()) {
			// Recursively copy directories
			copyDirectory(sourcePath, destPath);
		} else {
			// Copy files
			fs.copyFileSync(sourcePath, destPath);
		}
	}
}

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: [
			'vscode', 
			'tree-sitter',
			'tree-sitter-python'
		],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	// Copy webview files from src to dist
	const srcWebviewPath = path.join(__dirname, 'src', 'webview');
	const distWebviewPath = path.join(__dirname, 'dist', 'webview');
	
	if (fs.existsSync(srcWebviewPath)) {
		console.log(`Copying webview files from ${srcWebviewPath} to ${distWebviewPath}`);
		copyDirectory(srcWebviewPath, distWebviewPath);
	} else {
		console.warn(`Webview directory not found at ${srcWebviewPath}`);
	}
	
	if (watch) {
		await ctx.watch();
		// Watch for changes in the webview directory
		fs.watch(srcWebviewPath, { recursive: true }, (eventType, filename) => {
			if (filename) {
				const srcFile = path.join(srcWebviewPath, filename);
				const destFile = path.join(distWebviewPath, filename);
				const destDir = path.dirname(destFile);
				
				if (!fs.existsSync(destDir)) {
					fs.mkdirSync(destDir, { recursive: true });
				}
				
				if (fs.existsSync(srcFile) && !fs.statSync(srcFile).isDirectory()) {
					console.log(`[watch] Copying changed webview file: ${filename}`);
					fs.copyFileSync(srcFile, destFile);
				}
			}
		});
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
