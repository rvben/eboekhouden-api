import http from "node:http";
import crypto from "node:crypto";
import { EBoekhouden } from "./eboekhouden.mjs";
import { OfferteCache } from "./db.mjs";
import { ApiError } from "./errors.mjs";
import { defineRoutes, generateOpenApiSpec } from "./routes.mjs";

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
const USERNAME = process.env.EBOEKHOUDEN_USERNAME;
const PASSWORD = process.env.EBOEKHOUDEN_PASSWORD;
const DB_PATH = process.env.DB_PATH || "/data/offerte-cache.db";
const CACHE_TTL_DAYS = parseInt(process.env.CACHE_TTL_DAYS || "30", 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS || "300000", 10); // 5 min
const HANDLER_TIMEOUT_MS = parseInt(process.env.HANDLER_TIMEOUT_MS || "120000", 10); // 2 min
const READONLY = process.env.READONLY === "true";

if (!API_KEY || !USERNAME || !PASSWORD) {
	console.error("Missing required env vars: API_KEY, EBOEKHOUDEN_USERNAME, EBOEKHOUDEN_PASSWORD");
	process.exit(1);
}

const cache = new OfferteCache(DB_PATH, CACHE_TTL_DAYS);

// --- Session management ---

const session = {
	eb: new EBoekhouden({ username: USERNAME, password: PASSWORD }),
	mutex: null, // Promise that resolves when current request finishes
	idleTimer: null,
	startedAt: new Date().toISOString(),
	lastRequestAt: null,
};

function resetIdleTimer() {
	if (session.idleTimer) clearTimeout(session.idleTimer);
	session.idleTimer = setTimeout(async () => {
		if (session.mutex) return; // request in progress, skip
		console.log("[session] Idle timeout — closing browser");
		await session.eb.close();
	}, IDLE_TIMEOUT_MS);
}

function withTimeout(promise, ms) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Handler timed out after ${ms / 1000}s`)), ms);
		promise.then(
			(v) => { clearTimeout(timer); resolve(v); },
			(e) => { clearTimeout(timer); reject(e); },
		);
	});
}

async function withBrowser(handler, ...args) {
	while (session.mutex) {
		await session.mutex;
	}

	let resolve;
	session.mutex = new Promise((r) => { resolve = r; });

	try {
		try {
			await session.eb.ensureReady();
			const result = await withTimeout(handler(session.eb, ...args), HANDLER_TIMEOUT_MS);
			session.lastRequestAt = new Date().toISOString();
			resetIdleTimer();
			return result;
		} catch (err) {
			// Don't retry client errors — a fresh browser won't fix bad input
			if (err instanceof ApiError) throw err;

			console.error(`[session] Request failed, retrying with fresh session: ${err.message}`);
			await session.eb.close();
			try {
				await session.eb.ensureReady();
				const result = await withTimeout(handler(session.eb, ...args), HANDLER_TIMEOUT_MS);
				session.lastRequestAt = new Date().toISOString();
				resetIdleTimer();
				return result;
			} catch (retryErr) {
				console.error(`[session] Retry also failed, closing browser: ${retryErr.message}`);
				await session.eb.close();
				throw retryErr;
			}
		}
	} finally {
		session.mutex = null;
		resolve();
	}
}

// --- Routes ---

const routes = defineRoutes({ withBrowser, cache, readonly: READONLY });

// Set the health handler (needs session access)
routes.find((r) => r.path === "/api/health").handler = () => ({
	ok: true,
	browserActive: !!session.eb.browser,
	loggedIn: session.eb.isLoggedIn(),
	startedAt: session.startedAt,
	uptimeSeconds: Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000),
	lastRequestAt: session.lastRequestAt,
	cacheSize: cache.count(),
});

// Build OpenAPI spec once at startup
const openApiSpec = generateOpenApiSpec(routes);

// Index routes: exact matches in a Map, parameterized routes in an array
const routeMap = new Map();
const paramRoutes = [];
for (const route of routes) {
	if (route.path.includes(":")) {
		// Convert "/api/offerte/:id/status" to regex /^\/api\/offerte\/([^/]+)\/status$/
		const paramNames = [];
		const pattern = route.path.replace(/:([^/]+)/g, (_, name) => {
			paramNames.push(name);
			return "([^/]+)";
		});
		paramRoutes.push({ route, regex: new RegExp(`^${pattern}$`), paramNames });
	} else {
		routeMap.set(`${route.method} ${route.path}`, route);
	}
}

// --- HTTP helpers ---

function json(res, status, data) {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

async function readBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_SIZE) throw new Error("Body too large");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString());
}

// --- Server ---

const server = http.createServer(async (req, res) => {
	const start = Date.now();
	const url = new URL(req.url, `http://localhost:${PORT}`);

	// Root — service description for humans and AI agents
	if (url.pathname === "/") {
		return json(res, 200, {
			name: "e-Boekhouden API",
			description: "Browser automation API for e-Boekhouden. Uses Playwright to drive the web UI for operations not available via the official API.",
			docs: "/api/docs",
			health: "/api/health",
			endpoints: routes.map((r) => ({ method: r.method, path: r.path, summary: r.summary, auth: r.auth })),
		});
	}

	// Serve OpenAPI spec (no auth)
	if (url.pathname === "/api/docs") {
		return json(res, 200, openApiSpec);
	}

	// Match route (exact first, then parameterized)
	let route = routeMap.get(`${req.method} ${url.pathname}`);
	let params = {};
	if (!route) {
		for (const { route: r, regex, paramNames } of paramRoutes) {
			if (r.method !== req.method) continue;
			const match = url.pathname.match(regex);
			if (match) {
				route = r;
				params = Object.fromEntries(paramNames.map((name, i) => [name, match[i + 1]]));
				break;
			}
		}
	}
	if (!route) {
		console.log(`${req.method} ${url.pathname} 404 ${Date.now() - start}ms`);
		return json(res, 404, { error: "Not found" });
	}

	// Auth check
	if (route.auth) {
		const auth = req.headers.authorization || "";
		const expected = `Bearer ${API_KEY}`;
		const ok = auth.length === expected.length
			&& crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
		if (!ok) {
			console.log(`${req.method} ${url.pathname} 401 ${Date.now() - start}ms`);
			return json(res, 401, { error: "Unauthorized" });
		}
	}

	const query = Object.fromEntries(url.searchParams);

	try {
		let body = undefined;
		if (req.method === "POST" && route.body) {
			try {
				body = await readBody(req);
			} catch {
				console.log(`${req.method} ${url.pathname} 400 ${Date.now() - start}ms`);
				return json(res, 400, { error: "Invalid JSON" });
			}
		}

		const result = await route.handler(query, body, params);

		// Binary routes return { body: Buffer, contentType: string }
		if (route.binary) {
			console.log(`${req.method} ${url.pathname} 200 ${Date.now() - start}ms ${result.body.length}B`);
			const headers = {
				"Content-Type": result.contentType,
				"Content-Length": result.body.length,
			};
			if (result.filename) {
				headers["Content-Disposition"] = `attachment; filename="${result.filename}"`;
			}
			res.writeHead(200, headers);
			return res.end(result.body);
		}

		console.log(`${req.method} ${url.pathname} 200 ${Date.now() - start}ms`);
		return json(res, 200, result);
	} catch (err) {
		const status = err.status || 500;
		const message = err.message || String(err);
		console.log(`${req.method} ${url.pathname} ${status} ${Date.now() - start}ms`);
		console.error(`[${url.pathname}] Error: ${message}`);
		const clientMessage = status < 500 ? message : "Internal server error";
		return json(res, status, { success: false, error: clientMessage });
	}
});

server.listen(PORT, () => {
	console.log(`e-Boekhouden API listening on port ${PORT}`);
	console.log(`Mode: ${READONLY ? "read-only" : "read-write"}`);
	console.log(`Idle timeout: ${IDLE_TIMEOUT_MS / 1000}s`);
	console.log(`API docs: http://localhost:${PORT}/api/docs`);
});

// Prune expired cache entries daily
setInterval(() => {
	const pruned = cache.prune();
	console.log("[cache] Pruned expired entries");
}, 24 * 60 * 60 * 1000);

// Graceful shutdown
async function shutdown(signal) {
	console.log(`[shutdown] ${signal} received — closing browser and server`);
	if (session.idleTimer) clearTimeout(session.idleTimer);
	await session.eb.close();
	server.close(() => process.exit(0));
	// Force exit after 5s if server.close() hangs
	setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
