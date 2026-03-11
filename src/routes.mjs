// Route definitions — single source of truth for routing + OpenAPI docs

import { createOfferte, updateOfferteStatus, sendOfferteEmail, getOffertePdf } from "./routes/offerte.mjs";
import { createRelatie } from "./routes/relatie.mjs";
import { listOffertes, listRelaties } from "./routes/read.mjs";

export function defineRoutes({ withBrowser, cache, readonly }) {
	return [
		{
			method: "GET",
			path: "/api/health",
			summary: "Health check",
			description: "Returns service status including browser and login state.",
			auth: false,
			response: {
				200: {
					description: "Service status",
					schema: {
						type: "object",
						properties: {
							ok: { type: "boolean" },
							browserActive: { type: "boolean" },
							loggedIn: { type: "boolean" },
							startedAt: { type: "string", format: "date-time" },
							uptimeSeconds: { type: "integer" },
							lastRequestAt: { type: "string", format: "date-time", nullable: true },
							cacheSize: { type: "integer", description: "Number of cached offertes (within TTL)" },
						},
					},
				},
			},
			// handler is set directly in server.mjs (needs session access)
			handler: null,
		},
		{
			method: "GET",
			path: "/api/offertes",
			summary: "List offertes",
			description: "Scrapes the offerte list from e-Boekhouden. Optionally filter by search term.",
			auth: true,
			query: {
				search: { type: "string", description: "Filter offertes by search term" },
				page: { type: "integer", description: "Page number (default: 1)" },
				all: { type: "string", description: "Set to 'true' to return all offertes (sets page size to max)" },
			},
			response: {
				200: {
					description: "List of offertes",
					schema: {
						type: "object",
						properties: {
							offertes: {
								type: "array",
								items: {
									type: "object",
									properties: {
										id: { type: "string", description: "e-Boekhouden internal ID" },
										nummer: { type: "string", example: "OF-391" },
										status: { type: "string" },
										datum: { type: "string", example: "06-03-2026" },
										vervaldatum: { type: "string" },
										relatie: { type: "string" },
										kenmerk: { type: "string" },
										totaalExcl: { type: "string" },
										totaalIncl: { type: "string" },
									},
								},
							},
							count: { type: "integer" },
							page: { type: "integer" },
							totalPages: { type: "integer" },
						},
					},
				},
			},
			handler: (query) => withBrowser(listOffertes, query),
		},
		{
			method: "GET",
			path: "/api/relaties",
			summary: "List relaties",
			description: "Scrapes the relatie list from e-Boekhouden. Optionally filter by search term.",
			auth: true,
			query: {
				search: { type: "string", description: "Filter relaties by search term" },
				page: { type: "integer", description: "Page number (default: 1)" },
				all: { type: "string", description: "Set to 'true' to return all relaties (sets page size to max)" },
			},
			response: {
				200: {
					description: "List of relaties",
					schema: {
						type: "object",
						properties: {
							relaties: {
								type: "array",
								items: {
									type: "object",
									properties: {
										id: { type: "string" },
										code: { type: "string", example: "10001" },
										bedrijf: { type: "string" },
										adres: { type: "string" },
										plaats: { type: "string" },
										telefoon: { type: "string" },
										email: { type: "string" },
									},
								},
							},
							count: { type: "integer" },
							page: { type: "integer" },
							totalPages: { type: "integer" },
						},
					},
				},
			},
			handler: (query) => withBrowser(listRelaties, query),
		},
		// Write endpoints (disabled when READONLY=true)
		...(!readonly ? [{
			method: "POST",
			path: "/api/relatie",
			summary: "Create relatie",
			description: "Creates a new relatie (customer) in e-Boekhouden via browser automation.",
			auth: true,
			body: {
				required: ["bedrijf", "email"],
				properties: {
					bedrijf: { type: "string", description: "Company or person name", example: "Acme Corp" },
					bp: { type: "string", enum: ["B", "P"], default: "P", description: "B = Bedrijf, P = Particulier" },
					adres: { type: "string", description: "Street address", example: "Teststraat 99" },
					postcode: { type: "string", example: "0000 XX" },
					plaats: { type: "string", example: "Teststad" },
					land: { type: "string", default: "Nederland" },
					telefoon: { type: "string" },
					email: { type: "string", description: "Email address", example: "info@example.com" },
					notitie: { type: "string", description: "Notes" },
				},
			},
			response: {
				200: {
					description: "Relatie created",
					schema: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							relatieId: { type: "string" },
							code: { type: "string", description: "Auto-generated relatie code" },
						},
					},
				},
			},
			handler: async (query, body) => {
				const result = await withBrowser(createRelatie, body);
				return { success: true, ...result };
			},
		},
		{
			method: "POST",
			path: "/api/offerte",
			summary: "Create offerte",
			description: "Creates an offerte in e-Boekhouden via browser automation. Idempotent: duplicate kenmerk values return the cached result within the TTL window.",
			auth: true,
			body: {
				required: ["relatieCode", "templateId", "kenmerk", "items"],
				properties: {
					relatieCode: { type: "string", description: "Relatie code in e-Boekhouden", example: "10001" },
					templateId: { type: "string", description: "Offerte template ID", example: "123456" },
					inExVat: { type: "string", enum: ["IN", "EX"], default: "IN", description: "Prices incl or excl BTW" },
					kenmerk: { type: "string", description: "Reference text (also used as idempotency key)", example: "Project Alpha" },
					emailTemplateId: { type: "string", description: "Email template ID (optional)", example: "789012" },
					items: {
						type: "array",
						description: "Line items to add to the offerte",
						items: {
							type: "object",
							required: ["quantity", "description", "pricePerUnit", "btwCode", "ledgerCode"],
							properties: {
								quantity: { type: "number", description: "Quantity", example: 1 },
								description: { type: "string", example: "Service description" },
								pricePerUnit: { type: "number", description: "Price per unit incl/excl BTW", example: 100 },
								btwCode: { type: "string", example: "hoog 21" },
								ledgerCode: { type: "string", example: "8000" },
							},
						},
					},
				},
			},
			response: {
				200: {
					description: "Offerte created (or returned from cache)",
					schema: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							offerteNumber: { type: "string", example: "Offerte: OF-391" },
							offerteId: { type: "string", example: "1234567" },
							cached: { type: "boolean", description: "True if returned from idempotency cache" },
						},
					},
				},
			},
			handler: async (query, body) => {
				const cached = cache.get(body.kenmerk);
				if (cached) {
					return {
						success: true,
						offerteNumber: cached.offerteNumber,
						offerteId: cached.offerteId,
						cached: true,
					};
				}
				const result = await withBrowser(createOfferte, body);
				cache.set(body.kenmerk, result);
				return { success: true, ...result, cached: false };
			},
		},
		{
			method: "POST",
			path: "/api/offerte/:id/status",
			summary: "Update offerte status",
			description: "Changes the status of an existing offerte. Valid statuses: 03. Wacht op antwoord, 04. Geaccepteerd, 05. Gefactureerd 25%, 06. Gefactureerd 60%, 07. Gefactureerd 100%, 08. Afgewezen.",
			auth: true,
			pathParams: {
				id: { type: "string", description: "e-Boekhouden offerte ID (from create response)" },
			},
			body: {
				required: ["status"],
				properties: {
					status: { type: "string", description: "New status value", example: "04. Geaccepteerd" },
				},
			},
			response: {
				200: {
					description: "Status updated",
					schema: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							offerteId: { type: "string" },
							status: { type: "string" },
						},
					},
				},
			},
			handler: async (query, body, params) => {
				const result = await withBrowser(updateOfferteStatus, params.id, body);
				return { success: true, ...result };
			},
		},
		{
			method: "POST",
			path: "/api/offerte/:id/email",
			summary: "Send offerte email",
			description: "Opens the email compose modal on the offerte dashboard, selects the email template, and sends the email.",
			auth: true,
			pathParams: {
				id: { type: "string", description: "e-Boekhouden offerte ID (from create response)" },
			},
			body: {
				required: ["emailTemplateId"],
				properties: {
					emailTemplateId: { type: "string", description: "Email template ID (required — compose form has no subject without it)", example: "789012" },
				},
			},
			response: {
				200: {
					description: "Email sent (or returned from idempotency cache)",
					schema: {
						type: "object",
						properties: {
							success: { type: "boolean" },
							offerteId: { type: "string" },
							emailSent: { type: "boolean" },
							cached: { type: "boolean", description: "True if email was already sent with this template" },
						},
					},
				},
			},
			handler: async (query, body, params) => {
				if (cache.wasEmailSent(params.id, body.emailTemplateId)) {
					return { success: true, offerteId: params.id, emailSent: true, cached: true };
				}
				const result = await withBrowser(sendOfferteEmail, params.id, body || {});
				cache.logEmailSent(params.id, body.emailTemplateId);
				return { success: true, ...result, cached: false };
			},
		}] : []),
		{
			method: "GET",
			path: "/api/offerte/:id/pdf",
			summary: "Download offerte PDF",
			description: "Fetches the offerte PDF from e-Boekhouden using the authenticated browser session and streams it back.",
			auth: true,
			binary: true,
			pathParams: {
				id: { type: "string", description: "e-Boekhouden offerte ID" },
			},
			response: {
				200: {
					description: "PDF file",
					contentType: "application/pdf",
				},
			},
			handler: async (query, body, params) => {
				return await withBrowser(getOffertePdf, params.id);
			},
		},
	];
}

// Generate OpenAPI 3.0 spec from route definitions
export function generateOpenApiSpec(routes) {
	const paths = {};

	for (const route of routes) {
		const method = route.method.toLowerCase();
		const operation = {
			summary: route.summary,
			description: route.description,
			responses: {},
		};

		if (route.auth) {
			operation.security = [{ BearerAuth: [] }];
		}

		// Path parameters
		if (route.pathParams) {
			operation.parameters = Object.entries(route.pathParams).map(([name, schema]) => ({
				name,
				in: "path",
				required: true,
				schema: { type: schema.type },
				description: schema.description,
			}));
		}

		// Query parameters
		if (route.query) {
			const queryParams = Object.entries(route.query).map(([name, schema]) => ({
				name,
				in: "query",
				required: false,
				schema: { type: schema.type },
				description: schema.description,
			}));
			operation.parameters = [...(operation.parameters || []), ...queryParams];
		}

		// Request body
		if (route.body) {
			operation.requestBody = {
				required: true,
				content: {
					"application/json": {
						schema: {
							type: "object",
							required: route.body.required,
							properties: route.body.properties,
						},
					},
				},
			};
		}

		// Responses
		for (const [code, resp] of Object.entries(route.response)) {
			if (resp.contentType && resp.contentType !== "application/json") {
				operation.responses[code] = {
					description: resp.description,
					content: {
						[resp.contentType]: { schema: { type: "string", format: "binary" } },
					},
				};
			} else {
				operation.responses[code] = {
					description: resp.description,
					content: {
						"application/json": { schema: resp.schema },
					},
				};
			}
		}

		// Convert Express-style :param to OpenAPI {param}
		const oaPath = route.path.replace(/:([^/]+)/g, "{$1}");
		paths[oaPath] = { ...paths[oaPath], [method]: operation };
	}

	return {
		openapi: "3.0.3",
		info: {
			title: "e-Boekhouden API",
			description: "Browser automation API for e-Boekhouden. Uses Playwright to drive the web UI for operations not available via the official API.",
			version: "1.0.0",
		},
		servers: [{ url: "/" }],
		paths,
		components: {
			securitySchemes: {
				BearerAuth: {
					type: "http",
					scheme: "bearer",
					description: "API key passed as Bearer token",
				},
			},
		},
	};
}
