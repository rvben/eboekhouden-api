#!/usr/bin/env node
// CLI for one-off e-Boekhouden operations without running the server.
// Usage: node src/cli.mjs <command> [args]

import { EBoekhouden } from "./eboekhouden.mjs";
import { listOffertes, listRelaties } from "./routes/read.mjs";
import { createOfferte, updateOfferteStatus, sendOfferteEmail, getOffertePdf } from "./routes/offerte.mjs";
import { createRelatie } from "./routes/relatie.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const commands = {
	offertes: {
		usage: "offertes [search]",
		description: "List offertes (optionally filter by search term)",
		run: (eb, args) => listOffertes(eb, { search: args[0], all: "true" }),
	},
	relaties: {
		usage: "relaties [search]",
		description: "List relaties (optionally filter by search term)",
		run: (eb, args) => listRelaties(eb, { search: args[0], all: "true" }),
	},
	"create-relatie": {
		usage: "create-relatie <json-file>",
		description: "Create a relatie from a JSON file",
		run: (eb, args) => {
			if (!args[0]) { console.error("Usage: create-relatie <json-file>"); process.exit(1); }
			const data = JSON.parse(readFileSync(args[0], "utf-8"));
			return createRelatie(eb, data);
		},
	},
	"create-offerte": {
		usage: "create-offerte <json-file>",
		description: "Create an offerte from a JSON file",
		run: (eb, args) => {
			if (!args[0]) { console.error("Usage: create-offerte <json-file>"); process.exit(1); }
			const data = JSON.parse(readFileSync(args[0], "utf-8"));
			return createOfferte(eb, data);
		},
	},
	status: {
		usage: "status <offerte-id> <status>",
		description: "Update offerte status (e.g. '04. Geaccepteerd')",
		run: (eb, args) => {
			if (!args[0] || !args[1]) { console.error("Usage: status <offerte-id> <status>"); process.exit(1); }
			return updateOfferteStatus(eb, args[0], { status: args.slice(1).join(" ") });
		},
	},
	email: {
		usage: "email <offerte-id> <email-template-id>",
		description: "Send offerte email using a template",
		run: (eb, args) => {
			if (!args[0] || !args[1]) { console.error("Usage: email <offerte-id> <email-template-id>"); process.exit(1); }
			return sendOfferteEmail(eb, args[0], { emailTemplateId: args[1] });
		},
	},
	pdf: {
		usage: "pdf <offerte-id> [output-file]",
		description: "Download offerte PDF",
		run: async (eb, args) => {
			if (!args[0]) { console.error("Usage: pdf <offerte-id> [output-file]"); process.exit(1); }
			const result = await getOffertePdf(eb, args[0]);
			const filename = args[1] || result.filename || `offerte-${args[0]}.pdf`;
			writeFileSync(filename, result.body);
			return { saved: filename, size: result.body.length };
		},
	},
};

const [command, ...args] = process.argv.slice(2);

if (!command || command === "help" || command === "--help") {
	console.log("Usage: node src/cli.mjs <command> [args]\n");
	console.log("Commands:");
	for (const [name, cmd] of Object.entries(commands)) {
		console.log(`  ${cmd.usage.padEnd(40)} ${cmd.description}`);
	}
	process.exit(0);
}

if (!commands[command]) {
	console.error(`Unknown command: ${command}. Run with --help for usage.`);
	process.exit(1);
}

const USERNAME = process.env.EBOEKHOUDEN_USERNAME;
const PASSWORD = process.env.EBOEKHOUDEN_PASSWORD;

if (!USERNAME || !PASSWORD) {
	console.error("Missing env vars: EBOEKHOUDEN_USERNAME, EBOEKHOUDEN_PASSWORD");
	process.exit(1);
}

const eb = new EBoekhouden({ username: USERNAME, password: PASSWORD });

try {
	await eb.launch();
	await eb.login();
	const result = await commands[command].run(eb, args);
	console.log(JSON.stringify(result, null, 2));
} catch (err) {
	console.error(`Error: ${err.message}`);
	process.exit(1);
} finally {
	await eb.close();
}
