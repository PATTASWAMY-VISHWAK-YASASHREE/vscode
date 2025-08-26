/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check

const testWebLocation = require.resolve('@vscode/test-web');

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const minimist = require('minimist');
const fancyLog = require('fancy-log');
const ansiColors = require('ansi-colors');
const open = require('open');
const https = require('https');

const APP_ROOT = path.join(__dirname, '..');
const WEB_DEV_EXTENSIONS_ROOT = path.join(APP_ROOT, '.build', 'builtInWebDevExtensions');

const WEB_PLAYGROUND_VERSION = '0.0.13';

/**
 * Main function that parses command line arguments and starts the VS Code web server
 * @return {Promise<void>}
 */
async function main() {

	const args = minimist(process.argv.slice(2), {
		boolean: [
			'help',
			'playground',
			'verbose'
		],
		string: [
			'host',
			'port',
			'extensionPath',
			'browser',
			'browserType'
		],
	});

	if (args.help) {
		console.log(
			'./scripts/code-web.sh|bat[, folderMountPath[, options]]\n' +
			'                           Start with an empty workspace and no folder opened in explorer\n' +
			'  folderMountPath          Open local folder (eg: use `.` to open current directory)\n' +
			'  --playground             Include the vscode-web-playground extension\n' +
			'  --verbose                Enable verbose logging\n' +
			'  --host <hostname>        Specify the hostname (default: localhost)\n' +
			'  --port <port>            Specify the port (default: 8080)\n' +
			'  --browser <browser>      Specify the browser to open\n' +
			'  --browserType <type>     Specify the browser type\n'
		);
		startServer(['--help']);
		return;
	}

	const serverArgs = [];

	const HOST = args['host'] ?? 'localhost';
	const PORT = args['port'] ?? '8080';

	// Validate port number if provided
	if (args['port'] && (isNaN(Number(PORT)) || Number(PORT) < 1 || Number(PORT) > 65535)) {
		console.error(`Error: Invalid port number '${PORT}'. Port must be a number between 1 and 65535.`);
		process.exit(1);
	}

	if (args['host'] === undefined) {
		serverArgs.push('--host', HOST);
	}
	if (args['port'] === undefined) {
		serverArgs.push('--port', PORT);
	}

	// only use `./scripts/code-web.sh --playground` to add vscode-web-playground extension by default.
	if (args['playground'] === true) {
		serverArgs.push('--extensionPath', WEB_DEV_EXTENSIONS_ROOT);
		serverArgs.push('--folder-uri', 'memfs:///sample-folder');
		await ensureWebDevExtensions(args['verbose']);
	}

	let openSystemBrowser = false;
	if (!args['browser'] && !args['browserType']) {
		serverArgs.push('--browserType', 'none');
		openSystemBrowser = true;
	}

	serverArgs.push('--sourcesPath', APP_ROOT);

	serverArgs.push(...process.argv.slice(2).filter(v => !v.startsWith('--playground') && v !== '--no-playground' && !v.startsWith('--verbose')));

	startServer(serverArgs);
	if (openSystemBrowser) {
		try {
			await open.default(`http://${HOST}:${PORT}/`);
		} catch (error) {
			console.warn(`Warning: Could not open browser automatically: ${error.message}`);
			console.log(`Please open your browser and navigate to: http://${HOST}:${PORT}/`);
		}
	}
}

/**
 * Starts the VS Code web server with the given arguments
 * @param {string[]} runnerArguments - Array of command line arguments to pass to the server
 */
function startServer(runnerArguments) {
	const env = { ...process.env };

	console.log(`Starting @vscode/test-web: ${testWebLocation} ${runnerArguments.join(' ')}`);
	const proc = cp.spawn(process.execPath, [testWebLocation, ...runnerArguments], { env, stdio: 'inherit' });

	proc.on('exit', (code) => process.exit(code));

	process.on('exit', () => proc.kill());
	process.on('SIGINT', () => {
		proc.kill();
		process.exit(128 + 2); // https://nodejs.org/docs/v14.16.0/api/process.html#process_signal_events
	});
	process.on('SIGTERM', () => {
		proc.kill();
		process.exit(128 + 15); // https://nodejs.org/docs/v14.16.0/api/process.html#process_signal_events
	});
}

/**
 * Checks if a directory exists at the given path
 * @param {string} path - The path to check
 * @return {Promise<boolean>} True if the directory exists, false otherwise
 */
async function directoryExists(path) {
	try {
		return (await fs.promises.stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Downloads a playground file from the given HTTPS location
 * @param {string} fileName - The name of the file to download
 * @param {string} httpsLocation - The base HTTPS URL location
 * @param {string} destinationRoot - The root destination directory
 * @return {Promise<void>}
 */
async function downloadPlaygroundFile(fileName, httpsLocation, destinationRoot) {
	const destination = path.join(destinationRoot, fileName);
	await fs.promises.mkdir(path.dirname(destination), { recursive: true });
	
	return new Promise((resolve, reject) => {
		const fileStream = fs.createWriteStream(destination);
		
		const cleanup = () => {
			fileStream.destroy();
		};
		
		const request = https.get(path.posix.join(httpsLocation, fileName), response => {
			if (response.statusCode !== 200) {
				cleanup();
				reject(new Error(`Failed to download ${fileName}: HTTP ${response.statusCode}`));
				return;
			}
			
			response.pipe(fileStream);
			
			fileStream.on('finish', () => {
				fileStream.close();
				resolve();
			});
			
			fileStream.on('error', (err) => {
				cleanup();
				reject(new Error(`Failed to write ${fileName}: ${err.message}`));
			});
		});
		
		request.on('error', (err) => {
			cleanup();
			reject(new Error(`Failed to download ${fileName}: ${err.message}`));
		});
	});
}

/**
 * Ensures web development extensions are available for the playground
 * @param {boolean} verbose - Whether to log verbose messages
 * @return {Promise<void>}
 */
async function ensureWebDevExtensions(verbose) {

	// Playground (https://github.com/microsoft/vscode-web-playground)
	const webDevPlaygroundRoot = path.join(WEB_DEV_EXTENSIONS_ROOT, 'vscode-web-playground');
	const webDevPlaygroundExists = await directoryExists(webDevPlaygroundRoot);

	let downloadPlayground = false;
	if (webDevPlaygroundExists) {
		try {
			const packageJsonPath = path.join(webDevPlaygroundRoot, 'package.json');
			const packageJsonContent = await fs.promises.readFile(packageJsonPath, 'utf8');
			const webDevPlaygroundPackageJson = JSON.parse(packageJsonContent);
			if (webDevPlaygroundPackageJson.version !== WEB_PLAYGROUND_VERSION) {
				if (verbose) {
					fancyLog(`${ansiColors.yellow('Web Development extensions')}: Version mismatch (expected ${WEB_PLAYGROUND_VERSION}, found ${webDevPlaygroundPackageJson.version}), will re-download`);
				}
				downloadPlayground = true;
			}
		} catch (error) {
			if (verbose) {
				fancyLog(`${ansiColors.yellow('Web Development extensions')}: Error reading package.json (${error.message}), will re-download`);
			}
			downloadPlayground = true;
		}
	} else {
		downloadPlayground = true;
	}

	if (downloadPlayground) {
		if (verbose) {
			fancyLog(`${ansiColors.magenta('Web Development extensions')}: Downloading vscode-web-playground to ${webDevPlaygroundRoot}`);
		}
		try {
			const playgroundRepo = `https://raw.githubusercontent.com/microsoft/vscode-web-playground/main/`;
			await Promise.all(['package.json', 'dist/extension.js', 'dist/extension.js.map'].map(
				fileName => downloadPlaygroundFile(fileName, playgroundRepo, webDevPlaygroundRoot)
			));
			if (verbose) {
				fancyLog(`${ansiColors.green('Web Development extensions')}: Successfully downloaded vscode-web-playground`);
			}
		} catch (error) {
			fancyLog(`${ansiColors.red('Web Development extensions')}: Failed to download vscode-web-playground: ${error.message}`);
			throw error;
		}
	} else {
		if (verbose) {
			fancyLog(`${ansiColors.magenta('Web Development extensions')}: Using existing vscode-web-playground in ${webDevPlaygroundRoot}`);
		}
	}
}

main();
