import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ObjectId } from "mongodb";
import {
  balances,
  brl,
  buildShares,
  parseMoney,
  settle,
} from "../domain/finance";

const person = () => new ObjectId();
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const equal = (total: number, ids: ObjectId[]) =>
  buildShares(
    total,
    ids.map((personId) => ({ personId })),
  );
const get = (m: Map<string, number>, id: ObjectId) => m.get(String(id)) ?? 0;

describe("parseMoney", () => {
  it("aceita vírgula e ponto como separador decimal", () => {
    assert.equal(parseMoney("60,50"), 6050);
    assert.equal(parseMoney("60.50"), 6050);
    assert.equal(parseMoney("60"), 6000);
  });

  it("aceita R$ e separador de milhar", () => {
    assert.equal(parseMoney("R$ 1.200,50"), 120050);
  });

  it("não perde centavos por ponto flutuante", () => {
    assert.equal(parseMoney("0,29"), 29); // 0.29 * 100 = 28.999999999999996
    assert.equal(parseMoney("1.15"), 115); // 1.15 * 100 = 114.99999999999999
  });

  it("recusa vazio, texto e negativo", () => {
    for (const bad of ["", "abc", "-10", "R$ -5,00"]) {
      assert.throws(
        () => parseMoney(bad),
        /inválido/,
        `deveria recusar "${bad}"`,
      );
    }
  });
});

describe("brl", () => {
  it("formata em reais", () => {
    assert.match(brl(6050), /^R\$\s60,50$/);
    assert.match(brl(120050), /^R\$\s1\.200,50$/);
  });
});

describe("buildShares", () => {
  it("divide R$ 100 entre 3 sem perder centavo", () => {
    const s = buildShares(
      10000,
      [person(), person(), person()].map((personId) => ({ personId })),
    );
    assert.deepEqual(
      s.map((x) => x.cents),
      [3334, 3333, 3333],
    );
  });

  it("a soma das partes sempre fecha no total, e ninguém paga mais de 1 centavo a mais", () => {
    for (let total = 1; total <= 500; total++) {
      for (let n = 1; n <= 7; n++) {
        const cents = equal(total, Array.from({ length: n }, person)).map(
          (s) => s.cents,
        );
        assert.equal(sum(cents), total);
        assert.ok(Math.max(...cents) - Math.min(...cents) <= 1);
      }
    }
  });

  it("valor fixo para uma pessoa e o resto dividido entre as demais", () => {
    const [a, b, c, davi] = [person(), person(), person(), person()];
    const s = buildShares(20000, [
      { personId: a },
      { personId: b },
      { personId: c },
      { personId: davi, cents: 2000 },
    ]);
    assert.deepEqual(
      s.map((x) => x.cents),
      [6000, 6000, 6000, 2000],
    );
  });

  it("recusa valores fixos acima do total", () => {
    assert.throws(
      () =>
        buildShares(1000, [
          { personId: person(), cents: 1500 },
          { personId: person() },
        ]),
      /passam do total/,
    );
  });

  it("com todos os valores fixos, exige que a soma feche o total", () => {
    const [a, b] = [person(), person()];
    assert.throws(
      () =>
        buildShares(1000, [
          { personId: a, cents: 400 },
          { personId: b, cents: 400 },
        ]),
      /difere do total/,
    );
    const ok = buildShares(1000, [
      { personId: a, cents: 400 },
      { personId: b, cents: 600 },
    ]);
    assert.deepEqual(
      ok.map((x) => x.cents),
      [400, 600],
    );
  });

  it("recusa gasto sem participantes", () => {
    assert.throws(() => buildShares(1000, []), /ao menos um participante/);
  });
});

describe("balances", () => {
  // O exemplo da noite: Uber de 60 (Cesar pagou) e bar de 200 (Ana pagou)
  const [cesar, ana, bia, davi] = [person(), person(), person(), person()];
  const uber = {
    paidBy: cesar,
    cents: 6000,
    shares: equal(6000, [cesar, ana, bia]),
  };
  const bar = {
    paidBy: ana,
    cents: 20000,
    shares: equal(20000, [cesar, ana, bia, davi]),
  };

  it("calcula o saldo líquido de cada pessoa", () => {
    const b = balances([uber, bar], []);
    assert.equal(get(b, cesar), -1000);
    assert.equal(get(b, ana), 13000);
    assert.equal(get(b, bia), -7000);
    assert.equal(get(b, davi), -5000);
    assert.equal(sum([...b.values()]), 0);
  });

  it("um pagamento reduz a dívida de quem pagou e o crédito de quem recebeu", () => {
    const b = balances([uber, bar], [{ from: bia, to: ana, cents: 7000 }]);
    assert.equal(get(b, bia), 0);
    assert.equal(get(b, ana), 6000);
  });

  it("aceita pagamento parcial", () => {
    const b = balances([uber, bar], [{ from: davi, to: ana, cents: 2000 }]);
    assert.equal(get(b, davi), -3000);
    assert.equal(get(b, ana), 11000);
  });
});

describe("settle", () => {
  it("sem dívidas, não há transferências", () => {
    assert.deepEqual(settle(new Map()), []);
    assert.deepEqual(
      settle(
        new Map([
          ["a", 0],
          ["b", 0],
        ]),
      ),
      [],
    );
  });

  it("no exemplo da noite, todos pagam a Ana (3 transferências em vez de 5)", () => {
    const [cesar, ana, bia, davi] = [person(), person(), person(), person()];
    const uber = {
      paidBy: cesar,
      cents: 6000,
      shares: equal(6000, [cesar, ana, bia]),
    };
    const bar = {
      paidBy: ana,
      cents: 20000,
      shares: equal(20000, [cesar, ana, bia, davi]),
    };
    const t = settle(balances([uber, bar], []));
    assert.equal(t.length, 3);
    assert.ok(t.every((x) => x.to === String(ana)));
    assert.equal(sum(t.map((x) => x.cents)), 13000);
  });

  // Teste de propriedade: cenários aleatórios, mas com semente fixa (sempre os mesmos)
  function mulberry32(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("em 300 cenários aleatórios: saldos somam zero, as transferências zeram todos e são no máximo n-1", () => {
    const rand = mulberry32(42);
    const int = (min: number, max: number) =>
      min + Math.floor(rand() * (max - min + 1));

    for (let k = 0; k < 300; k++) {
      const people = Array.from({ length: int(2, 6) }, person);
      const expenses = Array.from({ length: int(1, 8) }, () => {
        const cents = int(100, 50000);
        const who = people.filter(() => rand() < 0.6);
        return {
          paidBy: people[int(0, people.length - 1)],
          cents,
          shares: equal(cents, who.length ? who : [people[0]]),
        };
      });

      const bal = balances(expenses, []);
      assert.equal(sum([...bal.values()]), 0);

      const transfers = settle(bal);
      assert.ok(transfers.length <= people.length - 1);

      const after = new Map(bal);
      for (const t of transfers) {
        after.set(t.from, after.get(t.from)! + t.cents);
        after.set(t.to, after.get(t.to)! - t.cents);
      }
      for (const v of after.values()) assert.equal(v, 0);
    }
  });
});
