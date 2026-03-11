// Relatie routes — create relations in e-Boekhouden
import { ApiError } from "../errors.mjs";

export async function createRelatie(eb, data) {
	if (!data.bedrijf || !data.email) {
		throw new ApiError(400, "Missing required fields: bedrijf, email");
	}

	// Navigate to relatie list, then click "Toevoegen"
	await eb.navigateContent("https://secure20.e-boekhouden.nl/relaties/relatie?scrollreset=1");

	const listFrame = eb.page.frames().find((f) =>
		f.url().includes("/relaties/relatie") && !f.url().includes("preload"),
	);
	if (!listFrame) throw new Error("Relatie list page not found");

	// Click "Toevoegen" link (navigates to /relaties/relatie/0)
	await listFrame.locator("a", { hasText: "Toevoegen" }).first().click();

	// Wait for the form to load
	const form = await eb.waitForFrame("relaties/relatie/0", 10000);
	await form.locator("#bedrijf").waitFor({ timeout: 5000 });

	console.log("[relatie] Filling form...");

	// Bedrijf/Particulier
	await form.locator("#bp").selectOption(data.bp || "P");

	// Naam
	await form.locator("#bedrijf").fill(data.bedrijf);

	// Adres
	if (data.adres) await form.locator("#adres").fill(data.adres);
	if (data.postcode) await form.locator("#postcode").fill(data.postcode);
	if (data.plaats) await form.locator("#plaats").fill(data.plaats);
	if (data.land) await form.locator("#land").fill(data.land);

	// Contact
	if (data.telefoon) await form.locator("#telefoonnummer").fill(data.telefoon);
	await form.locator("#email").fill(data.email);

	// Notitie
	if (data.notitie) await form.locator("#notitie").fill(data.notitie);

	// Save
	console.log("[relatie] Saving...");
	await form.locator("button.form-submit").click();

	// Wait for redirect to the relatie dashboard (means save succeeded)
	const dashboard = await eb.waitForFrame("relatie/dashboard/", 10000).catch(() => null);
	if (!dashboard) {
		const urls = eb.page.frames().map((f) => f.url()).filter((u) => u.includes("secure20"));
		throw new Error(`Relatie not saved — dashboard not found. Frames: ${JSON.stringify(urls)}`);
	}

	// Extract the relatie code from the dashboard
	const relatieCode = await dashboard.evaluate(() => {
		// Look for the code in the page content
		const codeEl = document.querySelector("[class*='code'], .relatie-code, h1, h2");
		return codeEl?.textContent?.trim() || "";
	});

	// Also try to get the code from URL or a more specific element
	const dashboardUrl = dashboard.url();
	const relatieId = dashboardUrl.match(/dashboard\/(\d+)/)?.[1] || "unknown";

	console.log(`[relatie] Created: ${relatieCode} (ID: ${relatieId})`);

	// Read the code field value which is auto-generated
	const code = await dashboard.evaluate(() => {
		// Try common patterns for displaying the relatie code
		const allText = document.body?.innerText || "";
		const codeMatch = allText.match(/Code[:\s]+(\d+)/);
		return codeMatch?.[1] || "";
	});

	return { relatieId, code: code || relatieCode };
}
