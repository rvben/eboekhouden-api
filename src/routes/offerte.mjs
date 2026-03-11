// Offerte routes — create and update offertes in e-Boekhouden
import { ApiError } from "../errors.mjs";

export async function createOfferte(eb, data) {
	if (!data.relatieCode || !data.templateId || !data.kenmerk || !data.items?.length) {
		throw new ApiError(400, "Missing required fields: relatieCode, templateId, kenmerk, items");
	}

	// Step 1: Fill and save the offerte header
	await eb.navigateContent("https://secure20.e-boekhouden.nl/facturen/offerte/toevoegen?scrollreset=1");

	const form = eb.page.frames().find((f) => f.url().includes("offerte/toevoegen"));
	if (!form) throw new Error("Offerte form not found");

	console.log("[offerte] Filling header...");
	await form.locator("#offertesjabloonId").selectOption(data.templateId);
	await form.locator("#inEx").selectOption(data.inExVat || "IN");
	await eb.setAutocomplete(form, "relatieId-AutocompletePickerInput", data.relatieCode);
	await form.locator("#kenmerk").fill(data.kenmerk);

	if (data.emailTemplateId) {
		await form.locator("#factuurEmailsjabloonId").selectOption(data.emailTemplateId);
	}

	console.log("[offerte] Saving header...");
	await form.locator("button.form-submit").click();

	// Wait for dashboard frame to appear (means save succeeded)
	const dashboard = await eb.waitForFrame("offerte/dashboard/", 15000).catch(() => null);
	if (!dashboard) {
		const urls = eb.page.frames().map((f) => f.url()).filter((u) => u.includes("secure20"));
		throw new Error(`Offerte not saved — dashboard not found. Frames: ${JSON.stringify(urls)}`);
	}

	const offerteId = dashboard.url().match(/dashboard\/(\d+)/)?.[1] || "unknown";
	const offerteNumber = await dashboard.evaluate(() => {
		const h1 = document.querySelector("h1");
		return h1?.textContent?.trim() || "";
	});
	console.log(`[offerte] Created: ${offerteNumber} (ID: ${offerteId})`);

	// Step 2: Add line items
	for (let i = 0; i < data.items.length; i++) {
		const item = data.items[i];
		const isLast = i === data.items.length - 1;
		console.log(`[offerte] Adding item ${i + 1}/${data.items.length}: ${item.description}`);

		// Dismiss any overlay that might block clicks
		await eb.dismissOverlay(dashboard);

		// Click "Product/dienst toevoegen" and wait for the form to appear
		await dashboard.locator("button, a", { hasText: "Product/dienst toevoegen" }).click({ force: true });
		await dashboard.locator("#aantal").waitFor({ timeout: 5000 });

		// Quantity (Dutch decimal separator)
		await eb.clearAndType(dashboard, "#aantal", String(item.quantity).replace(".", ","));

		// Description
		await dashboard.locator("#omschrijving").click();
		await dashboard.locator("#omschrijving").fill(item.description);

		// Price field depends on whether offerte is incl or excl BTW
		const priceField = (data.inExVat || "IN") === "EX" ? "#prijsExcl" : "#prijsIncl";
		await eb.clearAndType(dashboard, priceField, item.pricePerUnit.toFixed(2).replace(".", ","));

		// BTW code
		await eb.setAutocomplete(dashboard, "btw-AutocompletePickerInput", item.btwCode);

		// Ledger
		await eb.setAutocomplete(dashboard, "grootboekrekeningId-AutocompletePickerInput", item.ledgerCode);

		// Ensure "opslaan als standaard" is NOT checked
		const isChecked = await dashboard.locator("#opslaanAlsStandaard").isChecked().catch(() => false);
		if (isChecked) {
			await dashboard.locator("#opslaanAlsStandaard").uncheck();
		}

		if (isLast) {
			// Find the "Opslaan" button that isn't "Opslaan en nieuw" or "opslaan als standaard"
			const buttons = dashboard.locator("button");
			const count = await buttons.count();
			for (let b = 0; b < count; b++) {
				const text = await buttons.nth(b).textContent();
				if (text?.trim() === "Opslaan" && !text.includes("nieuw") && !text.includes("standaard")) {
					await buttons.nth(b).click({ force: true });
					break;
				}
			}
		} else {
			await dashboard.locator("button", { hasText: "Opslaan en nieuw" }).click({ force: true });
		}

		// Wait for the form to disappear (item saved)
		await dashboard.locator("#aantal").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
	}

	console.log("[offerte] All line items added");
	return { offerteNumber, offerteId };
}

const VALID_STATUSES = [
	"03. Wacht op antwoord",
	"04. Geaccepteerd",
	"05. Gefactureerd 25%",
	"06. Gefactureerd 60%",
	"07. Gefactureerd 100%",
	"08. Afgewezen",
];

export async function updateOfferteStatus(eb, offerteId, data) {
	if (!data.status) {
		throw new ApiError(400, "Missing required field: status");
	}
	if (!VALID_STATUSES.includes(data.status)) {
		throw new ApiError(400, `Invalid status "${data.status}". Valid: ${VALID_STATUSES.join(", ")}`);
	}

	// Navigate to the offerte edit form
	const editUrl = `https://secure20.e-boekhouden.nl/facturen/offerte/${offerteId}?goback=offerte/dashboard/${offerteId}`;
	await eb.navigateContent(editUrl);

	// Match the edit form (/facturen/offerte/{id}) — distinct from dashboard (/offerte/dashboard/{id})
	const form = eb.page.frames().find((f) => f.url().includes(`/facturen/offerte/${offerteId}`));
	if (!form) {
		const urls = eb.page.frames().map((f) => f.url()).filter((u) => u.includes("secure20"));
		throw new Error(`Offerte edit form not found. Frames: ${JSON.stringify(urls)}`);
	}

	// Wait for the status field to render before interacting
	await form.locator("#statusId-AutocompletePickerInput").waitFor({ timeout: 5000 });

	console.log(`[offerte] Setting status to "${data.status}" for offerte ${offerteId}...`);
	await eb.setAutocomplete(form, "statusId-AutocompletePickerInput", data.status);

	// Save — try form-submit button first, then exact "Opslaan" text match
	let clicked = false;
	const formSubmit = form.locator("button.form-submit");
	if (await formSubmit.count() > 0) {
		await formSubmit.click();
		clicked = true;
	} else {
		const buttons = form.locator("button");
		const count = await buttons.count();
		for (let b = 0; b < count; b++) {
			const text = await buttons.nth(b).textContent();
			if (text?.trim() === "Opslaan") {
				await buttons.nth(b).click();
				clicked = true;
				break;
			}
		}
	}
	if (!clicked) {
		throw new Error("Opslaan button not found on edit form");
	}

	// After save, e-Boekhouden stays on the edit form — wait for page to settle
	await form.page().waitForTimeout(2000);

	// Verify the status was actually saved by re-reading the field
	const savedStatus = await form.locator("#statusId-AutocompletePickerInput").inputValue().catch(() => "");
	if (savedStatus && !savedStatus.includes(data.status.substring(0, 5))) {
		throw new Error(`Status save verification failed: expected "${data.status}", field shows "${savedStatus}"`);
	}

	console.log(`[offerte] Status updated to "${data.status}"`);
	return { offerteId, status: data.status };
}

export async function sendOfferteEmail(eb, offerteId, data = {}) {
	if (!data.emailTemplateId) {
		throw new ApiError(400, "Missing required field: emailTemplateId");
	}

	// Navigate to the offerte dashboard
	const dashboard = await eb.navigateDashboard(offerteId);

	console.log(`[offerte] Clicking "E-mail sturen" for offerte ${offerteId}...`);
	await dashboard.locator("button, a", { hasText: "E-mail sturen" }).click();

	// Wait for the email compose modal to appear
	await dashboard.locator("button", { hasText: "Verzenden" }).waitFor({ timeout: 5000 });

	// Select email template: "Sjabloon selecteren" → pick from #sjabloon dropdown → "Volgende"
	await dashboard.locator("a, button, span", { hasText: "Sjabloon selecteren" }).click();
	await dashboard.locator("#sjabloon").waitFor({ timeout: 3000 });
	await dashboard.locator("#sjabloon").selectOption(data.emailTemplateId);
	await dashboard.locator("button", { hasText: "Volgende" }).click();

	// Wait for template to load subject and body via AJAX
	await dashboard.page().waitForTimeout(5000);
	console.log(`[offerte] Selected email template ${data.emailTemplateId}`);

	// Verify subject was populated by the template
	const subject = await dashboard.locator("#onderwerp").inputValue().catch(() => "");
	if (!subject) {
		throw new Error(`Template ${data.emailTemplateId} did not populate the subject field`);
	}

	// Log all email form values right before sending
	const emailForm = await dashboard.evaluate(() => {
		const get = (id) => document.getElementById(id)?.value || "";
		return { van: get("emailVan"), aan: get("emailAan"), cc: get("cc"), bcc: get("bcc"), onderwerp: get("onderwerp") };
	}).catch(() => ({}));
	console.log(`[offerte] Email form before send: ${JSON.stringify(emailForm)}`);

	// Send the email
	await dashboard.locator("button", { hasText: "Verzenden" }).click();
	await dashboard.page().waitForTimeout(3000);

	// Check for validation errors
	const okButton = dashboard.locator("button", { hasText: "Ok" });
	if (await okButton.count() > 0) {
		const errorText = await dashboard.evaluate(() => document.body?.innerText?.substring(0, 200) || "").catch(() => "");
		await okButton.click();
		throw new Error(`Email send failed: ${errorText}`);
	}

	console.log(`[offerte] Email sent for offerte ${offerteId}`);
	return { offerteId, emailSent: true, recipient: emailForm.aan };
}

export async function getOffertePdf(eb, offerteId) {
	const url = `https://secure20.e-boekhouden.nl/v1/api/offerte/pdf/${offerteId}`;
	console.log(`[offerte] Fetching PDF for offerte ${offerteId}...`);
	const { body, contentType } = await eb.fetchAuthenticated(url);
	console.log(`[offerte] PDF fetched: ${body.length} bytes`);
	return { body, contentType, filename: `offerte-${offerteId}.pdf` };
}
