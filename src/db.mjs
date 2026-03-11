// SQLite-based idempotency cache with TTL
import Database from "better-sqlite3";

export class OfferteCache {
	constructor(path, ttlDays = 30) {
		this.db = new Database(path);
		this.ttlMs = ttlDays * 24 * 60 * 60 * 1000;
		this.db.pragma("journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS offerte_cache (
				kenmerk TEXT PRIMARY KEY,
				offerte_number TEXT NOT NULL,
				offerte_id TEXT NOT NULL,
				created_at INTEGER NOT NULL
			)
		`);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS email_log (
				offerte_id TEXT NOT NULL,
				template_id TEXT NOT NULL,
				sent_at INTEGER NOT NULL,
				PRIMARY KEY (offerte_id, template_id)
			)
		`);
	}

	get(kenmerk) {
		const row = this.db.prepare(
			"SELECT * FROM offerte_cache WHERE kenmerk = ? AND created_at > ?",
		).get(kenmerk, Date.now() - this.ttlMs);
		if (!row) return null;
		return { offerteNumber: row.offerte_number, offerteId: row.offerte_id };
	}

	set(kenmerk, { offerteNumber, offerteId }) {
		this.db.prepare(
			"INSERT OR REPLACE INTO offerte_cache (kenmerk, offerte_number, offerte_id, created_at) VALUES (?, ?, ?, ?)",
		).run(kenmerk, offerteNumber, offerteId, Date.now());
	}

	clear() {
		this.db.exec("DELETE FROM offerte_cache");
	}

	count() {
		return this.db.prepare("SELECT COUNT(*) as n FROM offerte_cache WHERE created_at > ?").get(Date.now() - this.ttlMs).n;
	}

	// Email dedup — keyed on (offerte_id, template_id)
	wasEmailSent(offerteId, templateId) {
		const row = this.db.prepare(
			"SELECT 1 FROM email_log WHERE offerte_id = ? AND template_id = ? AND sent_at > ?",
		).get(offerteId, templateId, Date.now() - this.ttlMs);
		return !!row;
	}

	logEmailSent(offerteId, templateId) {
		this.db.prepare(
			"INSERT OR REPLACE INTO email_log (offerte_id, template_id, sent_at) VALUES (?, ?, ?)",
		).run(offerteId, templateId, Date.now());
	}

	prune() {
		this.db.prepare("DELETE FROM offerte_cache WHERE created_at <= ?").run(Date.now() - this.ttlMs);
		this.db.prepare("DELETE FROM email_log WHERE sent_at <= ?").run(Date.now() - this.ttlMs);
	}
}
