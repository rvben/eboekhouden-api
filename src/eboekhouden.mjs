// Reusable e-Boekhouden browser automation helpers
import { chromium } from "playwright";

const GOTO_OPTIONS = { waitUntil: "load", timeout: 30000 };
const DROPDOWN_SELECTOR = ".autocomplete-item, .dropdown-item, .AutocompleteDropdown li, .autocomplete-results li, [class*='autocomplete'] li, [class*='dropdown'] li:not(.disabled)";

export class EBoekhouden {
	constructor({ username, password }) {
		this.username = username;
		this.password = password;
		this.browser = null;
		this.page = null;
	}

	async launch() {
		this.browser = await chromium.launch({ headless: true });
		const context = await this.browser.newContext({ viewport: { width: 1280, height: 900 } });
		this.page = await context.newPage();
	}

	async close() {
		if (this.browser) await this.browser.close().catch(() => {});
		this.browser = null;
		this.page = null;
	}

	// --- Frame helpers ---

	findFrame(urlPart) {
		return this.page.frames().find((f) => f.url().includes(urlPart));
	}

	getContentFrame() {
		const frame = this.page.frames().find(
			(f) =>
				f.url().includes("secure20.e-boekhouden.nl") &&
				!f.url().includes("preload") &&
				!f.url().includes("refreshjwt") &&
				!f.url().includes("jwt.html"),
		);
		if (!frame) throw new Error("Content frame not found");
		return frame;
	}

	// Wait for a frame matching urlPart to appear (polls page.frames())
	async waitForFrame(urlPart, timeout = 10000) {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			const frame = this.findFrame(urlPart);
			if (frame) return frame;
			await this.page.waitForTimeout(200);
		}
		throw new Error(`Frame matching "${urlPart}" not found within ${timeout}ms`);
	}

	// --- Login ---

	isLoggedIn() {
		if (!this.page) return false;
		try {
			return !!this.findFrame("menu.asp");
		} catch {
			return false;
		}
	}

	async ensureReady() {
		if (!this.browser || !this.page) {
			await this.launch();
		}

		if (!this.isLoggedIn()) {
			await this.login();
		}
	}

	async login() {
		await this.page.goto("https://secure20.e-boekhouden.nl", GOTO_OPTIONS);
		const loginFrame = await this.waitForFrame("inloggen.asp", 15000);
		await loginFrame.locator("#txtEmail").waitFor({ state: "visible", timeout: 10000 });

		await loginFrame.locator("#txtEmail").fill(this.username);
		await loginFrame.locator("#txtWachtwoord").fill(this.password);
		await loginFrame.locator("#submit1").click();

		// Wait for menu frame (login succeeded) and welkom page (content ready)
		await this.waitForFrame("menu.asp", 15000);
		await this.waitForFrame("welkom", 10000);
		console.log("[eboekhouden] Logged in");
	}

	// Navigate the content area to a secure20 URL
	async navigateContent(url) {
		const mainFrame = this.page.frames().find((f) => {
			const u = f.url();
			return u.includes("secure20.e-boekhouden.nl") &&
				!u.includes("preload") &&
				!u.includes("refreshjwt") &&
				!u.includes("jwt.html") &&
				!u.includes("/assets/");
		});

		if (!mainFrame) {
			const urls = this.page.frames().map((f) => f.url());
			throw new Error(`Main content frame not found. Frames: ${JSON.stringify(urls)}`);
		}

		await mainFrame.goto(url, { waitUntil: "load", timeout: 30000 });
		await this.page.waitForTimeout(1000);
	}

	// Navigate to an offerte dashboard (Angular client-side route)
	// The dashboard can't be loaded via direct URL (server returns 404).
	// Must click through from the list page to trigger Angular's client-side routing.
	async navigateDashboard(offerteId) {
		// Navigate to the offerte list
		await this.navigateContent("https://secure20.e-boekhouden.nl/facturen/offerte?last=1&scrollreset=1");

		const listFrame = this.page.frames().find((f) => f.url().includes("facturen/offerte"));
		if (!listFrame) throw new Error("Offerte list page not found");

		// Wait for the table to render
		await listFrame.locator("table.grid").waitFor({ timeout: 5000 });

		// If the link isn't visible, narrow the date filter to find it.
		// The list shows max ~100 rows, so a wide date range may exclude newer offertes.
		// Strategy: try today first (most likely for recently created), then widen.
		let link = listFrame.locator(`a[href*='offerte/dashboard/${offerteId}']`);
		if (await link.count() === 0) {
			const datumVan = listFrame.locator("#datumVan");
			const datumTot = listFrame.locator("#datumTot");
			if (await datumVan.count() > 0) {
				const fmt = (d) => d.toLocaleDateString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric" });
				const today = new Date();

				// Try 1: today only (best chance for recent offertes)
				await datumVan.fill(fmt(today));
				await datumTot.fill(fmt(today));
				await datumTot.press("Enter");
				await this.page.waitForTimeout(2000);

				link = listFrame.locator(`a[href*='offerte/dashboard/${offerteId}']`);
				if (await link.count() === 0) {
					// Try 2: last 30 days
					const monthAgo = new Date(today);
					monthAgo.setDate(today.getDate() - 30);
					await datumVan.fill(fmt(monthAgo));
					await datumTot.fill(fmt(today));
					await datumTot.press("Enter");
					await this.page.waitForTimeout(2000);

					link = listFrame.locator(`a[href*='offerte/dashboard/${offerteId}']`);
				}
				if (await link.count() === 0) {
					// Try 3: last year
					const yearAgo = new Date(today);
					yearAgo.setFullYear(today.getFullYear() - 1);
					await datumVan.fill(fmt(yearAgo));
					await datumTot.fill(fmt(today));
					await datumTot.press("Enter");
					await this.page.waitForTimeout(2000);

					link = listFrame.locator(`a[href*='offerte/dashboard/${offerteId}']`);
				}
			}

			if (await link.count() === 0) {
				throw new Error(`Offerte ${offerteId} not found in list`);
			}
		}

		await link.click();

		// Wait for the dashboard to appear
		const dashboard = await this.waitForFrame(`offerte/dashboard/${offerteId}`, 10000);
		await dashboard.locator("h1").waitFor({ timeout: 5000 });

		console.log(`[eboekhouden] Navigated to offerte dashboard ${offerteId}`);
		return dashboard;
	}

	// --- Data helpers ---

	// Fetch a URL using the browser's authenticated session and return a Buffer
	async fetchAuthenticated(url) {
		const context = this.page.context();
		const response = await context.request.get(url);
		if (!response.ok()) {
			throw new Error(`Fetch ${url} failed: ${response.status()} ${response.statusText()}`);
		}
		return {
			body: await response.body(),
			contentType: response.headers()["content-type"] || "application/octet-stream",
		};
	}

	// --- Overlay helpers ---

	async dismissOverlay(frame) {
		// e-Boekhouden sometimes shows a modal overlay (app-form-overlay) that blocks clicks.
		// Try to close it by clicking its close button, or failing that, remove it via JS.
		const overlay = frame.locator("app-form-overlay");
		if (await overlay.count() > 0) {
			const closeBtn = frame.locator("app-form-overlay .form-close, app-form-overlay button.close, app-form-overlay [class*='close']");
			if (await closeBtn.count() > 0) {
				await closeBtn.first().click().catch(() => {});
				await frame.page().waitForTimeout(500);
			} else {
				await frame.evaluate(() => {
					document.querySelectorAll("app-form-overlay").forEach((el) => el.remove());
				}).catch(() => {});
			}
		}
	}

	// --- Form helpers ---

	async clearAndType(frame, selector, text) {
		const el = frame.locator(selector);
		await el.click();
		await el.fill(String(text));
	}

	async setAutocomplete(frame, inputId, value) {
		const input = frame.locator(`#${inputId}`);
		await input.click();
		await input.fill(value);

		// Wait for dropdown to appear instead of fixed sleep
		try {
			await frame.locator(DROPDOWN_SELECTOR).first().waitFor({ timeout: 2000 });
		} catch {
			// Dropdown didn't appear — press Tab to move on
			await input.press("Tab");
			return;
		}

		// Click the first visible dropdown item
		const clicked = await frame.evaluate((sel) => {
			const items = document.querySelectorAll(sel);
			for (const item of items) {
				if (item.offsetParent !== null) {
					item.click();
					return true;
				}
			}
			return false;
		}, DROPDOWN_SELECTOR);

		if (!clicked) {
			await input.press("Tab");
		}
	}
}
