import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, newToken, safeNext, verifyPassword } from "./auth";

describe("senhas", () => {
  it("aceita a senha certa e recusa a errada", async () => {
    const hash = await hashPassword("segredo123");
    assert.equal(await verifyPassword("segredo123", hash), true);
    assert.equal(await verifyPassword("segredo124", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  it("não guarda a senha em texto puro", async () => {
    assert.ok(!(await hashPassword("segredo123")).includes("segredo123"));
  });

  it("a mesma senha gera hashes diferentes (sal aleatório), e ambos validam", async () => {
    const [a, b] = [await hashPassword("segredo123"), await hashPassword("segredo123")];
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("segredo123", a), true);
    assert.equal(await verifyPassword("segredo123", b), true);
  });

  it("recusa um hash adulterado", async () => {
    const hash = await hashPassword("segredo123");
    const last = hash.at(-1) === "0" ? "1" : "0";
    assert.equal(await verifyPassword("segredo123", hash.slice(0, -1) + last), false);
  });
});

describe("safeNext (destino depois do login)", () => {
  it("aceita caminhos internos do site", () => {
    assert.equal(safeNext("/"), "/");
    assert.equal(safeNext("/g/123"), "/g/123");
    assert.equal(safeNext("/convite/abc?x=1"), "/convite/abc?x=1");
  });

  it("recusa qualquer destino que leve para fora do site", () => {
    for (const evil of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "", undefined, null, 42]) {
      assert.equal(safeNext(evil), "/", `deveria recusar ${JSON.stringify(evil)}`);
    }
  });
});

describe("newToken (link de convite)", () => {
  it("tem 32 caracteres seguros para URL e não se repete", () => {
    const tokens = new Set(Array.from({ length: 1000 }, newToken));
    assert.equal(tokens.size, 1000);
    for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]{32}$/);
  });
});
