// GitHub の Contents API で非公開リポジトリを読み書きする

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function enc(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class Repo {
  constructor({ owner, repo, token }) {
    this.base = `${API}/repos/${owner}/${repo}`;
    this.token = token;
  }

  headers(accept) {
    return {
      Accept: accept,
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async req(path, { accept = "application/vnd.github+json", method = "GET", body } = {}) {
    const url = path.startsWith("http") ? path : `${this.base}${path}`;
    const r = await fetch(url, {
      method,
      headers: { ...this.headers(accept), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).message || msg; } catch { /* 本文なし */ }
      throw new GitHubError(r.status, msg);
    }
    return r;
  }

  async check() {
    const r = await this.req("");
    const j = await r.json();
    return { name: j.full_name, private: j.private, push: j.permissions?.push ?? null };
  }

  async text(path) {
    const r = await this.req(`/contents/${enc(path)}`, { accept: "application/vnd.github.raw+json" });
    return r.text();
  }

  async blob(path) {
    const r = await this.req(`/contents/${enc(path)}`, { accept: "application/vnd.github.raw+json" });
    return r.blob();
  }

  async list(dir) {
    try {
      const r = await this.req(`/contents/${enc(dir)}`);
      return await r.json();
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  // ファイルの内容と sha を取得（なければ null）
  async getFile(path) {
    try {
      const r = await this.req(`/contents/${enc(path)}`);
      const j = await r.json();
      const bin = atob(j.content.replace(/\n/g, ""));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return { sha: j.sha, text: new TextDecoder().decode(bytes) };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async putFile(path, text, message, sha) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    const r = await this.req(`/contents/${enc(path)}`, {
      method: "PUT",
      body: { message, content: btoa(bin), ...(sha ? { sha } : {}) },
    });
    return (await r.json()).content.sha;
  }
}
