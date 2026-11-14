import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import session from "express-session";
import { createApp } from "./app";

// Estes testes sobem o app de verdade, mas só exercitam o que não precisa de banco:
// sessão em memória e requisições sem login.
let server: Server;
let base: string;

before(async () => {
  server = createApp(new session.MemoryStore()).listen(0);
  await new Promise((ok) => server.once("listening", ok));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

const call = (path: string, method = "GET") => fetch(base + path, { method, redirect: "manual" });

describe("sem login, nada de grupo é acessível", () => {
  const protectedRoutes: [string, string][] = [
    ["GET", "/"], ["POST", "/groups"],
    ["GET", "/g/abc"], ["POST", "/g/abc/people"], ["POST", "/g/abc/outings"], ["POST", "/g/abc/convite/renovar"],
    ["POST", "/g/abc/expenses"], ["GET", "/g/abc/expenses/x/edit"], ["POST", "/g/abc/expenses/x/edit"], ["POST", "/g/abc/expenses/x/delete"],
    ["POST", "/g/abc/payments"], ["POST", "/g/abc/payments/x/delete"],
    ["GET", "/g/abc/relatorio.pdf"], ["GET", "/convite/qualquer-token"],
  ];
  for (const [method, path] of protectedRoutes) {
    it(`${method} ${path} redireciona para o login`, async () => {
      const r = await call(path, method);
      assert.equal(r.status, 302);
      assert.match(r.headers.get("location") ?? "", /^\/login\?next=/);
    });
  }
});

describe("páginas públicas", () => {
  it("login e cadastro abrem", async () => {
    assert.equal((await call("/login")).status, 200);
    assert.equal((await call("/cadastro")).status, 200);
  });

  it("o CSS é servido", async () => {
    const r = await call("/css/style.css");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /css/);
  });

  it("o destino pós-login só aceita caminhos internos", async () => {
    assert.match(await (await call("/login?next=/g/1")).text(), /name="next" value="\/g\/1"/);
    assert.match(await (await call("/login?next=//evil.com")).text(), /name="next" value="\/"/);
    assert.match(await (await call("/login?next=/%5Cevil.com")).text(), /name="next" value="\/"/);
  });
});
