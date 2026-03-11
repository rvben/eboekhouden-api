// Read-only endpoints for e-Boekhouden

// Set the page size via the "Items per pagina" dropdown
async function setPageSize(frame, size, eb) {
	const select = frame.locator("select.pagesizes-select");
	if (await select.count() === 0) return;
	await select.selectOption(String(size));
	await frame.locator("table.grid").waitFor({ timeout: 15000 });
	await eb.page.waitForTimeout(500);
}

// Navigate to a specific page number via the pagination <li> elements
async function goToPage(frame, page, eb) {
	if (!page || page <= 1) return;

	// e-Boekhouden pagination: .pagination ul > li elements with page numbers
	const pageLi = frame.locator(`.pagination ul li:not(.disabled)`);
	const count = await pageLi.count();
	if (count === 0) return;

	// Find the li whose trimmed text matches the page number
	for (let i = 0; i < count; i++) {
		const text = (await pageLi.nth(i).textContent())?.trim();
		if (text === String(page)) {
			await pageLi.nth(i).click();
			await frame.locator("table.grid").waitFor({ timeout: 10000 });
			await eb.page.waitForTimeout(500);
			return;
		}
	}
}

// Extract pagination metadata from the page
async function getPaginationInfo(frame) {
	return await frame.evaluate(() => {
		const items = document.querySelectorAll(".pagination ul li");
		if (items.length === 0) return { page: 1, totalPages: 1 };

		const activeLi = document.querySelector(".pagination ul li.active");
		const currentPage = activeLi ? parseInt(activeLi.textContent?.trim()) || 1 : 1;

		// Collect all numeric page li's to find the max page
		const pageNums = Array.from(items)
			.map((li) => parseInt(li.textContent?.trim()))
			.filter((n) => !isNaN(n));

		const totalPages = pageNums.length > 0 ? Math.max(...pageNums) : 1;
		return { page: currentPage, totalPages };
	});
}

export async function listOffertes(eb, query = {}) {
	await eb.navigateContent("https://secure20.e-boekhouden.nl/facturen/offerte?last=1&scrollreset=1");

	const form = eb.page.frames().find((f) =>
		f.url().includes("facturen/offerte"),
	);
	if (!form) {
		const urls = eb.page.frames().map((f) => f.url());
		throw new Error(`Offerte list page not found. Frames: ${JSON.stringify(urls)}`);
	}

	// Apply search filter if provided
	if (query.search) {
		const hasSearch = await form.locator("#searchTerm").count();
		if (hasSearch) {
			await form.locator("#searchTerm").fill(query.search);
			await form.locator("#searchTerm").press("Enter");
			await form.locator("table.grid").waitFor({ timeout: 5000 });
			await eb.page.waitForTimeout(500);
		}
	}

	// If all=true, set page size to max (2000) to get everything in one shot
	if (query.all === "true" || query.all === "1") {
		await setPageSize(form, 2000, eb);
	}

	// Navigate to requested page
	const requestedPage = parseInt(query.page) || 1;
	await goToPage(form, requestedPage, eb);

	// Scrape the table (Angular grid with table.grid)
	const offertes = await form.evaluate(() => {
		const table = document.querySelector("table.grid");
		if (!table) return [];

		const rows = Array.from(table.querySelectorAll("tr")).filter(
			(row) => !row.closest("thead"),
		);

		return rows.map((row) => {
			const cells = row.querySelectorAll("td");
			const link = row.querySelector("a[href*='offerte/dashboard']");
			const id = link?.href?.match(/dashboard\/(\d+)/)?.[1] || null;
			return {
				id,
				nummer: cells[2]?.textContent?.trim() || "",
				status: cells[3]?.textContent?.trim() || "",
				datum: cells[4]?.textContent?.trim() || "",
				vervaldatum: cells[5]?.textContent?.trim() || "",
				relatie: cells[6]?.textContent?.trim() || "",
				kenmerk: cells[7]?.textContent?.trim() || "",
				totaalExcl: cells[9]?.textContent?.trim() || "",
				totaalIncl: cells[11]?.textContent?.trim() || "",
			};
		}).filter((o) => o.nummer);
	});

	const pagination = await getPaginationInfo(form);

	return {
		offertes,
		count: offertes.length,
		page: pagination.page,
		totalPages: pagination.totalPages,
	};
}

export async function listRelaties(eb, query = {}) {
	await eb.navigateContent("https://secure20.e-boekhouden.nl/relaties/relatie?scrollreset=1");

	const form = eb.page.frames().find((f) =>
		f.url().includes("/relaties/relatie") &&
		!f.url().includes("preload") &&
		!f.url().includes("jwt"),
	);
	if (!form) {
		const urls = eb.page.frames().map((f) => f.url());
		throw new Error(`Relaties page not found. Frames: ${JSON.stringify(urls)}`);
	}

	// Apply search filter if provided
	if (query.search) {
		await form.locator("#searchTerm").fill(query.search);
		await form.locator("#searchTerm").press("Enter");
		await form.locator("table.grid").waitFor({ timeout: 5000 });
		await eb.page.waitForTimeout(500);
	}

	// If all=true, set page size to max (2000) to get everything in one shot
	if (query.all === "true" || query.all === "1") {
		await setPageSize(form, 2000, eb);
	}

	// Navigate to requested page
	const requestedPage = parseInt(query.page) || 1;
	await goToPage(form, requestedPage, eb);

	// Scrape the table (Angular grid with table.grid)
	const relaties = await form.evaluate(() => {
		const table = document.querySelector("table.grid");
		if (!table) return [];

		const rows = Array.from(table.querySelectorAll("tr")).filter(
			(row) => !row.closest("thead"),
		);

		return rows.map((row) => {
			const cells = row.querySelectorAll("td");
			const link = row.querySelector("a[href*='relatie/dashboard']");
			const id = link?.href?.match(/dashboard\/(\d+)/)?.[1] || null;
			return {
				id,
				code: cells[1]?.textContent?.trim() || "",
				bedrijf: cells[2]?.textContent?.trim() || "",
				adres: cells[3]?.textContent?.trim() || "",
				plaats: cells[4]?.textContent?.trim() || "",
				telefoon: cells[5]?.textContent?.trim() || "",
				email: cells[6]?.textContent?.trim() || "",
			};
		}).filter((r) => r.code);
	});

	const pagination = await getPaginationInfo(form);

	return {
		relaties,
		count: relaties.length,
		page: pagination.page,
		totalPages: pagination.totalPages,
	};
}
