/**
 * Cloudflare D1 HTTP API adapter.
 * Lets Node/Vercel code expose the same small D1 binding surface used by
 * functions/utils/d1Database.js: prepare().bind().first/all/run().
 */

export class CloudflareD1 {
    constructor(options = {}) {
        this.accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
        this.databaseId = options.databaseId || process.env.CLOUDFLARE_D1_DATABASE_ID;
        this.apiToken = options.apiToken || process.env.CLOUDFLARE_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
        this.apiBase = options.apiBase || 'https://api.cloudflare.com/client/v4';

        if (!this.accountId || !this.databaseId || !this.apiToken) {
            throw new Error('Cloudflare D1 is not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_D1_API_TOKEN.');
        }
    }

    prepare(sql) {
        return new CloudflareD1Statement(this, sql);
    }

    async query(sql, params = []) {
        const url = `${this.apiBase}/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sql, params }),
        });

        let data;
        try {
            data = await response.json();
        } catch (error) {
            throw new Error(`D1 API returned non-JSON response: ${response.status} ${response.statusText}`);
        }

        if (!response.ok || data.success === false) {
            const message = (data.errors || []).map(err => err.message || String(err)).join('; ') || response.statusText;
            throw new Error(`D1 API error: ${message}`);
        }

        const result = Array.isArray(data.result) ? data.result[0] : data.result;
        if (result && result.success === false) {
            const message = (result.error || result.errors || []).toString() || 'query failed';
            throw new Error(`D1 query error: ${message}`);
        }

        return result || { results: [], meta: {} };
    }
}

class CloudflareD1Statement {
    constructor(db, sql) {
        this._db = db;
        this._sql = sql;
        this._params = [];
    }

    bind(...params) {
        this._params = params.map(param => {
            if (param === undefined) return null;
            if (typeof param === 'boolean') return param ? 1 : 0;
            return param;
        });
        return this;
    }

    async first(column) {
        const result = await this._db.query(this._sql, this._params);
        const row = (result.results || [])[0] || null;
        if (!row) return null;
        return column ? row[column] : row;
    }

    async all() {
        const result = await this._db.query(this._sql, this._params);
        return { results: result.results || [] };
    }

    async run() {
        const result = await this._db.query(this._sql, this._params);
        return {
            success: true,
            meta: result.meta || {},
        };
    }
}
