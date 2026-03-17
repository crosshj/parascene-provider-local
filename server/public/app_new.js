'use strict';

const TOKEN_STORAGE_KEY = 'parascene_api_token';

function getStoredToken() {
	try {
		return localStorage.getItem(TOKEN_STORAGE_KEY);
	} catch {
		return null;
	}
}

function setStoredToken(value) {
	try {
		if (value == null || value === '') {
			localStorage.removeItem(TOKEN_STORAGE_KEY);
		} else {
			localStorage.setItem(TOKEN_STORAGE_KEY, value);
		}
	} catch {
		// Ignore storage failures.
	}
}

function showTokenGate() {
	const gate = document.getElementById('token-gate');
	const appRoot = document.getElementById('app-root');
	if (gate) gate.hidden = false;
	if (appRoot) appRoot.hidden = true;
}

function showAppRoot() {
	const gate = document.getElementById('token-gate');
	const appRoot = document.getElementById('app-root');
	if (gate) gate.hidden = true;
	if (appRoot) appRoot.hidden = false;
}

async function apiFetch(path, options = {}) {
	const token = getStoredToken();
	const init = { ...options };
	const headers = new Headers(init.headers || {});
	if (token) {
		headers.set('Authorization', `Bearer ${token}`);
	}
	init.headers = headers;

	const res = await fetch(path, init);
	if (res.status === 401) {
		// Token is invalid; clear and force user to re-enter.
		setStoredToken('');
		showTokenGate();
		throw new Error('Unauthorized: token invalid or missing.');
	}
	return res;
}

function initTokenForm() {
	const form = document.getElementById('token-form');
	if (!form) return;
	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const input = document.getElementById('provider-token');
		const token = input?.value.trim() || '';
		if (!token) return;
		setStoredToken(token);
		showAppRoot();
		initApp();
	});
}

// ── Main app (copied from app.js with config-driven select + token auth) ─────

function initApp() {
	const form = document.getElementById('gen-form');
	if (!form) return;

	const modelSel = document.getElementById('model');
	const badge = document.getElementById('family-badge');
	const statusEl = document.getElementById('status');
	const copyErrorBtn = document.getElementById('copy-error-btn');
	const randomizeSeedBtn = document.getElementById('randomize-seed-btn');
	const previewWrap = document.getElementById('preview-wrap');
	const idleEl = document.getElementById('preview-idle');
	const imageEl = document.getElementById('image');
	const metaRowEl = document.getElementById('meta-row');

	const STORAGE_KEY = 'local-image-generator.form.v1';
	let savedValues = null;
	let lastErrorText = '';

	const methodState = {
		activeMethodId: 'text2img',
	};

	function setStatusMessage(text, isError = false) {
		statusEl.textContent = text || '';
		if (isError) {
			lastErrorText = text || '';
			copyErrorBtn?.classList.remove('hidden');
		} else {
			lastErrorText = '';
			copyErrorBtn?.classList.add('hidden');
		}
	}

	async function copyLastError() {
		if (!lastErrorText) return;
		try {
			await navigator.clipboard.writeText(lastErrorText);
			copyErrorBtn.title = 'Copied';
			setTimeout(() => {
				if (copyErrorBtn) copyErrorBtn.title = 'Copy error';
			}, 1200);
		} catch {
			setStatusMessage('Error: Could not copy error text', true);
		}
	}

	function randomizeSeed() {
		const seed = Math.floor(Math.random() * 2_147_483_647) + 1;
		form.seed.value = String(seed);
		saveFormValues();
	}

	// ── Form persistence ──────────────────────────────────

	function collectFormValues() {
		return {
			prompt: form.prompt.value,
			negative_prompt: form.negative_prompt.value,
			model: modelSel.value,
			width: form.width.value,
			height: form.height.value,
			steps: form.steps.value,
			cfg: form.cfg.value,
			seed: form.seed.value,
		};
	}

	function saveFormValues() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(collectFormValues()));
		} catch {
			// Ignore localStorage failures.
		}
	}

	function restoreSavedValues() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			return parsed && typeof parsed === 'object' ? parsed : null;
		} catch {
			return null;
		}
	}

	// ── Preview state ─────────────────────────────────────

	function setPreviewIdle() {
		previewWrap.classList.remove('is-loading');
		imageEl.style.display = 'none';
		idleEl.classList.remove('hidden');
	}

	function setPreviewLoading() {
		previewWrap.classList.add('is-loading');
		imageEl.style.display = 'none';
		idleEl.classList.add('hidden');
	}

	function setPreviewImage(src) {
		previewWrap.classList.remove('is-loading');
		idleEl.classList.add('hidden');
		imageEl.src = src;
		imageEl.style.display = 'block';
	}

	function renderMeta(data) {
		const items = [
			['family', data.family],
			['model', data.model.split(/[\\/]/).pop()],
			['seed', data.seed],
			['time', data.elapsed_ms + '\u202fms'],
		];
		metaRowEl.innerHTML = items
			.map(
				([k, v]) =>
					`<span class="chip"><span class="chip-k">${k}</span>${v}</span>`,
			)
			.join('');
	}

	// ── Capability-driven model select ─────────────────────

	async function loadCapabilitiesAndModels() {
		try {
			const res = await apiFetch('/api', { method: 'GET' });
			const data = await res.json();
			if (!data || !Array.isArray(data.methods) || data.methods.length === 0) {
				throw new Error('Provider did not return any methods.');
			}

			const methods = data.methods;
			const method =
				methods.find((m) => m.default) ||
				methods.find((m) => m.id === 'text2img') ||
				methods[0];

			methodState.activeMethodId = method.id || 'text2img';

			const fields = method.fields || {};
			const modelField = fields.model;
			if (!modelField || !Array.isArray(modelField.options)) {
				throw new Error('Provider method is missing model options.');
			}

			modelSel.innerHTML = '';
			for (const optDef of modelField.options) {
				const opt = document.createElement('option');
				opt.value = optDef.value;
				opt.textContent = optDef.label || optDef.value;
				modelSel.appendChild(opt);
			}

			// Apply any saved value if still present.
			const saved = savedValues;
			if (
				saved &&
				typeof saved.model === 'string' &&
				saved.model &&
				Array.from(modelSel.options).some((o) => o.value === saved.model)
			) {
				modelSel.value = saved.model;
			}

			// The provider config doesn't currently describe width/height/steps/cfg,
			// so we keep the existing defaults but restore saved values if present.
			if (saved) {
				if (saved.prompt != null) form.prompt.value = saved.prompt;
				if (saved.negative_prompt != null)
					form.negative_prompt.value = saved.negative_prompt;
				if (saved.width != null) form.width.value = saved.width;
				if (saved.height != null) form.height.value = saved.height;
				if (saved.steps != null) form.steps.value = saved.steps;
				if (saved.cfg != null) form.cfg.value = saved.cfg;
				if (saved.seed != null) form.seed.value = saved.seed;
			}

			saveFormValues();
		} catch (err) {
			modelSel.innerHTML = '<option value="">Failed to load models</option>';
			setStatusMessage('Error loading capabilities: ' + err.message, true);
		}
	}

	// ── Events ────────────────────────────────────────────

	[
		'prompt',
		'negative_prompt',
		'width',
		'height',
		'steps',
		'cfg',
		'seed',
	].forEach((n) => form[n].addEventListener('input', saveFormValues));

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		setStatusMessage('Generating…');
		setPreviewLoading();
		metaRowEl.innerHTML = '';

		const body = {
			prompt: form.prompt.value.trim(),
			negative_prompt: form.negative_prompt.value.trim(),
			model: modelSel.value,
			width: Number(form.width.value),
			height: Number(form.height.value),
			steps: Number(form.steps.value),
			cfg: Number(form.cfg.value),
		};

		const seedRaw = form.seed.value.trim();
		if (seedRaw) {
			const seedVal = Number(seedRaw);
			if (Number.isInteger(seedVal) && seedVal >= 0) {
				body.seed = seedVal;
			} else {
				setPreviewIdle();
				setStatusMessage(
					'Error: Seed must be a non-negative integer',
					true,
				);
				return;
			}
		}

		try {
			// Provider API: start job (POST /api with method + args, no job_id).
			const startRes = await apiFetch('/api', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					method: 'text2img',
					args: body,
				}),
			});
			const startData = await startRes.json();
			if (startRes.status !== 202 || !startData.job_id) {
				throw new Error(startData.error || 'Failed to start job');
			}

			const jobId = startData.job_id;

			// Poll until done (202 → still pending, 200 → final result).
			for (;;) {
				const pollRes = await apiFetch('/api', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						method: 'text2img',
						args: { job_id: jobId },
					}),
				});
				const pollData = await pollRes.json();

				if (pollRes.status === 200) {
					if (pollData.status === 'succeeded' && pollData.result?.image_url) {
						setPreviewImage(pollData.result.image_url + '?t=' + Date.now());
						renderMeta(pollData.result);
						setStatusMessage('Done.');
					} else {
						throw new Error(
							pollData.result?.error || pollData.error || 'Job failed',
						);
					}
					break;
				}
				if (pollRes.status === 202) {
					await new Promise((r) => setTimeout(r, 1500));
					continue;
				}
				throw new Error(pollData.error || 'Poll failed');
			}
		} catch (err) {
			setPreviewIdle();
			setStatusMessage('Error: ' + (err.message || 'Unknown'), true);
		}
	});

	copyErrorBtn?.addEventListener('click', copyLastError);
	randomizeSeedBtn?.addEventListener('click', randomizeSeed);

	// ── Init ──────────────────────────────────────────────

	savedValues = restoreSavedValues();
	setPreviewIdle();
	loadCapabilitiesAndModels();
}

// Boot sequence
document.addEventListener('DOMContentLoaded', () => {
	initTokenForm();
	const token = getStoredToken();
	if (!token) {
		showTokenGate();
	} else {
		showAppRoot();
		initApp();
	}
});

