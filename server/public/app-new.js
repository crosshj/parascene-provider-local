'use strict';

const TOKEN_STORAGE_KEY = 'parascene_api_token';
const CF_ACCESS_CLIENT_ID_KEY = 'parascene_cf_access_client_id';
const CF_ACCESS_CLIENT_SECRET_KEY = 'parascene_cf_access_client_secret';

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

function getStoredCfAccessClientId() {
	try {
		return localStorage.getItem(CF_ACCESS_CLIENT_ID_KEY);
	} catch {
		return null;
	}
}

function setStoredCfAccessClientId(value) {
	try {
		if (value == null || value === '') {
			localStorage.removeItem(CF_ACCESS_CLIENT_ID_KEY);
		} else {
			localStorage.setItem(CF_ACCESS_CLIENT_ID_KEY, value);
		}
	} catch {
		// Ignore storage failures.
	}
}

function getStoredCfAccessClientSecret() {
	try {
		return localStorage.getItem(CF_ACCESS_CLIENT_SECRET_KEY);
	} catch {
		return null;
	}
}

function setStoredCfAccessClientSecret(value) {
	try {
		if (value == null || value === '') {
			localStorage.removeItem(CF_ACCESS_CLIENT_SECRET_KEY);
		} else {
			localStorage.setItem(CF_ACCESS_CLIENT_SECRET_KEY, value);
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
	const cfAccessClientId = getStoredCfAccessClientId();
	const cfAccessClientSecret = getStoredCfAccessClientSecret();

	const init = { ...options };
	const headers = new Headers(init.headers || {});
	if (token) {
		headers.set('Authorization', `Bearer ${token}`);
	}
	if (cfAccessClientId) {
		headers.set('CF-Access-Client-Id', cfAccessClientId);
	}
	if (cfAccessClientSecret) {
		headers.set('CF-Access-Client-Secret', cfAccessClientSecret);
	}
	init.headers = headers;

	const res = await fetch(path, init);
	if (res.status === 401) {
		// Surface 401 to callers without clearing stored credentials.
		throw new Error('Unauthorized: token or access credentials invalid or missing.');
	}
	return res;
}

function initTokenForm() {
	const form = document.getElementById('token-form');
	if (!form) return;
	const tokenInput = document.getElementById('provider-token');
	const cfIdInput = document.getElementById('cf-access-client-id');
	const cfSecretInput = document.getElementById('cf-access-client-secret');

	// Prefill from storage if available.
	if (tokenInput) {
		const storedToken = getStoredToken();
		if (storedToken) tokenInput.value = storedToken;
	}
	if (cfIdInput) {
		const storedId = getStoredCfAccessClientId();
		if (storedId) cfIdInput.value = storedId;
	}
	if (cfSecretInput) {
		const storedSecret = getStoredCfAccessClientSecret();
		if (storedSecret) cfSecretInput.value = storedSecret;
	}

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const token = tokenInput?.value.trim() || '';
		const cfId = cfIdInput?.value.trim() || '';
		const cfSecret = cfSecretInput?.value.trim() || '';
		if (!token) return;

		setStoredToken(token);
		setStoredCfAccessClientId(cfId);
		setStoredCfAccessClientSecret(cfSecret);
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

	// ── Form persistence (only prompt and model; rest from API) ─────────────

	function collectFormValues() {
		return {
			prompt: form.prompt.value,
			model: modelSel.value,
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
		const modelLabel =
			typeof data.model === 'string' && data.model.includes('/')
				? data.model.split(/[\\/]/).pop()
				: (data.model ?? '—');
		const timeLabel =
			data.elapsed_ms != null && data.elapsed_ms !== '—'
				? `${data.elapsed_ms}\u202fms`
				: (data.elapsed_ms ?? '—');
		const items = [
			['family', data.family ?? '—'],
			['model', modelLabel],
			['seed', data.seed ?? '—'],
			['time', timeLabel],
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

			// Restore saved prompt and model only.
			const saved = savedValues;
			if (
				saved &&
				typeof saved.model === 'string' &&
				saved.model &&
				Array.from(modelSel.options).some((o) => o.value === saved.model)
			) {
				modelSel.value = saved.model;
			}
			if (saved && saved.prompt != null) form.prompt.value = saved.prompt;

			updateFamilyBadge();
			saveFormValues();
		} catch (err) {
			modelSel.innerHTML = '<option value="">Failed to load models</option>';
			setStatusMessage('Error loading capabilities: ' + err.message, true);
		}
	}

	function updateFamilyBadge() {
		const opt = modelSel.options[modelSel.selectedIndex];
		const label = opt ? opt.textContent : '';
		// Label is "family: modelName" from GET /api options.
		badge.textContent = label.includes(':') ? label.split(':')[0].trim() : '';
	}

	// ── Events ────────────────────────────────────────────

	form.prompt.addEventListener('input', saveFormValues);
	form.model.addEventListener('change', () => {
		updateFamilyBadge();
		saveFormValues();
	});

	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		setStatusMessage('Generating…');
		setPreviewLoading();
		metaRowEl.innerHTML = '';

		const body = {
			prompt: form.prompt.value.trim(),
			model: modelSel.value,
		};

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

			// Poll until done (202 → still pending, 200 → image binary or JSON error).
			for (;;) {
				const pollRes = await apiFetch('/api', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						method: 'text2img',
						args: { job_id: jobId },
					}),
				});

				if (pollRes.status === 202) {
					await new Promise((r) => setTimeout(r, 1500));
					continue;
				}

				if (pollRes.status === 200) {
					const contentType = pollRes.headers.get('Content-Type') || '';
					if (contentType.includes('image/png')) {
						const blob = await pollRes.blob();
						const url = URL.createObjectURL(blob);
						setPreviewImage(url);
						const meta = {
							family: pollRes.headers.get('X-Family') ?? badge.textContent ?? '—',
							model: pollRes.headers.get('X-Model') ?? modelSel.selectedOptions[0]?.textContent?.split(':')[1]?.trim() ?? '—',
							seed: pollRes.headers.get('X-Seed') ?? '—',
							elapsed_ms: pollRes.headers.get('X-Elapsed-Ms') ?? '—',
						};
						renderMeta(meta);
						setStatusMessage('Done.');
					} else {
						const pollData = await pollRes.json();
						throw new Error(
							pollData.result?.error || pollData.error || 'Job failed',
						);
					}
					break;
				}

				const pollData = await pollRes.json().catch(() => ({}));
				throw new Error(pollData.error || 'Poll failed');
			}
		} catch (err) {
			setPreviewIdle();
			setStatusMessage('Error: ' + (err.message || 'Unknown'), true);
		}
	});

	copyErrorBtn?.addEventListener('click', copyLastError);

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

