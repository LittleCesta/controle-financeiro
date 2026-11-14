import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paginate } from "./pagination";

const list = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginate", () => {
  it("lista vazia tem 1 página vazia", () => {
    assert.deepEqual(paginate([], 1), { items: [], page: 1, pages: 1, total: 0 });
  });

  it("divide em páginas de 10, e a última leva o resto", () => {
    assert.deepEqual(paginate(list(25), 1).items, list(10));
    assert.deepEqual(paginate(list(25), 2).items, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const last = paginate(list(25), 3);
    assert.deepEqual(last.items, [21, 22, 23, 24, 25]);
    assert.equal(last.pages, 3);
    assert.equal(last.total, 25);
  });

  it("múltiplo exato do tamanho não cria página vazia", () => {
    assert.equal(paginate(list(20), 1).pages, 2);
    assert.equal(paginate(list(10), 1).pages, 1);
    assert.equal(paginate(list(11), 1).pages, 2);
  });

  it("página fora do intervalo ou inválida cai numa página válida", () => {
    assert.equal(paginate(list(25), 99).page, 3);
    for (const bad of [0, -5, "abc", "", undefined, null, NaN]) {
      assert.equal(paginate(list(25), bad).page, 1, `deveria tratar ${String(bad)} como página 1`);
    }
  });

  it("aceita o número como texto, como vem da URL", () => {
    assert.equal(paginate(list(25), "2").page, 2);
  });

  it("percorrer todas as páginas devolve cada item uma vez, na mesma ordem", () => {
    const all = list(47);
    const { pages } = paginate(all, 1);
    const joined = Array.from({ length: pages }, (_, i) => paginate(all, i + 1).items).flat();
    assert.deepEqual(joined, all);
  });

  it("respeita um tamanho de página diferente", () => {
    assert.deepEqual(paginate(list(7), 2, 3).items, [4, 5, 6]);
  });
});
