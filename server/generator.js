// server/generator.js
// Manages a persistent Python worker for image generation.
// The worker process stays alive between requests so models remain loaded in VRAM.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PY_DIR = path.join(__dirname, '..', 'generator');
const PYTHON_SCRIPT = path.join(PY_DIR, 'generate.py');
const VENV_PYTHON = path.join(PY_DIR, '.venv', 'Scripts', 'python.exe');
const TIMEOUT_MS = Number(process.env.GENERATE_TIMEOUT_MS || 600_000);

function getPythonCmd() {
	if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
	if (fs.existsSync(VENV_PYTHON)) return VENV_PYTHON;
	return 'python';
}

// ── Persistent worker state ────────────────────────────────────────────────

let _worker = null; // child_process.ChildProcess | null
let _outDir = null; // resolved once on first call
let _buffer = ''; // incomplete stdout data between newlines
let _currentJob = null; // { resolve, reject, timer } | null
const _queue = []; // pending jobs

function _spawnWorker() {
	const child = spawn(
		getPythonCmd(),
		[PYTHON_SCRIPT, '--worker', '--out-dir', _outDir],
		{
			cwd: PY_DIR,
			env: process.env,
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	);

	_buffer = '';

	// Each response from generate.py is a single line of JSON followed by \n.
	child.stdout.on('data', (chunk) => {
		_buffer += chunk.toString();
		let nl;
		while ((nl = _buffer.indexOf('\n')) !== -1) {
			const line = _buffer.slice(0, nl).trim();
			_buffer = _buffer.slice(nl + 1);
			if (!line) continue;

			const job = _currentJob;
			if (!job) continue; // unexpected output — ignore
			_currentJob = null;
			clearTimeout(job.timer);

			try {
				job.resolve(JSON.parse(line));
			} catch {
				job.reject(
					new Error(`Generator returned invalid JSON: ${line}`),
				);
			}
			_tick();
		}
	});

	child.stderr.on('data', (chunk) => process.stderr.write(chunk));

	child.on('error', (err) => {
		if (_worker === child) _worker = null;
		if (_currentJob) {
			const job = _currentJob;
			_currentJob = null;
			clearTimeout(job.timer);
			job.reject(err);
			_tick();
		}
	});

	child.on('exit', (code) => {
		if (_worker === child) {
			_worker = null;
			_clearPid();
		}
		if (_currentJob) {
			// Unexpected exit while a job was in flight.
			const job = _currentJob;
			_currentJob = null;
			clearTimeout(job.timer);
			job.reject(
				new Error(`Python worker exited unexpectedly (code ${code}).`),
			);
			_tick();
		}
	});

	console.log('[generator] Python worker started');
	_writePid(child.pid);
	return child;
}

function _tick() {
	if (_currentJob || _queue.length === 0) return;
	if (!_worker || _worker.exitCode !== null) _worker = _spawnWorker();

	const { payload, resolve, reject } = _queue.shift();

	const timer = setTimeout(() => {
		// Detach & kill the stuck worker; a fresh one will spawn on next _tick().
		const dyingWorker = _worker;
		_worker = null;
		if (dyingWorker) dyingWorker.kill('SIGTERM');
		const job = _currentJob;
		_currentJob = null;
		if (job) job.reject(new Error('Generation timed out.'));
		_tick();
	}, TIMEOUT_MS);

	_currentJob = { resolve, reject, timer };

	const modelBasename = String(payload.model || '')
		.split(/[\\/]/)
		.pop();
	console.log(
		`[generator] start  family=${payload.family}  model=${modelBasename}`,
	);

	try {
		_worker.stdin.write(JSON.stringify(payload) + '\n');
	} catch (err) {
		clearTimeout(timer);
		_currentJob = null;
		_worker = null;
		reject(err);
		_tick();
	}
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
// SIGINT / SIGTERM: handlers fire reliably — kill worker then exit.
// Hard kill (SIGKILL / Task Manager): nothing we can do from JS, but the
//   PID file below lets a future server startup detect and kill orphans.

const PID_FILE = path.join(PY_DIR, '.worker.pid');

function _writePid(pid) {
	try {
		fs.writeFileSync(PID_FILE, String(pid));
	} catch {
		/* ignore */
	}
}

function _clearPid() {
	try {
		fs.unlinkSync(PID_FILE);
	} catch {
		/* ignore */
	}
}

function _killOrphan() {
	try {
		const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
		if (!pid || isNaN(pid)) return;
		process.kill(pid, 0); // throws if process is gone
		process.kill(pid, 'SIGTERM');
		console.log(`[generator] killed orphaned worker pid=${pid}`);
	} catch {
		/* process gone or no pid file — ok */
	}
	_clearPid();
}

// Kill any orphan from a previous hard-killed server run.
_killOrphan();

function _stopWorker() {
	if (!_worker) return;
	_clearPid();
	try {
		_worker.kill('SIGTERM');
	} catch {
		/* ignore */
	}
	_worker = null;
}

process.on('exit', _stopWorker);
process.on('SIGTERM', () => {
	_stopWorker();
	process.exit(0);
});
process.on('SIGINT', () => {
	_stopWorker();
	process.exit(0);
});

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Run a generation job.
 * The Python worker is started lazily on first call and kept alive so that
 * loaded models remain in VRAM for subsequent requests.
 *
 * @param {object} payload  Generation payload (prompt, family, model path, etc.)
 * @param {string} outDir   Absolute path where images should be saved.
 * @returns {Promise<object>}
 */
function runGenerator(payload, outDir) {
	_outDir = _outDir ?? outDir; // fixed for the lifetime of the server process
	return new Promise((resolve, reject) => {
		_queue.push({ payload, resolve, reject });
		_tick();
	});
}

module.exports = { runGenerator };
